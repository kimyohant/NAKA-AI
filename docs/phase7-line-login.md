# Phase 7A — เข้าสู่ระบบด้วย LINE (ChatGPT)

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน `docs/line-login-integration-status.md`
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย

## ทำไม

SMS OTP มีค่าใช้จ่ายทุกครั้งที่ล็อกอิน คนไทยเกือบทุกคนมี LINE และ LINE Login ไม่มีค่าต่อครั้ง
เพิ่มปุ่ม "เข้าสู่ระบบด้วย LINE" ข้าง Google แล้ว SMS จะเหลือเป็นทางสำรอง

## Branch และไฟล์ที่เป็นเจ้าของ

แตก branch `feat/line-login` จาก `main` ล่าสุด (มี Stripe แล้ว)

`src/auth/line.ts`, `migrations/0011_line_login.sql`, `tests/line-login.test.cjs`, `docs/line-login-integration-status.md`
แก้เพิ่มได้เฉพาะจุด:
- `src/auth/index.ts`: เพิ่ม 2 route ใน `paths` และ `switch` (แบบเดียวกับ google) — ห้ามแก้ส่วนอื่น
- `src/auth/session.ts`: ขยาย type ของ `identityUser(provider)` ให้รับ `'line'` เท่านั้น
- `public/login/index.html` + `public/login/login.js` + `public/login/login.css`: ปุ่ม LINE เหนือปุ่ม Google, ข้อความ `?error=line`

**ห้ามแก้** `src/index.ts`, `src/types.ts` (Claude เพิ่ม env ตอน merge), `src/auth/google.ts`, `src/auth/otp.ts`, `src/auth/sms.ts` (Z.AI ทำอยู่), `src/billing/**`
เทส auth เดิมใน `src/auth/tests/` ต้องผ่านทั้งหมดโดยไม่แก้เทสเดิม

## สัญญา

```ts
// src/auth/line.ts
export async function lineStart(request: Request, env: Env): Promise<Response>;            // GET /api/auth/line/start
export async function lineCallback(request: Request, env: Env, url: URL): Promise<Response>; // GET /api/auth/line/callback
```

Env (Claude เพิ่มใน `src/types.ts` ตอน merge — ระหว่างทำให้ cast แบบ `src/onboarding/signup.ts` เคยทำ):
`LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` 🔑 — ไม่ตั้ง = 503 และหน้า login ซ่อนปุ่ม LINE
(**คนละ channel กับ LINE bot เดิม** `LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN` ห้ามใช้ปนกัน)
เพิ่มใน `/api/auth/config` ไม่ได้ (อยู่ใน `index.ts` ที่ห้ามแก้) → ให้ `lineStart` ตอบ 503 แล้วหน้า login ซ่อนปุ่มเมื่อได้ 503 จาก `HEAD`/`GET` ไม่ได้
ทางที่ง่ายกว่า: **ขอให้ Claude เพิ่ม `lineLogin: boolean` ใน `/api/auth/config` ตอน merge** แล้ว `login.js` อ่านค่านั้น (ระหว่างทำ ถือว่า `undefined` = ซ่อน)

## ต้องทำให้เหมือน Google ใน `src/auth/google.ts` ทุกข้อด้านความปลอดภัย

- `state` สุ่มผูกกับ cookie (แยกชื่อ `naka_line_state`) + ตารางเดิม `auth_oauth_states` (ลบทิ้งทันทีที่ใช้, หมดอายุ 10 นาที), PKCE `S256`
- `redirect_uri` = `appOrigin(env)` + `/api/auth/line/callback` เท่านั้น
- ตัวตนมาจาก LINE ฝั่งเซิร์ฟเวอร์: แลก code ที่ token endpoint แล้ว **ตรวจ `id_token` ด้วย endpoint verify ของ LINE** (ส่ง `client_id` ไปด้วย ตรวจ `aud`, `iss`, `exp`, `nonce`) หรือเรียก profile ด้วย access token
  ห้ามเชื่อ JWT ที่ไม่ได้ตรวจ ห้าม decode เองแล้วใช้
- `provider_uid` = `sub` (LINE userId) ห้ามรวมบัญชีด้วยอีเมล (เหมือน Google)
- scope `openid profile` — **ไม่ขอ email** (ต้องยื่นขอสิทธิ์กับ LINE แยก ไม่จำเป็น)
- ชื่อที่แสดงจาก `name`/`displayName` ตัดที่ 160 ตัวอักษร ไม่มี = `สมาชิก NAKA-AI`
- เครดิตโบนัสสมัครใหม่ใช้ได้เลยเพราะผ่าน `identityUser()` เดิม
- ผิดพลาดทุกกรณี → redirect `/login/?error=line` ไม่ log code/token/ข้อมูลผู้ใช้
- **ตรวจ endpoint/พารามิเตอร์จากเอกสาร LINE Login v2.1 จริง** (developers.line.biz) เขียน URL เอกสารที่ใช้ไว้ในคอมเมนต์ ห้ามเดา

## Migration `0011_line_login.sql`

ขยาย `auth_identities.provider` CHECK ให้รับ `'line'` — SQLite แก้ CHECK ตรงๆ ไม่ได้ ต้องสร้างตารางใหม่
ไม่มีตารางไหนอ้าง foreign key มาที่ `auth_identities` แต่ `auth_identities.user_id` อ้าง `users` — เก็บข้อมูลเดิมครบ, UNIQUE และ index เดิมต้องอยู่
ดู `migrations/0010_stripe.sql` เป็นตัวอย่าง (อ่านคอมเมนต์เรื่อง foreign key) และเทสด้วยข้อมูลจริงบน D1 local: `npm run db:migrate:local`

## เทสที่ต้องมี (`tests/line-login.test.cjs` — mock `fetch` แบบ `tests/billing.test.cjs` ห้ามเรียก LINE จริง)

- start: redirect ไป LINE พร้อม state/PKCE/redirect_uri ถูก, set cookie; ไม่ตั้ง env → 503
- callback สำเร็จ → สร้าง user + session cookie → redirect `/app/`; ล็อกอินซ้ำ → user เดิม
- state ไม่ตรง / ใช้ซ้ำ / หมดอายุ / ไม่มี cookie / มี `error=` / id_token ตรวจไม่ผ่าน → `/login/?error=line` ไม่มี session
- ผู้ใช้ Google และ LINE ที่ชื่อ/อีเมลเหมือนกันเป็นคนละบัญชี
- migration: ข้อมูล phone/google เดิมอยู่ครบหลัง 0011, UNIQUE (provider, provider_uid) ยังทำงาน

## ก่อนส่งงาน

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด **commit ลง branch ก่อนแจ้งว่าเสร็จ** (ห้ามทิ้ง uncommitted, ห้าม commit ไฟล์ probe)
เขียนใน status doc: เอกสาร LINE ที่ใช้, ขั้นตอนสร้าง LINE Login channel ให้เจ้าของทำ (Callback URL), และสิ่งที่ขอให้ Claude ต่อสาย
