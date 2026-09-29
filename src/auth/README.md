# Auth backend

Implements the API in `docs/phase1-tasks.md` using Workers Web Crypto, fetch, and D1.
Auth source and tests are under `src/auth/`; its schema is
`migrations/0001_auth.sql`. The main router now mounts `handleAuth`, and `/me`
reads the real credit ledger. Existing LINE tables are untouched.

## Integration

```ts
import { handleAuth } from './auth';

// Inside fetch, before the admin API and static asset fallback:
const authResponse = await handleAuth(request, env, url);
if (authResponse) return authResponse;
```

`requireUser(request, env)` is also exported for customer API authorization; it
returns `User | null` and checks account status and session expiry on each call.
It does not grant admin access. `/api/auth/me` reads the signed-in user's balance
through `getBalance`; it does not accept a caller-supplied user ID. Both auth and
credits migrations must be applied before using the integrated API.

Apply the migration before enabling routes:

```powershell
npm run auth:setup
npm run db:migrate:local
npx wrangler dev --ip 127.0.0.1 --port 8789
```

Agent A works only in `C:\Users\natta\OneDrive\Desktop\naka-ai-auth` on
`feat/auth`. Local auth uses `http://127.0.0.1:8789`; ports 8788 and 8790 belong
to other agents. Until Claude updates the shared scripts, use the explicit
Wrangler command above: `npm run dev:auth` still targets port 8788.

The setup script adds only
missing local values and generates a random secret without printing it. Existing
settings are preserved, including any old `APP_ORIGIN`; check it before starting.
Local migration validation from the earlier workspace does not establish the
database state of this worktree. Agent A does not migrate remotely, deploy or send
real SMS; Claude owns release operations. Do not use local mock SMS in production.

## Configuration

Store actual secrets in `.dev.vars` locally and Wrangler secrets in production.
Values below are placeholders, not working credentials.

```dotenv
APP_ORIGIN="http://127.0.0.1:8789"
SESSION_SECRET="<random secret with at least 32 characters>"
SMS_PROVIDER="mock"
GOOGLE_CLIENT_ID="<Google Web application client ID>"
GOOGLE_CLIENT_SECRET="<Google client secret>"

# Production SMS:
# SMS_PROVIDER="thaibulksms"
# SMS_API_KEY="<ThaiBulkSMS API key>"
# SMS_API_SECRET="<ThaiBulkSMS API secret>"
# SMS_SENDER="<approved ThaiBulkSMS sender name>"
```

ThaiBulkSMS requires a registered, case-sensitive sender. `SMS_SENDER?: string`
is now included in `src/types.ts`; the adapter rejects missing configuration. There
is no guessed/default sender and no fallback to mock when real SMS fails.

### ThaiBulkSMS API verification (2026-09-29)

Compared `sms.ts` with the provider's [official SMS API reference](https://developer.thaibulksms.com/):

| Contract | Adapter |
| --- | --- |
| Send endpoint | `POST https://api-v2.thaibulksms.com/sms` |
| Authentication | HTTP Basic using API key and API secret |
| Request | Form-encoded `sender`, `msisdn`, `message` |
| Recipient | E.164 phone number |
| Acceptance response | HTTP 201; matching recipient and `message_id` in `phone_number_list` |

The adapter also rejects reported bad recipients, failed responses and redirects.
Provider acceptance is not proof of handset delivery. The project generates and
verifies OTPs itself; the separate provider-managed OTP API is not used. The
documented contract matches the adapter, so no endpoint change or disabled TODO
is needed. This review made no authenticated SMS request and sent no real SMS.

Use exactly one canonical `APP_ORIGIN` (scheme, hostname and optional port, no
path). Register `${APP_ORIGIN}/api/auth/google/callback` in the Google Web OAuth
client. Use the same origin for the frontend and API; alias domains should
redirect to it. POST requests require the matching `Origin` header, including
requests made with curl. HTTP is permitted only on localhost/loopback. Session
cookies are Secure on HTTPS; local HTTP omits Secure so development works.

