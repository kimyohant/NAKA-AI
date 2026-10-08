# ADR-002: ย้ายทุกอย่างลง Docker, Cloudflare เป็นแค่ proxy, Studio อยู่ที่ studio.naka-ai.com

**Status:** Proposed (รายละเอียดเพื่อพิจารณาก่อนลงมือ)
**Date:** 2026-10-08
**Supersedes:** ADR-001 ส่วน Edge Gateway / desktop / URL `/studio/`
**Deciders:** เจ้าของระบบ NAKA-AI TECH

---

## 1. สิ่งที่ตัดสินใจแล้ว (จากคำตอบ)

| เรื่อง | ตัดสินใจ | ผลต่อแผน |
|---|---|---|
| Studio production | Docker | ใช้ compose เดิมเป็นฐานได้ |
| Desktop app | **เลิกขาย** | ตัด `desktop/`, Electron, โหมด all-in-one, Watchtower, `/server-update` ทิ้งได้ → แยก process ได้อิสระ |
| URL Studio | **studio.naka-ai.com** | ใช้ cookie ระดับ `.naka-ai.com` แทน SSO redirect |
| Landing | **ย้ายจาก Cloudflare Worker ลง Docker** | ต้องมีตัวแปลง Worker → Node และย้าย D1 → SQLite |
| Cloudflare | **เป็นแค่ proxy** (DNS + TLS + WAF + cache) | ใช้ Cloudflare Tunnel เข้า origin ไม่เปิด port |

---

## 2. ภาพรวมระบบเป้าหมาย

