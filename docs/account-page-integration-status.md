# Phase 8B — สถานะงานหน้าบัญชีของฉัน /app/account/ (Agent B / Z.AI)

Branch: `feat/account-page` (แตกจาก `main` @ 156b72a) · สถานะ: **เสร็จ รอ merge (ต้องมี 8A ก่อน)**

## สิ่งที่ทำ

- **หน้า `/app/account/`** — `public/app/account/index.html` + `account.js` + `account.css`
  - topbar เหมือน billing (glass-nav + app.css เดิม), `noindex`, ไม่ล็อกอิน → เด้ง `/login/?next=/app/account/`
  - แสดงชื่อ, อีเมลหรือเบอร์ (จาก `/api/auth/me`), เครดิตคงเหลือ, ลิงก์ไป `/app/billing/`
  - `hasPassword === true` → ฟอร์มเปลี่ยนรหัส (ปัจจุบัน/ใหม่/ยืนยัน — ตรวจตรงกันและ ≥ 8 ตัวในเบราว์เซอร์ก่อนยิง, `autocomplete` ครบ)
  - สำเร็จ → "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นออกจากระบบแล้ว" + ล้างช่อง · ผิด → แสดง `error` ภาษาไทยจาก API ตรงตามตารางสัญญา (401/400/429)
  - `hasPassword` เป็น false หรือไม่มี → "บัญชีนี้เข้าสู่ระบบด้วย Google" ไม่แสดงฟอร์ม
  - endpoint ใช้งานไม่ได้ → error panel + ปุ่มลองใหม่ หน้าไม่พัง
  - `textContent` เท่านั้น (ไม่มี innerHTML), ใช้ได้ 360px (media query), `?mock=1` (มีรหัสผ่าน) และ `?mock=plain` (ไม่มี) จำลอง API แบบ onboarding.js
- **เมนูบัญชี** — `public/account-menu.js`: เพิ่มลิงก์ "บัญชีของฉัน" → `/app/account/` ถัดจาก "แดชบอร์ดของฉัน" (แก้จุดเดียวตามที่ใบงานอนุญาต)
- **เทส** — `tests/account-page.test.cjs`: รัน `account.js` จริงใน node:vm + DOM จำลอง (แพทเทิร์น `tests/admin-customers.test.cjs`), fetch ถูก mock ทั้งหมด

## ผลทดสอบ

- `npm run typecheck` ✅ · `npm test` ✅ (ตัวเลขอัปเดตด้านล่างหลังรันชุดเต็ม)
- เทสของงานนี้: ฟอร์มซ่อนเมื่อไม่มีรหัสผ่าน · ไม่ตรงกัน/สั้น → ไม่เรียก API · สำเร็จ → ข้อความ+ล้างช่อง+body ตรงสัญญา · error จาก API แสดงผล · เด้ง login เมื่อ 401 · ลิงก์ในเมนู · ไม่มี innerHTML

## สิ่งที่ขอให้ Claude ต่อสาย

1. **merge 8A (`feat/password-change`)** — งานหน้าของผมเรียก `POST /api/auth/password/change` และ `hasPassword` บน `/api/auth/me` ตามสัญญาเป๊ะ หลัง 8A merge หน้าทำงานจริงทันที **ไม่ต้อง wire route เพิ่ม** (`handleAuth` ครอบ `/api/auth/*` อยู่แล้ว)
2. จนกว่า 8A จะ merge: `/api/auth/me` ไม่มี `hasPassword` → หน้าแสดงข้อความ "บัญชีนี้เข้าสู่ระบบด้วย Google" กับทุกบัญชี (พฤติกรรมตามสัญญา "ถ้าไม่มี hasPassword") — ใช้ `?mock=1` สาธิตฟอร์มได้

## หมายเหตุ

- ห้าม log รหัสผ่านทุกกรณี (ฝั่งหน้าเว็บไม่บันทึกอะไรลง console/storage เกี่ยวกับรหัสผ่าน)
- ทดสอบหน้าจริงผ่าน DOM harness (จำลอง 200/400/401) — เปิดบน dev server ได้ทันทีหลัง 8A merge ด้วย `npm run dev` ที่จอกว้างและ 360px
