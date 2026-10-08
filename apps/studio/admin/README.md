# NAKA Admin (admin/)

Back-office (ระบบผู้ดูแล) for **NAKA-AI** (`apps/studio/admin` in [kimyohant/NAKA-AI](https://github.com/kimyohant/NAKA-AI)).
It holds the **system settings** that used to be the "ตั้งค่าระบบ" menu of the user-facing app:

| Tab | What it manages |
|---|---|
| บริการ AI (AI services) | Text / image / video providers, API keys, models, prices, Unsloth local server |
| สไตล์ภาพ (Visual styles) | Style presets, the numbered style gallery, preview images |
| ตั้งค่าเอเจนต์ (Agents) | Agent prompts and SKILL.md files, the skill library |
| ทั่วไป (General) | Content language, theme |
| ที่จัดเก็บข้อมูล (Storage) | Data directory info (desktop: move data) |
| เกี่ยวกับและอัปเดต (About) | Version, server update |

This is a Nuxt 3 SPA (`ssr: false`). It has no server of its own: it calls the existing NAKA-AI backend API
(`/api/v1`, the `backend/` folder of this repo).

## Security model

- The backend protects the system-settings API with **`ADMIN_TOKEN`** (≥ 16 characters).
  Admin-only calls must send `X-Admin-Token: <ADMIN_TOKEN>`; otherwise they get `401 E_ADMIN_REQUIRED`.
  - admin only: AI config create/update/delete/test and single-config reads, `/ai-providers`, style preset writes,
    `/prompts`, `/skills`, `/storage`, `/server-update`
  - still open to the user-facing app: AI config **list** (API keys are never returned), style preset list,
    the viewer's own preferences under `/settings/*`
- This app asks for the token on `/login` and keeps it in `sessionStorage` (or `localStorage` with "remember me").
- A valid admin token also passes the site-wide Basic Auth (`NAKA_AUTH_PASSWORD`).
- If the backend runs **without** `ADMIN_TOKEN` (local dev, desktop) the guard is off and this app shows a warning banner.

## Deploy (recommended: same origin, served by the backend at `/admin`)

```bash
npm ci
npm run generate                 # → .output/public (built for base path /admin/)
```

On the NAKA-AI backend set:

```bash
ADMIN_TOKEN=<long random secret>        # e.g. openssl rand -hex 24
ADMIN_DIST=/path/to/naka-drama-studio/admin/.output/public  # default when built: admin/.output/public
```

Then open `https://<your-naka-host>/admin/`. The user-facing app links its "เปิดระบบผู้ดูแล" (Open Admin) buttons to `/admin/`
(change with `NUXT_PUBLIC_ADMIN_URL` when building naka-drama-studio's frontend).

### Hosting on another domain

| Variable (build time) | Default | Meaning |
|---|---|---|
| `NUXT_APP_BASE_URL` | `/admin/` | Path this app is served from |
| `NUXT_PUBLIC_API_ORIGIN` | same origin | Backend origin, e.g. `https://naka.example.com` |
| `NUXT_PUBLIC_MAIN_APP_URL` | `/` | "Open NAKA-AI app" link |

Also set `ADMIN_ORIGINS=https://admin.example.com` on the backend so CORS allows this origin.

## Development

```bash
# terminal 1 — NAKA-AI backend (../backend), optionally with ADMIN_TOKEN set
npm run dev                      # port 5679

# terminal 2 — this app
npm ci
npm run dev                      # http://localhost:3014/admin/  (proxies /api and /static to 5679)
npm test                         # structure tests (node --test)
```

## Origin

The settings page (`app/pages/index.vue`) and its helpers were moved from naka-drama-studio
`frontend/app/pages/settings.vue`. The tests in `tests/settings-page.test.mjs` and
`tests/official-provider-settings.test.mjs` came with it.
