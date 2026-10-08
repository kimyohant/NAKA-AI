# Phase 1 — การแบ่งงาน 3 agent

อ้างอิงสถาปัตยกรรม: เอกสาร "NAKA-AI สถาปัตยกรรมระบบ" (Roadmap Phase 1)
เป้าหมาย Phase 1: ผู้ใช้สมัครด้วยเบอร์โทรหรือ Google ได้ มีเครดิต และงาน AI วิ่งผ่านคิว

| Agent | งาน | Branch | ไฟล์ที่เป็นเจ้าของ (แก้ได้เฉพาะไฟล์เหล่านี้) |
|---|---|---|---|
| **A — ChatGPT** | Auth backend | `feat/auth` | `src/auth/**`, `migrations/0001_auth.sql`, `tests/auth.test.cjs` |
| **B — Z.AI** | หน้า login + app shell (frontend) | `feat/auth-ui` | `public/login/**`, `public/app/**`, `public/account-menu.js`, `public/account-menu.css` |
| **C — Claude** | สัญญากลาง, เครดิต, คิวงาน, ต่อ route, review + merge | `feat/credits-jobs` | `src/types.ts`, `src/index.ts`, `src/credits.ts`, `src/jobs.ts`, `migrations/0002_credits_jobs.sql`, `tests/credits.test.cjs`, `docs/**` |

## กติการ่วม (ทุก agent)

1. แตก branch จาก `main` หลัง commit งานหน้าแรกล่าสุดแล้ว
2. **ห้ามแก้ไฟล์นอกคอลัมน์ "เจ้าของ"** ถ้าจำเป็นต้องแก้ ให้เขียนไว้ในคำอธิบาย PR ให้ Claude ทำตอน merge
3. ห้ามแก้ `schema.sql` เดิม (ระบบ LINE bot ใช้อยู่) ตารางใหม่ใส่ใน `migrations/` เท่านั้น
4. ห้ามใส่ secret ใน repo ค่า secret ทั้งหมดอ่านจาก `env` และใส่ตัวอย่างใน PR description
5. ต้องผ่าน `npm run typecheck` และ `npm test` ก่อนส่ง
6. ข้อความที่ผู้ใช้เห็นเป็นภาษาไทย ข้อความ error ห้ามเปิดเผยรายละเอียดภายใน (ดูแบบใน `src/studio.ts`)
7. เขียนโค้ดให้เข้ากับโค้ดเดิม: TypeScript บน Cloudflare Workers + D1, ไม่เพิ่ม dependency โดยไม่จำเป็น
8. ส่งงานเป็น PR พร้อมสรุปว่าทดสอบอะไรไปแล้ว

## สัญญากลาง (Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง)

### Env ใหม่ใน `src/types.ts`

```ts
GOOGLE_CLIENT_ID: string;
GOOGLE_CLIENT_SECRET: string;
SESSION_SECRET: string;          // ใช้ HMAC ค่า OTP
SMS_PROVIDER: "mock" | "thaibulksms";
SMS_API_KEY?: string;
SMS_API_SECRET?: string;
APP_ORIGIN: string;              // เช่น http://127.0.0.1:8788 หรือ https://naka-ai.com
```

### ตาราง (migrations/0001_auth.sql — Agent A เขียน)

```sql
users           (id TEXT PK, display_name, created_at, status)          -- id = crypto.randomUUID()
auth_identities (id TEXT PK, user_id, provider 'phone'|'google', provider_uid, verified_at,
                 UNIQUE(provider, provider_uid))
sessions        (id TEXT PK, user_id, expires_at, created_at)           -- id = token สุ่ม 32 bytes, เก็บเป็น SHA-256 hash
otp_codes       (phone, code_hash, expires_at, attempts, created_at)
```

### API (Agent A ทำ, Agent B เรียกใช้)

| Method | Path | Body | ผลลัพธ์ |
|---|---|---|---|
| POST | `/api/auth/otp/request` | `{ "phone": "0812345678" }` | `200 { "ok": true, "retryAfter": 60 }` · `400` เบอร์ผิด · `429 { "retryAfter": n }` |
| POST | `/api/auth/otp/verify` | `{ "phone", "code" }` | `200 { "user": User }` + cookie · `400` รหัสผิด/หมดอายุ · `429` ผิดเกิน 5 ครั้ง |
| GET | `/api/auth/google/start` | — | `302` ไป Google (มี `state` กัน CSRF) |
| GET | `/api/auth/google/callback` | — | `302` ไป `/app/` + cookie · ล้มเหลว `302` ไป `/login/?error=google` |
| GET | `/api/auth/me` | — | `200 { "user": User, "credits": number }` · `401` |
| POST | `/api/auth/logout` | — | `204` + ลบ cookie |

```ts
interface User { id: string; displayName: string; phone: string | null; email: string | null }
```

- Cookie: `naka_session`, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 วัน)
- เบอร์โทรเก็บแบบ E.164 (`+66812345678`) รับได้ทั้ง `08…` และ `+668…`
- `credits` ใน `/api/auth/me`: Agent A คืน `0` ไปก่อน Claude จะต่อกับ ledger ตอน merge

### Export ที่ Agent A ต้องมีให้ Claude ต่อ route

```ts
// src/auth/index.ts
export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response | null>; // null = ไม่ใช่ path ของ auth
export async function requireUser(request: Request, env: Env): Promise<User | null>;
```

---

## Brief: Agent A — ChatGPT (Auth backend)

ทำระบบสมัคร/ล็อกอินด้วยเบอร์โทร (OTP) และ Google ตามสัญญาข้างบน

