# Phase 5C — หลังร้าน: จัดการลูกค้า (ChatGPT)

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน `docs/admin-customers-integration-status.md`
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย

## เป้าหมาย

เจ้าของระบบดูแลลูกค้าได้จากหน้าเว็บ แทนการพิมพ์ SQL/curl ใน `docs/DEPLOY.md` ข้อ 6:
ค้นลูกค้า → ดูภาพรวม → เติมเครดิต / เปิดหรือต่อแพ็กเกจให้คนที่โอนนอกระบบ / ระงับบัญชี — ทุกการกระทำมีบันทึก

**ยังไม่ทำ:** คืนเงินผ่าน Omise, แก้/ยกเลิกใบเสร็จ, หลายแอดมินแยกสิทธิ์, สถิติ/กราฟรายได้

## Branch และไฟล์ที่เป็นเจ้าของ

แตก branch `feat/admin-customers` จาก `main` ล่าสุด (มีใบเสร็จแล้ว)

`src/admin/**`, `migrations/0009_admin_audit.sql`, `tests/admin-customers.test.cjs`, `public/admin/customers/**`, `docs/admin-customers-integration-status.md`

**ห้ามแก้** `src/index.ts`, `src/types.ts`, `src/credits.ts`, `src/billing/**`, `src/receipts/**`, `src/auth/**`, `public/admin/index.html` (หลังร้าน LINE bot เดิม)
Claude จะต่อ route ให้ตอน merge ตามสัญญาข้างล่าง ถ้าต้องใช้ฟังก์ชันจากไฟล์เหล่านั้น import ได้ ห้ามแก้

## การยืนยันตัวตน

เหมือน `/api/admin/*` เดิมใน `src/index.ts`: header `Authorization: Bearer <ADMIN_TOKEN>` — **router ตรวจให้ก่อนถึง handler ของคุณแล้ว**
หน้าเว็บให้กรอก token ครั้งเดียวแล้วเก็บใน `sessionStorage` (ปิดแท็บแล้วหาย) ส่งใน header ทุกคำขอ ห้ามใส่ใน URL
ได้ 401 → ล้าง token แล้วให้กรอกใหม่

## ฟังก์ชันที่ต้อง export

```ts
// src/admin/customers.ts
/** /api/admin/customers/* — เรียกหลังตรวจ ADMIN_TOKEN แล้ว คืน null ถ้า path ไม่ใช่ของคุณ */
export async function handleAdminCustomers(request: Request, env: Env, url: URL): Promise<Response | null>;
```

