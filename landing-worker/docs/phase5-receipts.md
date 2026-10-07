# Phase 5A — ใบเสร็จรับเงินอัตโนมัติ (ChatGPT)

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน `docs/receipts-integration-status.md`
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย

## เป้าหมาย

จ่ายค่าแพ็กเกจที่ `/app/billing/` สำเร็จ → ระบบออกใบเสร็จเลขรันต่อเนื่องให้เอง 1 ใบต่อ 1 การชำระ →
ลูกค้าเปิดดู/พิมพ์เป็น PDF จากเบราว์เซอร์ได้ (ไม่ต้องสร้าง PDF ฝั่ง server)

**ยังไม่ทำ:** ใบกำกับภาษีเต็มรูป (ต้องเก็บชื่อ/ที่อยู่/เลขผู้เสียภาษีของผู้ซื้อ), ส่งใบเสร็จทางอีเมล/SMS, ยกเลิก/ออกใบลดหนี้

## Branch และไฟล์ที่เป็นเจ้าของ

แตก branch `feat/receipts` จาก `main` ล่าสุด (มี `feat/billing` แล้ว)

`src/receipts/**`, `migrations/0008_receipts.sql`, `tests/receipts.test.cjs`, `public/app/receipts/**`, `docs/receipts-integration-status.md`

**ห้ามแก้** `src/billing/**`, `src/index.ts`, `src/types.ts`, `public/app/billing/**` — Claude จะต่อสายให้ตอน merge ตามสัญญาข้างล่าง

## ข้อมูลที่มีอยู่แล้ว

ตาราง `payments` ใน `migrations/0007_payments.sql`: ใช้แถวที่ `status = 'successful'` เท่านั้น
จำนวนเงินเป็นสตางค์ (`amount_satang`), เวลาเป็น Unix seconds (`paid_at`), ชื่อแพ็กเกจอยู่ในตาราง `plans`
ข้อมูลผู้ซื้อ: `getUser()` ใน `src/auth/session.ts` (ชื่อ, เบอร์, อีเมล)

## ตาราง (`migrations/0008_receipts.sql`)

- 1 การชำระ = 1 ใบ: `payment_id` เป็น `UNIQUE`
- เลขที่ใบเสร็จรันต่อเนื่องแยกตามปี ห้ามข้ามเลข ห้ามซ้ำ รูปแบบ `RC2026-000001` (ปี ค.ศ. ตาม `paid_at` เวลาไทย UTC+7)
  ใช้ `UNIQUE(year, seq)` และหาเลขถัดไปใน statement เดียวกับ INSERT (`INSERT … SELECT COALESCE(MAX(seq), 0) + 1 …`) ห้ามอ่านแล้วค่อยเขียนแยกกัน
- **เก็บ snapshot** ของทุกอย่างที่พิมพ์บนใบ (ชื่อผู้ขาย, เลขภาษีผู้ขาย, ที่อยู่, ชื่อผู้ซื้อ, ชื่อแพ็กเกจ, รอบ, จำนวนเงิน, VAT) ไว้ในแถวใบเสร็จ
  ใบที่ออกแล้วต้องแสดงเหมือนเดิมตลอด แม้ชื่อแพ็กเกจหรือ env จะเปลี่ยนภายหลัง

## Env ใหม่ (Claude จะเพิ่มใน `src/types.ts` ตอน merge — ระหว่างนี้ประกาศ interface ของคุณเองใน `src/receipts/`)

| ชื่อ | ความหมาย |
|---|---|
| `RECEIPT_SELLER_NAME` | ชื่อผู้ขายบนใบเสร็จ |
| `RECEIPT_SELLER_ADDRESS` | ที่อยู่ผู้ขาย |
| `RECEIPT_SELLER_TAX_ID` | เลขประจำตัวผู้เสียภาษี 13 หลัก (ไม่บังคับ) |
| `RECEIPT_VAT_REGISTERED` | `"1"` = จด VAT แล้ว: หัวใบเป็น "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ" และแยก "ราคารวม VAT 7% แล้ว" (VAT = ยอด × 7/107 ปัดเศษทีละสตางค์) ไม่ใช่ `"1"` = "ใบเสร็จรับเงิน" ไม่มีบรรทัด VAT |

