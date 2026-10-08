# Phase 9 — ลืมรหัสผ่าน: ลูกค้ารีเซ็ตเองทางอีเมล

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน status doc
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย · **commit ลง branch ก่อนแจ้งว่าเสร็จ ห้ามทิ้ง uncommitted ห้าม commit ไฟล์ probe/tmp**

## ทำไม

ลูกค้าที่สมัครด้วยอีเมลแล้วลืมรหัสผ่าน ตอนนี้ต้องติดต่อแอดมินให้ออกรหัสชั่วคราว (`/admin/customers/`) ทุกครั้ง
งานนี้ให้ลูกค้าขอลิงก์ตั้งรหัสใหม่ทางอีเมลได้เอง · ทางแอดมินเดิมยังอยู่ ห้ามแตะ

รอบนี้มีงานเดียวคือ **9A — API (ChatGPT)** · หน้าเว็บ (9B) จะสั่งแยกภายหลัง โดยเรียก API ตามสัญญาข้างล่าง

## การส่งอีเมล

ไฟล์ใหม่ `src/auth/email.ts` รูปแบบเดียวกับ `src/auth/sms.ts`:

```ts
export interface EmailProvider { send(to: string, subject: string, text: string): Promise<void> }
export function emailProvider(env: Env): EmailProvider // โยน AuthError(503) ถ้ายังไม่ได้ตั้งค่า
```

| `EMAIL_PROVIDER` | พฤติกรรม |
|---|---|
| ไม่ตั้ง / `"off"` | ฟีเจอร์ปิด (ค่าเริ่มต้นใน production จนกว่าเจ้าของจะใส่ key) |
| `"mock"` | ใช้ได้เฉพาะเมื่อ `APP_ORIGIN` เป็น `http:` — `console.log` แบบ mock SMS |
| `"resend"` | `POST https://api.resend.com/emails` ด้วย `Authorization: Bearer RESEND_API_KEY`, body `{ from: EMAIL_FROM, to: [to], subject, text }` ต้องมีทั้ง `RESEND_API_KEY` และ `EMAIL_FROM` ไม่งั้น 503 |

- ตรวจเอกสาร Resend ฉบับปัจจุบันก่อนเขียน แล้วใส่คอมเมนต์วันที่ตรวจแบบใน `sms.ts` · `redirect: 'manual'`, timeout 10 วินาที
- อีเมลเป็นข้อความล้วน (ไม่มี HTML) ภาษาไทย: บอกว่ามีคนขอตั้งรหัสผ่านใหม่ของ NAKA-AI, ลิงก์, อายุ 30 นาที, ถ้าไม่ได้ขอให้เพิกเฉย
- เพิ่มใน `src/types.ts` เฉพาะ `EMAIL_PROVIDER?`, `RESEND_API_KEY?`, `EMAIL_FROM?` · **ห้ามแก้ `wrangler.jsonc`** (Claude ตั้งค่าเองตอนเปิดใช้)

## Migration `migrations/0013_password_reset.sql`

ใช้ schema นี้ตามตัวอักษร:

```sql
-- One row per reset request. Unknown emails get a row too (no user, no token) so the rate limits
-- count them. email_key / ip_key are HMACs as in auth_password_attempts, never the values.
CREATE TABLE IF NOT EXISTS auth_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_key TEXT NOT NULL,
  ip_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE,          -- SHA-256 of the emailed token; the token itself is never stored
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_password_resets_email ON auth_password_resets(email_key, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_password_resets_ip ON auth_password_resets(ip_key, created_at);
```

## สัญญา API

ทั้งสองเส้นทาง: ไม่ต้องล็อกอิน, JSON ไม่เกิน 4 KB, ผ่าน Origin check ของ `handleAuth` เดิม, ใช้ `botCheck` (Turnstile) เดิมเมื่อมีการตั้งค่า

### `POST /api/auth/password/forgot`

```json
{ "email": "…", "turnstileToken": "…" }
```

| ผล | status | body |
|---|---|---|
| รับคำขอแล้ว (ไม่ว่าอีเมลจะมีบัญชีหรือไม่) | 200 | `{ "ok": true }` |
| อีเมลรูปแบบผิด | 400 | ข้อความจาก `normalizeEmail` |
| ขอบ่อยเกิน | 429 | `{ "error": "ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" }` + `Retry-After` |
| ยังไม่เปิดส่งอีเมล | 503 | `{ "error": "ระบบส่งอีเมลยังไม่พร้อมใช้งาน กรุณาติดต่อทีมงาน" }` |

- **ห้ามบอกว่าอีเมลมีบัญชีหรือไม่**: อีเมลที่ไม่มีบัญชี, บัญชี Google/LINE ที่ไม่มีรหัสผ่าน, บัญชีที่ถูกระงับ → ตอบ 200 เหมือนกันทุกตัวอักษร และไม่ส่งอีเมล
- ส่งอีเมลล้มเหลว → ยังตอบ 200 (ไม่งั้นจะรั่วว่ามีบัญชี) และ `console.error` โดยไม่มีอีเมลหรือ token ใน log
- เวลาตอบต้องไม่ต่างกันจนเดาได้: ส่งอีเมลผ่าน `ctx.waitUntil` ไม่ `await` ในเส้นทางตอบ — เพิ่มพารามิเตอร์ `ctx?: ExecutionContext` ให้ `handleAuth` และส่งต่อจาก `src/index.ts` (แก้ได้เฉพาะบรรทัดที่เรียก `handleAuth`)
- จำกัด: 3 ครั้ง/อีเมล/ชั่วโมง และ 10 ครั้ง/IP/ชั่วโมง นับจาก `auth_password_resets` (ทุกคำขอมีแถว รวมอีเมลที่ไม่มีบัญชี) · ใช้ `limitKeys` เดิมทำ key
- Token: `randomToken()` เดิม เก็บเฉพาะ `sha256(token)` อายุ 30 นาที · ออก token ใหม่แล้ว token เก่าที่ยังไม่ใช้ของผู้ใช้คนเดียวกันต้องใช้ไม่ได้
- ลิงก์ในอีเมล: `${APP_ORIGIN}/login/reset/#token=<token>` (อยู่ใน fragment จึงไม่ถูกส่งไปเซิร์ฟเวอร์หรือ log)
- ทุกคำขอลบแถวที่ `created_at` เก่ากว่า 24 ชั่วโมงทิ้ง

