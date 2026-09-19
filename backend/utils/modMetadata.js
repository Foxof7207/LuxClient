const fs = require('fs-extra');
const axios = require('axios');
const { readModCache, updateModCache } = require('./modCache');
const { downloadAndCacheIcon } = require('./icon-cache');

const API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'Client/Lux/1.0 (fernsehheft@pluginhub.de)';
const TIMEOUT_MS = 6000;
const HASH_BATCH = 100;
const PROJECT_BATCH = 80;
const ICON_POOL = 6;
const OFFLINE_COOLDOWN_MS = 60 * 1000;

let offlineUntil = 0;

const isModrinthEntry = (entry) => (entry?.source || 'modrinth') === 'modrinth';

function localPathOfIcon(icon) {
    if (typeof icon !== 'string' || !icon.startsWith('app-media:///')) return null;
    const rest = decodeURIComponent(icon.slice('app-media:///'.length));
    return process.platform === 'win32' ? rest : `/${rest.replace(/^\/+/, '')}`;
}

async function iconIsUsable(icon) {
    if (typeof icon !== 'string' || !icon.trim()) return false;
    const localPath = localPathOfIcon(icon);
    if (!localPath) return true;
    return fs.pathExists(localPath).catch(() => false);
}

async function needsDetails(entry, fileName) {
    if (!entry?.projectId || !isModrinthEntry(entry)) return false;
    if (!entry.title || entry.title === fileName) return true;
    if (entry.noIcon) return false;
    return !(await iconIsUsable(entry.icon));
}

async function modrinthRequest(config) {
    if (Date.now() < offlineUntil) throw new Error('modrinth_cooldown');
    try {
        const response = await axios({
            ...config,
            headers: { 'User-Agent': USER_AGENT },
            timeout: TIMEOUT_MS
        });
        return response.data;
    } catch (error) {
        const status = error?.response?.status;
        if (!status || status === 429 || status >= 500) offlineUntil = Date.now() + OFFLINE_COOLDOWN_MS;
        throw error;
    }
}

async function lookupVersionsByHash(hashes) {
    const found = new Map();
    for (let i = 0; i < hashes.length; i += HASH_BATCH) {
        const batch = hashes.slice(i, i + HASH_BATCH);
        try {
            const payload = await modrinthRequest({
                method: 'POST',
                url: `${API}/version_files`,
                data: { hashes: batch, algorithm: 'sha1' }
            });
            for (const [sha1, version] of Object.entries(payload || {})) {
                if (version?.project_id && version?.id) found.set(sha1, version);
            }
        } catch (_) {
            break;
        }
    }
    return found;
}

async function lookupProjects(projectIds) {
    const found = new Map();
    for (let i = 0; i < projectIds.length; i += PROJECT_BATCH) {
        const batch = projectIds.slice(i, i + PROJECT_BATCH);
        try {
            const payload = await modrinthRequest({
                method: 'GET',
                url: `${API}/projects`,
                params: { ids: JSON.stringify(batch) }
            });
            for (const project of Array.isArray(payload) ? payload : []) {
                if (project?.id) found.set(project.id, project);
            }
        } catch (_) {
            break;
        }
    }
    return found;
}

async function runPool(items, size, worker) {
    let index = 0;
    const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
        while (index < items.length) {
            const item = items[index++];
            await worker(item);
        }
    });
    await Promise.all(runners);
}

async function resolveContentMetadata({ items, modCachePath, hashFile, cacheIcons = true }) {
    const cache = await readModCache(modCachePath);
    const updates = {};
    const records = new Map();
    const unknownByHash = new Map();
    const detailTargets = new Map();

    const addDetailTarget = (projectId, cacheKey) => {
        if (!detailTargets.has(projectId)) detailTargets.set(projectId, []);
        detailTargets.get(projectId).push(cacheKey);
    };

    await Promise.all(items.map(async (item) => {
        const cacheKey = `${item.fileName}-${item.size}`;
        item.cacheKey = cacheKey;

        let entry = cache[cacheKey];
        if (!entry?.projectId && item.isFile) {
            let hash = null;
            try {
                hash = await hashFile(item.filePath);
            } catch (_) { }

            if (hash && cache[hash]?.projectId) {
                entry = { ...cache[hash], hash };
                updates[cacheKey] = entry;
            } else if (hash) {
                if (!unknownByHash.has(hash)) unknownByHash.set(hash, []);
                unknownByHash.get(hash).push(item);
            }
        }

        if (entry?.projectId) {
            records.set(cacheKey, { ...entry });
            if (await needsDetails(entry, item.fileName)) addDetailTarget(entry.projectId, cacheKey);
        }
    }));

    if (unknownByHash.size > 0) {
        const versions = await lookupVersionsByHash([...unknownByHash.keys()]);
        for (const [hash, version] of versions.entries()) {
            for (const item of unknownByHash.get(hash) || []) {
                const entry = {
                    version: version.version_number || null,
                    hash,
                    projectId: String(version.project_id),
                    versionId: String(version.id),
                    source: 'modrinth'
                };
                records.set(item.cacheKey, entry);
                updates[item.cacheKey] = entry;
                addDetailTarget(entry.projectId, item.cacheKey);
            }
        }
    }

    if (detailTargets.size > 0) {
        const projects = await lookupProjects([...detailTargets.keys()]);
        const iconJobs = [];

        for (const [projectId, project] of projects.entries()) {
            for (const cacheKey of detailTargets.get(projectId) || []) {
                const record = records.get(cacheKey);
                if (!record) continue;
                record.title = project.title || record.title;
                record.iconUrl = project.icon_url || record.iconUrl || null;
                record.icon = project.icon_url || null;
                record.noIcon = !project.icon_url;
                if (project.icon_url && cacheIcons) iconJobs.push(record);
                updates[cacheKey] = { ...(updates[cacheKey] || {}), ...record };
            }
        }

        await runPool(iconJobs, ICON_POOL, async (record) => {
            const cached = await downloadAndCacheIcon(record.iconUrl).catch(() => null);
            if (cached) record.icon = cached;
        });

        for (const [cacheKey, record] of records.entries()) {
            if (updates[cacheKey]) updates[cacheKey] = { ...updates[cacheKey], ...record };
        }
    }

    if (Object.keys(updates).length > 0) {
        await updateModCache(modCachePath, updates).catch((error) => {
            console.error('[ModMetadata] Failed to save mod cache updates:', error.message);
        });
    }

    return items.map((item) => {
        const record = records.get(item.cacheKey) || null;
        return {
            item,
            title: record?.title || null,
            icon: record?.icon || null,
            version: record?.version || null,
            projectId: record?.projectId,
            versionId: record?.versionId,
            source: record?.source || 'modrinth'
        };
    });
}

module.exports = { resolveContentMetadata };