ถ้ายังไม่ได้ตั้ง `RECEIPT_SELLER_NAME` ห้ามออกใบ (คืน `null`) แล้วค่อยออกย้อนหลังด้วย cron เมื่อมีค่าแล้ว

## ฟังก์ชันที่ต้อง export

```ts
// src/receipts/index.ts
/** ออกใบเสร็จของการชำระที่สำเร็จแล้ว เรียกซ้ำได้ ได้ใบเดิม ไม่ออกใบใหม่ */
export async function issueReceipt(env: Env, paymentId: string): Promise<{ id: string; number: string } | null>;
/** Cron: ออกใบให้การชำระสำเร็จที่ยังไม่มีใบ ทีละไม่เกิน max */
export async function backfillReceipts(env: Env, { max = 50 } = {}): Promise<number>;
/** /api/receipts และ /api/receipts/:id — userId มาจาก session */
export async function handleReceipts(request: Request, env: Env, url: URL, userId: string): Promise<Response | null>;
```

Claude จะเรียก `issueReceipt` หลัง `applyPayment` สำเร็จใน `src/billing/index.ts` และเรียก `backfillReceipts` ใน cron

## API

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/receipts` | `{ receipts: [{ id, number, issuedAt, planName, period, amount /* บาท */ }] }` ของผู้ใช้คนนั้น ล่าสุดก่อน |
| GET | `/api/receipts/:id` | ข้อมูลเต็มของใบ (จาก snapshot) — ใบของคนอื่นตอบ 404 เหมือนไม่มี |

หน้าเว็บ `public/app/receipts/index.html?id=…` ดึง `/api/receipts/:id` แล้วแสดงใบเสร็จขนาด A4
มีปุ่ม "พิมพ์ / บันทึกเป็น PDF" (`window.print()`) และ CSS `@media print` ที่ซ่อนเมนู/ปุ่มทั้งหมด
ไม่ล็อกอิน → ส่งไป `/login/?next=…` แบบเดียวกับ `public/app/billing/billing.js`
จำนวนเงินแสดงทั้งตัวเลข (`1,290.00 บาท`) และตัวหนังสือภาษาไทย (`หนึ่งพันสองร้อยเก้าสิบบาทถ้วน`) — เขียนตัวแปลงเองพร้อมเทส

## เทสที่ต้องมี (`tests/receipts.test.cjs` ใช้ helper ใน `tests/helpers/` แบบ `tests/billing.test.cjs`)

- เรียก `issueReceipt` ซ้ำ/พร้อมกันหลายครั้ง → ได้ใบเดียว เลขเดียว
- หลายการชำระ → เลขรัน 1, 2, 3 ไม่ข้าม, ขึ้นปีใหม่เริ่ม 1 ใหม่ (ตัดปีด้วยเวลาไทย: 31 ธ.ค. 23:30 น. ไทย ยังเป็นปีเก่า)
- การชำระที่ `pending`/`failed`/ของคนอื่น → ไม่ออกใบ / 404
- VAT: 399 บาท → VAT 26.10, ก่อน VAT 372.90; ไม่จด VAT → ไม่มีบรรทัด VAT
- เปลี่ยนชื่อแพ็กเกจหลังออกใบ → ใบเดิมยังแสดงชื่อเดิม
- ตัวเลขเป็นตัวหนังสือ: 0.50, 21, 101, 1,000,000, 1,290.25

## ก่อนส่งงาน

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด (ไม่ใช่แค่เทสของคุณ) — ส่งงานที่คอมไพล์ไม่ผ่านจะถูกตีกลับ
สรุปใน `docs/receipts-integration-status.md`: ทำอะไรแล้ว, เทสอะไร, จุดที่ขอให้ Claude ต่อสาย, ข้อสงสัย
