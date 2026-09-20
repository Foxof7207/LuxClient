const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');

const { HashCache } = require('./hashCache');
const { readModCache, updateModCache } = require('../utils/modCache');
const { chunkFile, chunkListBlob } = require('./chunker');
const { chooseCompression } = require('./compression');
const { validRelPath } = require('./pathRules');
const {
    CATEGORY,
    classify,
    shouldSkipDirectory
} = require('./syncPolicy');

const MANIFEST_VERSION = 1;
const MAX_ENTRIES = 50000;
const ICON_BASENAME = 'instance-icon';

const SHA1_CATEGORIES = new Set([CATEGORY.MODS, CATEGORY.RESOURCEPACKS, CATEGORY.SHADERPACKS]);

// Felder, die nur auf diesem Geraet gelten und deshalb nicht in die Cloud gehoeren.
// Der Ziel-PC behaelt beim Restore seine eigenen Werte (siehe mergeInstanceConfig).
const DEVICE_LOCAL_FIELDS = [
    'folderPath',
    'externalPath',
    'javaPath',
    'status',
    'playtime',
    'lastPlayed',
    'instanceType',
    'lastUsedVersion'
];

// 'icon' ist ein Sonderfall und steht bewusst nicht in der Liste darueber: als
// ausgelagerter Dateiname ist es der Verweis auf die mitsynchronisierte
// instance-icon.* und gehoert damit zum Profil. Nur die alte Inline-Form (ein
// base64-data-URI, bis zu 3 MB) wird verworfen -- die wuerde das Manifest aufblaehen,
// und die Datei daneben transportiert dasselbe Bild bereits.
function isInlineIcon(value) {
    return typeof value === 'string' && value.startsWith('data:');
}

