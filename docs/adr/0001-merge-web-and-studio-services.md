# ADR-001: รวม naka-ai-landing + naka-drama-studio เป็นเว็บเดียว และแยก Service ตามเมนู Studio AI

**Status:** Superseded (บางส่วน) by ADR-002 — desktop เลิกขาย, ใช้ studio.naka-ai.com, ย้าย landing ลง Docker
**Date:** 2026-10-08
**Deciders:** เจ้าของระบบ NAKA-AI TECH (kimyohant)

---

## Context

### สภาพปัจจุบัน (จากการอ่านโค้ดทั้ง 2 repo)

| | **naka-ai-landing** | **naka-drama-studio** |
|---|---|---|
| Runtime | Cloudflare Worker ตัวเดียว (`src/index.ts`) | Node.js + Hono (`backend/src/index.ts`, port 5679) + Electron desktop |
| Frontend | HTML/CSS/JS ล้วนใน `public/` (ไม่มี build) | Nuxt 3 SPA (`frontend/`) + Nuxt admin (`admin/`) |
| DB | Cloudflare D1 (18 migrations) | SQLite ไฟล์เดียว (better-sqlite3 + Drizzle) |
| Storage | R2 (ยังไม่เปิดใน production) | ดิสก์ local `data/static/` |
| หน้าที่ | Landing, Auth (Google/LINE/OTP/password), **credits + job queue**, Stripe billing, receipts, social posting, inbox, affiliate, admin ลูกค้า | เครื่องผลิตสื่อ: Drama, Marketer, Seller, Viral Clone, Live + Mastra agents + FFmpeg + Hypit |
| เชื่อมกัน | เป็น SSO server (`src/auth/studio.ts`) | รับ SSO ผ่าน `src/auth/naka-sso.ts`, session 12 ชม. |

### เมนู Studio AI (จาก `frontend/app/layouts/default.vue`)
1. **Drama** (`/drama`) — นิยาย → สคริปต์ → asset → storyboard → วิดีโอ → merge
2. **Marketer** (`/marketer`) — campaign, trending, gallery
3. **Seller** (`/seller`) — AI Seller / product video (หน้าแรก)
4. **Viral Clone** (`/viral-clone`) — วิเคราะห์คลิป + render (ffmpeg / Hypit)
5. **Live** (`/live`) — AI Live, TikTok Live connector, avatar
6. (Product **Studio** `/studio/:id` — shots, influencer, templates)

### ข้อเท็จจริงที่บังคับการตัดสินใจ

1. **เมนูทุกตัวใช้ "แกนกลาง" เดียวกันหนักมาก** — เช่น `services/studio.ts` import `generation.ts`, `ffmpeg-merge.ts`, `marketer.ts`, `task-prep.ts`, `mastra`, `pipeline-tasks.ts` พร้อมกัน; Seller พึ่ง auto-render ของ Studio (ลำดับ recovery ใน `index.ts` บังคับ)
   → ถ้าแยก 1 เมนู = 1 microservice ตรง ๆ ทุก service ต้อง copy แกนกลางเดียวกันไป หรือเรียกข้ามกันแบบ synchronous = **distributed monolith**
2. **Cloudflare Worker รัน FFmpeg / sharp / better-sqlite3 / Hypit ไม่ได้** → "เว็บเดียว" ต้องหมายถึง **โดเมนเดียว + UI เดียว + บัญชีเดียว** ไม่ใช่ runtime เดียว
3. **Electron desktop** bundle backend ทั้งก้อนเป็นไฟล์เดียว (`build/backend.mjs`) — ถ้าแยกเป็นหลาย service แบบ network จะทำให้ desktop พัง
4. **Studio ยังไม่หักเครดิต** (ไม่มีโค้ด credit ใน `backend/src` เลย) ขณะที่ landing มี `credits.ts` + hold/refund ใน job queue แล้ว → ช่องรั่วรายได้
5. **SQLite ไฟล์เดียว + งานค้างใน in-process promise** (ต้องมี startup recovery sweeps) → scale แนวนอนไม่ได้ เปิดได้ instance เดียว
6. **มีฟีเจอร์ซ้ำ**: `marketer/`, `video/`, `studio.ts`, trending อยู่ทั้งสอง repo
7. ทีมเล็ก (1–2 คน + AI agent) — ภาระ ops ของ microservice จริงจังสูง

---

## Decision

**ทำ "เว็บเดียว" ที่ขอบ (edge) และ "Modular Monolith + แยก Worker เฉพาะส่วนที่ scale ต่างกัน" ที่หลังบ้าน — ไม่แยก microservice ทีละเมนูตั้งแต่วันแรก**