### `POST /api/auth/password/reset`

```json
{ "token": "…", "newPassword": "…" }
```

| ผล | status | body |
|---|---|---|
| สำเร็จ | 200 | `{ "ok": true }` — **ไม่ออก session** ลูกค้าไปล็อกอินด้วยรหัสใหม่ |
| token ผิด / หมดอายุ / ใช้แล้ว / บัญชีถูกระงับ | 400 | `{ "error": "ลิงก์หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่" }` |
| รหัสใหม่ผิดกติกา | 400 | ข้อความจาก `checkPassword` |
| ลอง token ผิดเกิน | 429 | ข้อความไทย + `Retry-After` |

- ตรวจรหัสใหม่ด้วย `checkPassword` **ก่อน** ใช้ token — รหัสผิดกติกาต้องไม่ทำให้ลิงก์เสีย
- สำเร็จ: อัปเดต `auth_passwords` + ทำเครื่องหมาย `used_at` + **ลบ session ทั้งหมดของผู้ใช้** ใน `DB.batch` เดียว โดยมีเงื่อนไขว่า token ยังไม่ถูกใช้ (ส่งซ้ำพร้อมกันสองครั้ง สำเร็จได้ครั้งเดียว) แบบเดียวกับ `changePassword`
- token ผิดนับต่อ IP: เกิน 10 ครั้งใน 15 นาที = 429 (ใช้ `auth_password_attempts` kind `login` กับ key IP เดิม)
- ใช้ `hashPassword` เดิม ห้ามเขียน hash ใหม่ · ห้าม log หรือส่งกลับรหัสผ่าน/token

### `GET /api/auth/config` (เดิม)

เพิ่มฟิลด์ `passwordReset: boolean` — `true` เมื่อ `emailProvider(env)` ไม่โยน error (แบบ `phoneConfigured`) ให้หน้า login รู้ว่าจะแสดงลิงก์ "ลืมรหัสผ่าน" หรือไม่

---

## 9A — API (ChatGPT)

แตก branch `feat/password-reset` จาก `main` ล่าสุด (มี 8A `changePassword` แล้ว)

ไฟล์: `src/auth/email.ts` (ใหม่), `src/auth/password.ts` (เพิ่มฟังก์ชัน ห้ามเปลี่ยนพฤติกรรม register/login/change/hash เดิม),
`src/auth/index.ts` (เพิ่ม route, `passwordReset` ใน config, พารามิเตอร์ `ctx`), `src/index.ts` (เฉพาะบรรทัดเรียก `handleAuth`), `src/types.ts` (3 ฟิลด์ข้างบน),
`migrations/0013_password_reset.sql`, `tests/password-reset.test.cjs`, `docs/password-reset-integration-status.md`
**ห้ามแก้** `public/**`, `wrangler.jsonc`, migration เดิม, `src/admin/**`, `src/billing/**`, ไฟล์เทสเดิม

เทส (แบบ `tests/password-change.test.cjs`, provider `mock` หรือ stub `fetch`):
- ขอลิงก์ → ได้ token จากอีเมลจำลอง → reset สำเร็จ → รหัสเก่าใช้ไม่ได้ รหัสใหม่ล็อกอินได้ → session เดิมทุกเครื่องหลุด
- token ใช้ซ้ำไม่ได้ · หมดอายุหลัง 30 นาที · ขอใหม่แล้ว token เก่าใช้ไม่ได้ · ส่ง reset พร้อมกันสองครั้งสำเร็จครั้งเดียว
- อีเมลไม่มีบัญชี / บัญชี Google / บัญชีถูกระงับ → 200 body เดียวกันและไม่มีการส่งอีเมล
- รหัสใหม่สั้น/ยาว → 400 และ token ยังใช้ได้
- 429: ขอเกิน 3 ครั้ง/อีเมล, เกิน 10 ครั้ง/IP, token ผิดเกิน 10 ครั้ง
- `EMAIL_PROVIDER` ไม่ตั้ง → `forgot` ตอบ 503 และ `passwordReset: false` · `mock` บน `https:` → 503
- Resend: request ถูกรูปแบบ (URL, header, body), ตอบไม่ `ok` → ลูกค้ายังได้ 200, ใน log ไม่มีอีเมล/token
- ฐานข้อมูลเก็บเฉพาะ hash ของ token · Origin check และ JSON เกิน 4 KB · เทส auth เดิมผ่านโดยไม่แก้

## ก่อนส่งงาน

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด · **commit ลง branch** · สรุปผล, สิ่งที่ 9B ต้องรู้ และสิ่งที่ขอให้ Claude ต่อสาย (secret, DNS ของโดเมนผู้ส่ง) ใน status doc
