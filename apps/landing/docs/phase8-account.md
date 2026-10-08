# Phase 8 — หน้าบัญชีของฉัน + เปลี่ยนรหัสผ่านเอง

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน status doc ของแต่ละงาน
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย · **commit ลง branch ก่อนแจ้งว่าเสร็จ ห้ามทิ้ง uncommitted ห้าม commit ไฟล์ probe/tmp**

## ทำไม

ลูกค้าที่สมัครด้วยอีเมล (`src/auth/password.ts`) และลูกค้าที่ได้รหัสชั่วคราวจากแอดมิน (`/admin/customers/` → ลืมรหัสผ่าน) ยังเปลี่ยนรหัสเองไม่ได้

## สัญญา API (8A ทำ, 8B เรียกใช้)

`POST /api/auth/password/change` — ต้องล็อกอิน (cookie `naka_session`), JSON ไม่เกิน 4 KB, ผ่าน Origin check ของ `handleAuth` เดิม

```json
{ "currentPassword": "…", "newPassword": "…" }
```

| ผล | status | body |
|---|---|---|
| สำเร็จ | 200 | `{ "ok": true }` + `Set-Cookie` session ใหม่ |
| ไม่ได้ล็อกอิน | 401 | `{ "error": "กรุณาเข้าสู่ระบบ" }` |
| บัญชีไม่ได้สมัครด้วยอีเมล (Google/LINE) | 400 | `{ "error": "บัญชีนี้เข้าสู่ระบบด้วย Google หรือ LINE จึงไม่มีรหัสผ่าน" }` |
| รหัสปัจจุบันผิด | 400 | `{ "error": "รหัสผ่านปัจจุบันไม่ถูกต้อง" }` |
| รหัสใหม่ผิดกติกา / เหมือนรหัสเดิม | 400 | ข้อความไทย |
| ลองรหัสปัจจุบันผิดเกิน | 429 | ข้อความไทย + `Retry-After` |

`GET /api/auth/me` เดิมเพิ่มฟิลด์ `hasPassword: boolean` (8A ทำ) ให้หน้าเว็บรู้ว่าจะแสดงฟอร์มหรือไม่

---

## 8A — API เปลี่ยนรหัสผ่าน (ChatGPT)

แตก branch `feat/password-change` จาก `main` ล่าสุด

ไฟล์: `src/auth/password.ts` (เพิ่มฟังก์ชัน ห้ามเปลี่ยนพฤติกรรม register/login/hash เดิม), `src/auth/index.ts` (เพิ่ม route ใน `paths`/`switch` และ `hasPassword` ใน `/api/auth/me` เท่านั้น),
`tests/password-change.test.cjs`, `docs/password-change-integration-status.md`
**ห้ามแก้** `public/**` (Z.AI ทำ), `migrations/**` (ใช้ตารางเดิม `auth_passwords`, `auth_password_attempts`), `src/admin/**`, `src/billing/**`

กติกา:
- ใช้ `verifyPassword`/`hashPassword`/`checkPassword` เดิม ห้ามเขียน hash ใหม่
- รหัสปัจจุบันผิดนับเข้า rate limit เดิม (kind `login` ต่อ user) — ผิดครบ 5 ครั้งใน 15 นาที = 429
- สำเร็จ: อัปเดต `auth_passwords` + **ลบ session อื่นทั้งหมดของผู้ใช้** + ออก session ใหม่ให้เครื่องนี้ ใน `DB.batch` เดียว
- ห้าม log รหัสผ่านหรือส่งกลับใน response

เทส: สำเร็จแล้วรหัสเก่าใช้ไม่ได้/รหัสใหม่ใช้ได้, session เครื่องอื่นหลุด เครื่องนี้ยังอยู่, รหัสปัจจุบันผิด, รหัสใหม่สั้น/ยาว/ซ้ำเดิม, บัญชี Google, ไม่ล็อกอิน, 429 หลังผิด 5 ครั้ง, `hasPassword` ถูกทั้งสองแบบ, เทส auth เดิมผ่านโดยไม่แก้

## 8B — หน้า `/app/account/` (Z.AI)

แตก branch `feat/account-page` จาก `main` ล่าสุด · **งานหน้าเว็บล้วน**

ไฟล์: `public/app/account/index.html`, `public/app/account/account.js`, `public/app/account/account.css`, `tests/account-page.test.cjs`, `docs/account-page-integration-status.md`
แก้เพิ่มได้เฉพาะ: `public/account-menu.js` เพิ่มลิงก์ "บัญชีของฉัน" → `/app/account/` ในเมนู
**ห้ามแก้** `src/**`, `migrations/**`, ไฟล์อื่นใน `public/`

หน้าเว็บ:
- topbar เหมือน `public/app/billing/index.html` (ใช้ `app.css` เดิม), `noindex`, ไม่ล็อกอิน → ไป `/login/?next=/app/account/`
- แสดง: ชื่อ, อีเมลหรือเบอร์ (จาก `/api/auth/me`), เครดิตคงเหลือ, ลิงก์ไป `/app/billing/`
- ถ้า `hasPassword === true`: ฟอร์มเปลี่ยนรหัส (รหัสปัจจุบัน, รหัสใหม่, ยืนยันรหัสใหม่ — ตรวจตรงกันและ ≥ 8 ตัวในเบราว์เซอร์ก่อนส่ง), `autocomplete="current-password"`/`"new-password"`
  สำเร็จ → ข้อความ "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นออกจากระบบแล้ว" และล้างช่อง · ผิด → แสดง `error` จาก API
- ถ้าไม่มี `hasPassword` หรือเป็น `false`: ข้อความ "บัญชีนี้เข้าสู่ระบบด้วย Google" ไม่แสดงฟอร์ม
- `textContent` เท่านั้น, ใช้ได้ที่ 360px ไม่ล้น, `?mock=1` จำลอง API ทั้งสองกรณี (มี/ไม่มีรหัสผ่าน) แบบ `public/app/onboarding.js`

เทส (DOM จำลองแบบ `tests/admin-customers.test.cjs`): ฟอร์มซ่อนเมื่อไม่มีรหัส, รหัสใหม่ไม่ตรงกัน/สั้น → ไม่เรียก API, สำเร็จ → ข้อความและช่องว่าง, error จาก API แสดงผล, ลิงก์ในเมนูบัญชี

## ก่อนส่งงาน (ทั้งสองงาน)

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด · **commit ลง branch** · สรุปผลและสิ่งที่ขอให้ Claude ต่อสายใน status doc ของตัวเอง
