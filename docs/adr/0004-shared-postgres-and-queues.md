# ADR-0004: ใช้ฐานข้อมูลตัวเดียวกัน (PostgreSQL) — และต้องมี RabbitMQ / Redis ไหม

**Status:** Accepted (2026-10-08) — Phase 0, 1 and 2 done
**Date:** 2026-10-08
**Deciders:** เจ้าของระบบ NAKA-AI TECH

> **คำตอบที่ได้ (2026-10-08):** ระบบยังอยู่ระหว่าง dev (ไม่มีข้อมูลลูกค้าจริงต้องย้าย) และ **landing จะย้ายลง Docker บน host ของเจ้าของเอง** → เลือก **Option B (PostgreSQL self-host ใน Docker บน host เดียวกัน)**; ไม่ต้องใช้ Hyperdrive; ไม่ต้องย้ายข้อมูล D1/SQLite (เริ่ม DB ใหม่ + seed); ทำ landing ก่อน studio เพราะต้องย้ายลง Docker อยู่แล้ว และ studio ต้องพึ่ง `account.users`/เครดิต

---

## Context

### ตอนนี้มีฐานข้อมูล 2 ตัว คนละชนิด คนละที่
| | `apps/landing` (naka-ai.com) | `apps/studio` |
|---|---|---|
| DB | **Cloudflare D1** (SQLite บน Cloudflare) | **SQLite ไฟล์** ใน Docker volume |
| รันที่ | Cloudflare Worker | Docker (Node/Hono) |
| ตาราง | 37 (users, sessions, credit_ledger, payments, receipts, jobs, subscriptions, social, inbox …) | 39 (dramas, episodes, storyboards, campaigns, studio_projects, clone_*, sys_task, pipeline_tasks, ai_service_configs … + `users` สำเนาจาก SSO) |
| เข้าถึง DB | D1 API `env.DB.prepare().bind().first/all/run/batch` — 284 จุด | Drizzle ORM (sqlite-core) + DDL ดิบ `core/db/sqlite-schema.ts` (870 บรรทัด) |
| คิวงาน | ตาราง `jobs` + lease/fencing, cron ทุก 1 นาที | `sys_task`/`pipeline_tasks` + promise ในหน่วยความจำ + กู้งานตอนบูต |

### ปัญหาที่เกิดจากการมี 2 DB
1. **ข้อมูลคนเดียวกันอยู่ 2 ที่** — `users` ของ studio เป็นสำเนาจาก SSO; ชื่อ/อีเมลเปลี่ยนแล้วไม่ตาม
2. **Studio ไม่หักเครดิต** — เครดิตอยู่ใน D1 ซึ่ง studio เข้าไม่ถึง (ต้องสร้าง API ข้ามระบบ)
3. **ทำรายงานรวมไม่ได้** — "ลูกค้าคนนี้จ่ายเท่าไร ใช้ไปกี่คลิป" ต้อง join ข้าม 2 DB
4. **สำรอง/กู้คืน 2 แบบ** — D1 Time Travel กับ SQLite snapshot
5. **SQLite ไฟล์เดียว scale แนวนอนไม่ได้** — studio รันได้ instance เดียว

### ข้อเท็จจริงจากโค้ดที่มีผลต่อการย้าย
| เรื่อง | landing | studio |
|---|---|---|
| SQL เฉพาะ SQLite | `json_extract` 23, `datetime()` 21, `INSERT OR IGNORE` 10, `PRAGMA` 9, `unixepoch` 5 | `AUTOINCREMENT` 67 (ใน DDL), `PRAGMA table_info` 1 |
| ใช้ DB แบบ synchronous | — (D1 async อยู่แล้ว) | **46 จุด** เรียก `.get()/.run()/.all()` แบบไม่ await (เช่น `core/ai/app-settings.ts` ตั้งใจทำ sync) — Postgres เป็น async ทั้งหมด ต้องแก้ทั้งสาย |
| เอา id หลัง insert | `meta.last_row_id` | `getInsertId()` (`lastInsertRowid`) 20 ไฟล์ |
| test | shim D1 บน `node:sqlite` | better-sqlite3 ไฟล์ชั่วคราว |

---

## Decision

### 1. ฐานข้อมูล: **PostgreSQL ตัวเดียว (1 server / 1 database) แบ่ง schema ตามเจ้าของ**

