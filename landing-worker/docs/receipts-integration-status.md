# Phase 5A — สถานะส่งมอบใบเสร็จรับเงิน

วันที่: 2026-09-30 · Branch: `feat/receipts` · ฐานล่าสุด: `f542b0b` (`main`)

## งานที่เสร็จแล้ว

- `migrations/0008_receipts.sql`: ตาราง receipts, unique payment_id, unique (year, seq), unique number และ index สำหรับรายการของผู้ใช้
- `src/receipts/index.ts`: export `issueReceipt`, `backfillReceipts`, `handleReceipts` ตามใบงาน และ interface Env ที่ขยายชนิดเดิมด้วย receipt config แบบ optional
- ออกใบเฉพาะ payment ที่ successful และมี paid_at กับผู้ซื้อที่อ่านได้จาก getUser; เลข `RCYYYY-NNNNNN` ใช้ปี ค.ศ. ของ paid_at เวลาไทย UTC+7
- จัดสรรเลขด้วย `INSERT … SELECT COALESCE(MAX(seq), 0) + 1` ใน statement เดียว; `ON CONFLICT(payment_id) DO NOTHING` ไม่กินเลขเมื่อเรียกซ้ำ ใช้ผล insert นับจำนวน backfill จริงแม้ cron ซ้อนกัน
- เก็บ snapshot ชื่อ/ที่อยู่/เลขภาษีผู้ขาย ชื่อ/เบอร์/อีเมลผู้ซื้อ ชื่อแพ็กเกจ รอบ ยอดเงิน VAT หัวใบ วันที่และข้อความจำนวนเงินในแถวใบเสร็จ การอ่านใบไม่ join กลับไปข้อมูลที่เปลี่ยนภายหลัง
- `src/receipts/money.ts`: ตัวแปลงจำนวนสตางค์เป็นคำอ่านภาษาไทย และคำนวณ VAT รวมในราคา 7% ด้วยจำนวนเต็ม ปัดถึงสตางค์
- `public/app/receipts/`: หน้าภาษาไทย `/app/receipts/index.html?id=…` (ใช้ `/app/receipts/?id=…` ได้ด้วย), โหลด snapshot, แสดงยอดตัวเลข/คำอ่าน, ปุ่ม `window.print()`, CSS A4 และซ่อนเมนู/ปุ่มเมื่อพิมพ์ รองรับจอเล็ก โหลด/ผิดพลาด/ไม่พบใบ/ไม่มี id และ redirect 401 ไป login โดยเก็บ next
- ใช้ textContent กับข้อมูล snapshot เพื่อไม่ตีความชื่อหรือที่อยู่เป็น HTML; API ใช้ Cache-Control: no-store และตอบ 404 เหมือนกันสำหรับใบที่ไม่มีและใบของผู้อื่น
- ไม่เพิ่ม dependency และแก้เฉพาะไฟล์ในขอบเขตที่ได้รับมอบหมาย

## ผลทดสอบ

บน Node.js 24.14.0 หลัง `npm ci --no-audit --no-fund` ตาม lockfile (ใช้ `NODE_USE_SYSTEM_CA=1` สำหรับ certificate store ของ Windows):

| คำสั่ง | ผล |
| --- | --- |
| `npm run typecheck` | ผ่าน |
| `npm test` | ผ่านทั้งหมด 135 tests, 0 failed, 0 skipped |
| `node --test tests/receipts.test.cjs` | ผ่าน 21 tests |

เทสใหม่ใช้ `tests/helpers/d1.cjs` กับ SQLite จริง และคอมไพล์ TypeScript แบบเดียวกับ billing tests ครอบคลุม:

