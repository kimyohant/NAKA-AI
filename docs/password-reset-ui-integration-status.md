# Phase 9B — สถานะงานหน้าลืมรหัสผ่าน (Agent B / Z.AI)

Branch: `feat/password-reset-ui` (แตกจาก `origin/main` @ `01c0b4e` หลัง merge 9A) · สถานะ: **เสร็จ รอ merge**

## สิ่งที่ทำ

1. **ลิงก์ "ลืมรหัสผ่าน? รับลิงก์ตั้งรหัสใหม่ทางอีเมล" บน `/login/`** (`public/login/index.html` + `login.js`)
   - แสดง**เฉพาะเมื่อ** `GET /api/auth/config` ตอบ `passwordReset: true` (จาก `emailConfigured` ของ 9A) และเฉพาะโหมด "เข้าสู่ระบบ" (ซ่อนในโหมดสมัครสมาชิก)
   - กดแล้วอ่านอีเมลจากช่อง "อีเมล" ตรวจรูปแบบ → `POST /api/auth/password/forgot` ด้วย `{ email, turnstileToken? }` (token จาก widget Turnstile เดิมของหน้า ถ้ามี site key)
   - 200 → ข้อความกลาง "ถ้าอีเมลนี้มีบัญชี NAKA-AI เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว (ลิงก์ใช้ได้ 30 นาที)…" — **ไม่ยืนยันว่ามีบัญชี** ตามสัญญาของ 9A · 429/400/อื่น → ข้อความไทยจาก API · Turnstile reset หลังทุกความพยายาม
2. **หน้า `/login/reset/`** — `public/login/reset/index.html` + `reset.js` + `reset.css`
   - อ่าน token จาก URL fragment `#token=…` แล้ว**ลบ fragment ออกจาก address bar ทันที** (`history.replaceState`) — token ไม่ค้างใน history/referrer
   - ไม่มี token → แสดงข้อความพร้อมลิงก์กลับ `/login/` (ไม่แสดงฟอร์ม)
   - ฟอร์ม: รหัสใหม่ + ยืนยัน (ตรวจตรงกันและ ≥ 8 ตัวในเบราว์เซอร์ก่อนส่ง) → `POST /api/auth/password/reset` ด้วย `{ token, newPassword, turnstileToken? }`
   - สำเร็จ → ซ่อนฟอร์ม + "ตั้งรหัสผ่านใหม่แล้ว — เข้าสู่ระบบด้วยรหัสใหม่ได้เลย" (9A ไม่ออก session — ตามสัญญา) · 400 (ลิงก์หมดอายุ/ใช้แล้ว/รหัสผิดกติกา) → ข้อความจาก API · 429 → ข้อความไทย · Turnstile แสดงเมื่อ config มี site key
   - ทุกหน้า `noindex`, ใช้ `login.css` เดิม + `reset.css` เสริมเล็กน้อย, 360px ปลอดภัย
- **เทส** — `tests/password-reset-ui.test.cjs`: รันสคริปต์จริงใน node:vm + DOM จำลอง (แพทเทิร์น admin-customers), fetch mock ทั้งหมด — 10 เคส: แสดง/ซ่อนลิงก์ตาม config · ตรวจอีเมลก่อนยิง · ข้อความกลางไม่เผยว่ามีบัญชี · reset อ่าน token/ลบ fragment · ตรวจ ≥8/ตรงกันก่อนยิง · สำเร็จ/400 · ไม่มี token

## ผลทดสอบ

- `npm run typecheck` ✅ · `npm test` ✅ (ตัวเลขอัปเดตด้านล่างหลังรันชุดเต็ม)
- ตรวจเอกสาร API จริง: [docs.sms-gate.app](https://docs.sms-gate.app) ไม่เกี่ยวกับงานนี้ — สัญญา reset อ้างจาก `docs/phase9-password-reset.md` + โค้ดจริง `src/auth/password.ts` (`forgotPassword`/`resetPassword`, `botCheck` เมื่อมี Turnstile)

## สิ่งที่ขอให้ Claude ต่อสาย

1. **apply migration `0013_password_reset.sql` กับ D1 remote** ก่อนเปิดใช้ (ถ้ายังไม่ apply หลัง merge 9A)
2. ตั้งค่าเปิดใช้: `EMAIL_PROVIDER=resend` + `EMAIL_FROM` (vars) และ secret `RESEND_API_KEY` — ขั้นตอนเต็มอยู่ใน `docs/DEPLOY.md` §1 "ลืมรหัสผ่านทางอีเมล"
3. ยืนยันโดเมนผู้ส่ง + DNS ตามข้อกำหนด Resend ก่อนเปิดจริง (ลิงก์ใน DEPLOY)
4. จนกว่าจะตั้งค่า: `/api/auth/config` ตอบ `passwordReset: false` → ลิงก์บนหน้า login ซ่อนเอง ลูกค้าใช้ช่องทางโทร/แอดมินเดิมได้ตามปกติ — หน้าฝั่งเราไม่ต้องแก้เพิ่ม

## หมายเหตุ

- ไม่มีการ log อีเมล/token/รหัสผ่านฝั่งหน้าเว็บ (ฝั่ง 9A ก็ mask แล้ว)
- ข้อความ "บัญชีนี้เข้าสู่ระบบด้วย Google" บนหน้า account เดิมถูกปรับให้คลุม LINE/เบอร์ที่ไม่มีรหัสผ่านตาม merge หลัง 8B (a0f0019) — หน้า reset ไม่เกี่ยวกับข้อความนี้
