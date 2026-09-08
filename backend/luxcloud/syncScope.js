// Welche Teile einer Instanz synchronisiert werden, entscheidet der Server (der Nutzer
// stellt es dort pro Instanz ein), mit dem zuletzt bekannten lokalen Stand als Rueckfall.
//
// Diese Aufloesung lag frueher im IPC-Handler und war damit nur ueber IPC erreichbar. Der
// Abgleich vor dem Spielstart laeuft aber im Launcher, also im Hauptprozess -- ohne diese
// Datei haette er den Umfang entweder erraten oder dupliziert.

const api = require('./api');
const { readInstanceState, rememberRevision } = require('./syncState');

const SCOPE_KEYS = ['syncWorlds', 'syncScreenshots', 'crossPlatform'];

async function fetchCloudScope(instanceId) {
    try {
        const result = await api.authed({ method: 'GET', url: '/api/cloud/instances?status=all' });
        const found = (result.instances || []).find((entry) => entry.instanceUuid === String(instanceId));
        if (!found) return null;
        return {
            syncWorlds: found.syncWorlds,
            syncScreenshots: found.syncScreenshots,
            crossPlatform: found.crossPlatform
        };
    } catch (err) {
        console.warn(`[LuxCloud] Could not read the cloud sync scope (${err.code}), using the local one.`);
        return null;
    }
}

async function withSyncScope(instanceId, options = {}) {
    const tracked = (await readInstanceState(String(instanceId)).catch(() => null)) || {};
    const remote = await fetchCloudScope(instanceId);
    const merged = { ...options };

    for (const key of SCOPE_KEYS) {
        if (typeof merged[key] === 'boolean') continue;
        if (remote && typeof remote[key] === 'boolean') {
            merged[key] = remote[key];
            continue;
        }
        if (typeof tracked[key] === 'boolean') merged[key] = tracked[key];
    }

    if (remote) {
        await rememberRevision(String(instanceId), remote).catch(() => {});
    }
    if (!Array.isArray(merged.worldNames) && Array.isArray(tracked.syncWorldNames)) {
        merged.worldNames = tracked.syncWorldNames;
    }

    return merged;
}

module.exports = {
    SCOPE_KEYS,
    fetchCloudScope,
    withSyncScope
};
