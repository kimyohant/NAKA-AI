# Launch checklist — สิ่งที่ยังไม่เปิดใช้ และวิธีเปิด

สรุปจากโค้ดจริง ณ `main` @ `7077b11` (2026-09-30) — ทุกตัวแปรยืนยันจาก `src/types.ts` และตรรกะจากไฟล์ที่อ้าง
ขั้นตอนละเอียดอยู่ใน [docs/DEPLOY.md](DEPLOY.md) หัวข้อที่อ้างในแต่ละข้อ — หน้านี้เป็นดัชนีสั้นๆ ไม่ซ้ำเนื้อหา

กติกา (docs/phase1-tasks.md): แก้ `wrangler.jsonc`/`migrations/` และ deploy = **A เท่านั้น** · ค่าลับตั้งด้วย
`npx wrangler secret put` เท่านั้น ห้ามขอ/ส่งทางแชต

ตรวจก่อนเสมอ:

```sh
npx wrangler secret list        # ดูว่าค่าลับตัวไหนยังไม่มี
npx wrangler tail               # ดู log จริงหลังเปิดแต่ละอย่าง
```

---

## 1. SIGNUP_CREDITS — เครดิตฟรีตอนสมัคร (ยังไม่เปิด)

- **ทำอะไร:** บัญชีใหม่ได้เครดิตฟรีตามจำนวนทันที + การ์ดต้อนรับบน `/app/` (`GET /api/onboarding` — wired แล้วใน `src/index.ts`)
- **ไฟล์/ตัวแปร:** `src/onboarding/signup.ts` (ไม่ตั้ง/ไม่ใช่จำนวนเต็มบวก = ไม่แจก) · var `SIGNUP_CREDITS` ใน wrangler.jsonc (A ตั้ง) · เทส `tests/onboarding.test.cjs`
- **ค่าใช้จ่าย:** ไม่มีค่าบริการภายนอก — แต่เครดิตที่แจกคือต้นทุนเมื่อลูกค้าใช้สร้างงาน (ต้องเปิดข้อ 2 ก่อน จึงใช้ได้จริง)
- **เปิดยังไง:** A เพิ่ม `"SIGNUP_CREDITS": "3"` ใน vars → deploy → ทดสอบสมัครใหม่ได้เครดิตตามจำนวน ล็อกอินซ้ำไม่เพิ่ม (DEPLOY §5 มีรายการตรวจ) · แจกครั้งเดียวต่อบัญชี ไม่ย้อนหลังให้บัญชีเดิม

## 2. การสร้างคลิป — Anthropic + Google TTS (ใช้งานจริงต้องมี)

- **ทำอะไร:** สคริปต์/ร่างข้อความ/คอนเทนต์ (Anthropic Claude) และเสียงพากย์ไทย (Google Cloud Text-to-Speech) ของ `/review/`, `/studio/`, ร่าง Inbox
- **ไฟล์/ตัวแปร:** `ANTHROPIC_API_KEY` 🔑 (ตั้งแต่ยุคบอท LINE — DEPLOY §3 บอกว่าควรมีอยู่แล้ว ให้ตรวจด้วย secret list) · `GOOGLE_TTS_API_KEY` 🔑 + `GOOGLE_TTS_VOICE` (ไม่บังคับ เช่น `th-TH-Standard-A`) · ใช้ใน `src/agent.ts`, `src/affiliate.ts`, `src/studio.ts`, `src/inbox/draft.ts`
- **ค่าใช้จ่าย:** มี — Anthropic คิดตามการใช้งาน (pay-as-you-go) · Google TTS มีโควตาฟรีรายเดือนแล้วคิดตามตัวอักษร (ตรวจแผนปัจจุบันที่ cloud.google.com/text-to-speech/pricing)
- **เปิดยังไง:** ขาดตัวไหน `npx wrangler secret put <ชื่อ>` → ทดสอบสร้างคลิปรีวิวจริง 1 คลิป (DEPLOY §5 มีรายการ) → ดู `npx wrangler tail` หา error

## 3. Turnstile — กันบอทก่อนขอ OTP/สมัคร/ลืมรหัสผ่าน (ฟรี · ยังไม่เปิด)

- **ทำอะไร:** ฟอร์มบน `/login/` จะให้ยืนยัน "ไม่ใช่บอท" ก่อน (OTP, สมัครด้วยอีเมล, ลืมรหัสผ่าน) — จนกว่าจะเปิด ระบบพึ่ง rate limit อย่างเดียว
- **ไฟล์/ตัวแปร:** `TURNSTILE_SITE_KEY` (var สาธารณะ — `/api/auth/config` ส่งให้หน้าเว็บ) + `TURNSTILE_SECRET_KEY` 🔑 · `src/auth/turnstile.ts`, `public/login/login.js`
- **ค่าใช้จ่าย:** ไม่มี (Cloudflare Turnstile ฟรี)
- **เปิดยังไง:** สร้าง widget ใน Cloudflare dashboard hostname `naka-ai.com` (DEPLOY §1 Cloudflare) → ตั้งสองค่า → deploy · ผลข้างเคียง: ผู้ใช้ต้องกดยืนยันก่อนทุกครั้ง — แนะนำเปิดเมื่อเริ่มมีบัญชีสแปม (ปิด/เปิดย้อนกลับได้)

## 4. R2/MEDIA — คลิปรอโพสต์ + อัปโหลดเข้า Inbox (ยังไม่เปิด)

