// Checks the sandbox detection and the path probe that the cloud code relies on.
//
// The point of both is telling two situations apart that used to look identical:
// "there is nothing there" vs "the sandbox will not let you look", and "signed out"
// vs "the keyring cannot open the stored session". Getting that wrong is what made
// Lux Cloud backups fail silently in the Flatpak build.

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed += 1;
        console.log(`  PASS  ${name}`);
    } else {
        failed += 1;
        console.log(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
    }
}

function section(title) {
    console.log(`\n${title}`);
}

const SANDBOX_PATH = require.resolve('../backend/utils/sandbox.js');

// describeSandbox() caches, so every scenario needs a fresh module instance.
function loadWith(env) {
    const saved = { ...process.env };
    for (const key of ['FLATPAK_ID', 'SNAP', 'SNAP_NAME', 'APPIMAGE']) delete process.env[key];
    Object.assign(process.env, env);

    delete require.cache[SANDBOX_PATH];
    const mod = require(SANDBOX_PATH);
    const result = mod.describeSandbox();

    process.env = saved;
    delete require.cache[SANDBOX_PATH];
    return { mod, result };
}

function main() {
    const onLinux = process.platform === 'linux';

    section('1) Packaging detection');

    const flatpak = loadWith({ FLATPAK_ID: 'de.pluginhub.lux' });
    check('a Flatpak is recognised by FLATPAK_ID',
        !onLinux || flatpak.result.kind === 'flatpak', flatpak.result);
    check('and counts as confined',
        !onLinux || flatpak.result.confined === true, flatpak.result);
    check('keeping the app id for the override hint',
        !onLinux || flatpak.result.appId === 'de.pluginhub.lux', flatpak.result);

    const snap = loadWith({ SNAP: '/snap/lux/current', SNAP_NAME: 'lux' });
    check('a Snap is recognised', !onLinux || snap.result.kind === 'snap', snap.result);
    check('and counts as confined', !onLinux || snap.result.confined === true, snap.result);

    // An AppImage is unpacked, not confined - the filesystem and the session bus are
    // the host's, so nothing may behave as if it were sandboxed.
    const appImage = loadWith({ APPIMAGE: '/home/someone/Lux.AppImage' });
    check('an AppImage is recognised',
        !onLinux || appImage.result.kind === 'appimage', appImage.result);
    check('but is not treated as confined',
        !onLinux || appImage.result.confined === false, appImage.result);

    const plain = loadWith({});
    const plainExpected = onLinux && fs.existsSync('/.flatpak-info') ? 'flatpak' : 'none';
    check('a plain install reports no sandbox',
        !onLinux || plain.result.kind === plainExpected, plain.result);

    section('2) probePath tells "missing" apart from "denied"');

    const { mod } = loadWith({});
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lux-sandbox-test-'));

    const present = path.join(tmp, 'saves');
    fs.mkdirSync(present);
    const readable = mod.probePath(present);
    check('a readable folder reads back as readable',
        readable.exists === true && readable.readable === true && readable.denied === false, readable);

    const missing = mod.probePath(path.join(tmp, 'does-not-exist'));
    check('a missing path is neither readable nor denied',
        missing.exists === false && missing.readable === false && missing.denied === false, missing);
    check('and reports ENOENT', missing.code === 'ENOENT', missing);

    const blocked = path.join(tmp, 'blocked');
    fs.mkdirSync(blocked);
    fs.mkdirSync(path.join(blocked, 'saves'));
    fs.chmodSync(blocked, 0o000);

    const denied = mod.probePath(path.join(blocked, 'saves'));
    // Running as root ignores the mode bits, so this can only be asserted otherwise.
    const rootlike = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0;
    if (rootlike || process.platform === 'win32') {
        console.log('  SKIP  an unreadable folder reports denied (needs a non-root POSIX user)');
    } else {
        check('an unreadable folder reports denied, not missing',
            denied.denied === true && denied.readable === false, denied);
        check('and is still reported as existing',
            denied.exists === true, denied);
    }

    fs.chmodSync(blocked, 0o700);
    fs.rmSync(tmp, { recursive: true, force: true });

    check('an empty path is handled', mod.probePath('').denied === false, mod.probePath(''));
    check('a non-string path is handled', mod.probePath(null).readable === false, mod.probePath(null));

    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exit(failed === 0 ? 0 : 1);
}

main();