function sha256Of(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function scanInstance(instanceDir, options = {}) {
    const { syncWorlds = false, syncScreenshots = false, worldNames = null } = options;

    const files = [];
    const excluded = {};
    const oversized = [];

    const note = (reason) => {
        excluded[reason] = (excluded[reason] || 0) + 1;
    };

    async function walk(absDir, relDir) {
        let entries;
        try {
            entries = await fs.readdir(absDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                if (shouldSkipDirectory(relPath, { syncWorlds, syncScreenshots, worldNames })) {
                    note('policy:skipped-dir');
                    continue;
                }
                await walk(path.join(absDir, entry.name), relPath);
                continue;
            }

            if (!entry.isFile()) {
                note('policy:not-a-file');
                continue;
            }

            if (!validRelPath(relPath)) {
                note('invalid-path');
                continue;
            }

            const absPath = path.join(absDir, entry.name);
            let stat;
            try {
                stat = await fs.stat(absPath);
            } catch {
                note('unreadable');
                continue;
            }

            const verdict = classify(relPath, { syncWorlds, syncScreenshots, worldNames, size: stat.size });
            if (!verdict.include) {
                note(verdict.reason);
                if (verdict.reason === 'size:too-large') {
                    oversized.push({ path: relPath, size: stat.size });
                }
                continue;
            }

            files.push({
                relPath,
                absPath,
                size: stat.size,
                mtimeMs: Math.round(stat.mtimeMs),
                category: verdict.category,
                chunk: Boolean(verdict.chunk),
                compressible: Boolean(verdict.compressible)
            });
        }
    }

    await walk(instanceDir, '');
    files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

    return { files, excluded, oversized };
}

async function saveModCacheUpdates(modCachePath, updates) {
    if (!modCachePath || !updates || Object.keys(updates).length === 0) return false;

    try {
        return await updateModCache(modCachePath, updates);
    } catch {
        return false;
    }
}

async function loadModCache(modCachePath) {
    return readModCache(modCachePath);
}

function lookupSource(modCache, file, sha1) {
    const fileName = file.relPath.split('/').pop();
    const candidates = [`${fileName}-${file.size}`];
    if (sha1) candidates.push(sha1);

    for (const key of candidates) {
        const hit = modCache[key];
        if (!hit || !hit.projectId || !hit.versionId) continue;
        if ((hit.source || 'modrinth') !== 'modrinth') continue;

        const resolvedSha1 = typeof hit.hash === 'string' ? hit.hash : sha1;
        if (!resolvedSha1) continue;
        if (sha1 && resolvedSha1 !== sha1) continue;

        return {
            type: 'modrinth',
            projectId: String(hit.projectId),
            versionId: String(hit.versionId),
            sha1: resolvedSha1
        };
    }

    return null;
}

function normalizeInstanceConfig(config) {
    const normalized = {};
    for (const [key, value] of Object.entries(config || {})) {
        if (DEVICE_LOCAL_FIELDS.includes(key)) continue;
        if (key === 'icon' && isInlineIcon(value)) continue;
        normalized[key] = value;
    }
    return normalized;
}

// Gegenstueck zu normalizeInstanceConfig fuer den Download: alles Synchronisierte kommt
// aus der Cloud, die geraetelokalen Felder bleiben die dieses PCs. Ohne diesen Merge
// wuerde ein Restore die normalisierte Fassung einfach darueberschreiben und dabei
// javaPath, Spielzeit und den Installationszustand dieses Geraets loeschen.
function mergeInstanceConfig(remoteConfig, localConfig) {
    const merged = { ...(remoteConfig || {}) };
    const local = localConfig || {};

    for (const key of DEVICE_LOCAL_FIELDS) {
        if (key in local) merged[key] = local[key];
        else delete merged[key];
    }

    // Ein Icon aus der Cloud gewinnt, aber nur wenn es eines gibt -- Manifeste aus der
    // Zeit vor dieser Aenderung fuehren gar kein icon-Feld, und dann darf das lokale
    // Icon nicht verschwinden.
    if (!merged.icon && local.icon) merged.icon = local.icon;

    return merged;
}

// Der Server nimmt den Loader nur klein und ohne Sonderzeichen an (/^[a-z]{1,32}$/),
// waehrend in der instance.json "Fabric" oder "NeoForge" steht. Ungeprueft
// durchgereicht beantwortet er jeden Sync mit "Invalid loader" -- und zwar auch dann,
// wenn der Nutzer nichts angefasst hat.
const LOADER_RE = /^[a-z]{1,32}$/;
const MC_VERSION_RE = /^[0-9A-Za-z._+-]{1,32}$/;
const LOADER_VERSION_RE = /^[0-9A-Za-z._+-]{1,48}$/;

function runtimeFromConfig(config) {
    if (!config || typeof config !== 'object') return null;

    const runtime = {};

    const mcVersion = String(config.version || '').trim();
    if (MC_VERSION_RE.test(mcVersion)) runtime.mcVersion = mcVersion;

    const loader = String(config.loader || '').trim().toLowerCase();
    if (LOADER_RE.test(loader)) runtime.loader = loader;

    const loaderVersion = String(config.loaderVersion || '').trim();
    if (LOADER_VERSION_RE.test(loaderVersion)) runtime.loaderVersion = loaderVersion;

    return Object.keys(runtime).length > 0 ? runtime : null;
}

async function buildNormalizedInstanceJson(instanceDir) {
    const file = path.join(instanceDir, 'instance.json');
    if (!await fs.pathExists(file)) return null;

    let config;
    let stat;
    try {
        config = await fs.readJson(file);
        stat = await fs.stat(file);
    } catch {
        return null;
    }

    const buffer = Buffer.from(JSON.stringify(normalizeInstanceConfig(config), null, 2), 'utf8');
    return { buffer, sha256: sha256Of(buffer), config, mtimeMs: Math.round(stat.mtimeMs) };
}

async function buildManifest(options) {
    const {
        instanceDir,
        instanceId,
        name,
        hashCacheDir,
        modCachePath = null,
        syncWorlds = false,
        syncScreenshots = false,
        worldNames = null,
        enableChunking = false,
        device = null,
        runtime = null,
        settings = null,
        parentRevision = 0,
        playtimeTotalMs = 0,
        resolveOnline = false,
        onProgress = null
    } = options;

    const scan = await scanInstance(instanceDir, { syncWorlds, syncScreenshots, worldNames });
    if (scan.files.length > MAX_ENTRIES) {
        const error = new Error(`Instance has ${scan.files.length} syncable files, the limit is ${MAX_ENTRIES}`);
        error.code = 'too_many_entries';
        throw error;
    }

    const cache = await new HashCache(hashCacheDir, instanceId).load();
    const modCache = await loadModCache(modCachePath);

    const entries = [];
    const uploads = [];
    const excluded = { ...scan.excluded };
    const stats = {
        fileCount: scan.files.length,
        totalBytes: 0,
        referencedBytes: 0,
        uploadBytes: 0,
        chunkedFiles: 0,
        cachedHashes: 0,
        oversized: scan.oversized
    };

    const note = (reason) => {
        excluded[reason] = (excluded[reason] || 0) + 1;
    };

    let icon = null;
    let processed = 0;

    if (resolveOnline) {
        const pending = [];
        const bySha1 = new Map();

        for (const file of scan.files) {
            if (!SHA1_CATEGORIES.has(file.category)) continue;

            let hashed;
            try {
                hashed = await cache.resolve(file.relPath, file.absPath, { withSha1: true });
            } catch {
                continue;
            }
            if (!hashed.sha1) continue;
            if (lookupSource(modCache, file, hashed.sha1)) continue;

            pending.push(hashed.sha1);
            bySha1.set(hashed.sha1, file);
        }

        if (pending.length > 0) {
            if (onProgress) onProgress({ phase: 'resolve', total: pending.length });

            const { resolveBySha1, toModCacheEntries } = require('./modrinthResolver');
            const online = await resolveBySha1(pending);
            const updates = toModCacheEntries(online.resolved, bySha1);

            Object.assign(modCache, updates);
            await saveModCacheUpdates(modCachePath, updates);

            stats.onlineAttempted = online.attempted;
            stats.onlineResolved = online.resolved.size;
            stats.onlineFailed = online.failed;
        }
    }

    const instanceJson = await buildNormalizedInstanceJson(instanceDir);

    // Niemand ruft buildManifest mit einem runtime auf, wodurch das Feld bisher immer
    // leer blieb -- und mit ihm die Version-, Loader- und Loader-Version-Spalten der
    // Cloud-Instanz, die daraus befuellt werden. Die Werte stehen in der instance.json,
    // die hier ohnehin schon gelesen wurde.
    const resolvedRuntime = runtime || runtimeFromConfig(instanceJson && instanceJson.config);

    // Der Name kommt aus der instance.json, nicht aus dem Ordnernamen.
    //
    // Der Ordner kann auf jedem PC anders heissen -- schon ein zweiter Download legt
    // "Name (1)" an, weil der alte Ordner noch existiert. Als Ordnername im Manifest
    // machte das zwei Dinge kaputt: der Vergleichshash unterschied sich zwischen den
    // Geraeten, sodass der erste Sync nach einem Download eine Revision erzeugte, obwohl
    // niemand etwas geaendert hatte; und der zweite PC benannte die Cloud-Instanz nach
    // seinem eigenen Ordner um. Die instance.json wird synchronisiert und ist damit auf
    // beiden Seiten dieselbe Quelle.
    const configuredName = instanceJson && instanceJson.config
        && typeof instanceJson.config.name === 'string'
        && instanceJson.config.name.trim().length > 0
        ? instanceJson.config.name.trim()
        : null;
    const resolvedName = configuredName || name;

    for (const file of scan.files) {
        processed += 1;
        if (onProgress && processed % 25 === 0) {
            onProgress({ processed, total: scan.files.length, path: file.relPath });
        }

        if (file.relPath === 'instance.json') continue;

        const wantsSha1 = SHA1_CATEGORIES.has(file.category);
        let hashed;
        try {
            hashed = await cache.resolve(file.relPath, file.absPath, { withSha1: wantsSha1 });
        } catch {
            note('unreadable');
            continue;
        }

        if (hashed.size !== file.size) {
            note('changed-while-hashing');
            continue;
        }
        if (hashed.cached) stats.cachedHashes += 1;

        stats.totalBytes += file.size;

        const base = {
            path: file.relPath,
            size: file.size,
            mtime: file.mtimeMs,
            sha256: hashed.sha256
        };

        if (file.relPath.startsWith(`${ICON_BASENAME}.`)) {
            icon = { blob: hashed.sha256 };
        }

        const source = wantsSha1 ? lookupSource(modCache, file, hashed.sha1) : null;
        if (source) {
            entries.push({ ...base, source });
            stats.referencedBytes += file.size;
            continue;
        }

        if (enableChunking && file.chunk) {
            const chunked = await chunkFile(file.absPath);
            const list = chunkListBlob(chunked.chunks);

            entries.push({ ...base, chunks: { algo: chunked.algo, list: list.sha256 } });
            uploads.push({
                path: file.relPath,
                kind: 'chunk-list',
                sha256: list.sha256,
                size: list.buffer.length,
                buffer: list.buffer,
                compression: 'zstd'
            });
            for (const chunk of chunked.chunks) {
                uploads.push({
                    path: file.relPath,
                    kind: 'chunk',
                    sha256: chunk.sha256,
                    size: chunk.size,
                    offset: chunk.offset,
                    absPath: file.absPath,
                    compression: 'none'
                });
            }

            stats.chunkedFiles += 1;
            stats.uploadBytes += file.size;
            continue;
        }

        entries.push({ ...base, blob: hashed.sha256 });
        uploads.push({
            path: file.relPath,
            kind: 'file',
            sha256: hashed.sha256,
            size: file.size,
            absPath: file.absPath,
            compression: file.compressible ? chooseCompression(file.relPath, file.size) : 'none'
        });
        stats.uploadBytes += file.size;
    }

    if (instanceJson) {
        entries.push({
            path: 'instance.json',
            size: instanceJson.buffer.length,
            mtime: instanceJson.mtimeMs,
            sha256: instanceJson.sha256,
            blob: instanceJson.sha256
        });
        uploads.push({
            path: 'instance.json',
            kind: 'inline',
            sha256: instanceJson.sha256,
            size: instanceJson.buffer.length,
            buffer: instanceJson.buffer,
            compression: 'zstd'
        });
        stats.totalBytes += instanceJson.buffer.length;
        stats.uploadBytes += instanceJson.buffer.length;
    }

    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    await cache.prune(new Set(scan.files.map((file) => file.relPath)));
    await cache.save();

    const manifest = {
        manifestVersion: MANIFEST_VERSION,
        instanceId,
        name: resolvedName,
        parentRevision,
        createdAt: Date.now(),
        device: device || undefined,
        runtime: resolvedRuntime || undefined,
        settings: settings || undefined,
        icon: icon || undefined,
        playtime: { totalMs: playtimeTotalMs },
        entries,
        excluded
    };

    const serialized = Buffer.from(JSON.stringify(manifest), 'utf8');

    return {
        manifest,
        manifestBlob: { buffer: serialized, sha256: sha256Of(serialized) },
        contentHash: contentHashOf(manifest),
        uploads,
        stats
    };
}

function contentHashOf(manifest) {
    const relevant = {
        instanceId: manifest.instanceId,
        name: manifest.name,
        runtime: manifest.runtime || null,
        settings: manifest.settings || null,
        icon: manifest.icon || null,
        entries: (manifest.entries || []).map((entry) => [
            entry.path,
            entry.sha256,
            entry.blob || null,
            entry.source ? `${entry.source.projectId}:${entry.source.versionId}` : null,
            entry.chunks ? entry.chunks.list : null
        ])
    };
    return sha256Of(Buffer.from(JSON.stringify(relevant), 'utf8'));
}

function summarize(result) {
    const byCategory = {};
    for (const upload of result.uploads) {
        const top = upload.path.split('/')[0];
        byCategory[top] = (byCategory[top] || 0) + upload.size;
    }

    return {
        entries: result.manifest.entries.length,
        referencedFiles: result.manifest.entries.filter((entry) => entry.source).length,
        chunkedFiles: result.stats.chunkedFiles,
        totalBytes: result.stats.totalBytes,
        referencedBytes: result.stats.referencedBytes,
        uploadBytes: result.stats.uploadBytes,
        manifestBytes: result.manifestBlob.buffer.length,
        cachedHashes: result.stats.cachedHashes,
        excluded: result.manifest.excluded,
        oversized: result.stats.oversized,
        uploadBytesByFolder: byCategory
    };
}

module.exports = {
    MANIFEST_VERSION,
    MAX_ENTRIES,
    buildManifest,
    buildNormalizedInstanceJson,
    contentHashOf,
    mergeInstanceConfig,
    normalizeInstanceConfig,
    saveModCacheUpdates,
    scanInstance,
    summarize
};
