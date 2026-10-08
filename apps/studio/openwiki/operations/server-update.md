---
type: operations
title: Server Update and Security
description: How the Docker/server deployment is configured, authenticated and updated through Watchtower, and the SSRF-safe outbound fetch used for user-supplied URLs.
tags: [operations, deployment, docker, watchtower, security, ssrf, auth]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-eeb14dc4f3a4ec88c276fac5
    resource: repo://backend/src/services/server-update.ts
  - id: openwiki-source-22b1079b1f264641b524909a
    resource: repo://backend/src/utils/safe-fetch.ts
  - id: openwiki-source-31e571dace0c25bfa02d28fd
    resource: repo://deploy/ai-live/README.md
  - id: openwiki-source-b79fbbd921df689b4bbdc82f
    resource: repo://docker-compose.yml
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Server Update and Security

<!-- openwiki: broken internal link [backend-server.md] file "backend-server.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [desktop-app.md] file "desktop-app.md" does not exist. Fix the href or restore the target, then delete this comment. -->
The server deployment is the same backend as the desktop app (see [Backend Server](backend-server.md)), run from the repo `Dockerfile` and `docker-compose.yml`. The desktop app updates through its own Electron updater ([Desktop App](desktop-app.md)); everything here applies to the server build only.

## Docker deployment

`docker-compose.yml` runs two services:

- **app** — binds `NAKA_HOST=0.0.0.0` inside the container, so `NAKA_AUTH_PASSWORD` is mandatory (compose fails if it is unset, matching the backend's startup refusal for non-loopback hosts). The host port is published on `127.0.0.1:5679` only, so exposing it publicly requires a reverse proxy. All state (SQLite, generated media, editable `workspace/skills`) lives in the named volume `naka-data` mounted at `/app/data`. `NAKA_VERSION` is baked in as a build arg.
- **watchtower** — started with `--http-api-update`, a shared token, `--label-enable` (only containers labeled `com.centurylinklabs.watchtower.enable` are touched), `--cleanup` and `--rolling-restart`. It mounts the Docker socket, which is the sensitive part of this setup.

## Update flow

`routes/serverUpdate.ts` exposes three endpoints under `/api/v1/server-update`:

- `GET /state` returns the current version, update mode and the last check result; it makes no network call.
- `POST /check` fetches the release manifest (`latest.json`, the same format the desktop updater consumes), trying each feed URL in order with a 15 s timeout and accepting the first that has a `version`. The manifest list is `NAKA_UPDATE_FEED` if set, otherwise two default sources. It compares three-part numeric versions and stores `available`, `up-to-date` or `error` in module memory (lost on restart).
- `POST /apply` calls Watchtower's `POST /v1/update` with a bearer token. It only works in `watchtower` mode, which is selected purely by `NAKA_WATCHTOWER_URL` being set; otherwise the mode is `manual` and the UI shows `docker compose pull && up -d` instructions.

The current version comes from `NAKA_VERSION` (leading `v` stripped) with a fallback to `backend/package.json`, then `0.0.0`. The design rationale in the source is that containers are immutable: the app never updates itself in place, it asks Watchtower to pull a new image and replace the container, so `/apply` can only report "triggered" before the process is replaced.

## SSRF-safe fetching

`utils/safe-fetch.ts` is used where the server fetches URLs a user typed — currently product-link import (`services/product-ingest.ts`). `safeFetch` enforces:

- only `http`/`https`, no embedded credentials;
- the destination must be a public address. IP literals are checked up front; hostnames are checked inside a custom `lookup` passed to `http.request`, so validation and connection use the same DNS answer (defeats DNS rebinding), and any blocked address among the results rejects the lookup;
- `isBlockedAddress` uses a `net.BlockList` of special-use IPv4/IPv6 ranges (private, loopback, link-local, CGNAT, documentation, multicast, Teredo, 6to4 and others), unwraps IPv4-mapped and NAT64 IPv6 to test the embedded IPv4, rejects `::/96`, and treats unparseable input as blocked;
- redirects are followed manually up to 5 hops, re-validating each hop;
- one deadline spans all redirects (default 15 s) and the body cap counts *decompressed* bytes (gzip/deflate/brotli), either truncating (HTML) or erroring (binary), which also blocks decompression bombs.

All failures surface as `SafeFetchError`. `backend/tests/campaigns-migration.test.ts` covers `isBlockedAddress` and `assertPublicHttpUrl`.

## GPU host for AI Live

`deploy/ai-live/` documents a separate GPU machine (Ubuntu with NVIDIA drivers) running LiveTalking, SRS and `naka-live-agent`. The agent listens on port 8020 and requires a token (stored in `/etc/naka-live/agent.env`, mode 600); LiveTalking and SRS accept traffic from localhost only, so remote previews pass through the token-protected agent. The backend side of this is described in [Marketing Suite](../workflows/marketing-suite.md).