## API

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/admin/customers?q=` | ค้นจากเบอร์ (รับ `0812345678` หรือ `+66812345678`), อีเมล, ชื่อ หรือ user id — ไม่ใส่ `q` = สมัครล่าสุด 50 คน คืน `{ customers: [{ id, name, phone, email, status, planId, expiresAt, credits, createdAt }] }` |
| GET | `/api/admin/customers/:id` | ภาพรวม: ข้อมูลผู้ใช้, แพ็กเกจปัจจุบัน, ยอดเครดิต, ประวัติเครดิต 50 รายการ (`ledgerFor`), การชำระ 20 รายการ, ใบเสร็จ (เลขที่ + id), บัญชีโซเชียลที่เชื่อม (ชื่อเพจ/สถานะ **ห้ามคืน token**), บันทึกแอดมินของคนนี้ |
| POST | `/api/admin/customers/:id/credits` | `{ amount, note }` เติมเครดิต (`grantCredits(..., "grant", note)`) `amount` จำนวนเต็ม 1–10000, `note` บังคับ |
| POST | `/api/admin/customers/:id/package` | `{ planId, months, note }` เปิดหรือต่อแพ็กเกจที่จ่ายนอกระบบ — กติกาเดียวกับ `applyPayment` ใน `src/billing/index.ts`: แพ็กเดิมที่ยังไม่หมดอายุ = ต่อจากวันหมดเดิม ไม่เติมเครดิตเพิ่ม, แพ็กใหม่/หมดแล้ว = เริ่มวันนี้และเติมเครดิตถึงยอดของแพ็กเกจ (`next_credit_at` = อีก 30 วัน) — ทำใน `DB.batch` เดียว `months` 1–12, `planId` ต้องเป็นแพ็กเกจที่มีราคา ห้าม `free` **ไม่ออกใบเสร็จ** (ไม่มีการชำระผ่านระบบ) |
| POST | `/api/admin/customers/:id/status` | `{ status: "active" \| "disabled", note }` ระงับ → ลบ `sessions` ของคนนั้นใน batch เดียวกัน ให้หลุดทันที |

- POST ทุกตัว: body เป็น JSON ไม่เกิน 4 KB, ข้อผิดพลาดเป็นภาษาไทย, ไม่พบลูกค้า = 404
- ตรวจชื่อคอลัมน์ทั้งหมดจาก migration 0001–0008 จริง ห้ามเดา

## บันทึกแอดมิน (`migrations/0009_admin_audit.sql`)

ตาราง `admin_audit`: `id`, `user_id` (ลูกค้า), `action` (`credits` | `package` | `status`), `detail` (JSON: ค่าที่ส่งมา + ค่าก่อน/หลัง), `note`, `created_at`
เขียนใน `DB.batch` เดียวกับการเปลี่ยนแปลง — เปลี่ยนสำเร็จต้องมีบันทึก บันทึกไม่ได้ต้องไม่เปลี่ยน ห้ามมีโค้ด UPDATE/DELETE ตารางนี้

## หน้าเว็บ `public/admin/customers/index.html`

- ช่องค้นหาด้านบน → ตารางผลลัพธ์ → คลิกแถวเปิดรายละเอียด
- รายละเอียดแสดงทุกอย่างจาก API พร้อมฟอร์ม 3 อัน (เติมเครดิต, แพ็กเกจ, ระงับ/เปิดบัญชี)
  ทุกฟอร์มต้องกดยืนยันในหน้า (ไม่ใช้ `window.confirm`) ที่สรุปว่าจะทำอะไรกับใคร เช่น "เติม 30 เครดิตให้ ร้านทดสอบ (+66812345678)"
- ลิงก์ใบเสร็จเปิด `/app/receipts/?id=…` ไม่ได้ (ต้องเป็นเจ้าของ) ให้แสดงแค่เลขที่
- ใช้ `textContent` เท่านั้น ห้าม `innerHTML` กับข้อมูลลูกค้า
- `<meta name="robots" content="noindex">`, ใช้บนมือถือกว้าง 360px ได้, สไตล์เดียวกับ `public/admin/index.html`

## เทสที่ต้องมี (`tests/admin-customers.test.cjs` ใช้ helper ใน `tests/helpers/`)

- ค้นด้วย `0812345678` เจอคนที่เก็บเป็น `+66812345678`, ค้นอีเมล/ชื่อ, ไม่เจอ = รายการว่าง
- เติมเครดิต: ยอดเพิ่มถูก, มีบันทึก, amount 0 / -1 / 1.5 / 10001 / ไม่มี note → 400 และไม่มีอะไรเปลี่ยน
- แพ็กเกจ: เปิดใหม่ → เครดิตขึ้นเท่าแพ็กเกจ; ต่อแพ็กเดิม → วันหมดเลื่อน เครดิตไม่เพิ่ม; เปลี่ยนแพ็ก → เริ่มใหม่; `free`/ไม่มีแพ็กนี้ → 400
- ระงับ → session หายและ `getUser` คืน null; เปิดกลับ → ล็อกอินใหม่ได้
- รายละเอียดลูกค้าไม่มี token โซเชียลหลุดออกมา
- ลูกค้าที่ไม่มีอยู่ → 404

## ก่อนส่งงาน

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด CI บน GitHub ต้องเป็นสีเขียวที่ branch ของคุณ
เปิดหน้าจริงด้วย `npm run dev` ลองครบทั้ง 3 ฟอร์ม แล้วสรุปใน `docs/admin-customers-integration-status.md`
