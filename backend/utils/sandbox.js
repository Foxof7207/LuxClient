const fs = require('fs');

// A Flatpak or Snap build runs inside a sandbox whose filesystem, D-Bus access and
// desktop integration are all narrower than a .deb/.rpm install gets. Several things
// Lux Cloud depends on - registering the luxclient:// scheme with the host, reaching
// the login keyring, reading an instances folder the user picked before switching
// packaging - are decided by that sandbox and not by anything the app can change at
// runtime, so the cloud code has to be able to tell where it is running.

const KIND_NONE = 'none';
const KIND_FLATPAK = 'flatpak';
const KIND_SNAP = 'snap';
const KIND_APPIMAGE = 'appimage';

let cached = null;

function readFlatpakAppId() {
    if (typeof process.env.FLATPAK_ID === 'string' && process.env.FLATPAK_ID.trim()) {
        return process.env.FLATPAK_ID.trim();
    }

    try {
        const info = fs.readFileSync('/.flatpak-info', 'utf8');
        const match = info.match(/^\s*(?:name|app-id)\s*=\s*(.+)$/mi);
        return match ? match[1].trim() : null;
    } catch (_) {
        return null;
    }
}

function detect() {
    if (process.platform !== 'linux') {
        return { kind: KIND_NONE, appId: null, confined: false };
    }

    // /.flatpak-info exists in every Flatpak sandbox, including one the user started
    // with `flatpak run --env=...`, where FLATPAK_ID alone can be missing.
    if (process.env.FLATPAK_ID || fs.existsSync('/.flatpak-info')) {
        return { kind: KIND_FLATPAK, appId: readFlatpakAppId(), confined: true };
    }

    if (process.env.SNAP && process.env.SNAP_NAME) {
        return { kind: KIND_SNAP, appId: process.env.SNAP_NAME, confined: true };
    }

    // An AppImage is unpacked, not confined - it only matters for updates.
    if (process.env.APPIMAGE) {
        return { kind: KIND_APPIMAGE, appId: null, confined: false };
    }

    return { kind: KIND_NONE, appId: null, confined: false };
}

function describeSandbox() {
    if (!cached) cached = detect();
    return cached;
}

function isFlatpak() {
    return describeSandbox().kind === KIND_FLATPAK;
}

function isSnap() {
    return describeSandbox().kind === KIND_SNAP;
}

// True for packagings that hide part of the host from the process. Everything that
// behaves differently because of the sandbox keys off this rather than off Flatpak
// alone, so a Snap build does not have to be special-cased again later.
function isConfined() {
    return describeSandbox().confined;
}

// fs.existsSync() answers false both for "there is nothing there" and for "the
// sandbox refuses to let you look", which is how a blocked instances folder ends up
// reported as "no saves found". Callers that need to tell those apart use this.
function probePath(target) {
    if (typeof target !== 'string' || !target) {
        return { exists: false, readable: false, denied: false, code: null };
    }

    try {
        fs.accessSync(target, fs.constants.R_OK);
        return { exists: true, readable: true, denied: false, code: null };
    } catch (err) {
        const denied = err.code === 'EACCES' || err.code === 'EPERM';
        return {
            exists: denied,
            readable: false,
            denied,
            code: err.code || null
        };
    }
}

module.exports = {
    KIND_APPIMAGE,
    KIND_FLATPAK,
    KIND_NONE,
    KIND_SNAP,
    describeSandbox,
    isConfined,
    isFlatpak,
    isSnap,
    probePath
};
