const crypto = require('crypto');
const os = require('os');
const fs = require('fs-extra');

const { getStateFile } = require('./paths');
const { writeJsonAtomic, readJsonSafe } = require('./atomicJson');
const { encryptToken, decryptTokenDetailed } = require('../utils/secureProfileStore');

const EMPTY_STATE = {
    version: 1,
    deviceUuid: null,
    user: null,
    accessTokenExpiresAt: null,
    linkedAt: null
};

let cache = null;
let warnedUnreadable = false;

function newDeviceUuid() {
    return crypto.randomUUID().replace(/-/g, '');
}

function getDeviceName() {
    const hostname = os.hostname();
    if (typeof hostname === 'string' && hostname.trim().length > 0) {
        return hostname.trim().slice(0, 100);
    }
    return 'Lux Client';
}

async function readState() {
    if (cache) return cache;

    const raw = await readJsonSafe(getStateFile(), null);
    if (!raw || typeof raw !== 'object') {
        cache = { ...EMPTY_STATE };
        return cache;
    }

    const access = decryptTokenDetailed(raw.accessTokenEnc);
    const refresh = decryptTokenDetailed(raw.refreshTokenEnc);

    // A stored session that will not decrypt used to arrive here as "no tokens", which
    // is indistinguishable from being signed out - the account panel simply showed the
    // sign-in button again and every sync stopped without ever saying why. Keep the
    // distinction so the UI can tell the user that the keyring, not the account, is the
    // problem. This is what a Flatpak build without access to org.freedesktop.secrets
    // runs into: the tokens were written under a different safeStorage backend.
    const unreadable = refresh.status === 'unavailable' || refresh.status === 'failed'
        || access.status === 'unavailable' || access.status === 'failed';

    if (unreadable && !warnedUnreadable) {
        warnedUnreadable = true;
        console.warn(
            `[LuxCloud] The stored session could not be decrypted (${refresh.status}). `
            + 'The OS keyring is answering differently than when it was saved - signing in again will fix it.'
        );
    }

    cache = {
        ...EMPTY_STATE,
        ...raw,
        accessToken: access.value || null,
        refreshToken: refresh.value || null,
        sessionUnreadable: unreadable
    };
    delete cache.accessTokenEnc;
    delete cache.refreshTokenEnc;
    return cache;
}

async function writeState(next) {
    const stored = { ...next };
    delete stored.sessionUnreadable;
    stored.accessTokenEnc = next.accessToken ? encryptToken(next.accessToken) : null;
    stored.refreshTokenEnc = next.refreshToken ? encryptToken(next.refreshToken) : null;
    delete stored.accessToken;
    delete stored.refreshToken;

    await writeJsonAtomic(getStateFile(), stored);
    // Anything we just wrote we can read back, so a previous decrypt failure is over.
    cache = { ...next, sessionUnreadable: false };
    warnedUnreadable = false;
    return cache;
}

async function patchState(patch) {
    const current = await readState();
    return writeState({ ...current, ...patch });
}

async function ensureDeviceUuid() {
    const state = await readState();
    if (state.deviceUuid) return state.deviceUuid;

    const deviceUuid = newDeviceUuid();
    await patchState({ deviceUuid });
    return deviceUuid;
}

async function rotateDeviceUuid() {
    const deviceUuid = newDeviceUuid();
    await patchState({ deviceUuid });
    return deviceUuid;
}

async function setSession({ user, accessToken, refreshToken, expiresIn }) {
    return patchState({
        user,
        accessToken,
        refreshToken,
        accessTokenExpiresAt: Date.now() + (Number(expiresIn) || 0) * 1000,
        linkedAt: Date.now()
    });
}

async function updateTokens({ accessToken, refreshToken, expiresIn }) {
    return patchState({
        accessToken,
        refreshToken,
        accessTokenExpiresAt: Date.now() + (Number(expiresIn) || 0) * 1000
    });
}

async function clearSession() {
    cache = { ...EMPTY_STATE };
    warnedUnreadable = false;
    await fs.remove(getStateFile()).catch(() => {});
    return cache;
}

async function isLoggedIn() {
    const state = await readState();
    return Boolean(state.refreshToken && state.user);
}

module.exports = {
    clearSession,
    ensureDeviceUuid,
    getDeviceName,
    isLoggedIn,
    patchState,
    readState,
    rotateDeviceUuid,
    setSession,
    updateTokens
};
