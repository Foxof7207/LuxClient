const fs = require('fs-extra');
const { writeJsonAtomic } = require('../luxcloud/atomicJson');

const queues = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function enqueue(filePath, task) {
    const previous = queues.get(filePath) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(filePath, next);
    next.catch(() => {}).finally(() => {
        if (queues.get(filePath) === next) queues.delete(filePath);
    });
    return next;
}

async function readRaw(filePath) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            if (!await fs.pathExists(filePath)) return {};
            const raw = await fs.readFile(filePath, 'utf8');
            if (!raw.trim()) return {};
            const data = JSON.parse(raw);
            return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch (_) {
            await delay(40 * (attempt + 1));
        }
    }
    return null;
}

async function readModCache(filePath) {
    if (!filePath) return {};
    return (await readRaw(filePath)) || {};
}

function mergeEntry(existing, update) {
    if (!existing || typeof existing !== 'object') {
        const fresh = {};
        for (const [key, value] of Object.entries(update)) {
            if (value !== undefined) fresh[key] = value;
        }
        return fresh;
    }

    const merged = { ...existing };
    for (const [key, value] of Object.entries(update)) {
        if (value === null || value === undefined || value === '') continue;
        merged[key] = value;
    }
    return merged;
}

function updateModCache(filePath, updates) {
    if (!filePath || !updates || Object.keys(updates).length === 0) return Promise.resolve(false);

    return enqueue(filePath, async () => {
        let current = await readRaw(filePath);
        if (current === null) {
            await fs.copy(filePath, `${filePath}.corrupt`).catch(() => {});
            current = {};
        }

        for (const [key, update] of Object.entries(updates)) {
            if (!update || typeof update !== 'object') continue;
            current[key] = mergeEntry(current[key], update);
        }

        await writeJsonAtomic(filePath, current, { spaces: 0 });
        return true;
    });
}

module.exports = { mergeEntry, readModCache, updateModCache };