```
PostgreSQL 17  (database: naka)
├─ schema account   ← apps/landing เป็นเจ้าของ (users, sessions, credits, payments, receipts, jobs, social, inbox …)
├─ schema studio    ← apps/studio เป็นเจ้าของ (dramas, campaigns, studio_*, clone_*, sys_task …)
└─ schema reporting ← view อ่านอย่างเดียว สำหรับรายงานข้ามระบบ (เช่น ยอดใช้เครดิตต่อเมนู)
```

**"ตัวเดียวกัน" = engine เดียว, เครื่องเดียว, backup เดียว, ทำรายงาน join ได้ — แต่ยังแยกเจ้าของข้อมูล:**
- แต่ละแอปมี DB role ของตัวเอง: `account_app` เขียนได้แค่ `account`, `studio_app` เขียนได้แค่ `studio`
- `studio` **อ่าน** `account.users` ได้ผ่าน view (ไม่ต้องเก็บสำเนา `users` อีก) แต่**ห้ามเขียน**ตาราง account
- เครดิต: studio เรียก **function ใน DB** ที่ account เป็นเจ้าของ — `account.hold_credits(user_id, amount, ref)`, `account.commit_hold(hold_id)`, `account.refund_hold(hold_id)` (GRANT EXECUTE ให้ `studio_app`) → atomic, ไม่ต้องมี HTTP API, logic เงินยังอยู่ที่เดียว
- ห้ามมี foreign key ข้าม schema (กันสองแอปผูกกันแน่นจน deploy แยกไม่ได้)

### 2. ที่ตั้ง DB: **PostgreSQL 17 ใน Docker บน host เดียวกับ landing + studio** (ตัดสินแล้ว — ดูคำตอบด้านบน)
- ทั้งสองแอปต่อผ่าน Docker network (`postgres:5432`), ไม่เปิด port ออก internet (bind `127.0.0.1` สำหรับ dev tools เท่านั้น)
- แต่ละ role ตั้ง `search_path` เป็น schema ของตัวเอง → SQL เดิมที่เขียนชื่อตารางเปล่า ๆ (`FROM users`) ทำงานได้โดยไม่ต้องเติมชื่อ schema
- backup: `pg_dump` รายวัน + WAL archive ไป R2/ดิสก์อื่น (ทำก่อนเปิดใช้งานจริง) — เพราะเลือก self-host ภาระนี้เป็นของเรา
- เดิมเสนอ managed Postgres (Option A) — ยังเป็นทางเลือกถ้าวันหน้าอยากให้ DB ไม่ล่มตาม host

### 3. คิวงาน: **ใช้ Postgres เป็นคิว — ยังไม่ต้องมี RabbitMQ**
### 4. Cache / pub-sub: **ยังไม่ต้องมี Redis** — มีเกณฑ์ชัดว่าเมื่อไรค่อยเพิ่ม (§ Trade-off)

---

## Options Considered — ฐานข้อมูล

### Option A: Managed PostgreSQL (Neon / Supabase / DigitalOcean / RDS) — **แนะนำ**
| Dimension | Assessment |
|---|---|
| Complexity | Medium — ไม่ต้องดูแล server DB เอง |
| Cost | ~$19–70/เดือน ตามขนาด |
| Scalability | ดี — studio รันหลาย instance ได้, read replica ได้ |
| Reliability | PITR, HA, backup อัตโนมัติ; landing ไม่ล่มตาม VPS |
| Team familiarity | Postgres = มาตรฐาน, Drizzle รองรับ |

**Pros:** ข้อมูลเงินปลอดภัยที่สุด, Hyperdrive ต่อได้ตรง, ไม่ต้องทำ backup เอง
**Cons:** มีค่ารายเดือน, ถ้าเลือก region ไกลจาก VPS studio จะช้า (studio ยิง query ถี่ตอน poll งาน)

### Option B: PostgreSQL self-host ใน Docker บนเครื่อง studio
| Dimension | Assessment |
|---|---|
| Complexity | Medium–High — ต้องดูแล backup (pgBackRest/WAL-G → R2), upgrade, monitoring เอง |
| Cost | ต่ำสุด (ใช้เครื่องเดิม) |
| Scalability | จำกัดที่เครื่องเดียว |
| Reliability | **VPS ล่ม = naka-ai.com ล่มด้วย** (เดิม landing อยู่บน Cloudflare ไม่ล่มตาม) |
| Team familiarity | ต้องเรียนเรื่อง ops ของ Postgres |

