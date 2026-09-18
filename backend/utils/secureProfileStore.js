const { safeStorage } = require('electron');

const ENC_PREFIX = 'safe:v1:';

function encryptToken(value) {
    if (!value || typeof value !== 'string') return value;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return value;

    try {
        const encrypted = safeStorage.encryptString(value).toString('base64');
        return `${ENC_PREFIX}${encrypted}`;
    } catch {
        return value;
    }
}

// Returns why a token could not be read, not just that it could not be.
// On Linux the backend safeStorage picks (gnome-libsecret, kwallet, or the plaintext
// "basic" fallback) is chosen per run from what the session exposes. A sandboxed
// build that cannot reach org.freedesktop.secrets gets a different backend than the
// run that wrote the token, and the ciphertext then simply will not open again.
// Reporting that as an empty token is what makes the app look silently signed out.
function decryptTokenDetailed(value) {
    if (!value || typeof value !== 'string') return { value: value || null, status: 'empty' };

    if (!value.startsWith(ENC_PREFIX)) {
        return { value, status: 'plaintext' };
    }

    if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
        return { value: null, status: 'unavailable' };
    }

    try {
        const base64 = value.slice(ENC_PREFIX.length);
        return { value: safeStorage.decryptString(Buffer.from(base64, 'base64')), status: 'ok' };
    } catch (err) {
        return { value: null, status: 'failed', reason: (err && err.message) || null };
    }
}

function decryptToken(value) {
    return decryptTokenDetailed(value).value;
}

function toStoredProfile(profile) {
    if (!profile || typeof profile !== 'object') return profile;

    const stored = { ...profile };
    if (stored.access_token) {
        stored.access_token_enc = encryptToken(stored.access_token);
        delete stored.access_token;
    }
    if (stored.refresh_token) {
        stored.refresh_token_enc = encryptToken(stored.refresh_token);
        delete stored.refresh_token;
    }
    return stored;
}

function fromStoredProfile(profile) {
    if (!profile || typeof profile !== 'object') return profile;

    const hydrated = { ...profile };
    if (typeof hydrated.access_token_enc === 'string') {
        const accessToken = decryptToken(hydrated.access_token_enc);
        if (accessToken) hydrated.access_token = accessToken;
    }
    if (typeof hydrated.refresh_token_enc === 'string') {
        const refreshToken = decryptToken(hydrated.refresh_token_enc);
        if (refreshToken) hydrated.refresh_token = refreshToken;
    }

    delete hydrated.access_token_enc;
    delete hydrated.refresh_token_enc;

    return hydrated;
}

function needsMigration(rawProfile) {
    if (!rawProfile || typeof rawProfile !== 'object') return false;
    return Boolean(rawProfile.access_token || rawProfile.refresh_token);
}

function getUserProfile(store) {
    const rawProfile = store.get('user_profile');
    if (!rawProfile) return null;

    if (needsMigration(rawProfile)) {
        store.set('user_profile', toStoredProfile(rawProfile));
    }

    return fromStoredProfile(rawProfile);
}

function setUserProfile(store, profile) {
    store.set('user_profile', toStoredProfile(profile));
}

function getAccounts(store) {
    const rawAccounts = store.get('accounts') || [];
    if (!Array.isArray(rawAccounts)) return [];

    let migrationNeeded = false;
    const accounts = rawAccounts.map((account) => {
        if (needsMigration(account)) migrationNeeded = true;
        return fromStoredProfile(account);
    });

    if (migrationNeeded) {
        store.set('accounts', rawAccounts.map((account) => toStoredProfile(account)));
    }

    return accounts;
}

function setAccounts(store, accounts) {
    const safeAccounts = Array.isArray(accounts) ? accounts : [];
    store.set('accounts', safeAccounts.map((account) => toStoredProfile(account)));
}

module.exports = {
    encryptToken,
    decryptToken,
    decryptTokenDetailed,
    getUserProfile,
    setUserProfile,
    getAccounts,
    setAccounts
};
