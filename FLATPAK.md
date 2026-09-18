# Running Lux as a Flatpak

There is no official Flatpak build yet (see `TODO.md`). This page exists because the
community builds keep hitting the same three problems, all of which make **Lux Cloud
sync and cloud backups stop working** without saying why. Two of them can only be
fixed in the Flatpak manifest — no amount of client code can grant a permission the
sandbox was never given.

The client now detects that it is running inside a Flatpak (`/.flatpak-info` or
`FLATPAK_ID`) and adjusts what it claims it can do, but it still needs the
permissions below to actually work.

## Required `finish-args`

```yaml
finish-args:
  # Lux Cloud, Modrinth/CurseForge, Mojang auth and the updater all need the network.
  - --share=network
  - --share=ipc
  - --socket=wayland
  - --socket=fallback-x11
  - --device=dri

  # The sign-in session is stored with Electron's safeStorage, which talks to the
  # keyring over the session bus. Without this, Electron silently falls back to a
  # different backend than the run that saved the token, the stored session cannot be
  # decrypted any more, and Lux looks signed out on every start — cloud backups and
  # sync then never run. This is the single most common cause.
  - --talk-name=org.freedesktop.secrets
  - --socket=session-bus

  # Only needed if users keep their instances folder outside the sandbox (Settings →
  # instances path). The default location under ~/.var/app/ works without it.
  - --filesystem=home
```

## The `luxclient://` sign-in callback

`app.setAsDefaultProtocolClient()` cannot register a scheme from inside the sandbox:
the write lands in the sandboxed `~/.local/share` that the host never reads, and
`process.execPath` points at `/app/...`, which means nothing outside. The client
therefore skips that call under Flatpak and reports `deepLinkReady: false`, so the
account panel shows the manual-code fallback straight away instead of waiting three
minutes for a callback that is never coming.

To make the callback work properly, declare the handler in the exported desktop
entry:

```desktop
MimeType=x-scheme-handler/luxclient;
```

Users can always sign in with the six-character code the website shows after
approving the device, so this is a convenience, not a blocker.

## Instances folder outside the sandbox

If a user moves over from the `.deb`/`.rpm`/AppImage build, their configured
instances path (e.g. `~/.local/share/Lux/instances`) is not reachable from inside the
sandbox. Backups used to report this as *"No saves found"* and skip silently; they now
report the permission denial and name the fix. Either grant the path:

```sh
flatpak override --user --filesystem=/path/to/instances de.pluginhub.lux
```

or point Settings → instances path back at the default location.

## Not covered here

The in-app updater (`backend/utils/linuxUpdater.js`) selects a `.deb`/`.rpm`/AppImage
asset and cannot update a Flatpak. A Flatpak build should ship with the in-app updater
disabled and let `flatpak update` handle it.