**Pros:** ถูก, latency studio↔DB ต่ำสุด
**Cons:** ภาระ ops + จุดล่มจุดเดียว; Worker ต้องต่อเข้ามาผ่าน Cloudflare Tunnel + Hyperdrive

### Option C: คง D1 + SQLite แยกกัน แล้วเชื่อมด้วย API
| Dimension | Assessment |
|---|---|
| Complexity | Low ตอนนี้ / สูงขึ้นเรื่อย ๆ |
| Cost | ต่ำสุด |
| Scalability | studio ยังติด SQLite instance เดียว |
| Team familiarity | ใช้ของเดิม |

**Pros:** ไม่ต้อง migrate
**Cons:** ไม่ตอบโจทย์ "ตัวเดียวกัน", ต้องสร้าง API เครดิต/ผู้ใช้เพิ่ม, รายงานรวมทำยาก, สอง backup

### Option D: ใช้ D1 ตัวเดียวทั้งสองระบบ
ตัดทิ้ง — D1 ใช้จากนอก Worker ได้แค่ผ่าน HTTP API (ช้า + มี rate limit) ไม่เหมาะกับ studio ที่ query ถี่

---

## Options Considered — คิวงาน (RabbitMQ?)

### Q-A: Postgres เป็นคิว (`FOR UPDATE SKIP LOCKED`) — **แนะนำ**
- landing: ตาราง `account.jobs` เดิม (lease/fencing/refund ครั้งเดียว) ย้ายมา Postgres แทบไม่ต้องเปลี่ยน logic; cron Worker ยังเป็นตัวปลุก
- studio: ใช้ **pg-boss** (หรือเขียน worker บนตาราง `studio.jobs` แบบเดียวกับ landing) แทน promise ในหน่วยความจำ → รีสตาร์ทแล้วงานไม่หาย, ไม่ต้องมี recovery sweeps ซับซ้อน, แยก container render ได้ (ADR-0002 §5)
- **ข้อดีใหญ่:** สร้างงาน + hold เครดิต อยู่ใน **transaction เดียวกัน** — ทำแบบนี้กับ RabbitMQ ไม่ได้ (ต้องมี outbox pattern)
- รองรับหลายพันงาน/วินาที — งานของเราคือหลักสิบ–ร้อยงาน/นาที (คอขวดจริงคือ AI provider ไม่ใช่คิว)

### Q-B: RabbitMQ
| | |
|---|---|
| ได้อะไร | routing ซับซ้อน, fan-out, throughput สูงมาก |
| เสียอะไร | service เพิ่ม 1 ตัวต้องดูแล/สำรอง/monitor, Worker ต่อ AMQP ไม่ได้ตรง ๆ, ต้องทำ outbox เพื่อให้ "สร้างงาน + หักเครดิต" ไม่หลุด |
| เมื่อไรควรใช้ | มีหลายทีม/หลายภาษาส่ง event หากัน, หรือ throughput เกินหลายพันข้อความ/วินาทีต่อเนื่อง — **ยังไม่ใช่เรา** |

### Q-C: Cloudflare Queues
ดีสำหรับฝั่ง Worker แต่ studio (Docker) ต้อง pull ผ่าน HTTP; ไม่ได้ transaction ร่วมกับ DB → ไม่คุ้มเมื่อมี Postgres แล้ว

---

## Options Considered — Redis?

| ใช้ Redis ทำอะไรได้ | ตอนนี้ทำด้วยอะไร | ต้องมี Redis ไหม |
|---|---|---|
| session | `account.sessions` ใน DB (30 วัน, hash) | ไม่ — query เดียวต่อ request, Postgres พอ |
| rate limit (OTP/password) | ตารางใน DB + `CF-Connecting-IP` | ไม่ — หรือใช้ Cloudflare Rate Limiting ที่ edge |
| cache settings / AI config | `withSettings()` อ่าน DB ทุก request | ไม่ — cache ในหน่วยความจำ 30–60 วินาทีพอ |
| real-time (Live events, สถานะงาน) | frontend poll `live/tiktok/events?after=…` | ยังไม่ — ใช้ Postgres `LISTEN/NOTIFY` + SSE ก่อน |
| คิว (BullMQ) | — | ไม่ — ใช้ Postgres (ด้านบน) |