- เรียกซ้ำ/พร้อมกันทั้ง payment เดียวและหลาย payment, เลขต่อเนื่อง, ข้อบังคับ unique
- ปีเก่าที่ 31 ธ.ค. 23:30 และ 23:59:59 เวลาไทย กับปีใหม่เมื่อ 00:00; การออกย้อนหลังยังใช้ปีของ paid_at
- pending/failed/expired/ไม่มี payment/ไม่มี paid_at, ไม่มี seller config, ผู้ซื้อหายหรือถูกปิดบัญชี
- backfill มีขีดจำกัด (ค่าเริ่มต้น 50), เรียง payment เก่าก่อน, cron ซ้อนกันนับเฉพาะแถวที่ตนสร้าง, insert ล้มเหลวไม่กินเลขและ retry ได้
- 399 บาท = ก่อน VAT 372.90 + VAT 26.10; มี VAT เฉพาะ config เท่ากับ `"1"` และ UI ไม่แสดงบรรทัด VAT กรณีไม่จด
- snapshot คงเดิมแม้เปลี่ยน plan, buyer, payment และ env
- list เฉพาะเจ้าของ/เรียงล่าสุด/หน่วยบาท; detail ของคนอื่นตอบ 404; method ที่เขียนถูกปฏิเสธ; ข้อผิดพลาดไม่เผยรายละเอียดภายใน
- คำอ่าน 0.50, 21, 101, 1,000,000, 1,290.25 รวมศูนย์/หนึ่ง/สิบเอ็ด/ล้านเอ็ด/ล้านล้าน และข้อมูลไม่ถูกต้อง
- รัน JS หน้าเว็บจริงกับ DOM/fetch จำลองเพื่อตรวจการแสดง snapshot, VAT, textContent, ปุ่มพิมพ์, redirect 401, missing id/404/network/500

ข้อจำกัดการตรวจ UI: session นี้ไม่มี browser ที่เชื่อมต่อ จึงยังไม่ได้ตรวจภาพจริงที่ความกว้าง 360px หรือ print preview/PDF จากเบราว์เซอร์ เทส DOM ไม่ทดแทนการตรวจ layout จริง; ให้ตรวจสองรายการนี้หลังต่อระบบ ไม่มีการส่งรายการชำระเงินจริงหรือ deploy

## จุดที่ให้ Claude ต่อสายตอน merge

### 1. Migration และ config

ใช้ migration `0008_receipts.sql` หลัง `0007_payments.sql` ก่อนเปิด route/hook/cron และเพิ่ม field ต่อไปนี้ใน Env ของ `src/types.ts`:

```ts
RECEIPT_SELLER_NAME?: string;
RECEIPT_SELLER_ADDRESS?: string;
RECEIPT_SELLER_TAX_ID?: string;
RECEIPT_VAT_REGISTERED?: string;
```

ตัวอย่าง config สำหรับทดสอบเท่านั้น (ต้องใส่ข้อมูลผู้ขายจริงก่อนเปิดใช้งาน):

```json
{
  "RECEIPT_SELLER_NAME": "ชื่อผู้ขายสำหรับทดสอบ",
  "RECEIPT_SELLER_ADDRESS": "ที่อยู่ผู้ขายสำหรับทดสอบ",
  "RECEIPT_VAT_REGISTERED": "0"
}
```

`RECEIPT_SELLER_TAX_ID` ไม่บังคับ; ถ้าใช้ให้เป็นเลข 13 หลักตามใบงาน ไม่มี seller name หรือเป็นช่องว่างจะไม่ออกใบใหม่ และ backfill คืน 0 ส่วนใบที่เคยออกแล้วยังอ่าน/คืนใบเดิมได้แม้ถอด config

### 2. หลัง applyPayment สำเร็จใน src/billing/index.ts

import `issueReceipt` จาก `../receipts` แล้วเรียกหลัง transaction ของ `applyPayment` สำเร็จ ห้ามให้ความล้มเหลวของใบเสร็จเปลี่ยนผลชำระเงินที่บันทึกสำเร็จแล้ว; cron จะออกใบที่ตกค้างให้ เช่น:

```ts
if (claim.meta.changes === 1) {
  try { await issueReceipt(env, paymentId); }
  catch { console.error('receipts: issuance deferred to cron'); }
}
return claim.meta.changes === 1;
```