- **สถานะ:** wrangler.jsonc ยัง comment บรรทัด `r2_buckets` ไว้ (เปิดตัวโดยไม่มี R2) — `MEDIA` ไม่มี = อัปโหลดคลิปตอบ **503** (`src/social/media.ts`) และโพสต์อัตโนมัติปิด
- **ไฟล์/ตัวแปร:** `"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "naka-ai-media" }]` · `src/social/media.ts`, `src/social/posts.ts`, `src/inbox/`
- **ค่าใช้จ่าย:** R2 มีระดับฟรี แล้วคิดตามพื้นที่เก็บและการเรียกใช้ (ตรวจแผนที่ cloudflare.com/plans)
- **เปิดยังไง:** เปิด R2 ใน Cloudflare dashboard → `npx wrangler r2 bucket create naka-ai-media` → **A** restore บรรทัด `r2_buckets` ใน wrangler.jsonc → deploy (DEPLOY §1 Cloudflare)
- **ข้อแม้:** โพสต์ลงเพจจริงต้องเชื่อม Meta ก่อน (DEPLOY §1 Meta) และเก็บ token เพจด้วย `SOCIAL_TOKEN_KEY` 🔑 (DEPLOY §2)

## 5. SMS OTP — เลือก provider (ยังไม่ตัดสิน)

- **ทำอะไร:** ล็อกอินด้วยเบอร์โทร (OTP 6 หลัก) — ไม่เปิดก็ยังล็อกอินด้วย LINE/Google/อีเมลได้
- **ตัวเลือก + ค่าใช้จ่าย:**
  - `"off"` — ปิดฟีเจอร์ (ฟอร์มเบอร์โทรซ่อน) ฟรี
  - `"android_gateway"` — ฟรี ใช้มือถือ Android ของร้าน + ซิมร้าน (ต้องเปิดแอป+เน็ตตลอด, ผู้รับเห็นเบอร์, ค่ายอาจจำกัดซิมยิงเยอะ) — env: `SMS_GATEWAY_USERNAME`/`SMS_GATEWAY_PASSWORD` 🔑 (`SMS_GATEWAY_URL` ไม่บังคับ)
  - `"thaibulksms"` — มีค่าใช้จ่ายต่อข้อความ + ต้องจดทะเบียนชื่อผู้ส่ง — env: `SMS_API_KEY`/`SMS_API_SECRET` 🔑/`SMS_SENDER`
- **ไฟล์/ตัวแปร:** `SMS_PROVIDER` (var) + secrets ตาม provider · `src/auth/sms.ts` (มี 3 provider: mock/thaibulksms/android_gateway)
- **เปิดยังไง:** ตาม DEPLOY §1 "SMS OTP" (ทาง ก./ข. ครบ) + §3 → ทดสอบขอ OTP ด้วยเบอร์ตัวเอง (DEPLOY §5)

## 6. LINE Login — ปุ่มล็อกอินด้วย LINE (ฟรี · ยังไม่เปิด)

- **ทำอะไร:** ปุ่ม "เข้าสู่ระบบด้วย LINE" บนหน้า login — ช่องทางล็อกอินเพิ่มที่ไม่ใช้ SMS
- **ไฟล์/ตัวแปร:** `LINE_LOGIN_CHANNEL_ID` + `LINE_LOGIN_CHANNEL_SECRET` 🔑 (channel ประเภท LINE Login แยกจากบอท) · `src/auth/line.ts`, flag `lineLogin` ใน `/api/auth/config` (`src/auth/index.ts`) — ไม่ตั้ง = ปุ่มไม่แสดง
- **ค่าใช้จ่าย:** ไม่มี
- **เปิดยังไง:** สร้าง channel (DEPLOY §1 LINE Login) → secrets → deploy → ทดสอบล็อกอินสองครั้งได้บัญชีเดิม (DEPLOY §5)

## 7. ลืมรหัสผ่านทางอีเมล — Resend (API พร้อมบน main · ยังไม่เปิดใช้)

- **ทำอะไร:** ลูกค้ากดรับลิงก์ตั้งรหัสใหม่ทางอีเมลจากหน้า login ทำเองได้ ไม่ต้องโทรแอดมิน (หน้า `/login/reset/`)
- **ไฟล์/ตัวแปร:** `EMAIL_PROVIDER=resend` + `EMAIL_FROM` (vars) · `RESEND_API_KEY` 🔑 · migration `0013_password_reset.sql` (remote D1) · หน้า login ปุ่มลืมรหัสผ่าน + `/login/reset/` (`public/login/`)
- **ค่าใช้จ่าย:** Resend มีแผนฟรีตามจำนวนฉบับ/เดือน แล้วคิดเพิ่ม (resend.com/pricing) · **ต้องยืนยันโดเมนผู้ส่ง (DNS SPF/DKIM) ก่อน**
- **เปิดยังไง:** ตาม [docs/DEPLOY.md](DEPLOY.md) หัวข้อ "ลืมรหัสผ่านทางอีเมล — Resend" (ขั้นตอนครบ + ลิงก์เอกสาร Resend ที่ตรวจแล้ว 2026-09-30)

---

## ลำดับที่แนะนำ

1. **ข้อ 2** (คลิป) ก่อน — เป็นหัวใจของบริการ และทำให้เครดิตที่ข้อ 1 แจกไปใช้ได้จริง
2. **ข้อ 1** (เครดิตฟรี) ตามด้วย **ข้อ 5/6** (ช่องทางล็อกอินเพิ่ม)
3. **ข้อ 7** (ลืมรหัสผ่าน) เมื่อพร้อมยืนยันโดเมนกับ Resend
4. **ข้อ 3** (Turnstile) เมื่อเริ่มมีสแปม · **ข้อ 4** + Meta connect เมื่อจะเปิดโพสต์อัตโนมัติ (รวม `SOCIAL_TOKEN_KEY` ตาม DEPLOY §2)
