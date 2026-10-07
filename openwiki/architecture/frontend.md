---
type: architecture
title: Static Front End
description: The build-less front end under public/ — plain HTML/CSS/JS pages served by Workers Assets, the route groups, 3D and Godot landing assets, and the design brief that constrains UI copy.
tags: [frontend, static-assets, ui, godot, threejs]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-7f27d0218d709bf45305387e
    resource: repo://public/app/app.js
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
  - id: openwiki-source-b574320c1cc11ae7b799d605
    resource: repo://.ui-craft/brief.md
  - id: openwiki-source-f1c29df965300759d3c1ff56
    resource: repo://wrangler.jsonc
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Static Front End

<!-- openwiki: broken internal link [/openwiki/architecture/request-routing.md] link "/openwiki/architecture/request-routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
There is no bundler or framework step. `public/` is deployed as-is through the `ASSETS` binding (`wrangler.jsonc`: `assets.directory: ./public`). Only `/api/*` and `/webhook/*` are routed to the Worker first (`run_worker_first`); every other path is a static file, reached through the `env.ASSETS.fetch(request)` fall-through at the end of the Worker's `fetch`. See [Worker Request Routing](/openwiki/architecture/request-routing.md).

## Route groups

| Path | Purpose |
| --- | --- |
| `/` (`index.html`) | Public landing: `landing.css/js`, `hero-line`, `glass-nav`, `journey`, Three.js stage |
| `/create/` | Product-brief page that previews the photo locally; it does not upload or render |
| `/studio/`, `/studio/marketer/` | Content draft tool and AI marketer workflow UI |
| `/app/…` | Signed-in member area: dashboard, `account/`, `billing/`, `inbox/`, `receipts/`, onboarding and works scripts |
| `/admin/…` | Admin panel: landing, `customers/`, `system/` |
| `/login/`, `/login/reset/` | Sign-in and password reset |
| `/legal/…` | Privacy, terms, refund, data deletion |
| `/chatbot/` | Redirects to `/create/?workflow=bot` |
| `/review/` | Review rendering page |

Shared scripts such as `account-menu.js`, `app.js`, `workflows.js` and `member.css` are included by plain `<script>`/`<link>` tags with `defer`. Pages guard themselves by calling `GET /api/auth/me`: `public/app/app.js` renders the dashboard when signed in, redirects to `/login/?next=/app/` when signed out, and shows a retry error — never a login bounce — on transient failures. `?mock=1` runs the page on stubbed data and labels it as such.

## 3D and animated assets

- The landing stage uses `scene3d.js` and `naka-reference-relief.js` with vendored Three.js under `public/vendor/three/` (no CDN dependency for the library).
- `public/world/` and `public/flow/` hold Godot 4.5 web exports (`.pck`, `.wasm.gz`, worklets). Sources live in `creative/` (Blender, Godot, video) and are **not** part of the Worker. After a Godot export, `npm run world:postprocess` rebuilds the files.
- The Worker special-cases `/world/index.wasm`: it fetches `/world/index.wasm.gz` from assets and answers with `Content-Type: application/wasm`, `Content-Encoding: gzip` and a one-year immutable cache.

## Design constraints

`.ui-craft/brief.md` and `.ui-craft/tokens.md` define the white/cobalt naga identity, Thai-first copy, and the rule not to invent customer proof, prices, performance claims or integrations. Local templates must be labelled as demonstrations rather than AI output. Read them before UI changes. Per `CLAUDE.md`, the retired legacy messaging integration is not mentioned on user-facing pages.