### 3. Router และ cron ใน src/index.ts

import `handleReceipts`, `backfillReceipts` จาก `./receipts` และต่อ route ก่อน ASSETS fallback:

```ts
if (url.pathname === '/api/receipts' || url.pathname.startsWith('/api/receipts/')) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
  return (await handleReceipts(request, env, url, user.id))
    ?? json({ error: 'ไม่พบใบเสร็จนี้' }, 404);
}
```

userId ต้องมาจาก session เท่านั้น ไม่รับจาก query/body และเพิ่ม cron แยกจาก billing/queue:

```ts
ctx.waitUntil(backfillReceipts(env, { max: 50 }).then(
  count => { if (count) console.log('receipts issued', count); },
  () => console.error('receipts: backfill failed'),
));
```

### 4. ลิงก์ใน public/app/billing/**

ดึง `GET /api/receipts` เพื่อแสดงประวัติของผู้ใช้หลังล็อกอิน/หลังชำระสำเร็จ แล้วลิงก์แต่ละรายการไป `/app/receipts/?id=` + encodeURIComponent(receipt.id) ถ้าใบยังไม่มาให้รอ cron และมีทางโหลดรายการอีกครั้ง

List ตรงตามสัญญา:

```ts
{ receipts: [{ id, number, issuedAt, planName, period, amount }] }
```

Detail คืน object โดยตรง (ไม่มี wrapper `receipt`):

```ts
{
  id, number, issuedAt, title,
  seller: { name, address, taxId },
  buyer: { name, phone, email },
  planName, period, periodLabel,
  paidAt, paidDate, issuedDate,
  amount, amountSatang, amountText, amountWords,
  vatRegistered, vat, vatSatang, vatText,
  subtotal, subtotalSatang, subtotalText
}
```

amount/vat/subtotal เป็นบาท; ชื่อที่ลงท้าย Satang เป็นจำนวนเต็มสตางค์; vat/vatSatang/vatText เป็น null เมื่อไม่จด VAT; issuedAt/paidAt เป็น Unix seconds ส่วน issuedDate/paidDate เป็นข้อความวันไทยที่เก็บไว้ใน snapshot

## ประเด็นสำหรับ integration

- ไม่มีคำขอเปลี่ยนสัญญากลาง และไม่ได้แก้ billing, router, Env กลาง หรือหน้าชำระเงิน งานนี้จึงยังไม่ออกใบอัตโนมัติจากการจ่ายจริงจนกว่า Claude จะต่อสายตามรายการข้างต้น
- ใบย้อนหลัง snapshot ข้อมูล ณ เวลาที่ออกใบ เพราะระบบเดิมไม่ได้เก็บประวัติชื่อแพ็กเกจ/ผู้ขาย/ผู้ซื้อไว้ใน payment; วันชำระและปีของเลขยังอิง paid_at เดิม
- getUser ไม่คืนผู้ซื้อที่ disabled/ไม่มีอยู่แล้ว จึงเว้น payment กลุ่มนี้ไว้โดยไม่บล็อกรายการอื่น; ถ้าต้องออกให้บัญชีที่ปิดแล้วต้องให้เจ้าของสัญญากำหนดนโยบายเพิ่มเติม
- migration ไม่มีการลบหรือแก้ใบที่ออกแล้ว; โมดูลไม่ update/delete receipts เพื่อรักษา snapshot และเลขต่อเนื่อง การยกเลิก/ใบลดหนี้อยู่นอก scope
- หลังต่อสาย ให้ทดสอบผ่าน session จริงสองผู้ใช้, ชำระใน sandbox, cron backfill, จอ 360px และ print preview A4 ทั้งแบบมี/ไม่มี VAT

ทำงานใน worktree แยก `C:/Users/natta/.codex/worktrees/naka-ai-receipts` เพราะ checkout หลักถูกงานอีกชุดสลับกลับ main ระหว่างทำงาน ไม่รวม `.openclaw/` หรือไฟล์งานอื่นใน commit