**เกณฑ์ว่าเมื่อไรค่อยเพิ่ม Redis** (ข้อใดข้อหนึ่ง):
1. studio API รัน **> 1 instance** และต้องการ rate limit / lock / cache ร่วมกัน
2. Live มีผู้ชม/ห้องพร้อมกันเยอะจน `LISTEN/NOTIFY` หรือ polling กิน DB เกิน ~20% CPU
3. มี hot read ที่ cache ในหน่วยความจำไม่พอ (หลาย instance ต้องเห็นค่าเดียวกัน)

---

## Trade-off Analysis

- **Postgres ตัวเดียว vs แยก DB ต่อ service (แนวทาง microservice ตำรา):** เราได้ "แหล่งความจริงเดียว" + transaction ข้ามระบบ (เครดิต) + รายงาน join ได้ โดยยังรักษาขอบเขตด้วย schema + role + function — ถ้าวันหน้าต้องแยกจริง ก็ย้าย schema ไป server ใหม่ได้เพราะไม่มี FK ข้าม schema
- **Managed vs self-host:** จ่ายเพิ่มเดือนละไม่กี่ร้อยถึงพันกว่าบาท แลกกับไม่ต้องดูแล backup/HA ของ**ข้อมูลเงิน** และ naka-ai.com ไม่ล่มตาม VPS — คุ้มสำหรับทีมเล็ก
- **Postgres queue vs RabbitMQ:** เสีย throughput ที่ไม่ได้ใช้, ได้ service น้อยลง 1 ตัว + transaction เดียวกับเครดิต
- **ไม่มี Redis:** request ช้ากว่าระดับ ~1 ms ในบางจุด — ไม่มีผลกับงานที่ใช้เวลาหลักนาที (AI generate)
- **ต้นทุนการย้ายคือส่วนที่แพงที่สุด:** studio ต้องเปลี่ยน sync → async 46 จุด + Drizzle sqlite→pg; landing ต้องแปลง SQL ~70 จุด แต่ใช้ adapter รูปแบบ D1 เดิมได้ จึงไม่ต้องแก้ 284 call site

---

## Consequences

**ง่ายขึ้น**
- ปิดช่องรายได้รั่ว: studio hold/commit/refund เครดิตใน transaction เดียวกับการสร้างงาน
- ข้อมูลผู้ใช้ชุดเดียว (เลิกสำเนา `users` ใน studio)
- รายงาน "รายได้ vs การใช้งานต่อเมนู/ต่อลูกค้า" ทำด้วย SQL ตรง ๆ
- backup / PITR ที่เดียว
- studio รันหลาย instance + แยก render worker ได้ (ปลดล็อก ADR-0002 §5)

**ยากขึ้น**
- landing ขึ้นกับ DB นอก Cloudflare (Hyperdrive ช่วยเรื่อง latency แต่ DB ล่ม = naka-ai.com ล่ม)
- dev ต้องมี Postgres (docker compose) — test ใช้ **PGlite** (Postgres ใน process, ไม่ต้องมี Docker) แทน shim SQLite
- migration ต้องมีเครื่องมือเดียว (Drizzle Kit) แยก folder ต่อ schema

**ต้องกลับมาทบทวน**
- Redis ตามเกณฑ์ 3 ข้อด้านบน
- RabbitMQ / event bus เมื่อมีหลายทีม/หลายภาษาหรือ throughput สูงจริง
- read replica สำหรับรายงาน เมื่อ query รายงานเริ่มกระทบ OLTP

---

## Action Items (เป็นเฟส) — ฉบับปรับหลังได้คำตอบ

### ✅ Phase 0 — Postgres ใน Docker (เสร็จ)
- [x] `docker-compose.yml` ที่ root: `postgres:17` + volume + healthcheck, bind `127.0.0.1:5432`
- [x] `infra/postgres/init/`: schema `account`/`studio`/`reporting`, role `account_app`/`studio_app`/`reporting_ro` (NOLOGIN ใน SQL, ตั้งรหัสจาก `.env` ด้วย shell script), `search_path` ต่อ role, ปิดสิทธิ์ `public`
- [x] ตรวจสิทธิ์ด้วย PGlite: แต่ละ role สร้าง/อ่าน/เขียนได้แค่ schema ของตัวเอง