1. `migrations/0001_auth.sql` ตามตารางข้างบน พร้อม index ที่จำเป็น
2. `src/auth/otp.ts`
   - สุ่มรหัส 6 หลักด้วย `crypto.getRandomValues` เก็บเป็น HMAC ด้วย `SESSION_SECRET` ไม่เก็บรหัสจริง
   - หมดอายุ 5 นาที, ขอใหม่ได้ทุก 60 วินาที, สูงสุด 3 ครั้ง/เบอร์/ชั่วโมง, ยืนยันผิดได้ 5 ครั้ง
   - เทียบรหัสแบบ constant-time
3. `src/auth/sms.ts` — interface `SmsProvider { send(phone, text) }`
   - `mock`: `console.log` รหัสออก log (ใช้ตอน dev) และห้ามใช้ถ้า `APP_ORIGIN` เป็น https
   - `thaibulksms`: เขียนตามเอกสาร API จริงของผู้ให้บริการ ถ้าเข้าถึงเอกสารไม่ได้ให้เว้นเป็น TODO ที่ throw ชัดเจน อย่าเดา endpoint
4. `src/auth/google.ts` — OAuth 2.0 Authorization Code flow, scope `openid email profile`, ตรวจ `state` ผ่าน cookie สั้น ๆ, อ่าน email จาก userinfo endpoint
5. `src/auth/session.ts` — สร้าง/อ่าน/ลบ session, `requireUser`
6. `src/auth/index.ts` — `handleAuth` จับ path `/api/auth/*`
7. ถ้าเบอร์หรือ Google account ใหม่ ให้สร้าง `users` + `auth_identities` ถ้ามีแล้วให้ล็อกอินบัญชีเดิม (ยังไม่ต้องทำการผูกหลายช่องทางเข้าบัญชีเดียว)
8. `tests/auth.test.cjs` ครอบคลุมอย่างน้อย: เบอร์ผิดรูปแบบ, rate limit 429, รหัสผิด 5 ครั้ง, รหัสหมดอายุ, verify สำเร็จได้ cookie, `/me` ไม่มี cookie ได้ 401, Google `state` ไม่ตรงถูกปฏิเสธ — mock HTTP ทั้งหมด ดูแบบใน `tests/studio.test.cjs`

ห้ามแก้ `src/index.ts` — Claude จะต่อ route ให้

---

## Brief: Agent B — Z.AI (Frontend: login + app shell)

ทำหน้าจอฝั่งผู้ใช้ ใช้ API ตามสัญญาข้างบน ระหว่างที่ backend ยังไม่เสร็จให้ mock ด้วย `fetch` stub ในโหมด `?mock=1`

1. `public/login/index.html` + `login.css` + `login.js`
   - ปุ่ม "เข้าสู่ระบบด้วย Google" (ลิงก์ไป `/api/auth/google/start`)
   - ฟอร์มเบอร์โทร → ขอรหัส → ช่องกรอกรหัส 6 หลัก (`inputmode="numeric"`, `autocomplete="one-time-code"`)
   - นับถอยหลังขอรหัสใหม่ตาม `retryAfter`, แสดง error ภาษาไทยทุกกรณีในตาราง API, อ่าน `?error=google`
   - สำเร็จแล้วไป `/app/` หรือ `?next=` (รับเฉพาะ path ภายในเว็บ ขึ้นต้นด้วย `/` แต่ไม่ใช่ `//`)
2. `public/app/index.html` + `app.css` + `app.js` — dashboard เปล่า
   - เรียก `/api/auth/me` ถ้า 401 ให้ไป `/login/?next=/app/`
   - แสดงชื่อ, เครดิตคงเหลือ, การ์ดเริ่มงาน 4 แบบ (ลิงก์ไป `/create/?workflow=sales|drama|live|bot`), ปุ่มออกจากระบบ
3. `public/account-menu.js` + `account-menu.css` — สคริปต์เล็กที่เพิ่มปุ่ม "เข้าสู่ระบบ" หรือชื่อผู้ใช้ใน glass nav โดยเรียก `/api/auth/me` (ห้ามแก้ `glass-nav.js` เอง ส่งวิธีใส่ `<script>` ให้ Claude ใน PR)
4. ดีไซน์ต้องเข้ากับหน้าแรก: ฟอนต์ Anuphan / IBM Plex Sans Thai, โทนน้ำเงินเข้ม `#091736`, ปุ่ม pill (ดู `public/home.css`, `public/home-refine.css`)
5. ใช้งานได้ที่ความกว้าง 360px, เข้าถึงได้ด้วยคีย์บอร์ด, มี `label` ทุกช่อง, error อยู่ใน `aria-live`
6. ห้ามใช้ countdown ปลอม, popup ซ้อน หรือ dark pattern (บทเรียนจาก buzzy.now)

---

## งาน Agent C — Claude

1. อัปเดต `src/types.ts` ตามสัญญา (ทำก่อน ให้ A และ B เริ่มได้)
2. `migrations/0002_credits_jobs.sql`: `plans`, `credit_ledger`, `jobs`
3. `src/credits.ts`: grant / hold / refund แบบ atomic, ยอดคงเหลือ = SUM(delta)
4. `src/jobs.ts`: คิวงาน AI, จำกัดงานพร้อมกันต่อผู้ใช้ตามแพ็กเกจ, คืนเครดิตเมื่อล้ม
5. ต่อ `handleAuth` เข้า `src/index.ts`, ใส่ `account-menu.js` ในหน้าเว็บ, เชื่อม `credits` ใน `/api/auth/me`
6. Review และ merge PR ของ A และ B ตามลำดับ: A → B → C

## ลำดับเวลา

1. Claude commit งานค้าง + push สัญญา (`src/types.ts`, ไฟล์นี้) ลง `main`
2. A, B, C ทำพร้อมกัน
3. Merge A → ต่อ route → Merge B → ทดสอบ login จริงบน dev → Merge C