```
                         naka-ai.com  (โดเมนเดียว, cookie เดียว)
                                   │
                ┌──────────────────▼───────────────────┐
                │  Edge Gateway — Cloudflare Worker     │  (จาก naka-ai-landing)
                │  • landing / legal / login (static)   │
                │  • Auth, Session, Admin ลูกค้า         │
                │  • Credits ledger, Billing, Receipts  │
                │  • Social, Inbox, Affiliate, cron     │
                │  • /studio/* , /api/studio/* → proxy  │
                └──────────────────┬───────────────────┘
                                   │  signed internal header (user id, plan)
                ┌──────────────────▼───────────────────┐
                │  Studio Core API — Node/Hono           │  (จาก naka-drama-studio)
                │  modules/                              │
                │   ├─ drama/      ├─ seller/            │
                │   ├─ marketer/   ├─ viral-clone/       │
                │   ├─ live/       └─ product-studio/    │
                │  core/ (shared kernel)                 │
                │   ai-config · agents(Mastra) · tasks   │
                │   storage · ownership · credits-client │
                └──────┬──────────────────────┬─────────┘
                       │ job queue            │ long-lived WS
          ┌────────────▼──────────┐   ┌───────▼─────────────┐
          │ Render Worker(s)      │   │ Live Service         │
          │ ffmpeg · hypit ·      │   │ tiktok-live · avatar │
          │ image/video gen poll  │   │ (stateful, 1 proc/ห้อง)│
          └───────────────────────┘   └─────────────────────┘
```

**หลักสำคัญ**
- **UI เดียว**: Nuxt app ของ studio เป็น "แอปหลังล็อกอิน" ที่ `naka-ai.com/studio/` (หรือ `/app/`), landing static ยังอยู่ที่ `/` บน Worker (SEO ดี, เร็ว). Worker proxy `/studio/*` + `/api/studio/*` ไป origin ของ Studio → **same-origin = ตัด SSO redirect dance ทิ้งได้** ใช้ session cookie ของ Worker ตัวเดียว
- **เมนู = module ที่มีขอบเขตชัด** ไม่ใช่ process แยก: แต่ละเมนูเป็นโฟลเดอร์ `modules/<menu>/{routes,services,schema}` ห้าม import ข้าม module ตรง ๆ ต้องผ่าน `core/` หรือ public interface ของ module (บังคับด้วย ESLint `no-restricted-imports` / dependency-cruiser)
- **แยก process เฉพาะที่มีเหตุผลทาง scaling/ความเสถียร**:
  - **Render Worker** — CPU หนัก (FFmpeg, Hypit, sharp) ไม่ควรแย่ง CPU กับ API
  - **Live Service** — connection ค้างยาว, stateful, crash ไม่ควรลาก API ล่ม
- **Gateway เป็นเจ้าของบัญชีและเงิน**: Studio เรียก `POST /internal/credits/hold|commit|refund` ของ Worker ก่อน/หลังสร้างงาน

---

## Options Considered

### Option A: Microservice 1 ตัวต่อ 1 เมนู (ตามที่คิดไว้ตอนแรก)
| Dimension | Assessment |
|---|---|
| Complexity | **High** — 5–6 service × (deploy, DB, log, auth, version) |
| Cost | สูง — VPS/container หลายตัว, แต่ละตัวต้องมี ffmpeg/agents ซ้ำ |
| Scalability | ดีในทางทฤษฎี แต่คอขวดจริงคือ render/AI provider ไม่ใช่เมนู |
| Team familiarity | ต่ำ — ต้องมี service mesh / tracing / contract test |

**Pros:** deploy เมนูแยกกันได้, ล่มทีละเมนู
**Cons:** แกนกลางร่วม (generation, agents, ffmpeg, sys_task) ต้อง copy หรือแยกเป็น service อีกตัวที่ทุกเมนูเรียก → กลายเป็น distributed monolith; Seller↔Studio auto-render ผูกกัน; desktop app แตก; SQLite แชร์ข้าม process ไม่ได้ ต้องย้าย Postgres ก่อน

### Option B: Modular Monolith + Edge Gateway + แยก Render/Live (**เลือก**)
| Dimension | Assessment |
|---|---|
| Complexity | **Medium** — 1 API + 2 worker + 1 edge |
| Cost | ต่ำ — VPS 1–2 เครื่อง + Cloudflare ที่มีอยู่ |
| Scalability | เพิ่ม render worker ได้แนวนอน; API scale แนวตั้งก่อน |
| Team familiarity | สูง — ใช้ Hono/Worker/Nuxt เดิมทั้งหมด |