### ✅ Phase 1 — Landing → Node + Docker + Postgres (เสร็จ)
- [x] Node entrypoint ห่อ `worker.fetch()/scheduled()` เดิม (ADR-0002 §3) + adapter รูปแบบ D1 บน Postgres (`postgres` driver; `?` → `$n`; `batch` = transaction; `last_row_id` จาก `RETURNING id`)
- [x] แปลง SQL เฉพาะ SQLite ~70 จุด + migrations 0001–0018 → baseline Postgres ชุดเดียว
- [x] test 279 ตัว: shim `node:sqlite` → PGlite
- [x] Dockerfile + service `landing` + `landing-cron` ใน compose; Caddy/Tunnel ตาม ADR-0002
- ส่วนที่ต่างจากแผน: เขียนพร้อมกันถูก serialize ด้วย advisory lock ใน adapter (เหมือน D1 ที่เขียนทีละรายการ — โค้ดเช็คโควตา/ยอดเครดิตใน statement เดียวต้องการแบบนี้); test ที่รัน Cloudflare workerd + D1 ย้ายเป็น `tests/postgres.integration.test.cjs` (รันกับ PostgreSQL จริงใน CI); workflow deploy ไป Cloudflare ถูกลบ

### ✅ Phase 2 — Studio → Postgres (เสร็จ)
- [x] Drizzle `sqlite-core` → `pg-core`, DDL → `apps/studio/backend/migrations/pg/0001_baseline.sql` (39 ตาราง; รันตอนบูตใต้ advisory lock), sync → async, `getInsertId` → `RETURNING` + `insertedId()`, test → PGlite (`DATABASE_URL=pglite://memory`)
- [x] ย้าย service studio เข้า compose ที่ root (network เดียวกับ postgres, `studio_app`); `apps/studio/docker-compose.yml` + Watchtower ถูกลบ (ADR-0002), volume สื่อเดิม `naka-drama-studio_naka-data` ใช้ต่อ
- ส่วนที่ต่างจากแผน: ใช้ `pgTable` + `search_path` ของ role แทน `pgSchema('studio')` (SQL ไม่ต้องเติมชื่อ schema — dev/test ใช้ PGlite ที่ตั้ง search_path เอง); migration เป็นไฟล์ SQL ที่เขียนเอง ไม่ใช่ drizzle-kit generate; **concurrency** — บน better-sqlite3 การอ่านแล้วเขียนต่อกันไม่มี I/O จริงคั่น จึงไม่มี request อื่นแทรกได้ บน Postgres แทรกได้ทุก await → แก้จุดที่แข่งกันได้ด้วย statement เดียว (`ON CONFLICT`, `UPDATE … WHERE … RETURNING`) หรือ transaction + `pg_advisory_xact_lock` (`startTask`, งบโปรเจกต์ใน `createTask`, ผลตอบรับ creative, `makeVideo` ของ Seller) — test ใน `tests/concurrency.test.ts`
- ไม่ได้ย้ายข้อมูล SQLite เดิม (ตามคำตอบด้านบน: ยังเป็น dev) — สื่อใน volume ยังอยู่ แต่แถวในฐานข้อมูลเริ่มใหม่

### Phase 3 — ใช้ประโยชน์จาก DB เดียว (1–2 สัปดาห์)
- [ ] `account.hold_credits/commit_hold/refund_hold` + GRANT ให้ `studio_app`; studio หักเครดิต
- [ ] `studio.users` → view อ่าน `account.users`; คิวงาน studio บน Postgres (pg-boss); `reporting` views

---

## Action Items เดิม (ก่อนได้คำตอบ — เก็บไว้อ้างอิง)

### Phase 0 — เตรียม (1 สัปดาห์)
1. [ ] เลือกผู้ให้บริการ + region (เดียวกับ VPS studio); สร้าง `naka` database, schema `account`/`studio`/`reporting`, role `account_app`/`studio_app`/`reporting_ro`
2. [ ] `docker-compose` สำหรับ dev มี `postgres:17`; test ใช้ PGlite
3. [ ] Hyperdrive config ชี้ไป DB (landing)
4. [ ] วัดขนาดข้อมูลจริง: `wrangler d1 info naka-ai-db` + ขนาด `naka.sqlite3` บนเซิร์ฟเวอร์

