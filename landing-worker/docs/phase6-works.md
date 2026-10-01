# Phase 6A — ผลงานของฉัน (ChatGPT)

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน `docs/works-integration-status.md`
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย

## ปัญหา

ลูกค้าสร้างคลิปรีวิวที่ `/review/` แล้วถ้าปิดแท็บหรือรีเฟรชระหว่างรอ ผลงานหายจากมุมมองลูกค้า
(งานยังอยู่ในตาราง `jobs` แต่ไม่มีหน้าไหนให้กลับไปเปิด) และ `/app/` ยังมีข้อความ
"งานที่คุณสร้างจะแสดงรายการในหน้านี้เมื่อระบบคิวงานพร้อม"

## เป้าหมาย

ลูกค้าเห็นรายการงานของตัวเองบน `/app/` และกดเปิดผลคลิปเดิมที่ `/review/?job=<id>` ได้ทุกเมื่อ

## Branch และไฟล์ที่เป็นเจ้าของ

แตก branch `feat/works` จาก `main` ล่าสุด

`src/works/**`, `tests/works.test.cjs`, `public/app/works.js`, `public/app/works.css`, `docs/works-integration-status.md`
แก้เพิ่มได้เฉพาะจุด:
- `public/app/index.html`: แทนที่ `<p class="jobs-note">…</p>` ด้วยที่วางรายการ + โหลดไฟล์ของคุณ
- `public/review/review.js`: รองรับ `?job=<id>` — เปิดหน้าแล้วเรียก `poll(id)` เดิมทันที (แสดงสถานะ/ผลเหมือนเพิ่งกดสร้าง) ห้ามเปลี่ยนพฤติกรรมอื่น
  และหลัง POST สำเร็จให้ `history.replaceState` ใส่ `?job=<id>` ลง URL เพื่อรีเฟรชแล้วไม่หาย

**ห้ามแก้** `src/index.ts`, `src/types.ts`, `src/jobs.ts`, `src/credits.ts`, `src/affiliate.ts`, `src/billing/**`, `src/receipts/**`, `src/onboarding/**`, `migrations/**`
ไม่ต้องมี migration ใหม่

## API

```ts
// src/works/index.ts — Claude จะต่อ route ให้ตอน merge (หลัง requireUser)
/** GET /api/works — userId มาจาก session คืน null ถ้า path ไม่ใช่ของคุณ */
export async function handleWorks(request: Request, env: Env, url: URL, userId: string): Promise<Response | null>;
```

`GET /api/works?before=<cursor>` คืน 20 รายการล่าสุดของผู้ใช้คนนี้:

```json
{
  "works": [
    { "id": "…", "kind": "affiliate_review", "title": "ชื่อสินค้า", "status": "done",
      "costCredits": 1, "createdAt": "2026-09-30 10:00:00", "finishedAt": "…", "href": "/review/?job=…" }
  ],
  "next": "<cursor หรือ null>"
}
```

- เฉพาะ `kind = 'affiliate_review'` (ค่าคงที่ `AFFILIATE_JOB_KIND` จาก `src/affiliate.ts` — import ห้าม hard-code) งานตอบแชท `inbox_reply` ห้ามโผล่
- `title` = `productName` จาก `jobs.input` (JSON) ตัดที่ 80 ตัวอักษร อ่านไม่ได้ = `"คลิปรีวิว"`
- **ห้ามคืน `output`, `input` ทั้งก้อน, `error`, `provider_cost_usd`** (output มีเสียง base64 ขนาดใหญ่ error มีข้อความของผู้ให้บริการ)
- `status` ตามจริง (`queued` | `running` | `done` | `failed`) — failed แสดงว่า "ไม่สำเร็จ คืนเครดิตแล้ว"
- cursor ต้องไม่ข้าม/ซ้ำเมื่อ `created_at` เท่ากัน (เรียงด้วย `created_at DESC, id DESC`)
- `Cache-Control: no-store`, ข้อผิดพลาดภาษาไทย, method อื่น = 405
- ตรวจชื่อคอลัมน์จาก `migrations/0002_credits_jobs.sql` และ `0006_jobs_limit.sql` จริง ห้ามเดา

## หน้า `/app/`

- ส่วน "ผลงานของฉัน" ใต้การ์ดงาน แสดงชื่อ วันที่ (เวลาไทย) สถานะ ปุ่ม "เปิดดู" → `href`
- งานที่ยัง `queued`/`running` แสดงว่ากำลังทำ (ไม่ต้อง poll อัตโนมัติ มีปุ่มรีเฟรชพอ)
- ไม่มีงาน → ข้อความชวนสร้างคลิปแรกพร้อมลิงก์ `/review/`, มีมากกว่า 20 → ปุ่ม "ดูเพิ่ม"
- API ล้มเหลว → ข้อความสั้นๆ ในส่วนนี้ ห้ามทำให้ dashboard พัง
- `textContent` เท่านั้นกับข้อมูลลูกค้า, สไตล์เดียวกับ `public/app/app.css`, ใช้ได้ที่ 360px, `?mock=1` แบบ `public/app/onboarding.js`

## เทสที่ต้องมี (`tests/works.test.cjs` ใช้ helper ใน `tests/helpers/`)

- เห็นเฉพาะงานของตัวเอง ไม่มีงานของคนอื่น ไม่มี `inbox_reply`
- response ไม่มี `output`/`error`/`provider_cost_usd` แม้งาน done/failed
- `input` เสีย/ไม่มี productName → title สำรอง
- แบ่งหน้า 45 งาน (รวมหลายงาน `created_at` เท่ากัน) → ได้ครบ 45 ไม่ซ้ำ
- `review.js` ด้วย `?job=` เรียก `GET /api/affiliate/reviews/:id` ทันที (DOM จำลองแบบ `tests/admin-customers.test.cjs`)

## ก่อนส่งงาน

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด **commit งานลง branch** (อย่าทิ้งไว้ uncommitted)
เปิดหน้าจริงด้วย `npm run dev` สร้างคลิป ปิดแท็บ แล้วเปิดใหม่จาก `/app/` ต้องเห็นผลเดิม — สรุปผลใน `docs/works-integration-status.md`
