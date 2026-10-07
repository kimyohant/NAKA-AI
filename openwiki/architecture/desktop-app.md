---
type: architecture
title: Desktop App
description: How the Electron shell boots the bundled backend as a utility process, manages userData and the workspace template, migrates the data directory, self-updates, and is packaged and released.
tags: [desktop, electron, packaging, updater, migration, userdata]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-b516a3e1f30eb2b366da8834
    resource: repo://desktop/scripts/build-backend.mjs
  - id: openwiki-source-50991d90b8e98258b967c0cf
    resource: repo://desktop/scripts/prepare-resources.mjs
  - id: openwiki-source-5ba96c782af44d5414c1e757
    resource: repo://desktop/src/main.ts
  - id: openwiki-source-48d53de5808dabb12a4c52cd
    resource: repo://desktop/src/migrate.ts
  - id: openwiki-source-202826dd158fc614b8189d6a
    resource: repo://desktop/src/updater.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Desktop App

`desktop/` wraps the same backend and frontend used for server deployment in an Electron shell. The main process (`desktop/src/main.ts`) does no product logic: it prepares directories, forks the backend, waits for it to be healthy, and opens a window pointed at it.

## Boot sequence (`bootstrap`)

1. `app.setPath('userData', …/NAKA-AI)` when packaged, `NAKA-AI-Dev` otherwise, so dev and packaged builds never share database, uploads or the single-instance lock.
2. A single-instance lock is taken first; a second launch just focuses the existing window (two instances would fight over SQLite's write lock).
3. Pick a free loopback port, read `userData/storage-config.json` to learn the data directory (falls back to `userData/data` on any missing, corrupt or unusable config without rewriting the bad file), create it.
4. Packaged builds sync the workspace template from `resources/workspace-template` into `userData/workspace`; dev builds use `backend/workspace` directly.
5. `startBackend` forks `build/backend.mjs` with `utilityProcess.fork`, injecting env: `PORT`, `NAKA_DESKTOP=1`, `NAKA_DATA_DIR`, `SQLITE_PATH` (`<dataDir>/naka.sqlite3`), `WORKSPACE_PATH`, `FRONTEND_DIST`; when packaged also `FFMPEG_BIN`, `FFPROBE_BIN` and `CAPTION_FONT_DIR` pointing into `resources/`.
6. `waitHealthy` polls `/api/v1/health` every 300 ms for up to 15 s, then the `BrowserWindow` loads `http://127.0.0.1:<port>`. Because window and API share an origin, the frontend uses relative URLs and needs no CORS.

Backend stdout/stderr are forwarded with a `[backend]` prefix. An unexpected backend exit shows an error box and quits the app, unless `backendRestarting` is set (used during migration). External links and navigation away from the app origin are denied in-app and opened in the system browser. See [Backend Server](backend-server.md) for the env contract the backend side reads.

## Workspace template sync

`syncWorkspaceTemplate` copies the bundled `workspace` tree into userData, tracked by a `.template-version` marker (`TEMPLATE_VERSION`, bump it when bundled templates change). Existing files are never overwritten (`force: false`), preserving user-created skills and edits — with one exception: `prompts/` is force-overwritten on version change because prompts evolve together with the in-code defaults and Settings offers "restore default". This is why language directives in the backend must override stale user skills (see [AI Agents](ai-agents.md)).

## Storage migration (`migrate.ts`)

The user can move the data directory from the UI. The sequence is validate → stop backend → move → write config → restart backend → done, reported over the `naka:migrate-progress` IPC channel (throttled to 80 ms, with done/error always sent). Stated invariants: the old directory is never deleted before the copy verifies, the config file is written only after files are moved, and any failure rolls back and restarts the backend on the old directory. `pick-directory` pre-validates the target (not the current dir, not nested inside or above it, writable, free space reported); `storage-config.json` lives outside the data directory and is written atomically via tmp + rename.

## In-app updater (`updater.ts`)

Designed for unsigned builds. It fetches a `latest.json` manifest (`NAKA_UPDATE_FEED` overrides; defaults are GitHub release and raw URLs), compares versions, downloads the artifact and verifies SHA-256. On macOS it unpacks the zipped `.app`, renames the old bundle to a `.old` backup, moves the new one in and relaunches via `open`; on Windows it runs the downloaded setup silently (`/S`) detached then quits. It is disabled when not packaged. `make-update-feed.mjs` builds the manifest (`version`, `notes`, `platforms["<platform>-<arch>"] → {url, sha256, size}`); `publish-release.mjs` and `cos-upload.mjs` publish to GitHub Releases and Tencent COS.

## Build pipeline

- `build-backend.mjs`: esbuild bundles `backend/src/index.ts` into a single ESM file (`build/backend.mjs`, target node20). `sharp`, `better-sqlite3`, `ffmpeg-static`, `ffprobe-static` stay external — the native modules are rebuilt for Electron's ABI and unpacked from the asar, and ffmpeg is loaded dynamically. A banner injects `require`, `__filename` and `__dirname` shims.
- `build-main.mjs`: bundles the main process to CommonJS (`dist/main.js`).
- `prepare-resources.mjs`: assembles `desktop/resources/` — the Nuxt static output (requires `index.html`, so run `npm run generate` first), the workspace template, caption fonts, and per-OS ffmpeg/ffprobe folders (`bin-mac`, `bin-win`; Windows `ffmpeg.exe` must be cached in `build/win-bin/`).
- `after-pack.mjs` and electron-builder produce macOS dmg (arm64/x64) and a Windows NSIS installer.

Run `npm run rebuild:native` whenever the native module ABI changes (postinstall already does it).
