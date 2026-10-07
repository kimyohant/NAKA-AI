---
type: architecture
title: Runtime Settings and Feature Flags
description: How values saved in the /admin/system/ panel (D1 system_settings, secrets encrypted with AES-GCM) are merged over wrangler vars on every request, how FEATURE_* switches work, and how to register a new setting.
tags: [settings, feature-flags, encryption, admin, d1]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-2b224924026e990392a01c35
    resource: repo://src/system/admin.ts
  - id: openwiki-source-10a2fd5ba8caf039da777c27
    resource: repo://src/system/registry.ts
  - id: openwiki-source-b3dd13818582885c401b1ba7
    resource: repo://src/system/store.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Runtime Settings and Feature Flags

Operators change configuration without redeploying through the system control panel (`public/admin/system/`, API in `src/system/admin.ts`, further notes in `docs/system-control.md`). Saved values are stored in D1 `system_settings` and overlaid on the Worker's env by `withSettings` (`src/system/store.ts`). Modules therefore just read `env.X` and never know where a value came from.

## Registry: what is editable

`src/system/registry.ts` lists every `SettingDef` (`key`, `group`, `kind` of `secret | text | select | number | switch`, label, optional `pattern`, `max`, and a `default` for switches). **Only keys in the registry** are read from `system_settings` or accepted by the admin API. Bindings and root secrets (`SESSION_SECRET`, `ADMIN_TOKEN`, `SETTINGS_KEY`, `SOCIAL_TOKEN_KEY`, `APP_ORIGIN`) are listed in `LOCKED` and stay in wrangler config. Adding a configurable value or feature flag means adding it to the registry.

## Merge order

For each registered key `withSettings` picks: **saved panel value → wrangler var/secret (trimmed) → switch default**. Three provider switches work by blanking credentials: `FEATURE_GOOGLE_LOGIN`, `FEATURE_LINE_LOGIN` and `FEATURE_TURNSTILE` set to `off` clear the matching client id/secret, so every existing "is it configured?" check agrees.

`featureOn(env, "FEATURE_…")` is true when the value is `on`, or when unset and the registry default is not `off`. Some switches default off (`FEATURE_MAINTENANCE`, and `FEATURE_PAYMENTS` — payments are off by default since the project runs as a non-commercial study project).

## Storage and encryption

- Secret rows are AES-GCM encrypted with `SETTINGS_KEY` (base64 of exactly 32 bytes; `settingsKeyReady` validates canonical encoding and tolerates a trailing newline from piped secrets). Ciphertext format is `v1.<iv>.<sealed>`.
- The additional authenticated data is `["system-setting-v1", key]`, so a ciphertext copied to another key name will not decrypt.
- On read, rows for unknown keys, or whose `secret` flag disagrees with the registry kind, are ignored. A row that fails to decrypt logs an error and falls back to the Worker's value.
- If the table cannot be read, the site keeps running on wrangler config.

## Caching

Saved values are cached per D1 binding for 10 s per isolate (`CACHE_MS`), keyed also by `SETTINGS_KEY`; `invalidateSettings(db)` clears it after a write. A change in the panel can therefore take up to ~10 s to reach other isolates.

## Admin API

`handleAdminSystem` (called with the *unmerged* `workerEnv`, so it can distinguish saved from wrangler values) exposes per-setting `PUT` and `DELETE`, a bulk `POST /settings/import` ("moved from Cloudflare"), plan create/update, and `GET /audit`. Each change writes a `system_audit` row with actor, before/after (secrets shown only as hints), and the clear uses an `updated_at` guard so a concurrent edit is not deleted blindly.

## Where flags bite

<!-- openwiki: broken internal link [/openwiki/architecture/request-routing.md] link "/openwiki/architecture/request-routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`closedFeature` in the router and the cron `scheduled` handler gate on `featureOn`. See [Worker Request Routing](/openwiki/architecture/request-routing.md) and [Job Queue, Credits and Cron](/openwiki/architecture/background-processing.md). Tests: `tests/system-control.test.cjs`.
