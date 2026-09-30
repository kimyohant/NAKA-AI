# Phase 5B — สถานะงาน onboarding (Agent B / Z.AI)

Branch: `feat/onboarding` (แตกจาก `main` @ f542b0b) · สถานะ: **เสร็จ รอ merge**

## สิ่งที่ทำ

1. **เครดิตฟรีตอนสมัคร** — `src/onboarding/signup.ts`
   - `signupCredits(env)`: อ่าน `SIGNUP_CREDITS` (ยังไม่อยู่ใน `Env` — ใช้ local type cast, รอ Claude เพิ่มใน `src/types.ts` ตอน merge) · ไม่ได้ตั้ง/`""`/`"0"`/`"-5"`/`"abc"`/ทศนิยม → 0 = ไม่แจก · ไม่มี hard-code
   - `signupBonusStatement(db, userId, amount)`: statement ตามสัญญาในใบงาน (`INSERT … SELECT … WHERE EXISTS (users) AND NOT EXISTS (note = 'signup_bonus')`) — idempotent, อยู่ batch เดียวกับ users row จึงแจกครั้งเดียวต่อผู้ใช้
   - ต่อเข้า `identityUser()` ใน `src/auth/session.ts` แบบแก้น้อยที่สุด: ถ้าไม่แจก จะไม่มี statement ที่ 3 เลย (พฤติกรรมเดิมของ auth ไม่เปลี่ยน)

2. **API สถานะผู้ใช้ใหม่** — `src/onboarding/index.ts`: `handleOnboarding(request, env, url, userId)` คืน `{ credits, signupBonus, steps: { firstVideo, pageConnected, hasPackage } }` — อ่านจาก schema จริง: `credit_ledger` (0002), `jobs.status='done' AND kind<>'inbox_reply'` (0002 + `INBOX_JOB_KIND` จาก `src/inbox/common.ts`), `social_accounts.status='active'` (0003), `subscriptions.status='active'` (0002, ต่อยอด 0007) · `Cache-Control: no-store` · 405 ถ้า method ไม่ใช่ GET · 401 ถ้าไม่มี userId

3. **การ์ดต้อนรับใน `/app/`** — `public/app/onboarding.js` + `onboarding.css` + mount `<div id="onboarding-card">` และ `<link>/<script>` ใน `public/app/index.html`
   - มีโบนัส: "ยินดีต้อนรับ! คุณได้เครดิตฟรี N เครดิต ลองสร้างคลิปแรกได้เลย" · ไม่มีโบนัส: ไม่พูดถึงเครดิตฟรี
   - เช็กลิสต์ 3 ขั้น → `/review/`, `/app/inbox/`, `/app/billing/` · ครบ 3 ขั้นหรือกด "ซ่อน" → ซ่อนถาวร (localStorage, try/catch)
   - `/api/onboarding` ล้มเหลว → ไม่แสดงการ์ด dashboard ไม่พัง · `?mock=1` / `?mock=plain` / `?mock=done` สำหรับลองหน้าโดยไม่มี backend (แบบ `account-menu.js`)
   - สไตล์เดียวกับ app.css (glass navy) · รองรับ 360px (media query ≤560px)

## ผลทดสอบ

- `npm run typecheck` ✅ 0 error · `npm test` ✅ **118/118** (รวม onboarding 4 เคส + auth tests ของ A ที่ไม่แตะ)
- `tests/onboarding.test.cjs` (SQLite จริงผ่าน `tests/helpers/d1.cjs` + migrations 0001–0007): สมัครใหม่+3 → ยอด 3 และล็อกอินซ้ำยัง 3 · ไม่ตั้ง/"0"/"-5"/"abc" → ไม่มีแถว · เบอร์เดียวกันสองคำขอ → user เดียว โบนัสเดียว · steps เป็น true ตามข้อมูลจริง (`inbox_reply` ไม่นับ) และไม่ปนข้อมูลผู้ใช้อื่น

## ทดสอบหน้า `/app/` จริง (npm run dev, พอร์ต 8790, SIGNUP_CREDITS=3)

- **มีโบนัส (flow จริง):** สมัครด้วย OTP (รหัสจาก log ของ mock SMS) → เข้า `/app/` → การ์ดเครดิตของ dashboard แสดง **3 เครดิต** และ mode note "เชื่อมต่อระบบแล้ว · ข้อมูลจากเซิร์ฟเวอร์" — โบนัสเข้าจริงผ่าน `identityUser`
- **การ์ดต้อนรับ:** route ยังไม่ถูก wire → การ์ดซ่อนอย่างสง่างาม (dashboard ปกติ) — ตามสัญญา; ทดสอบตัวการ์ดผ่าน `?mock=1` (ข้อความโบนัส + 3 ขั้น + ปุ่มซ่อน), `?mock=plain` (ไม่มีคำว่าเครดิตฟรี), `?mock=done` (ซ่อนอัตโนมัติ + จำค่า reload แล้วยังซ่อน) · ปุ่ม "ซ่อน" → localStorage `naka.onboarding.hidden=1` และอยู่หลัง reload
- **จอแคบ 360px:** วัดจาก DOM — องค์ประกอบของการ์ดไม่มีตัวไหนล้นขอบ (เทียบ scrollWidth); **แต่พบ topbar ของหน้าล้นถึง ~429px** (brand + nav 4 ลิงก์ + account menu) — เป็นของเดิมจาก `public/app/app.css`/`account-menu.css` ไม่ใช่ไฟล์ phase นี้ (ตามกติกาห้ามแก้) แนะนำให้ Claude ต่อยอดที่ merge: ยอมให้ nav เลื่อนแนวนอน หรือซ่อน label ลิงก์ที่ ≤480px
- หมายเหตุ: ภาพหน้าจอถ่ายผ่าน IAB timeout ทั้ง session นี้ จึงบันทึกเป็นคำบรรยาย + ค่า DOM ตามที่ใบงานอนุญาต ("แนบภาพหน้าจอ**หรือบรรยาย**")

## ขอ Claude ต่อตอน merge

1. **Route:** `src/index.ts` — หลัง `handleAuth`:
   ```ts
   if (url.pathname === '/api/onboarding') {
     const user = await requireUser(request, env);
     return handleOnboarding(request, env, url, user?.id ?? '');
   }
   ```
   (`requireUser` มีอยู่แล้วใน `src/auth/index.ts`)
2. **`src/types.ts`:** เพิ่ม `SIGNUP_CREDITS?: string` ใน `Env` (โค้ดผม cast ไว้แล้ว จะใช้ได้ทันที)
3. ตั้ง `SIGNUP_CREDITS` จริงใน production (จำนวนโบนัสเป็นของเจ้าของธุรกิจ — ไม่ตั้ง = ไม่แจก)

## ข้อสงสัย / หมายเหตุ

- `signupBonus` ใช้ `SUM(delta) WHERE note='signup_bonus'` — ถ้าในอนาคตมีการปรับโบนัสหลายรอบจะรวมกัน ซึ่งสอดคล้องกับ balance
- การแจกโบนัสใช้ `INSERT…SELECT` ที่มีเงื่อนไขในตัว (ไม่พึ่ง read-then-write) จึงปลอดภัยกับ race