### Phase 1 — Studio → Postgres (2–3 สัปดาห์)  *ทำก่อนเพราะไม่มีข้อมูลเงิน*
5. [ ] Drizzle `sqlite-core` → `pg-core` (39 ตาราง, `pgSchema('studio')`), ย้าย DDL ดิบ (`sqlite-schema.ts`) เป็น drizzle-kit migrations
6. [ ] sync → async: 46 จุด (เริ่มที่ `core/ai/app-settings.ts` แล้วไล่ผู้เรียก)
7. [ ] `getInsertId()` → `.returning({ id })` (20 ไฟล์); `ownership.ts` raw SQL → Postgres
8. [ ] test: better-sqlite3 → PGlite; test ที่ pin เลข migration ต้องปรับ
9. [ ] ย้ายข้อมูล: `pgloader` (SQLite → Postgres) + เทียบจำนวนแถวทุกตาราง; ซ้อม 1 รอบ
10. [ ] cutover studio (downtime สั้น) — เก็บไฟล์ SQLite เดิมไว้ย้อนกลับ

### Phase 2 — Landing → Postgres (2–3 สัปดาห์)
11. [ ] adapter **รูปแบบ D1 บน Postgres** (`prepare/bind/first/all/run/batch` → `postgres` driver ผ่าน Hyperdrive; `?` → `$n`; `batch` = transaction; `last_row_id` จาก `RETURNING id`) → 284 call site ไม่ต้องแก้
12. [ ] แปลง SQL เฉพาะ SQLite ~70 จุด: `json_extract` → `->>`, `datetime()/unixepoch` → `to_timestamp/extract(epoch …)`, `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`, `AUTOINCREMENT` → identity, ตัด `PRAGMA`
13. [ ] migrations 0001–0018 → ไฟล์ Postgres ชุดเดียว (schema ปัจจุบัน) + migration ใหม่ต่อจากนั้น
14. [ ] test: shim `node:sqlite` → PGlite (279 test ต้องผ่านเหมือนเดิม)
15. [ ] ย้ายข้อมูล: `wrangler d1 export` → แปลง → import; เทียบยอด `credit_ledger`, `payments`, `receipts` ต่อผู้ใช้ให้ตรง 100%
16. [ ] cutover ช่วงคนใช้น้อย (feature switch ปิดการเขียน); เก็บ D1 ไว้ 30 วัน

### Phase 3 — ใช้ประโยชน์จาก DB เดียว (1–2 สัปดาห์)
17. [ ] `account.hold_credits / commit_hold / refund_hold` (SECURITY DEFINER) + GRANT ให้ `studio_app`
18. [ ] studio หักเครดิตตอนสร้างงาน generate/merge (ใช้ `generation-cost.ts` เป็นราคา) ใน transaction เดียวกับการสร้าง job
19. [ ] เลิกตาราง `studio.users` → view อ่าน `account.users`
20. [ ] studio job queue บน Postgres (pg-boss) แทน promise ในหน่วยความจำ → เปิดทางแยก render container
21. [ ] `reporting` views: ยอดเติมเงิน, เครดิตที่ใช้ต่อเมนู/ต่อลูกค้า

**รวม ~6–9 สัปดาห์** (คนเดียว + AI agent)

---

## คำถามที่ต้องตอบก่อนเริ่ม
1. เซิร์ฟเวอร์ Docker ของ studio อยู่ที่ไหน (ผู้ให้บริการ/ประเทศ)? — ใช้เลือก region ของ DB
2. ยอมจ่าย managed DB (~$19–70/เดือน) ไหม หรืออยาก self-host ใน Docker (ถูกกว่าแต่ naka-ai.com จะล่มตาม VPS)
3. landing ยังอยู่บน Cloudflare Worker ต่อไป (ใช้ Hyperdrive) ใช่ไหม — หรือจะย้ายลง Docker ตาม ADR-0002 พร้อมกันเลย
4. ขนาดข้อมูลปัจจุบันโดยประมาณ (จำนวนผู้ใช้, จำนวน drama/งาน) — ใช้วางแผน downtime ตอนย้าย
