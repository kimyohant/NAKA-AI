# AI Inbox — สถานะ (Phase 4)

โค้ดหลักเขียนโดย Agent A (ChatGPT) จากสัญญา `docs/phase4-inbox.md` แล้วเครดิตหมดก่อน commit
Claude ทำต่อให้เสร็จ: แก้ error คอมไพล์, แยกโควตา, จำกัดตามแพ็กเกจ, เขียนเทสต์ และเอกสารนี้

## สิ่งที่ทำงานแล้ว (เทสต์ 8 ข้อใน `src/inbox/tests/inbox.test.cjs`, mock HTTP ทั้งหมด)

- `GET /webhook/meta` ยืนยัน subscription ด้วย `META_WEBHOOK_VERIFY_TOKEN` แบบ constant-time
- `POST /webhook/meta` ตรวจ `X-Hub-Signature-256` กับ raw bytes ก่อน parse, บันทึก receipt ลง D1 ก่อนตอบ 200
  (DB ล้ม → 503 ให้ Meta retry), ประมวลผลต่อใน `ctx.waitUntil` และ cron
- รองรับ: คอมเมนต์เพจ Facebook (`feed` / `comment` / `add`), คอมเมนต์ Instagram (`comments`), ข้อความ Messenger/IG (`messaging`, `messages`)
- เก็บครั้งเดียวต่อ external ID, ข้อความ/คอมเมนต์จากเพจเองไม่ถูกนับเป็นลูกค้า และถ้าไม่ใช่ของระบบเรา จะหยุด auto ใน thread นั้น
- เพจเดียวผูกสองบัญชี NAKA → ไม่ตอบทั้งคู่ (`ambiguous_account`)
- คิว `inbox_reply` ผ่าน `enqueueJob` แบบ `costCredits: 0, countsTowardLimit: false` — ไม่กินเครดิตและไม่กินช่องงานวิดีโอ
- ข้อความที่คิวเต็มหรือ enqueue ล้มจะถูกหยิบใหม่ภายหลัง ไม่หาย
- ส่งต่อคนทันทีโดยไม่เรียก Claude: คำว่า คืนเงิน/ร้องเรียน/ของเสีย/แพ้/ฟ้อง + คำที่ร้านตั้งเอง, ข้อความที่พยายามสั่งระบบ,
  ข้อความว่าง (ไฟล์แนบ), คอมเมนต์สาธารณะที่มีข้อมูลส่วนตัว, ร้านยังไม่มีคลังความรู้
- Claude (`claude-opus-5-5`, effort low, JSON schema, server-side fallback) ร่างจาก `inbox_kb` เท่านั้น
- กันคำตอบเสี่ยง: ตัวเลขที่ไม่มีในข้อมูลร้าน → ส่งต่อคน, คำตอบสาธารณะที่พูดถึงข้อมูลส่วนตัว → แทนด้วยข้อความชวนไปแชท
- `auto` ส่งเองเฉพาะ `confidence=high` และไม่ handoff และยังเป็นข้อความล่าสุดของ thread; claim แบบ atomic ก่อนส่ง
  ผลไม่แน่นอน (timeout/5xx) → `uncertain` ไม่ส่งซ้ำอัตโนมัติ ให้คนตรวจบน Meta
- แชท (DM) ส่งได้ภายใน 24 ชั่วโมงหลังข้อความล่าสุดของลูกค้า
- เปิดบอทได้เฉพาะแพ็กเกจ `business` และ `max` (402 ถ้าไม่ใช่) และถ้าลดแพ็กเกจ คิวจะหยุดหยิบข้อความของร้านนั้น
- API หน้าแอป: threads, thread + messages, approve (แก้ข้อความได้), handoff, settings, kb (สูงสุด 30 รายการ) — เห็นเฉพาะของตัวเอง

## Migration

- `0005_inbox.sql` — ตาราง inbox ทั้งหมด + `inbox_webhook_receipts`
- `0006_jobs_limit.sql` — คอลัมน์ `jobs.counts_toward_limit`
- ลำดับ: 0001 → 0002 → 0003 → 0004 → 0005 → 0006

## ยังไม่ได้ทดสอบกับของจริง

- ยังไม่เคยรับ webhook จาก Meta จริง ต้องสร้าง Meta App, ตั้ง Callback URL `https://naka-ai.com/webhook/meta`,
  subscribe `feed` (เพจ), `messages` และ `comments`/`messages` (Instagram)
- ต้องยื่น App Review สำหรับสิทธิ์ที่เกี่ยวกับการอ่าน/ตอบคอมเมนต์และข้อความ (ตรวจชื่อ permission ล่าสุดกับเอกสาร Meta ก่อนยื่น)
- ยังไม่มีหน้า UI ของกล่องข้อความใน `/app/` (มีแค่ API)

## ขอให้ Claude แก้ตอน merge

1. `src/index.ts`: `/webhook/meta` → `handleMetaWebhook(request, env, ctx)` (ไม่ต้องมี session),
   `/api/inbox/*` → `handleInbox(request, env, url, user.id)` หลัง `requireUser`
2. ลงทะเบียน `[INBOX_JOB_KIND]: makeInboxHandler(env)` ใน job handlers
3. cron: `ctx.waitUntil(drainInbox(env, { maxReceipts: 5, maxMessages: 20 }))` แยก catch จากคิวอื่น
4. `wrangler.jsonc`: `run_worker_first` ครอบ `/webhook/*` อยู่แล้ว ไม่ต้องแก้
