# naka-ai-backend

All server code of **NAKA-AI**. Unified design: the naka-ai.com Worker (`landing-worker/`) is the account hub
(members, login, credits, payments, admin); the Studio engine (`backend/`) does the AI production and trusts the Worker
through SSO. Server side of **NAKA-AI** — moved out of [kimyohant/naka-drama-studio](https://github.com/kimyohant/naka-drama-studio),
which now keeps only the user-facing frontend and the Electron desktop app.

```
landing-worker/  naka-ai.com Cloudflare Worker — accounts, login, credits, Stripe, LINE/Meta, admin APIs (D1)
                 (moved with history from naka-ai-landing; its pages stay there)
backend/   Studio engine: Hono API + Drizzle ORM (better-sqlite3) + Mastra AI agents, FFmpeg merge, media generation
           (moved with its full git history via git subtree)
admin/     NAKA Admin — back-office SPA for system settings (AI services, styles, agents, storage, update),
           served by the backend at /admin
study/     notes for the Hypit render engine used by Viral Clone (source installed in study/hypit)
docker/    container entrypoint
Dockerfile, docker-compose.yml   all-in-one image: backend + admin + the frontend from naka-drama-studio
```

## Run locally

Check out both repositories side by side:

```
work/
├── naka-ai-backend/      (this repo)
└── naka-drama-studio/    (frontend + desktop)
```

```bash
# backend API on :5679
cd naka-ai-backend/backend && npm ci && npm run dev

# back-office on http://localhost:3014/admin/ (proxies /api to :5679)
cd naka-ai-backend/admin && npm ci && npm run dev

# user-facing app on http://localhost:3013 (proxies /api and /static to :5679)
cd naka-drama-studio/frontend && npm ci && npm run dev
```

Without `ADMIN_TOKEN` the settings API is open (fine for local dev); the admin app then shows a warning banner.

## Production (single server)

1. Build the frontend in `naka-drama-studio/frontend` (`npm run generate`) and the admin here (`cd admin && npm run generate`).
2. Start the backend (`cd backend && npm start`) with at least:

| Variable | Example | Meaning |
|---|---|---|
| `NAKA_HOST` | `0.0.0.0` | listen on all interfaces (requires `NAKA_AUTH_PASSWORD`) |
| `NAKA_AUTH_PASSWORD` | — | site-wide Basic Auth |
| `ADMIN_TOKEN` | `openssl rand -hex 24` | sign-in for `/admin`; guards the system-settings API (≥ 16 chars) |
| `FRONTEND_DIST` | `/srv/naka-drama-studio/frontend/.output/public` | user-facing app (default: the sibling checkout) |
| `ADMIN_DIST` | `/srv/naka-ai-backend/admin/.output/public` | back-office (default: `admin/.output/public` when built) |

The app is then at `https://<your-domain>/` and the back-office at `https://<your-domain>/admin/`.
All other variables (`SQLITE_PATH`, `STORAGE_PATH`, `WORKSPACE_PATH`, `FFMPEG_BIN`, `PUBLIC_BASE_URL`, `HYPIT_*`, …)
are unchanged — see `backend/.env.example`.

## Docker

```bash
cp .env.example .env          # set NAKA_AUTH_PASSWORD, ADMIN_TOKEN, WATCHTOWER_TOKEN
docker compose up -d --build  # needs ../naka-drama-studio/frontend (build.additional_contexts)
```

Without compose: `docker buildx build --build-context frontend=../naka-drama-studio/frontend -t kimyohant/naka-ai .`

## Tests

```bash
cd backend && npm run typecheck && npx tsx --test tests/*.test.ts tests/*.test.mjs
cd admin && npm test
```

A few backend tests also check the API contract against the frontend; they read `../naka-drama-studio/frontend`
(or `NAKA_FRONTEND_DIR`) and skip that part when it is not checked out.

## Desktop app

The Electron app (in naka-drama-studio/desktop) bundles this backend: its build scripts look for `../naka-ai-backend/backend`
(override with `NAKA_BACKEND_DIR`).
