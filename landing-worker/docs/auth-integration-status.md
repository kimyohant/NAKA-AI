# Shared auth integration status

## สถานะปัจจุบัน — Agent A / feat/auth

ตั้งแต่ 2026-09-29 ทำงานเฉพาะ `C:\Users\natta\OneDrive\Desktop\naka-ai-auth`
ตาม `AGENTS.md` ของ worktree นี้ ใช้พอร์ต `8789` แก้เฉพาะ `src/auth/**`,
`migrations/0001_auth.sql` และเอกสารนี้ ข้อความด้านล่างที่กล่าวถึง workspace
ร่วมและพอร์ต 8788 เป็นประวัติจาก commit `8295a23` ไม่ใช่ขอบเขตงานปัจจุบัน

### งานที่เหลือที่ดำเนินการแล้ว

- ตรวจ `src/auth/sms.ts` เทียบ [เอกสาร ThaiBulkSMS](https://developer.thaibulksms.com/)
  ได้เนื้อหา SMS API จากผลค้นบนโดเมนเอกสารทางการ แม้การเปิดหน้าโดยตรงแสดงเพียง
  shell ของเว็บ ยืนยัน endpoint, Basic Auth, form fields และ response ตรงกับโค้ด
  บันทึกแหล่งอ้างอิงและวันที่ตรวจใน source/README ไม่ต้องเดา endpoint หรือปิด provider
- เพิ่มหัวข้อ **ทดสอบด้วยมือ** ใน `src/auth/README.md`: OTP แบบ `SMS_PROVIDER=mock`,
  PowerShell ที่เก็บ cookie ใน memory, ผลที่ควรได้, rate limit/expiry/replay,
  Google Web OAuth client และ redirect URIs ทั้งพอร์ต 8789 และ production
- ปรับ default origin และข้อความคำสั่งใน `src/auth/setup-local.cjs` เป็นพอร์ต
  8789 โดยยังไม่เขียนทับค่าตั้งค่าเดิม ไม่ได้รันสคริปต์หรือแก้ `.dev.vars` ในรอบนี้
- ไม่ได้ตั้ง Google client จริง, ส่ง SMS จริง, deploy, push หรือแตะไฟล์ของ agent อื่น

### ผลตรวจรอบนี้

- `npm run typecheck`: ผ่านใน worktree `naka-ai-auth`
- `npm test`: ผ่าน 57/57 รวม auth 28 กรณี และ workerd/D1 บน router จริง
  ใช้ HTTP mocks สำหรับผู้ให้บริการทั้งหมด
- `node --check src/auth/setup-local.cjs`: ผ่าน
- ตัวอย่าง PowerShell ทั้ง 3 block ใน README ผ่าน parser โดยไม่ได้รันคำสั่งเหล่านั้น
- `git diff --check`: ผ่าน แก้เพียง `src/auth/README.md`, `src/auth/sms.ts`,
  `src/auth/setup-local.cjs` และเอกสารนี้ ไม่รวม `AGENTS.md` ใน commit
- พร้อมส่งให้ Claude review; หลัง commit ให้ Agent A หยุดรอคำสั่งใหม่

### ขอให้ Claude แก้

1. `package.json`: `dev:auth` ยังเป็นพอร์ต 8788 ให้เปลี่ยนเป็น
   `wrangler dev --ip 127.0.0.1 --port 8789` สำหรับ worktree auth หรือเพิ่ม script
   แยกเฉพาะ Agent A โดยคงพอร์ตของ agent อื่น ระหว่างนี้ README ใช้คำสั่ง explicit
2. `.dev.vars.example`: ปรับตัวอย่าง origin และ Google callback สำหรับ Agent A
   เป็นพอร์ต 8789 ตอนรวมงาน ไฟล์นี้อยู่นอกขอบเขตจึงไม่ได้แก้
3. ก่อนทดสอบด้วยมือ เจ้าของ environment ต้องตรวจ `.dev.vars` ใน worktree auth
   ให้ origin ตรงกับ 8789 และ provider เป็น mock; setup เก็บค่าที่มีอยู่ ไม่เขียนทับ
4. ก่อน release ตรวจรายการ frontend review ด้านล่างอีกครั้งใน branch UI ล่าสุด
   ข้อสังเกตเดิมเป็น snapshot ของงานที่ยังทำไม่เสร็จ ไม่ใช่ผลตรวจล่าสุดของ Agent B

## ประวัติ integration ก่อนแยก worktree (8295a23)

The user authorized continuing integration and working alongside the existing
frontend/queue agents on 2026-09-29.

ChatGPT is handling the auth integration and its tests:
- `src/auth/**`, `migrations/0001_auth.sql`
- The `handleAuth` import/dispatch in `src/index.ts` only; queue/affiliate edits
  in the same file are preserved.
- `SMS_SENDER` in `src/types.ts`; other Env additions are preserved.
- Auth test discovery, local auth configuration and migration verification.

Frontend work already appeared under `public/login/` and `public/account-menu.*`
while this task was running. Those files are left to the frontend agent until
its work settles; this document is a handoff, not a claim that the other agent
has received a direct message.

## Integration contract

- All `/api/auth/*` routes now pass through `handleAuth` before static assets.
- `/api/auth/me` reads the real `credit_ledger` balance. Apply both migrations.
- POSTs must come from the exact configured `APP_ORIGIN`. Same-origin browser
  fetch sends `Origin` automatically. Local origin uses `http://127.0.0.1:8788`.
- Use `credentials: 'same-origin'` (also the browser default). Do not store a
  session token in localStorage; the backend sets the HttpOnly cookie.
- Real `/me` errors must never fall back to a persisted mock session. Explicit
  UI mock mode must remain visibly labeled and separate from real auth.
- Logout should report an HTTP/network failure instead of claiming success.
- No live SMS/Google verification or remote deploy has occurred. Local provider
  credentials and Cloudflare CLI authentication were missing at inspection.

Frontend follow-up: mount `[data-account-menu]` and `/account-menu.js` in the
marketing/create navigation, verify mobile layout and login/logout error states.

## Review findings for the frontend owner

Inspection of the in-progress files found these integration issues; avoid shipping
until corrected:

1. `NakaAuth.me()` currently falls back to a local mock user after a real 401,
   server error or network failure. Only use local mock data when `mockMode()` is
   explicitly enabled. Distinguish anonymous (401) from an unavailable API.
2. `login.js` calls `signIn(data.user)` even for real OTP login. This writes the
   real user to the mock store and invents 120 credits. Call it only in explicit
   mock mode; real auth is already persisted in the HttpOnly session cookie.
3. `signOut()` swallows network failures and ignores HTTP status. Do not navigate
   away or show logged-out success unless session revocation succeeds.
4. `safeNext()` also needs to reject control characters (e.g. `/\t/evil.test`),
   since URL parsing can turn them into a scheme-relative external target.
5. OTP request 502/503 currently shows "invalid phone"; render the API's Thai
   error instead. Disable resend while a request is pending, and derive its
   countdown from an absolute retry deadline so background tabs stay accurate.
6. The login page's terms/privacy acceptance statement has no real policy links.
   Use truthful sign-in guidance until actual published policies are supplied.

The browser connector currently exposes no browsers, so a visual browser pass
was not possible in this session. Backend integration is validated by real
workerd/D1 with mocked provider HTTP and the standard TypeScript/test commands.

## Validation and local server handoff

- `npm run typecheck`: passed.
- `npm test`: 57 tests passed, including the current affiliate/credits suites and
  auth on the real router in an isolated workerd/D1 runtime.
- `npm run auth:setup`: generated the missing local secret and loopback/mock
  settings in ignored `.dev.vars`; existing credentials were preserved.
- `npm run db:migrate:local`: applied `0001_auth.sql` and
  `0002_credits_jobs.sql` successfully.
- Another agent's existing dev server owns port 8788 and started before these
  settings were added. It still returned configuration errors during inspection.
  Its owner should restart it with `npm run dev:auth` to load `.dev.vars`.
  The temporary servers started for this integration were stopped; the other
  agent's server was not stopped or changed.
- No production secrets were retrieved: `wrangler secret list` requires
  Cloudflare authentication in this environment. No remote database writes,
  real SMS sends, Google account login, or deployment were performed.
