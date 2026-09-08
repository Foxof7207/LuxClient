const api = require('./api');
const conflict = require('./conflict');
const downloader = require('./downloader');
const { readInstanceState } = require('./syncState');
const { buildManifestInWorker } = require('./manifestRunner');
const { getHashCacheDir } = require('./paths');

const HEAD_TIMEOUT_MS = 2500;

const DECISION = {
    LAUNCH: 'launch',
    UPDATED: 'updated',
    CONFLICT: 'conflict',
    OFFLINE: 'offline',
    NOT_LINKED: 'not-linked',
    DISABLED: 'disabled',
    BUSY: 'busy',
    TRASHED: 'trashed'
};

function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            const err = new api.LuxCloudError('offline', 'The cloud did not answer in time');
            reject(err);
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchHead(instanceId) {
    return withTimeout(
        api.authed({ method: 'GET', url: `/api/cloud/instances/${instanceId}/head?touch=1` }),
        HEAD_TIMEOUT_MS
    );
}

// Hat sich seit dem letzten Sync lokal etwas geaendert?
//
// Massstab ist derselbe Content-Hash, den auch der Upload benutzt. Der frueher genutzte
// Abgleich gegen den Hash-Cache taugt dafuer nicht: der Cache ist eine reine
// Pfad-zu-Hash-Tabelle, die bei JEDEM Manifest-Bau fortgeschrieben wird -- auch bei einem
// Bau, der nie committet wurde. Danach hielt er die geaenderten Dateien fuer den
// Referenzstand und meldete "sauber", obwohl die Cloud etwas voellig anderes kennt.
async function isDirtySinceLastSync(instanceDir, instanceId, tracked, options) {
    const scan = await conflict.isLocallyDirty(instanceDir, instanceId, {
        syncWorlds: Boolean(options.syncWorlds),
        syncScreenshots: Boolean(options.syncScreenshots),
        instanceConfigHash: tracked.lastInstanceConfigHash || null
    });

    // Ohne gespeicherten Content-Hash (Instanz aus einer aelteren Version) bleibt nur der
    // Cache-Abgleich.
    if (typeof tracked.lastContentHash !== 'string' || tracked.lastContentHash.length === 0) {
        return scan;
    }

    try {
        const built = await buildManifestInWorker({
            instanceDir,
            instanceId,
            name: tracked.instanceName || null,
            hashCacheDir: getHashCacheDir(),
            modCachePath: options.modCachePath || null,
            syncWorlds: Boolean(options.syncWorlds),
            syncScreenshots: Boolean(options.syncScreenshots),
            worldNames: Array.isArray(options.worldNames) ? options.worldNames : null,
            enableChunking: false,
            parentRevision: Number(tracked.lastKnownRevision || 0)
        });

        const changed = built.contentHash !== tracked.lastContentHash;
        return {
            dirty: changed,
            reason: changed ? 'content-hash' : 'clean',
            // Die Pfadliste stammt weiter aus dem Scan; sie ist nur Anzeige. Wenn der
            // Hash eine Aenderung sieht, der Scan aber nichts auflisten kann, bleibt die
            // Entscheidung trotzdem bei "geaendert".
            changed: changed ? scan.changed : []
        };
    } catch (err) {
        console.warn('[LuxCloud] Could not build the manifest for the pre-launch check:', err.message);
        return scan;
    }
}

async function checkBeforeLaunch({
    instanceDir,
    instanceId,
    instanceName,
    options = {},
    onProgress = null
} = {}) {
    const report = (phase, detail = {}) => {
        if (onProgress) onProgress({ instanceName, instanceId, phase, ...detail });
    };

    if (options.enabled === false) {
        return { decision: DECISION.DISABLED, canLaunch: true };
    }

    const tracked = await readInstanceState(instanceId);
    if (!tracked || !tracked.cloudLinked) {
        return { decision: DECISION.NOT_LINKED, canLaunch: true };
    }

    // Nothing to reconcile against while the cloud copy sits in the trash, and the game
    // must not be held up by a check the server will only reject.
    if (tracked.trashed) {
        return { decision: DECISION.TRASHED, canLaunch: true, lastSyncedAt: tracked.lastSyncedAt || null };
    }

    report('checking');

    let head;
    try {
        head = await fetchHead(instanceId);
    } catch (err) {
        // Jeder Weg, der 'checking' gemeldet hat, muss auch einen Schluss melden -- sonst
        // haengt die Anzeige beim Aufrufer auf "wird geprueft".
        report('offline', { reason: err.code || 'offline' });
        return {
            decision: DECISION.OFFLINE,
            canLaunch: true,
            reason: err.code || 'offline',
            lastSyncedAt: tracked.lastSyncedAt || null
        };
    }

    const localRevision = Number(tracked.lastKnownRevision || 0);
    const remoteRevision = Number(head.revision || 0);

    const dirty = await isDirtySinceLastSync(instanceDir, instanceId, tracked, options);

    const activeElsewhere = head.activeSession
        && head.activeSession.deviceUuid
        && head.activeSession.deviceUuid !== options.deviceUuid;

    const base = {
        localRevision,
        remoteRevision,
        dirty: dirty.dirty,
        changedLocally: dirty.changed.length,
        activeSession: activeElsewhere ? head.activeSession : null
    };

    if (remoteRevision <= localRevision) {
        report('ready', { revision: remoteRevision });
        return {
            ...base,
            decision: DECISION.LAUNCH,
            canLaunch: true,
            pushAfterLaunch: dirty.dirty
        };
    }

    if (!dirty.dirty) {
        report('updating', { from: localRevision, to: remoteRevision });

        const restored = await downloader.restoreInstance({
            instanceUuid: instanceId,
            instanceDir,
            instanceName,
            modCachePath: options.modCachePath || null,
            onProgress: (progress) => report('updating', progress)
        });

        report('ready', { revision: restored.revision });
        return {
            ...base,
            decision: DECISION.UPDATED,
            canLaunch: true,
            revision: restored.revision,
            downloadedBytes: restored.downloadedBytes,
            unavailable: restored.unavailable
        };
    }

    report('conflict', { localRevision, remoteRevision });

    const remote = await api.authed({
        method: 'GET',
        url: `/api/cloud/instances/${instanceId}/manifest?revision=latest`
    });

    let baseManifest = null;
    if (localRevision > 0) {
        try {
            const previous = await api.authed({
                method: 'GET',
                url: `/api/cloud/instances/${instanceId}/manifest?revision=${localRevision}`
            });
            baseManifest = previous.manifest;
        } catch (_) {
            baseManifest = null;
        }
    }

    return {
        ...base,
        decision: DECISION.CONFLICT,
        canLaunch: false,
        remoteManifest: remote.manifest,
        baseManifest,
        changed: dirty.changed.slice(0, 200)
    };
}

module.exports = {
    DECISION,
    HEAD_TIMEOUT_MS,
    checkBeforeLaunch,
    fetchHead
};
