---
type: architecture
title: Frontend
description: The Nuxt 3 single-page app — manual dynamic route registration, the useApi fetch client and its error-code contract, i18n, the desktop bridge, and where each product area's views live.
tags: [frontend, nuxt, vue, routing, i18n, api-client]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-e60020b063a038b1aa9f0802
    resource: repo://frontend/app/composables/useApi.ts
  - id: openwiki-source-81476c16c638b6cd577d7d19
    resource: repo://frontend/app/composables/useDesktopBridge.ts
  - id: openwiki-source-d145e14026d63ab12e2d5b2d
    resource: repo://frontend/app/composables/useToast.ts
  - id: openwiki-source-2809b09c95cd1ee7234347c5
    resource: repo://frontend/app/composables/useUnifiedLanguage.ts
  - id: openwiki-source-072fde324c5e2db471beefc4
    resource: repo://frontend/nuxt.config.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Frontend

`frontend/` is a Nuxt 3 / Vue 3 / TypeScript app with `ssr: false` and `srcDir: 'app/'`. In production it is built to static files (`npm run generate`, output `.output/public`) and served by the backend from the same origin (see [Backend Server](backend-server.md)); in dev, Vite on port 3013 proxies `/api` and `/static` to the backend on 5679. There is no UI component framework: styling is plain CSS, with `vue-sonner` for toasts and `vue-i18n` for text.

## Routing

Static pages live in `app/pages/` (`index`, `settings`, `marketer`, `studio`, `seller`, `live`, `viral-clone`). Pages that need an `:id` parameter live in `app/views/` and are registered by hand in the `pages:extend` hook of `nuxt.config.ts`, avoiding `[id]` bracket filenames that need shell escaping and break some deployment targets. Registered routes: `/drama/:id`, `/drama/:id/board`, `/drama/:id/episode/:episodeNumber`, `/marketer/:id`, `/marketer/gallery`, `/studio/:id`, `/seller/:id`, `/viral-clone/:id`. Order matters: `/marketer/gallery` is pushed before `/marketer/:id` because matching is first-wins. When adding a detail page, add the file under `views/` and a matching entry here.

## API client

`app/composables/useApi.ts` is the only HTTP layer. `api.get/post/put/del` call `fetch` against the relative base `/api/v1`, expect the backend envelope `{code, data, message}`, return `json.data ?? json`, and throw an `Error` carrying `errorCode` and `status` when the response is not ok or `code >= 400`. Calls are logged to the console. Domain wrappers (`dramaAPI`, `episodeAPI`, `storyboardAPI`, `characterAPI`, `taskAPI`, `mergeAPI`, `aiConfigAPI`, `skillsAPI`, `marketerAPI`, `trendingAPI`, and more) build on it, with TypeScript types for campaign and trending shapes. `useToast.toastError` maps a stable `errorCode` (for example `E_NO_TEXT_MODEL`) to localized text, matching the backend's `AppError` contract. `useAgent` posts to `/agent/<type>/chat` with the drama and episode ids and optional model/config overrides, guarding against concurrent runs.

## Internationalization

`composables/i18n.ts` creates a module-level `vue-i18n` singleton (non-legacy mode so the locale can switch at runtime) from `locales/th.json` and `locales/en.json`. The UI locale is persisted in `localStorage` under `naka:locale`, defaults to Thai, and falls back to English. The UI language and the AI *content* language (what agents write in, see [AI Agents](ai-agents.md)) are one switch: `confirmUnifiedLanguage` in `useUnifiedLanguage.ts` shows a confirmation dialog, then saves `content_language` to the backend, switches the vue-i18n locale and reloads the page so every component rebuilds cleanly.

## Desktop bridge

`useDesktopBridge()` returns `window.nakaDesktop` (injected by the Electron preload) or `null` in a browser or server deployment. Desktop-only UI — storage migration (`pickDirectory`, `startMigration`) and in-app updates — shows only when the bridge exists. See [Desktop App](desktop-app.md).

## Views by product area

- **Drama** (`views/drama/`): `detail.vue` (project overview), `board.vue`, and `episode.vue`, the largest file (~6.5k lines) and core workbench for script → assets → storyboard → video → export. See [Drama Pipeline](../workflows/drama-pipeline.md).
- **Marketer** (`views/marketer/`, `Marketer*` components): campaigns, reference ads, trending and gallery.
- **Studio / Seller / Viral Clone** (`views/studio`, `views/seller`, `views/viralclone`): workspaces for their respective projects; see [Marketing Suite](../workflows/marketing-suite.md) and [Viral Clone](../workflows/viral-clone.md).

Pure logic that should be testable without Vue sits in `app/utils/*.js` (for example `studioFlow.js`, `viralCloneFlow.js`, `videoPreflight.js`). Shared UI primitives include `AppMenu`/`AppMenuItem` (Teleported dropdown with one placement/animation implementation driven by `usePopover`), `BaseSelect`, `ModelSelect`, `ConfirmDialog`, and `MentionTextarea`.