**Pros:** ได้ "เว็บเดียว" เร็ว, desktop ยังรันทุก module ใน process เดียวได้ (mode `all-in-one`), ขอบเขต module ชัดพร้อมแยกจริงในอนาคต
**Cons:** deploy studio API ทีเดียวทุกเมนู; ต้องมีวินัยเรื่องขอบเขต module

### Option C: ย้ายทุกอย่างเข้า repo/runtime เดียว (Node ทั้งหมด หรือ Worker ทั้งหมด)
| Dimension | Assessment |
|---|---|
| Complexity | Medium–High (rewrite) |
| Cost | ทิ้งข้อดี Cloudflare (edge, D1, cron ฟรี) หรือทำ FFmpeg ไม่ได้ |
| Scalability | แย่กว่า B |
| Team familiarity | ต้อง port auth/billing ที่ test ไว้แล้ว ~30 ไฟล์ |

**Pros:** codebase เดียว ภาษาเดียว
**Cons:** Worker รัน ffmpeg/sqlite native ไม่ได้; ย้าย auth/billing ไป Node = เสี่ยงกับระบบเงินที่ทำงานอยู่แล้ว

---

## Trade-off Analysis

- **"แยกตามเมนู" vs "แยกตามลักษณะงาน"** — เมนูต่างกันที่ UI/workflow แต่ใช้ทรัพยากรเดียวกัน (AI provider, ffmpeg, storage). จุดที่ต้อง scale/แยก fault จริงคือ **render** และ **live** จึงแยกตามนั้นได้ประโยชน์มากกว่าด้วยต้นทุนน้อยกว่ามาก
- **Same-origin proxy vs SSO ข้ามโดเมน** — proxy ผ่าน Worker เพิ่ม latency ~ไม่กี่ ms แต่ได้ cookie เดียว, ไม่มี CORS, ไม่มี redirect 3 ทอด, ปิด studio ไม่ให้เข้าตรงจาก internet ได้ (Cloudflare Tunnel)
- **Desktop app** — Option B คง entrypoint `all-in-one` ที่โหลดทุก module + render + live ใน process เดียว; production ใช้ entrypoint `api` / `render` / `live` แยกกัน จากโค้ดชุดเดียวกัน
- **เส้นทางสู่ microservice จริง** — เมื่อมี module ไหนต้องการทีม/จังหวะ deploy/DB แยกจริง (เช่น Live มีลูกค้าเยอะ) ค่อยยก `modules/live` ออกเป็น service ได้ทันทีเพราะขอบเขตถูกบังคับไว้แล้ว (Strangler pattern)

---

## Consequences

**ง่ายขึ้น**
- ลูกค้าเห็นเว็บเดียว ล็อกอินครั้งเดียว เครดิตกระเป๋าเดียว
- ปิดช่องรั่ว: ทุกงาน generate ใน studio ถูก hold/refund เครดิตผ่าน gateway
- Render หนักไม่ทำให้ UI/API ช้า; Live ล่มไม่ลาก drama ล่ม
- ลบฟีเจอร์ซ้ำ (marketer/video/trending) ให้เหลือเจ้าของเดียว

**ยากขึ้น**
- ต้องมี job queue ข้าม process (SQLite เดิมใช้ in-memory promise) → ต้องมี queue จริง
- ต้องดูแล contract ระหว่าง Gateway ↔ Studio (internal API + signed header)
- Deploy มี 2 ฝั่ง (Cloudflare + VPS) ต้องมี CI/CD และ versioning ร่วม

**ต้องกลับมาทบทวน**
- SQLite → Postgres เมื่อจะรัน Studio API > 1 instance หรือแยก render worker หลายเครื่อง
- Local disk → R2/S3 เมื่อ render worker อยู่คนละเครื่องกับ API
- เกณฑ์ยก module เป็น service จริง: (1) ต้อง scale ต่างจากส่วนอื่น > 5×, (2) มีคน/ทีมดูแลแยก, หรือ (3) ต้องการ release cycle แยก

---

## Action Items (แผนเป็นเฟส)

### Phase 0 — Monorepo (1 สัปดาห์)
1. [ ] สร้าง repo ใหม่ `naka-platform` (pnpm workspaces + Turborepo) แล้ว `git subtree add` ทั้ง 2 repo เพื่อเก็บ history
   ```
   apps/edge        ← naka-ai-landing (Worker + public/)
   apps/studio-web  ← naka-drama-studio/frontend
   apps/admin       ← naka-drama-studio/admin  (ภายหลังรวมกับ /admin ของ Worker)
   apps/desktop     ← naka-drama-studio/desktop
   services/studio  ← naka-drama-studio/backend
   packages/contracts  ← type ร่วม: User, CreditHold, JobStatus, error codes
   ```