Mock SMS logs OTP text **only for explicit `SMS_PROVIDER=mock` on loopback HTTP**.
It is rejected on HTTPS and on non-loopback HTTP. Real SMS and Google flows do
not log provider bodies, OTPs, OAuth codes, tokens or credentials. No SMS or OAuth
calls are made unless their configuration is present.

## ทดสอบด้วยมือ

ขั้นตอนต่อไปนี้เป็นคู่มือสำหรับผู้ทดสอบ ไม่ใช่ผลยืนยันว่าล็อกอิน Google จริงหรือ
ส่ง SMS จริงแล้ว ใช้เฉพาะ worktree นี้และพอร์ต `8789` ขณะทดสอบ local

### 1. เตรียม local และ OTP แบบ mock

1. เปิด terminal ที่ `C:\Users\natta\OneDrive\Desktop\naka-ai-auth` ตรวจว่า
   `git branch --show-current` คืน `feat/auth` และอ่าน `AGENTS.md` ก่อนทำงาน
2. ตั้งค่าใน `.dev.vars` ของ worktree นี้ให้ `APP_ORIGIN="http://127.0.0.1:8789"`
   และ `SMS_PROVIDER="mock"` ใช้ `npm run auth:setup` เพื่อสร้าง secret แบบสุ่ม
   หากยังไม่มี `SESSION_SECRET` สคริปต์ไม่เขียนทับค่าที่มีอยู่ จึงต้องแก้ origin
   เก่าด้วยตนเอง อย่าคัดลอก secret ลงเอกสารหรือ commit `.dev.vars`
3. รัน `npm run db:migrate:local` เพื่อเตรียมทั้งตาราง auth และเครดิตในฐานข้อมูล
   local แล้วรัน `npx wrangler dev --ip 127.0.0.1 --port 8789`
   หากแก้ `.dev.vars` ให้ restart process ของพอร์ต 8789 เพื่อโหลดค่าใหม่
4. ทดสอบ backend ด้วย PowerShell ด้านล่าง ใช้เบอร์ตัวอย่างเฉพาะเมื่อแน่ใจว่า
   provider เป็น `mock` รหัสจะปรากฏใน terminal ของ Wrangler พร้อม prefix
   `[auth:mock-sms]` ไม่มีการส่ง SMS ออกไป และ API ไม่คืนรหัสใน response

```powershell
$authOrigin = 'http://127.0.0.1:8789'
$authHeaders = @{ Origin = $authOrigin }
$authPhone = '0810000001'
$authSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Invoke-RestMethod -Uri "$authOrigin/api/auth/otp/request" -Method Post `
  -Headers $authHeaders -ContentType 'application/json' `
  -Body (@{ phone = $authPhone } | ConvertTo-Json)

# อ่านรหัสจาก terminal ของ Wrangler แล้วกรอกที่นี่
$authCode = Read-Host 'รหัส OTP mock 6 หลัก'
Invoke-RestMethod -Uri "$authOrigin/api/auth/otp/verify" -Method Post `
  -Headers $authHeaders -ContentType 'application/json' -WebSession $authSession `
  -Body (@{ phone = $authPhone; code = $authCode } | ConvertTo-Json)

Invoke-RestMethod -Uri "$authOrigin/api/auth/me" -WebSession $authSession
Invoke-WebRequest -Uri "$authOrigin/api/auth/logout" -Method Post `
  -Headers $authHeaders -WebSession $authSession -UseBasicParsing