```
 ผู้ใช้
   │ https
   ▼
┌──────────────────────────── Cloudflare (proxy only) ────────────────────────────┐
│  naka-ai.com · www.naka-ai.com · studio.naka-ai.com                              │
│  TLS, WAF, DDoS, Turnstile, cache /static/* (immutable media)                     │
└───────────────────────────────────┬──────────────────────────────────────────────┘
                                    │ Cloudflare Tunnel (ขาออกจาก server, ไม่เปิด port)
┌───────────────────────────────────▼──────── Docker host (VPS) ───────────────────┐
│  [cloudflared] ──► [caddy]  reverse proxy + forward_auth                           │
│                      │                                                             │
│     naka-ai.com ─────┼──► account-web   (landing เดิม: auth, credits, billing,    │
│                      │                   receipts, social, inbox, admin, public/)  │
│                      │    account-cron  (image เดียวกัน, role=cron ทุก 1 นาที)     │
│                      │                                                             │
│ studio.naka-ai.com ──┼─ forward_auth ──► account-web /internal/auth/verify         │
│                      │      (ผ่าน → ใส่ header X-Naka-User-*)                      │
│                      ├─ /              ► studio-web   (Nuxt static, caddy เสิร์ฟ)  │
│                      ├─ /admin/        ► studio-admin (Nuxt static, admin เท่านั้น)│
│                      ├─ /static/*      ► caddy file_server (volume studio-data:ro) │
│                      ├─ /api/v1/live*  ► studio-live                               │
│                      └─ /api/v1/*      ► studio-api                                │
│                                                                                    │
│  studio-api ──(job queue ใน studio.sqlite)──► studio-render (×N)                  │
│  studio-api ──http://account-web/internal/credits/* (Docker network เท่านั้น)       │
│                                                                                    │
│  volumes: account-data (account.sqlite) · studio-data (studio.sqlite + media)      │
│  [litestream] สำรอง SQLite ต่อเนื่องไป R2/S3                                        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Container ทั้งหมด

| Container | Image | หน้าที่ | Scale |
|---|---|---|---|
| `cloudflared` | cloudflare/cloudflared | Tunnel ออกไป Cloudflare | 1 |
| `caddy` | caddy:2 | Route ตาม host/path, forward_auth, เสิร์ฟ static | 1 |
| `account-web` | `naka/account` | โค้ด landing เดิมทั้งหมด (HTTP) | 1 (SQLite) |
| `account-cron` | `naka/account` | `scheduled()` เดิม: queue, social, billing, receipts, inbox, trending | **1 เท่านั้น** |
| `studio-api` | `naka/studio` | API ทุกเมนู ยกเว้น live | 1 |
| `studio-render` | `naka/studio` | FFmpeg, Hypit, poll งานสร้างภาพ/วิดีโอ, recovery sweeps | 1→N |
| `studio-live` | `naka/studio` | TikTok Live connector, AI Live, avatar (WebSocket ค้างยาว) | 1 |
| `litestream` | litestream/litestream | backup SQLite ทั้ง 2 ไฟล์ | 1 |

> `studio-api`, `studio-render`, `studio-live` ใช้ **image เดียวกัน** ต่างกันแค่ `NAKA_ROLE=api|render|live` → build ครั้งเดียว, version ตรงกันเสมอ

---

## 3. ย้าย Landing (Cloudflare Worker) ลง Docker

### 3.1 ข่าวดี: โค้ดพึ่ง Cloudflare น้อยมาก
จาก grep ทั้ง `src/` สิ่งที่ผูกกับ Worker มีแค่:

| Worker API | ใช้ที่ไหน | แทนด้วย |
|---|---|---|
| `env.DB` (D1: `prepare/bind/first/all/run/batch`) | ~300 จุด | **adapter บน better-sqlite3** — interface เดียวกัน (มีต้นแบบแล้วที่ `tests/helpers/d1.cjs`, 43 บรรทัด) |
| `env.ASSETS.fetch` | `src/index.ts` 2 จุด | Caddy เสิร์ฟ `public/` ตรง; Worker code ได้เฉพาะ `/api/*`, `/webhook/*` เหมือน `run_worker_first` เดิม |
| `env.MEDIA` (R2) | `social/media.ts`, `video/` | adapter `get/put/delete` บนดิสก์ volume (หรือ R2 ผ่าน S3 API) |
| `ctx.waitUntil` | `index.ts` 9 จุด | เก็บ promise ไว้ใน Set, รอให้เสร็จตอน `SIGTERM` |
| `scheduled()` cron | `index.ts` | container `account-cron` เรียก `scheduled()` ทุกต้นนาที |
| `CF-Connecting-IP` | rate-limit OTP/password | **Cloudflare ยังส่ง header นี้ผ่าน Tunnel** ใช้ต่อได้เลย (Caddy ต้องไม่ลบ) |
| `crypto.subtle`, `fetch`, `Request/Response` | ทั่วไป | Node 24 มีในตัว |
| Stripe SDK, Anthropic SDK | billing, agent | ทำงานบน Node ได้ปกติ |

→ **ไม่ต้อง rewrite โค้ด business logic** แค่เพิ่มไฟล์ entrypoint ใหม่ห่อ `worker.fetch()` เดิม

### 3.2 Node entrypoint (โครงร่าง)

```ts
// apps/account/server/node.ts
import { serve } from '@hono/node-server'
import worker from '../src/index'
import { openD1 } from './d1-sqlite'          // D1 interface บน better-sqlite3
import { diskBucket } from './r2-disk'         // R2 interface บนดิสก์

const env = {
  ...process.env,                              // vars + secrets (เดิมอยู่ใน wrangler / secret put)
  DB: openD1(process.env.SQLITE_PATH!),
  MEDIA: process.env.MEDIA_DIR ? diskBucket(process.env.MEDIA_DIR) : undefined,
}
const pending = new Set<Promise<unknown>>()
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.add(p); p.finally(() => pending.delete(p)) },
              passThroughOnException() {} }

if (process.env.NAKA_ROLE === 'cron') {
  // ต้นนาทีทุกนาที เหมือน "* * * * *"
  const tick = () => worker.scheduled({ scheduledTime: Date.now(), cron: '* * * * *' } as any, env, ctx)
  setTimeout(function loop() { tick(); setTimeout(loop, 60_000 - (Date.now() % 60_000)) },
             60_000 - (Date.now() % 60_000))
} else {
  serve({ fetch: (req) => worker.fetch(req, env, ctx), port: 8788 })
}
process.on('SIGTERM', async () => { await Promise.allSettled([...pending]); process.exit(0) })
```

### 3.3 จุดที่ต้องระวัง (เจอในโค้ด)
1. **Origin check** — `src/index.ts:60` เทียบ `Origin` กับ `url.origin`. หลัง proxy `request.url` จะเป็น `http://account-web:8788/...` → **ต้องสร้าง Request ใหม่จาก `X-Forwarded-Proto` + `Host`** ใน entrypoint ไม่งั้น POST ทุกตัวได้ 403
2. **Cookie ต้องเป็น `Domain=.naka-ai.com`** — `cookieValue()` ใน `src/auth/common.ts:47` ตอนนี้ไม่มี Domain → เพิ่ม `COOKIE_DOMAIN` (ตั้งเฉพาะ production) เพื่อให้ studio.naka-ai.com อ่าน `naka_session` ได้
3. **D1 batch = transaction** — adapter ต้อง `BEGIN/COMMIT` เหมือนต้นแบบ (โค้ด billing/credits พึ่งเรื่องนี้)
4. **`withSettings()` อ่าน DB ทุก request** — บน SQLite local เร็วกว่า D1 อยู่แล้ว ไม่ต้องแก้
5. **cron ห้ามรันซ้อน** — `account-cron` ต้องมี 1 ตัวเท่านั้น (jobs มี lease/fencing อยู่แล้วเป็นตาข่ายกันพลาด)
6. **ไฟล์ `public/studio/`** (noindex draft tool) ชนชื่อกับ Studio ใหม่ → redirect ไป `studio.naka-ai.com`

### 3.4 ย้ายข้อมูล D1 → SQLite
D1 คือ SQLite อยู่แล้ว ไม่ต้องแปลง SQL:
```bash
npx wrangler d1 export naka-ai-db --remote --output=naka-ai-d1.sql
sqlite3 account.sqlite < naka-ai-d1.sql
sqlite3 account.sqlite "PRAGMA integrity_check; SELECT count(*) FROM users; SELECT count(*) FROM credit_ledger;"
```
ตาราง `d1_migrations` มาด้วย → ใช้ runner เดิมต่อได้ (`migrations/NNNN_*.sql`)

---

## 4. Login ข้าม naka-ai.com ↔ studio.naka-ai.com

### ทางเลือก
| | A: คง SSO เดิม (`/api/sso/studio/*`) | **B: Shared cookie + forward_auth (แนะนำ)** |
|---|---|---|
| ทำงานยังไง | redirect 3 ทอด, studio มี session 12 ชม. ของตัวเอง | cookie `naka_session` ใช้ร่วม, Caddy ถาม account ทุก request |
| Logout | ไม่ sync (ออกที่หนึ่ง อีกที่ยังอยู่) | ออกทีเดียวออกทั้งคู่ |
| โค้ดที่ต้องดูแล | 2 ฝั่ง (studio.ts + naka-sso.ts) | endpoint เดียว `/internal/auth/verify` |
| Studio ต้องรู้เรื่อง auth | มาก | แทบไม่ต้อง (อ่าน header) |

### Flow แบบ B
```
GET studio.naka-ai.com/api/v1/dramas   (Cookie: naka_session=…)
  caddy ─forward_auth─► account-web GET /internal/auth/verify
          200 + X-Naka-User-Id, X-Naka-User-Name, X-Naka-User-Admin, X-Naka-Plan
          401 → หน้าเว็บ redirect ไป naka-ai.com/login/?next=https://studio.naka-ai.com/...
  caddy ─(copy headers, ลบ header X-Naka-* ที่ client ส่งมาเองก่อนเสมอ)─► studio-api
```
- Studio: middleware ใหม่ `auth/proxy-user.ts` อ่าน header → ใส่ใน `owner-context` (ระบบ `owner_user_id` / `ownership.ts` เดิมใช้ต่อได้ทั้งหมด)
- ตัด `NAKA_AUTH_PASSWORD` Basic auth และ SSO flow ทิ้ง
- **studio-api ไม่เปิด port ออก host** เข้าได้ทาง caddy เท่านั้น → header ปลอมไม่ได้
- `next=` ต้อง allowlist เฉพาะ `naka-ai.com` / `studio.naka-ai.com` (กัน open redirect)
- Admin: `X-Naka-User-Admin=1` (กฎเดิม: Google verified + `ADMIN_EMAILS`) แทน `ADMIN_TOKEN` ของ studio admin

---

## 5. Studio: แยก service ตามเมนู

### 5.1 แผนที่เมนู → API → ตาราง (จาก `backend/src/index.ts` + `sqlite-schema.ts`)

| เมนู | API prefix | ตารางหลัก | ลักษณะงาน |
|---|---|---|---|
| **Drama** | `/dramas /episodes /storyboards /scenes /characters /props /merge` | dramas, episodes, storyboards, scenes, characters, props, character_looks, video_merges … | pipeline ยาว, AI agent + render |
| **Marketer** | `/campaigns /trending-videos /gallery` | campaigns, campaign_* , creative_results | AI text + ภาพ |
| **Seller** | `/seller` | seller_posts | ผูกกับ Product Studio auto-render |
| **Product Studio** | `/studio` | studio_projects, studio_shots, studio_avatars, studio_images, studio_influencers* | render หนัก |
| **Viral Clone** | `/clone` | clone_projects, clone_variants | วิเคราะห์คลิป + Hypit render |
| **Live** | `/live` | (live-avatars, tiktok-live) | **stateful, WebSocket ค้าง** |
| *Core (ทุกเมนูใช้)* | `/tasks /upload /ai-configs /ai-providers /style-presets /prompts /agent /skills /storage /settings` | sys_task, pipeline_tasks, ai_service_*, style_presets, assets, app_settings | แกนกลาง |

### 5.2 ทำไมยังไม่แยก container ต่อเมนูทันที
- `services/studio.ts` import `generation`, `ffmpeg-merge`, `marketer`, `task-prep`, `mastra` พร้อมกัน; Seller ต้องรอ Studio auto-render → ถ้าแยกตอนนี้ต้องเรียก HTTP ข้ามกันไปมา
- งานค้างอยู่ใน **promise ในหน่วยความจำ** (ต้องมี recovery sweeps ตอนบูต) → ถ้าหลาย container ต่างคนต่างกู้งานกันเอง = งานซ้ำ/เครดิตหักซ้ำ
- คอขวดจริงคือ **CPU ของ FFmpeg/Hypit** และ **connection ของ Live** ไม่ใช่จำนวนเมนู

### 5.3 แผน 3 ขั้น (ไปถึง "1 เมนู 1 container" ได้จริง)

**ขั้น 1 — แยกตามลักษณะงาน** (ได้ประโยชน์มากสุดก่อน)
`studio-api` / `studio-render` / `studio-live` จาก image เดียว
- เปลี่ยน background promise → **ตาราง `jobs` + lease/fencing** (ลอก pattern จาก `src/jobs.ts` ของ landing ที่ test แล้ว) → api สร้างงาน, render หยิบไปทำ, รีสตาร์ทไม่หาย
- recovery sweeps ย้ายไปอยู่ที่ `studio-render` ตัวเดียว

**ขั้น 2 — Modular monolith ตามเมนู** (ในโค้ด)
```
services/studio/src/
  core/            ai, agents(mastra), generation, ffmpeg, storage, jobs, ownership, credits-client
  modules/
    drama/         routes.ts · service.ts · schema.ts · jobs.ts · index.ts (public API)
    marketer/
    seller/
    product-studio/
    viral-clone/
    live/
  roles/           api.ts · render.ts · live.ts   (เลือก module ที่จะโหลดจาก env)
```
- กฎ (dependency-cruiser ใน CI): `modules/A` import ได้แค่ `core/**` และ `modules/B/index.ts`
- ย้ายทีละ module: live → viral-clone → marketer → drama → (seller + product-studio พร้อมกัน)

**ขั้น 3 — เปิด container ต่อเมนู ด้วย env** (เมื่อขั้น 2 เสร็จ)
```yaml
studio-drama:     { image: naka/studio, environment: { NAKA_ROLE: api, NAKA_MODULES: drama } }
studio-marketer:  { image: naka/studio, environment: { NAKA_ROLE: api, NAKA_MODULES: marketer } }
studio-commerce:  { image: naka/studio, environment: { NAKA_ROLE: api, NAKA_MODULES: seller,product-studio } }
studio-clone:     { image: naka/studio, environment: { NAKA_ROLE: api, NAKA_MODULES: viral-clone } }
studio-core:      { image: naka/studio, environment: { NAKA_ROLE: api, NAKA_MODULES: core } }
```
Caddy route ตาม prefix ในตาราง 5.1 → แต่ละเมนู restart/ล่ม/จำกัด CPU/RAM แยกกันได้, แต่ยังใช้ `studio.sqlite` ไฟล์เดียวบน host เดียว (SQLite WAL รองรับหลาย process บนดิสก์เดียวกัน, ตั้ง `busy_timeout`)
→ ถ้าวันหนึ่งต้องหลายเครื่อง: แยก DB ต่อ module หรือย้าย Postgres (Drizzle เปลี่ยน dialect ได้)

---

## 6. ระบบเครดิต (ปิดช่องรั่ว)

ตอนนี้ studio **ไม่หักเครดิตเลย**. ใหม่:
```
studio-api                                    account-web (เจ้าของเงิน)
  สร้างงาน ──POST /internal/credits/hold──────►  hold (ใช้ logic src/credits.ts เดิม)
           ◄──── holdId / 402 เครดิตไม่พอ ──────
  render สำเร็จ ─POST /internal/credits/commit─►
  render fail ถาวร ─POST /internal/credits/refund► (refund ครั้งเดียว, idempotent ด้วย holdId)
```
- `/internal/*` เข้าได้จาก Docker network เท่านั้น (Caddy ตอบ 404 ถ้ามาจากภายนอก) + `INTERNAL_SECRET`
- ราคากลาง: `services/generation-cost.ts` ของ studio → ย้ายไป `packages/contracts`

---

## 7. Cloudflare เป็น proxy อย่างเดียว — ข้อจำกัดที่ต้องรู้

| เรื่อง | ค่า | ผลกระทบ / วิธีรับมือ |
|---|---|---|
| ขนาด request body (Free/Pro) | **100 MB** | อัปโหลดคลิปใหญ่ใน Viral Clone/Drama จะโดนตัด → upload แบบแบ่ง chunk หรือ presigned upload ตรงไป R2 |
| Timeout ต่อ request | **100 วินาที** (ขึ้น 524) | งาน AI/merge ต้องเป็น async + poll (ส่วนใหญ่ทำอยู่แล้วผ่าน `sys_task`) ตรวจ endpoint ที่ยังรอผลแบบ sync |
| WebSocket | รองรับ | Live ใช้ได้ |
| Cache | ตั้ง Cache Rule `studio.naka-ai.com/static/*` = cache everything (ไฟล์เป็น uuid immutable อยู่แล้ว) | ลด bandwidth VPS มาก |
| IP จริง | header `CF-Connecting-IP` | โค้ด rate-limit เดิมใช้ต่อได้ |
| DNS | CNAME `@`, `www`, `studio` → `<tunnel-id>.cfargotunnel.com` (proxied) | ลบ route `custom_domain` ใน wrangler |

---

## 8. Monorepo ใหม่

```
naka-platform/
├─ apps/
│  ├─ account/            ← naka-ai-landing (git subtree, เก็บ history)
│  │  ├─ src/             โค้ด Worker เดิม (แก้น้อยที่สุด)
│  │  ├─ server/          node.ts · d1-sqlite.ts · r2-disk.ts   (ใหม่)
│  │  ├─ public/          landing static
│  │  ├─ migrations/
│  │  └─ Dockerfile
│  ├─ studio-web/         ← naka-drama-studio/frontend
│  └─ studio-admin/       ← naka-drama-studio/admin
├─ services/
│  └─ studio/             ← naka-drama-studio/backend (+ Dockerfile, NAKA_ROLE)
├─ packages/
│  └─ contracts/          type ร่วม: User headers, CreditHold, JobStatus, error codes, ราคา
├─ infra/
│  ├─ docker-compose.yml
│  ├─ Caddyfile
│  ├─ litestream.yml
│  └─ .env.example
├─ docs/adr/              ADR-001, ADR-002
└─ .github/workflows/     ci.yml (typecheck+test ทุก app, Node 24) · deploy.yml (build → push → ssh compose pull/up)
```
**ลบทิ้ง:** `desktop/`, `configs/`, Watchtower, route `/server-update` + `services/server-update.ts`, `wrangler.jsonc` (หลัง cutover), Basic auth, SSO flow ทั้ง 2 ฝั่ง
**Node:** ใช้ 24 ทุก image (studio Dockerfile ตอนนี้ node 20)

### Caddyfile (โครงร่าง)
```caddy
{ servers { trusted_proxies static private_ranges } }

http://naka-ai.com, http://www.naka-ai.com {
    @www host www.naka-ai.com
    redir @www https://naka-ai.com{uri} 301
    respond /internal/* 404
    @api path /api/* /webhook/*
    reverse_proxy @api account-web:8788
    root * /srv/account-public
    file_server
}

http://studio.naka-ai.com {
    request_header -X-Naka-*                     # กัน client ปลอม header
    respond /internal/* 404
    @public path /static/*
    handle @public { root * /srv/studio-data ; file_server }

    forward_auth account-web:8788 {
        uri /internal/auth/verify
        copy_headers X-Naka-User-Id X-Naka-User-Name X-Naka-User-Admin X-Naka-Plan
    }
    handle /api/v1/live* { reverse_proxy studio-live:5679 }
    handle /api/v1/*     { reverse_proxy studio-api:5679 }
    handle /admin/*      { root * /srv/studio-admin ; try_files {path} /admin/index.html ; file_server }
    handle               { root * /srv/studio-web   ; try_files {path} /index.html ; file_server }
}
```
(หน้าเว็บ static ควรโหลดได้โดยไม่ต้อง login แล้วให้ API 401 พา redirect — ปรับ `forward_auth` ให้ครอบเฉพาะ `/api/*` และ `/admin/*` ตอน implement)

---

## 9. ลำดับงาน + ประมาณเวลา

| Phase | งาน | เวลา | ทำแล้วได้อะไร |
|---|---|---|---|
| **0** | Monorepo + CI + ลบ desktop/watchtower/server-update | 3–4 วัน | ฐานโค้ดเดียว |
| **1** | Landing บน Node: adapter D1/R2/cron, Dockerfile, test เดิมผ่านทั้งหมด, รันคู่ขนานบน `staging.naka-ai.com` | 1–1.5 สัปดาห์ | landing พร้อมย้าย |
| **2** | Infra: compose + Caddy + cloudflared + litestream, staging ครบทุก host | 3–4 วัน | ระบบจริงบน Docker |
| **3** | **Cutover landing** (ดู §10) | 1 วัน (downtime ~15 นาที) | เลิกใช้ Worker |
| **4** | Auth รวม: cookie `.naka-ai.com` + forward_auth + studio อ่าน header, ปิด SSO | 1 สัปดาห์ | login ครั้งเดียว |
| **5** | Credits: `/internal/credits/*` + studio hold/commit/refund | 1 สัปดาห์ | ปิดช่องรายได้รั่ว |
| **6** | Studio ขั้น 1: job queue ทนรีสตาร์ท + แยก api/render/live | 2 สัปดาห์ | render ไม่ถ่วง API |
| **7** | Studio ขั้น 2: modules ตามเมนู (ทีละเมนู) + ลบฟีเจอร์ซ้ำ marketer/video/trending | 3–4 สัปดาห์ | ขอบเขตชัด |
| **8** | Studio ขั้น 3: container ต่อเมนู (เปิดตามความจำเป็น) | 2–3 วัน | 1 เมนู 1 service |

**รวม ~10–12 สัปดาห์** · Phase 1–3 กับ 4–5 ทำสลับกันได้; **Phase 5 (เครดิต) ควรขยับขึ้นก่อนถ้า studio เปิดให้ลูกค้าใช้อยู่แล้ว**

---

## 10. Cutover runbook (Landing: Worker → Docker)

ก่อนวันจริง
1. Staging ผ่าน: login ทุกช่องทาง (Google, LINE, password, reset), Stripe test checkout + webhook, LINE/Meta webhook, cron ทุกงาน
2. ลด TTL DNS ไม่จำเป็น (Tunnel เปลี่ยนได้ทันทีใน dashboard)
3. ซ้อม export/import D1 อย่างน้อย 1 รอบ วัดเวลา

วันจริง (ช่วงคนใช้น้อย)
1. เปิด `FEATURE_*` maintenance / feature switch ปิดการเขียน (มีระบบ `closedFeature` อยู่แล้ว) → หยุด cron ใน Worker
2. `wrangler d1 export --remote` → import → `integrity_check` + เทียบจำนวนแถวตารางสำคัญ (users, sessions, credit_ledger, payments, receipts, jobs)
3. `docker compose up -d` → health check
4. สลับ public hostname `naka-ai.com` / `www` ใน Cloudflare ไปที่ Tunnel
5. Smoke test: login, ดูเครดิต, Stripe webhook test event, LINE webhook verify
6. เปิดการเขียน

Rollback: สลับ hostname กลับไป Worker (D1 ยังอยู่ครบ — ข้อมูลที่เขียนหลัง cutover ต้อง replay มือ จึงตัดสินใจภายใน 1 ชม.แรก)

**Webhook ที่ URL ไม่เปลี่ยน** (โดเมนเดิม): Stripe (retry เองถ้าพลาด), LINE, Meta, Google/LINE OAuth redirect URI

---

## 11. ความเสี่ยง

| ความเสี่ยง | โอกาส | ผลกระทบ | ป้องกัน |
|---|---|---|---|
| Server เดียวล่ม = ทั้งระบบล่ม (เดิม landing อยู่บน Cloudflare ไม่เคยล่ม) | กลาง | สูง | litestream สำรองทุกวินาที, script กู้เครื่องใหม่ < 30 นาที, monitoring (Uptime Kuma/Healthchecks) |
| Render กิน CPU จนหน้าเว็บช้า | สูง | กลาง | `cpus:`/`mem_limit` ใน compose ให้ `studio-render`, account-web ได้ priority |
| Origin/cookie ผิดหลัง proxy → login/POST พัง | กลาง | สูง | test e2e บน staging ก่อน cutover (§3.3 ข้อ 1–2) |
| Upload > 100 MB โดน Cloudflare ตัด | กลาง | กลาง | chunked upload |
| เครดิตหักซ้ำ/ไม่คืน ตอนแยก render | กลาง | สูง | hold/commit/refund idempotent ด้วย holdId + test |
| ข้อมูลหายตอน migrate D1 | ต่ำ | สูง | ซ้อม, เทียบ row count, เก็บ D1 ไว้ 30 วัน |

---

## 12. Spec เครื่องแนะนำ (เริ่มต้น)
- VPS 8 vCPU / 16 GB RAM / NVMe 200 GB+ (FFmpeg + Hypit กิน CPU, media กินดิสก์)
- R2 สำหรับ backup (litestream) และ media ระยะยาว
- ภายหลัง: แยก `studio-render` ไปเครื่องที่ 2 เมื่อคิว render ยาว → ต้องย้าย media ไป R2 + DB ไป Postgres ก่อน

---

## คำถามที่เหลือ
1. Studio ตอนนี้ **เปิดให้ลูกค้าใช้จริงแล้วหรือยัง?** (ถ้าใช่ → ทำ Phase 5 เครดิตก่อน)
2. Docker host เดิมของ studio อยู่ที่ไหน spec เท่าไร จะใช้เครื่องเดียวกันรัน landing ด้วยไหม
3. Cloudflare plan (Free / Pro)? มีผลกับ upload limit
4. ต้องการ staging แยกเครื่อง หรือรันบนเครื่องเดียวกันด้วย compose project คนละชื่อ