2. [ ] CI เดียว: typecheck + test ทุก app (Node 24 เพราะ edge ใช้ `node:sqlite`)
3. [ ] รวม `CLAUDE.md`/openwiki เป็นชุดเดียว, ย้าย ADR นี้ไป `docs/adr/0001-*.md`

### Phase 1 — เว็บเดียว (1–2 สัปดาห์)
4. [ ] Studio frontend: ตั้ง `app.baseURL = '/studio/'` + `useApi` ชี้ `/api/studio/v1`
5. [ ] Worker: เพิ่ม route proxy `/studio/*`, `/api/studio/*` → `STUDIO_ORIGIN` (Cloudflare Tunnel ไป VPS, ไม่เปิด port สาธารณะ) และแนบ header `X-Naka-User` ที่เซ็น HMAC + timestamp
6. [ ] Studio: middleware ใหม่อ่าน signed header แทน SSO flow (เก็บ `naka-sso.ts` ไว้เป็นโหมด fallback สำหรับ desktop)
7. [ ] Landing: ปุ่ม "เริ่มสร้าง" / `/create/?workflow=…` ลิงก์เข้าเมนูที่ตรงกันใน `/studio/` (sales→seller, drama→drama, live→live)
8. [ ] ตัดสินใจเรื่อง admin: รวม "ตั้งค่า AI" ของ studio เข้า `/admin/` ของ Worker เป็นแท็บเดียว (proxy เช่นกัน)

### Phase 2 — เครดิตและ ownership (1–2 สัปดาห์)
9. [ ] Worker เปิด internal API `hold / commit / refund` (reuse logic ใน `src/credits.ts`)
10. [ ] Studio `core/credits-client.ts` เรียกก่อนทุก `generateImage/generateVideo/merge` และ refund เมื่อ task fail ถาวร
11. [ ] ใช้ `services/generation-cost.ts` ที่มีอยู่เป็นตารางราคากลาง ย้ายไป `packages/contracts`

### Phase 3 — Modularize Studio ตามเมนู (2–3 สัปดาห์, ทำทีละ module)
12. [ ] สร้าง `services/studio/src/core/` (ai, agents, generation, ffmpeg, storage, ownership, pipeline-tasks)
13. [ ] ย้ายตามลำดับความเสี่ยงต่ำ→สูง: `live` → `viral-clone` → `marketer` → `drama` → `seller` + `product-studio` (สองตัวหลังผูกกัน ย้ายพร้อมกัน)
14. [ ] ใส่ dependency-cruiser rule: `modules/A` ห้าม import `modules/B/**` ยกเว้น `modules/B/index.ts`
15. [ ] แต่ละ module เป็นเจ้าของตาราง prefix ของตัวเอง (`drama_*`, `clone_*`, `live_*` …)
16. [ ] ลบของซ้ำ: เลือกเจ้าของเดียวสำหรับ marketer / trending / ai-video (แนะนำ: ฝั่ง studio เป็นเจ้าของการผลิต, ฝั่ง edge เหลือแค่ social posting + inbox)

### Phase 4 — แยก process ที่จำเป็น (2–3 สัปดาห์)
17. [ ] เปลี่ยน in-process promise → job queue ที่ทนรีสตาร์ท (เริ่มจาก ตาราง jobs + lease ใน SQLite แบบเดียวกับ `jobs.ts` ของ edge; ย้ายไป Postgres/Redis เมื่อมีหลายเครื่อง)
18. [ ] Entrypoints: `api.ts`, `render-worker.ts`, `live.ts`, `all-in-one.ts` (desktop) — docker-compose มี 3 service ใช้ image เดียว
19. [ ] Storage abstraction (`local` | `r2`) เปิด R2 ใน production

### Phase 5 — ทบทวน (เมื่อมีข้อมูลจริง)
20. [ ] วัด: เวลา render, คิว, CPU, รายได้ต่อเมนู → ใช้เกณฑ์ใน *Consequences* ตัดสินว่าจะยก module ไหนเป็น microservice จริงหรือไม่
21. [ ] SQLite → Postgres (Drizzle รองรับ, เปลี่ยน dialect + migration)

---

### คำถามที่ต้องตอบก่อนเริ่ม
- Studio production รันที่ไหนตอนนี้ (Windows server ผ่าน `redeploy.ps1` หรือ Docker)? มีผลกับ Cloudflare Tunnel และ Phase 4
- Desktop app ยังต้องขายต่อไหม? ถ้าไม่ ตัดโหมด `all-in-one` ออกได้ ทำให้ Phase 3–4 ง่ายขึ้นมาก
- URL ที่ต้องการ: `naka-ai.com/studio/` (แนะนำ, same-origin) หรือ `app.naka-ai.com` (ต้องใช้ cookie ระดับ `.naka-ai.com`)