```

ผลที่คาดหวัง: ขอรหัสได้ `200 { ok: true, retryAfter: 60 }` ยืนยันสำเร็จได้
`user` และ cookie `naka_session`; `/me` คืนผู้ใช้และเครดิตจาก ledger
บัญชีใหม่ที่ยังไม่ได้รับเครดิตคืน `0` ออกจากระบบได้ `204` และเรียก `/me`
ด้วย session เดิมอีกครั้งต้องได้ `401` (PowerShell แสดงเป็น HTTP error)

ตรวจกรณีปฏิเสธด้วยเบอร์ทดสอบแยกจากกรณีสำเร็จ: ขอซ้ำก่อน 60 วินาทีต้องได้
`429` พร้อม `Retry-After`; หลังขอครบ 3 ครั้งในชั่วโมงเดียวต้องถูกจำกัดแม้ยืนยัน
สำเร็จแล้ว รหัสผิดครั้งที่ 1–4 ได้ `400` และครั้งที่ 5 ได้ `429` รหัสที่ปล่อยไว้
ครบ 5 นาทีหรือใช้สำเร็จไปแล้วต้องใช้ซ้ำไม่ได้ ห้ามแก้เวลา/ล้างฐานข้อมูลร่วม
เพื่อข้ามข้อจำกัด ให้รอเวลาจริงหรือใช้ automated tests ซึ่งแยกฐานข้อมูลให้แล้ว

หากมีหน้าเว็บจาก agent UI รวมเข้ามาแล้ว เปิด `/login/` โดย **ไม่ใส่ `?mock=1`**
เพื่อทดสอบ backend จริงร่วมกับ SMS mock โหมด UI mock อาจข้าม backend จึงไม่ใช้
เป็นหลักฐานยืนยัน integration ตรวจ login → `/app/` → logout และ reload
โดย cookie บน local HTTP จะไม่มี `Secure` แต่ยังมี `HttpOnly; SameSite=Lax`

### 2. ตั้ง Google OAuth Client

1. เจ้าของบัญชีเลือกโปรเจกต์ใน Google Cloud Console แล้วตั้ง Google Auth
   platform: Branding, Audience และข้อมูลติดต่อของแอป หากใช้ External/Testing
   ให้เพิ่มบัญชีผู้ทดสอบใน Audience ตามการตั้งค่าของโปรเจกต์
2. ไป Clients → Create client เลือก **Web application** แล้วเพิ่ม Authorized
   redirect URIs ให้ตรงตามตาราง แนะนำแยก client สำหรับ local และ production
   ใช้ scopes `openid email profile` สำหรับเข้าสู่ระบบเท่านั้น

| สภาพแวดล้อม | `APP_ORIGIN` | Authorized redirect URI |
| --- | --- | --- |
| Local ของ Agent A | `http://127.0.0.1:8789` | `http://127.0.0.1:8789/api/auth/google/callback` |
| Production | `https://naka-ai.com` | `https://naka-ai.com/api/auth/google/callback` |

3. เจ้าของบัญชีเก็บ Client ID/Client Secret แล้วใส่ `GOOGLE_CLIENT_ID` และ
   `GOOGLE_CLIENT_SECRET` ใน `.dev.vars` สำหรับ local จากนั้น restart dev server
   ฝั่ง production ให้ Claude ตั้งผ่าน Worker secrets เมื่อเตรียม release
   ห้ามใส่ client secret ใน JavaScript ฝั่งหน้าเว็บหรือไฟล์ที่ commit
4. Flow นี้เริ่มจาก backend redirect จึงไม่ได้ใช้ JavaScript SDK ของ Google
   การเพิ่ม Authorized JavaScript origins อย่างเดียวไม่แทนการเพิ่ม redirect URI
   ห้ามสลับ `127.0.0.1` กับ `localhost`, เปลี่ยนพอร์ต หรือเติม slash หลัง callback

