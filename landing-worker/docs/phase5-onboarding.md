# Phase 5B — เครดิตฟรีตอนสมัคร + หน้าต้อนรับผู้ใช้ใหม่ (Claude — รับต่อจาก Z.AI)

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน `docs/onboarding-integration-status.md`
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย

## เป้าหมาย

คนสมัครใหม่ได้เครดิตฟรีทันที เข้า `/app/` แล้วเห็นการ์ดต้อนรับที่บอกว่ามีกี่เครดิต และพาทำ 3 ขั้นแรกจนเห็นผลงานชิ้นแรก

## Branch และไฟล์ที่เป็นเจ้าของ

แตก branch `feat/onboarding` จาก `main` ล่าสุด

`src/onboarding/**`, `tests/onboarding.test.cjs`, `public/app/onboarding.js`, `public/app/onboarding.css`, `docs/onboarding-integration-status.md`
แก้เพิ่มได้เฉพาะจุด: `identityUser()` ใน `src/auth/session.ts` (ข้อ 1), `public/app/index.html` (ใส่ที่วางการ์ด + โหลดไฟล์ของคุณ)

**ห้ามแก้** `src/index.ts`, `src/types.ts`, `src/credits.ts`, `src/billing/**`, `src/receipts/**` (ChatGPT ทำอยู่), `migrations/**`
ไม่ต้องมี migration ใหม่ — ใช้ `credit_ledger` เดิม

## 1. เครดิตฟรีตอนสมัคร

- จำนวนจาก env `SIGNUP_CREDITS` (Claude จะเพิ่มใน `src/types.ts` ตอน merge) ไม่ได้ตั้ง/ไม่ใช่จำนวนเต็มบวก = ไม่แจก
  จำนวนจริงเจ้าของธุรกิจเป็นคนเลือก ห้าม hard-code
- ให้ **ครั้งเดียวต่อผู้ใช้ ตอนสร้างบัญชีเท่านั้น** ล็อกอินครั้งต่อไปไม่ได้เพิ่ม
- เพิ่มเป็น statement ที่ 3 ใน `env.DB.batch([...])` เดิมของ `identityUser()` ให้เป็น transaction เดียวกับการสร้าง user:
  `INSERT INTO credit_ledger (user_id, delta, reason, note) SELECT ?, ?, 'grant', 'signup_bonus' WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE user_id = ? AND note = 'signup_bonus')`
  (`id` เป็น UUID ใหม่ทุกครั้ง ถ้า user เดิมล็อกอิน แถว users นี้จะไม่ถูกสร้าง จึงไม่แจกซ้ำ)
  ถ้าไม่แจก ห้ามใส่ statement นี้เลย
- ทำฟังก์ชันสร้าง statement ไว้ใน `src/onboarding/` แล้ว import มาใช้ใน `session.ts` แก้ `session.ts` ให้น้อยที่สุด

## 2. API สถานะผู้ใช้ใหม่

```ts
// src/onboarding/index.ts — Claude จะต่อ route ให้ตอน merge
/** GET /api/onboarding — userId มาจาก session */
export async function handleOnboarding(request: Request, env: Env, url: URL, userId: string): Promise<Response | null>;
```

คืนค่า:

```json
{
  "credits": 3,
  "signupBonus": 3,
  "steps": { "firstVideo": false, "pageConnected": false, "hasPackage": false }
}
```

- `credits`: `getBalance()` จาก `src/credits.ts`
- `signupBonus`: จำนวนที่ได้จากแถว `note = 'signup_bonus'` ของผู้ใช้คนนี้ ไม่มี = `0`
- `firstVideo`: เคยมีงานในตาราง `jobs` ที่ `status = 'done'` และ `kind <> 'inbox_reply'` (งานตอบแชทไม่นับ) (ดู schema ใน `migrations/0002_credits_jobs.sql`)
- `pageConnected`: มีบัญชีใน `social_accounts` ที่ `status = 'active'` (ดู `migrations/0003_social.sql`)
- `hasPackage`: มี subscription `status = 'active'` (ดู `PLAN_ID_SQL` ใน `src/credits.ts`)
- ตรวจชื่อคอลัมน์/สถานะจาก migration จริง ห้ามเดา

## 3. การ์ดต้อนรับใน `/app/`

- ดึง `/api/onboarding` แล้วแสดงการ์ดบนสุดของ dashboard
  - มีโบนัส: "ยินดีต้อนรับ! คุณได้เครดิตฟรี N เครดิต ลองสร้างคลิปแรกได้เลย"
  - ไม่มีโบนัส: ข้อความต้อนรับโดยไม่พูดถึงเครดิตฟรี
- เช็กลิสต์ 3 ขั้น แต่ละขั้นมีปุ่มพาไปหน้านั้น และติ๊กถูกเมื่อ step เป็น `true`:
  1. สร้างคลิปรีวิวแรก → `/review/`
  2. เชื่อมเพจ Facebook ให้บอทตอบแชท → `/app/inbox/`
  3. เลือกแพ็กเกจ → `/app/billing/`
- ครบ 3 ขั้น หรือกด "ซ่อน" → ไม่แสดงอีก (จำใน `localStorage` ครอบด้วย try/catch — ใช้ไม่ได้ก็แค่แสดงต่อ)
- `/api/onboarding` ล้มเหลว → ไม่แสดงการ์ด ห้ามทำให้ dashboard พัง
- ใช้สไตล์เดียวกับ `public/app/app.css` และหน้า billing (glass, ฟอนต์เดิม) ใช้งานได้บนมือถือกว้าง 360px
- ตัวเลือก `?mock=1` แบบใน `public/account-menu.js` ให้ลองหน้าได้โดยไม่ต้องมี backend

## เทสที่ต้องมี (`tests/onboarding.test.cjs` ใช้ helper ใน `tests/helpers/`)

- สมัครใหม่ + `SIGNUP_CREDITS=3` → ยอด 3, ล็อกอินซ้ำ → ยังเป็น 3
- ไม่ตั้ง / `"0"` / `"-5"` / `"abc"` → ไม่มีแถว `signup_bonus`
- สมัครพร้อมกันด้วยเบอร์เดียวกัน 2 คำขอ → ได้ user เดียว โบนัสเดียว
- `/api/onboarding` แต่ละ step เปลี่ยนเป็น `true` ตามข้อมูลจริง, ข้อมูลผู้ใช้อื่นไม่ปน
- เทส auth เดิมใน `src/auth/tests/` ต้องผ่านทั้งหมดโดยไม่แก้เทสเดิม

## ก่อนส่งงาน

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด (ไม่ใช่แค่เทสของคุณ) — ส่งงานที่คอมไพล์ไม่ผ่านจะถูกตีกลับ
เปิดหน้า `/app/` จริงด้วย `npm run dev` ทั้งกรณีมีโบนัส/ไม่มี และบนจอแคบ แนบภาพหน้าจอหรือบรรยายใน
`docs/onboarding-integration-status.md` พร้อมจุดที่ขอให้ Claude ต่อสาย และข้อสงสัย