อ้างอิง [Google Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
และ [การตั้ง Google Auth platform](https://developers.google.com/workspace/chat/authenticate-authorize-chat-user):
Google กำหนดให้ redirect URI ตรงกับ client ที่ลงทะเบียน และอนุญาต HTTP สำหรับ
loopback local ส่วน URL production ใช้ HTTPS

### 3. ตรวจ Google login และ session

1. หลังตั้งค่าข้างต้น เปิด browser ที่ `http://127.0.0.1:8789/api/auth/google/start`
   ใช้บัญชีทดสอบของตนเองและอนุญาตข้อมูลพื้นฐาน ระบบต้องกลับ callback แล้ว redirect
   ไป `/app/` หาก worktree นี้ยังไม่มี UI ให้ตรวจ `/api/auth/me` ใน browser เดิมแทน
2. ตรวจ Network ว่า callback คืน `302` และ cookie `naka_session` ไม่คัดลอกค่า
   cookie หรือ authorization code ลง issue/log; `/me` ต้องคืนอีเมลบัญชีที่เลือก
   และเครดิตจริง การล็อกอิน Google เดิมอีกครั้งต้องใช้ user ID เดิม
3. ออกจากระบบด้วยหน้า UI หรือ same-origin `POST /api/auth/logout` แล้วตรวจ
   `/me` ได้ `401` ยกเลิกหน้า Google consent ในรอบใหม่ต้องกลับ
   `/login/?error=google` โดยไม่สร้าง session ใหม่
4. เปิด callback ที่มี state ผิดโดยไม่มี flow ที่เริ่มไว้ ต้องกลับหน้า error
   การ replay callback หรือใช้ state ที่เกิน 10 นาทีต้องไม่สร้าง session ใหม่
   ตรวจกรณีเหล่านี้โดย automated tests ได้โดยไม่ล็อกอิน Google จริง

หากพบ `redirect_uri_mismatch` ให้เทียบ URI กับตารางและตรวจว่ารหัส client มาจาก
โปรเจกต์เดียวกัน หาก start ได้ `503` ให้ตรวจค่าตั้งค่าและ restart server;
หาก API ได้ `403` ให้ใช้ origin ตามที่ตั้งไว้ตลอด flow หลังตั้งค่า production
ผู้รับผิดชอบ release ต้องทดสอบที่ `https://naka-ai.com` และตรวจ cookie มี `Secure`
ขั้นตอน production นี้เป็นรายการส่งต่อ ไม่ใช่คำอนุญาตให้ Agent A deploy

## Behavior

- Thai mobile input `06…`, `08…`, `09…` or `+66…` normalizes to E.164.
- OTPs use uniform cryptographic six-digit codes, challenge-specific HMAC-SHA256,
  five-minute expiry, 60-second cooldown, and three sends per rolling hour per
  phone. Five failed guesses lock that challenge; the fifth correct guess works.
- An additional limit allows 20 send requests per rolling hour per trusted
  `CF-Connecting-IP`; stored IP values are HMACs. Missing IPs share one bucket.
  Failed/uncertain SMS deliveries consume quota but cannot activate an OTP.
- D1 transactions reserve send quota and replace the challenge atomically.
  Conditional SQL claims prevent OTP replay and duplicate OAuth code exchange.
  Concurrent OTP verification may reject an in-flight attempt; at most one wins.
- Sessions contain 32 random bytes and expire after 30 days. D1 stores only their
  SHA-256 digests. Login rotates the presented session; logout deletes it.
- Google uses authorization code exchange plus PKCE, a ten-minute HttpOnly state
  cookie and single-use server-side state. Identity and verified email come from
  Google's userinfo endpoint over the server-obtained access token. Google `sub`
  is the identity key. Client tokens are never accepted; emails never auto-link
  accounts across providers or distinct Google subjects.
- Login creates an active user only when that provider identity is new. Disabled
  users cannot log in or use existing sessions.
- API responses are non-cacheable. Errors are Thai and hide internal details.
  Old OTP/history/state/session records are cleaned on the corresponding flows;
  idle deployments can additionally schedule deletion by expiry for retention.

## Validation

Node 24 is used for the built-in SQLite test harness. It executes production SQL
with foreign keys and atomic transactions. A second suite uses Wrangler's
installed Miniflare/esbuild to verify the flow against isolated workerd and D1.
All outbound HTTP is mocked, and runtime database state is ephemeral.

```powershell
npm run test:auth
npm run typecheck
npm test
```

`npm test` now discovers both the existing tests and the auth suites. The runtime
suite bundles the real `src/index.ts`, exercises routed auth on workerd/D1, and
verifies that a ledger grant appears in `/me` for the authenticated customer.
Test coverage includes normalization, request validation, rolling limits,
concurrent sends/verifications, lockout, expiry, replay, hashed sessions,
rotation/logout, disabled users, provider failures, dev-only mock mode, Google
state/PKCE/replay, verified profile handling and stable identity reuse.

Provider credentials, SMS delivery and real Google browser login must be checked
in the integrated environment; local automated tests do not establish delivery
or account configuration.

## References

- [ThaiBulkSMS SMS API](https://developer.thaibulksms.com/)
- [Google OpenID Connect and UserInfo](https://developers.google.com/identity/openid-connect/openid-connect)
- [Cloudflare D1 atomic batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
