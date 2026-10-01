# คู่มือเปิดใช้จริง naka-ai

ลำดับจากบนลงล่าง ทำครบแต่ละขั้นก่อนไปขั้นถัดไป คำสั่งทั้งหมดรันในโฟลเดอร์ `naka-ai`
เครื่องหมาย 🔑 = ค่าที่ต้องเก็บเป็นความลับ ห้ามใส่ในไฟล์ที่ commit

## 0. ก่อนเริ่ม

- [ ] ล็อกอิน Cloudflare: `npx wrangler login`
- [ ] สำรองฐานข้อมูลจริง: `npx wrangler d1 export naka-ai-db --remote --output backup-before-launch.sql`
- [ ] โค้ดที่จะ deploy คือ branch `main` และ CI บน GitHub ต้องขึ้นเครื่องหมายถูกเขียว

## 1. บริการภายนอก (ใช้เวลารออนุมัติ เริ่มก่อน)

### Meta (Facebook + Instagram) — โพสต์อัตโนมัติ + AI Inbox
- [ ] สร้างแอปที่ developers.facebook.com แบบ Business
- [ ] เพิ่ม Facebook Login for Business: Valid OAuth Redirect URI = `https://naka-ai.com/api/social/meta/callback`
- [ ] เพิ่ม Webhooks:
  - Page: Callback URL `https://naka-ai.com/webhook/meta`, Verify token = ค่าเดียวกับ `META_WEBHOOK_VERIFY_TOKEN` 🔑, subscribe fields `feed`, `messages`
  - Instagram: Callback URL เดียวกัน, subscribe `comments`, `messages`
- [ ] ยื่น App Review ขอสิทธิ์ (ตรวจชื่อล่าสุดกับเอกสาร Meta ก่อนยื่น — รายการอยู่ที่ `SCOPES` ใน `src/social/meta.ts`):
  `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata`, `pages_manage_engagement`, `pages_messaging`,
  `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`
- [ ] ระหว่างรอ App Review ทดสอบได้ด้วยบัญชีที่เป็น admin/tester ของแอปเท่านั้น
- ได้ค่า: `META_APP_ID`, `META_APP_SECRET` 🔑

### สมัครด้วยอีเมล + รหัสผ่าน — เปิดอยู่แล้ว ไม่ต้องตั้งอะไร
- รหัสผ่านเก็บแบบ PBKDF2 · ลองผิด 5 ครั้งใน 15 นาทีต่ออีเมลจะถูกพัก · สมัครได้ 5 บัญชีต่อ IP ต่อชั่วโมง
- ยังไม่ยืนยันอีเมล · ลืมรหัสผ่าน (ปัจจุบัน): `/admin/customers/` → ลูกค้า → "ลืมรหัสผ่าน" → ได้รหัสใหม่แสดงครั้งเดียว แจ้งลูกค้าทางโทรศัพท์
- ลืมรหัสผ่านทางอีเมล: API พร้อมบน `main` แล้ว (phase 9A, migration `0013`) แต่**ยังปิด** — จะเปิดเองเมื่อตั้ง Resend ครบ
  ดูหัวข้อถัดไป (หน้าเว็บฝั่งลูกค้ามาพร้อม phase 9B ยังไม่อยู่บน `main` ตอนนี้)
- เปิด Turnstile ภายหลังเมื่อเริ่มมีบัญชีสแปม — ขั้นตอนอยู่ §7.2

### Resend — ส่งอีเมลลืมรหัสผ่าน (แผนฟรีพอสำหรับงานนี้)
ระบบจะเปิด**เองทันที**เมื่อครบทั้ง 3 ค่า: `"EMAIL_PROVIDER": "resend"` + `RESEND_API_KEY` 🔑 + `EMAIL_FROM`
ยังตั้งไม่ครบ = ยังปิด หน้าล็อกอินยังแจ้งให้โทรทีมงาน และ `GET /api/auth/config` ตอบ `passwordReset: false` — ตั้งครึ่งค่าไม่มีอะไรพัง

- [ ] สมัคร resend.com ยืนยันอีเมล (โควตาแผนฟรีตรวจที่ resend.com/pricing)
- [ ] **Domains → Add Domain** → ใส่ `naka-ai.com` → คัดลอก DNS records ที่หน้านั้นแสดง**ให้ครบทุกรายการ**
      (TXT ยืนยันความเป็นเจ้าของ + CNAME DKIM 2 รายการ และ SPF/MX ถ้ามีให้) ไปเพิ่มที่ DNS ของ Cloudflare
      — CNAME ตั้งเป็น **DNS only** (เมฆสีเทา) ห้าม proxy ผ่าน Cloudflare ไม่งั้นยืนยันโดเมนไม่ผ่าน
- [ ] กลับหน้า Resend กด **Verify** รอจนสถานะเป็น **Verified** ก่อนขั้นถัดไป (ส่งจากโดเมนที่ยังไม่ Verified ไม่ได้)
- [ ] **API Keys → Create API Key** → คัดลอกค่า (แสดงครั้งเดียว)
- [ ] ตั้งค่าบน Worker (เป็นงานของ A ตามกติกา): เพิ่ม `"EMAIL_PROVIDER": "resend"` ใน `"vars"` ของ `wrangler.jsonc`
      แล้ว `npx wrangler secret put RESEND_API_KEY` และ `npx wrangler secret put EMAIL_FROM`
- [ ] `EMAIL_FROM` ใช้รูปแบบ `naka-ai <no-reply@naka-ai.com>` — โดเมนต้องตรงกับที่ Verified ไว้ (โดเมนอื่น Resend ปฏิเสธ)
- [ ] ตามด้วย migration `0013` + deploy ตาม §4 (ทำครั้งเดียวพร้อมกัน)
- [ ] ทดสอบตาม §5 ข้อ "ลืมรหัสผ่านทางอีเมล"
- ได้ค่า: `RESEND_API_KEY` 🔑 · `EMAIL_FROM` (ไม่ลับ แต่ตั้งผ่าน `secret put` ตามแผน 9A เพื่อไม่ต้องแก้ `wrangler.jsonc` เพิ่ม)
- โค้ดฝั่งส่ง: `src/auth/email.ts` (POST https://api.resend.com/emails, plain text ภาษาไทย, หมดเวลา 10 วินาที, ไม่ตาม redirect)

### LINE Login — ล็อกอินด้วย LINE (ฟรี ลดค่า SMS)
- [ ] developers.line.biz → Provider เดิมหรือใหม่ → สร้าง channel ประเภท **LINE Login** (แยกจาก Messaging API ของบอต) App type **Web app**
- [ ] แท็บ LINE Login → Callback URL = `https://naka-ai.com/api/auth/line/callback` · เปิด channel เป็น **Published**
- ได้ค่า: `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` 🔑 (ไม่ตั้ง = ปุ่ม LINE ไม่แสดง)

### Google Cloud — ล็อกอินด้วย Google + เสียงพากย์ไทย
- [ ] OAuth consent screen (External) + OAuth Client แบบ Web: Authorized redirect URI = `https://naka-ai.com/api/auth/google/callback`
- [ ] เปิด Cloud Text-to-Speech API แล้วสร้าง API key ที่จำกัดให้ใช้ได้แค่ API นี้
- [ ] (ไม่บังคับ) ฟังเสียงไทยแล้วเลือก voice เช่น `th-TH-Standard-A` ตั้งเป็น `GOOGLE_TTS_VOICE`
- ได้ค่า: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 🔑, `GOOGLE_TTS_API_KEY` 🔑

### SMS OTP — ไม่บังคับ (`SMS_PROVIDER`; `"off"` = ล็อกอินด้วย LINE/Google เท่านั้น ฟอร์มเบอร์โทรจะไม่แสดง)

**ก. มือถือ Android ของร้าน (`android_gateway`)** — ถูกที่สุดช่วงลูกค้ายังน้อย
- [ ] ใช้มือถือ Android ที่มีซิมและแพ็กเกจ SMS เปิดเน็ตและชาร์จไฟตลอด ปิดโหมดประหยัดแบตให้แอปนี้
- [ ] ติดตั้งแอป **SMS Gateway for Android** (github.com/capcom6/android-sms-gateway หรือ Google Play) → เปิด **Cloud server** → จด username/password ที่แอปแสดง
- [ ] ลองส่งจากแอปไปเบอร์ตัวเองก่อน 1 ครั้ง
- ได้ค่า: `SMS_GATEWAY_USERNAME`, `SMS_GATEWAY_PASSWORD` 🔑 (`SMS_GATEWAY_URL` ไม่ต้องตั้ง ยกเว้นใช้ server ของตัวเอง ต้องเป็น https)
- ข้อจำกัด: ผู้รับเห็นเบอร์มือถือแทนชื่อร้าน · มือถือดับ/ไม่ได้ออนไลน์ใน 1 ชั่วโมงล่าสุด = ขอ OTP ไม่ได้ (LINE/Google ยังใช้ได้)
  · ค่ายอาจจำกัดซิมที่ส่ง SMS จำนวนมาก · ระบบรู้แค่ว่าส่งเข้าคิวของมือถือแล้ว ไม่รู้ว่าถึงผู้รับหรือไม่

**ข. ThaiBulkSMS (`thaibulksms`)** — เมื่อลูกค้าเยอะขึ้น ชื่อผู้ส่งเป็นชื่อร้าน
- [ ] สมัครบัญชี เติมเครดิต และ**จดทะเบียนชื่อผู้ส่ง (sender name)** รออนุมัติ
- ได้ค่า: `SMS_API_KEY` 🔑, `SMS_API_SECRET` 🔑, `SMS_SENDER` (ชื่อที่อนุมัติแล้ว ตรงตัวพิมพ์เล็ก/ใหญ่)

### Stripe — รับเงินค่าแพ็กเกจ (Omise ไม่รับบุคคลธรรมดาแล้ว)
- [ ] สมัครที่ stripe.com ประเทศ Thailand ประเภทธุรกิจ **Individual / sole proprietor** ยืนยันตัวตนและบัญชีธนาคาร
- [ ] Settings → Payment methods: เปิด **PromptPay** และ **Cards** (หน้าชำระเงินแสดงตามที่เปิดไว้ โค้ดไม่ได้ล็อกวิธีชำระ)
- [ ] Settings → Branding: โลโก้/สี naka-ai และ Public details: ชื่อร้าน เบอร์ อีเมล (ขึ้นบนหน้าชำระเงินและใบแจ้งยอดบัตร)
- [ ] ทดสอบใน **sandbox** ก่อน แล้วค่อยใช้ live keys
- [ ] API key: Developers → API keys → สร้าง **restricted key** (`rk_…`) ให้สิทธิ์ Checkout Sessions: **Write** เท่านั้น
- [ ] Webhooks: เพิ่ม endpoint `https://naka-ai.com/webhook/stripe` เลือก event `checkout.session.completed`,
      `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
      แล้วคัดลอก **Signing secret** (`whsec_…`)
- ได้ค่า: `STRIPE_SECRET_KEY` 🔑 (restricted key), `STRIPE_WEBHOOK_SECRET` 🔑
- รายละเอียดทั้งหมด: [STRIPE_INTEGRATION_TODO.md](../STRIPE_INTEGRATION_TODO.md)

### Cloudflare
- [ ] Turnstile: สร้าง widget, hostname = `naka-ai.com` → ได้ `TURNSTILE_SITE_KEY` (สาธารณะ) และ `TURNSTILE_SECRET_KEY` 🔑
- [ ] R2: `npx wrangler r2 bucket create naka-ai-media` (ห้ามเปิด public access)
- [ ] Redirect Rule: `www.naka-ai.com/*` → `https://naka-ai.com/${1}` (301) — ระบบล็อกอินรับเฉพาะโดเมนหลัก

## 2. ค่าที่ต้องสร้างเอง

```sh
openssl rand -base64 48   # SESSION_SECRET (ยาวอย่างน้อย 32 ตัวอักษร)
openssl rand -base64 32   # SOCIAL_TOKEN_KEY (ต้องเป็น 32 bytes พอดี) — ห้ามเปลี่ยนภายหลัง ไม่งั้นทุกร้านต้องเชื่อมเพจใหม่
openssl rand -hex 24      # META_WEBHOOK_VERIFY_TOKEN
```

## 3. ตั้งค่าบน Worker

ค่าที่ไม่ลับ ใส่ใน `wrangler.jsonc` ใต้ `"vars"`:

```jsonc
"vars": {
  "APP_ORIGIN": "https://naka-ai.com",
  "SMS_PROVIDER": "android_gateway",   // หรือ "thaibulksms"
  "TURNSTILE_SITE_KEY": "<site key>",
  "RECEIPT_SELLER_NAME": "<ชื่อผู้ขายบนใบเสร็จ ตรงกับที่จดทะเบียน>",
  "RECEIPT_SELLER_ADDRESS": "<ที่อยู่>",
  "RECEIPT_SELLER_TAX_ID": "<เลขผู้เสียภาษี 13 หลัก ไม่มีก็เว้นไว้>",
  "RECEIPT_VAT_REGISTERED": "<\"1\" ถ้าจด VAT แล้ว ไม่งั้นลบบรรทัดนี้>",
  "SIGNUP_CREDITS": "<เครดิตฟรีตอนสมัคร เช่น \"3\" ไม่แจกก็ลบบรรทัดนี้>",
  "EMAIL_PROVIDER": "resend"   // เมื่อตั้ง Resend เสร็จแล้วเท่านั้น (§1) — ก่อนหน้านั้นไม่ต้องมีบรรทัดนี้
}
```

ใบเสร็จ: ยังไม่ตั้ง `RECEIPT_SELLER_NAME` = ยังไม่ออกใบ ตั้งแล้ว cron จะออกย้อนหลังให้ทุกการชำระที่สำเร็จ
ใบที่ออกแล้วแก้ไม่ได้ (ชื่อ/ที่อยู่/VAT ถูกเก็บไว้ในใบ) **ตรวจค่าให้ถูกก่อนตั้ง**
เครดิตฟรีตอนสมัคร: แจกครั้งเดียวต่อบัญชีใหม่ ไม่ย้อนหลังให้คนที่สมัครไปก่อนตั้งค่า

ค่าลับ ตั้งทีละตัว (คำสั่งจะถามค่า ไม่เก็บในไฟล์):

```sh
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put LINE_LOGIN_CHANNEL_ID
npx wrangler secret put LINE_LOGIN_CHANNEL_SECRET
npx wrangler secret put GOOGLE_TTS_API_KEY
# SMS ทาง ก. (android_gateway)
npx wrangler secret put SMS_GATEWAY_USERNAME
npx wrangler secret put SMS_GATEWAY_PASSWORD
# หรือทาง ข. (thaibulksms)
npx wrangler secret put SMS_API_KEY
npx wrangler secret put SMS_API_SECRET
npx wrangler secret put SMS_SENDER
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN
npx wrangler secret put SOCIAL_TOKEN_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
# ลืมรหัสผ่านทางอีเมล — ตั้งเมื่อตั้ง Resend เสร็จแล้ว (§1) ตั้งครบทั้ง EMAIL_PROVIDER ใน vars ด้วยจึงจะเปิด
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
```

ค่าเดิมที่ควรมีอยู่แล้ว: `ANTHROPIC_API_KEY`, `ADMIN_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`
ตรวจ: `npx wrangler secret list`

## 4. ฐานข้อมูลและ deploy

```sh
npm run typecheck && npm test                               # ต้องผ่านทั้งหมด
npx wrangler d1 migrations apply naka-ai-db --remote        # 0001 → ล่าสุด ไม่แตะตาราง LINE เดิม
npx wrangler deploy
```

หรือ deploy จาก GitHub (หลังตั้งค่าครั้งแรก): แท็บ Actions → **Deploy** → Run workflow บน `main`
ระบบจะรัน typecheck + เทสก่อน ถ้าไม่ผ่านจะไม่ deploy แล้วจึง apply migration และ deploy ให้

- [ ] ตั้งค่าครั้งแรก: Cloudflare → My Profile → API Tokens → สร้างจาก template "Edit Cloudflare Workers" แล้วเพิ่มสิทธิ์ **D1: Edit**
- [ ] GitHub repo → Settings → Secrets and variables → Actions: เพิ่ม `CLOUDFLARE_API_TOKEN` 🔑 และ `CLOUDFLARE_ACCOUNT_ID`
- [ ] (แนะนำ) Settings → Environments → `production` → Required reviewers = ตัวเอง จะได้ต้องกดยืนยันก่อน deploy ทุกครั้ง
- ย้อนฐานข้อมูลถ้า migration พัง: `npx wrangler d1 time-travel restore naka-ai-db --timestamp=<เวลาก่อน deploy>` (ย้อนได้ 30 วัน)

ทุก push และ PR จะรัน typecheck + เทสอัตโนมัติ (workflow **CI**) งานของ agent ที่ขึ้นกากบาทแดงยังไม่ต้อง merge

## 5. ทดสอบหลัง deploy (ทำเองบน naka-ai.com)

- [ ] หน้าแรกโหลด เมนู 4 ผลิตภัณฑ์ คลิปละครเล่น
- [ ] `/login/` (เมื่อเปิด Turnstile + SMS แล้ว — ปัจจุบัน `SMS_PROVIDER` เป็น `off` ข้ามข้อนี้ได้): มีกล่องยืนยัน → ขอ OTP ด้วยเบอร์ตัวเอง → ได้ SMS → เข้า `/app/` ได้
- [ ] สมัครด้วยอีเมล + รหัสผ่าน → เข้า `/app/` ได้ · ออกจากระบบแล้วเข้าใหม่ได้ · รหัสผิดขึ้นข้อความเตือน
- [ ] ลืมรหัสผ่านทางอีเมล (เมื่อเปิด Resend + UI phase 9B บน main แล้ว): `/login/` → ลืมรหัสผ่าน → กรอกอีเมลตัวเอง
      → ได้อีเมลภายใน ~1 นาที → ลิงก์ตั้งรหัสใหม่ → ล็อกอินด้วยรหัสใหม่ได้ · ล็อกอินด้วยรหัสเก่าไม่ได้แล้ว
      · กรอกอีเมลที่ไม่มีในระบบ → หน้าเว็บแสดงข้อความเดียวกัน (ไม่เปิดเผยว่ามีบัญชีหรือไม่)
- [ ] ล็อกอินด้วย Google ได้
- [ ] ล็อกอินด้วย LINE ได้ ครั้งที่สองได้บัญชีเดิม
- [ ] แอดมินเติมเครดิตทดสอบ: `curl -X POST https://naka-ai.com/api/admin/credits/<user-id> -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"amount":5,"note":"ทดสอบ"}'`
- [ ] `/review/` สร้างคลิปรีวิวจริง 1 คลิป (ใช้ 1 เครดิต) → ได้บท + เสียงไทย → สร้างวิดีโอ → ดาวน์โหลด
- [ ] `/app/inbox/` → เชื่อมเพจ Facebook → คอมเมนต์ใต้โพสต์เพจด้วยอีกบัญชี → ข้อความขึ้นใน inbox ภายใน 1–2 นาที
- [ ] ตั้งบอทเป็น "ร่างรออนุมัติ" → ได้ draft → กดส่ง → คำตอบขึ้นบน Facebook
- [ ] `/app/billing/` (sandbox keys) → เลือกแพ็กเกจเริ่มต้น → ไปหน้า Stripe → บัตร `4242 4242 4242 4242` → กลับมา แพ็กเกจเปิด เครดิตขึ้น 30
- [ ] บัตรที่ต้องผ่าน 3-D Secure `4000 0025 0000 3155` และบัตรถูกปฏิเสธ `4000 0000 0000 0002` → ผลตรงตามจริง
- [ ] PromptPay ใน sandbox → หน้า Stripe มีปุ่มจำลองว่าจ่ายสำเร็จ/ล้มเหลว → แพ็กเกจเปิดเมื่อสำเร็จเท่านั้น
- [ ] Stripe Dashboard → Webhooks → endpoint แสดงว่าส่งสำเร็จ (204)
- [ ] สมัครด้วยเบอร์ที่ไม่เคยใช้ → การ์ดต้อนรับบน `/app/` บอกเครดิตฟรีตาม `SIGNUP_CREDITS` → ล็อกอินซ้ำเครดิตไม่เพิ่ม
- [ ] หลังจ่ายสำเร็จ ใบเสร็จขึ้นใน `/app/billing/` (ต้องตั้ง `RECEIPT_SELLER_NAME` แล้ว) เปิดดูและพิมพ์ได้
- [ ] `/admin/customers/` → กรอก token → ค้นเบอร์ตัวเอง → เติมเครดิต 1 → ยอดใน `/app/` ขึ้นตาม
- [ ] ดู log: `npx wrangler tail`

## 6. แพ็กเกจลูกค้า

ลูกค้าซื้อเองได้ที่ `/app/billing/` (PromptPay/บัตร ผ่าน Stripe) ระบบเปิดแพ็กเกจ เติมเครดิตรายเดือน และหมดอายุให้อัตโนมัติ
ถ้าลูกค้าโอนเงินนอกระบบ หรือต้องเติมเครดิต/ระงับบัญชี ใช้หน้า **`https://naka-ai.com/admin/customers/`**
(กรอก `ADMIN_TOKEN` ครั้งเดียว ปิดแท็บแล้วต้องกรอกใหม่): ค้นด้วยเบอร์ `08…` อีเมล หรือชื่อ → เปิดรายละเอียด →
เติมเครดิต / เปิดหรือต่อแพ็กเกจ 1–12 เดือน / ระงับหรือเปิดบัญชี ทุกฟอร์มต้องใส่เหตุผลและกดยืนยัน ทุกการกระทำมีบันทึกในหน้าลูกค้า
การเปิดแพ็กเกจจากหน้านี้ไม่ออกใบเสร็จ (ไม่มีการชำระผ่านระบบ)

## 7. เปิดฟีเจอร์ถัดไป: สร้างคลิปรีวิว (/review/) และ Turnstile

### 7.1 ฟีเจอร์สร้างคลิปรีวิว — โค้ดพร้อมบน `main` แล้ว เปิดให้ลูกค้าใช้จริงต้องมีครบข้อนี้

ระบบเดินแบบนี้: ลูกค้ากรอกข้อมูลสินค้า + รูป (รูปไม่ออกจากเครื่องลูกค้า) → งานเข้าคิว ตัดเครดิตทันที →
cron ทุกนาทีหยิบงานมาให้ Claude เขียนบท + Google TTS ทำเสียงพากย์ไทย → เบราว์เซอร์ของลูกค้าเรนเดอร์วิดีโอ 9:16 → ดาวน์โหลด
งานล้มเหลวระบบคืนเครดิตให้เอง (โค้ดทำแล้ว) หน้า landing มีปุ่ม "ลองฟรี" (`/review/?demo=1` ไม่เสียเครดิต) อยู่แล้ว
สร้างจริงต้องล็อกอินและมีเครดิต รายการงานเก่าดูที่แดชบอร์ด `/app/` (ส่วนผลงาน, `GET /api/works`)

- [ ] `ANTHROPIC_API_KEY` ตั้งอยู่แล้ว — ตรวจด้วย `npx wrangler secret list` (ขาด = งานทุกงาน fail)
- [ ] `GOOGLE_TTS_API_KEY` 🔑 ตั้งแล้ว และเปิด Cloud Text-to-Speech API แล้ว (ขั้นตอนใน §1) — ขาด = งาน fail ตอนทำเสียง
- [ ] ตัดสินใจราคาต่อคลิป: โค้ดล็อกไว้ที่ `REVIEW_COST_CREDITS = 1` เครดิต ใน `src/affiliate.ts` (ค่าชั่วคราว)
      ก่อนขึ้นราคาจริงให้แก้ค่านี้ในโค้ด (merge ผ่าน A) ไม่มีการตั้งผ่านหน้าเว็บ
- [ ] ลูกค้าต้องมีทางได้เครดิตอย่างน้อย 1 ทางก่อนเปิดใช้: ตั้ง `SIGNUP_CREDITS` (§3) / เปิดขายแพ็กเกจผ่าน Stripe
      ([STRIPE_INTEGRATION_TODO.md](../STRIPE_INTEGRATION_TODO.md)) / เติมให้เองที่ `/admin/customers/` (§6)
      — ปัจจุบันทั้งสามทางยังไม่เปิด ลูกค้าใหม่จึงสร้างคลิปจริงไม่ได้แม้โค้ดพร้อม
- [ ] ไม่ต้องตั้ง R2: วิดีโอเรนเดอร์ในเบราว์เซอร์ของลูกค้า R2 (`naka-ai-media`) ใช้เฉพาะตอนเปิดโพสต์อัตโนมัติลงโซเชียล
- [ ] deploy แล้วทดสอบตาม §5 ข้อ `/review/` และลองให้งานพังจงใจ 1 งาน เพื่อยืนยันว่าเครดิตถูกคืน

### 7.2 Turnstile — ปิดอยู่ตอนนี้ เปิดอย่างไรไม่ให้พังหน้าอื่น

ฝั่งเซิร์ฟเวอร์ตรวจ token เฉพาะเมื่อ `TURNSTILE_SECRET_KEY` ถูกตั้ง และหน้าเว็บแสดง widget เฉพาะเมื่อ
`TURNSTILE_SITE_KEY` ถูกตั้ง (ส่งผ่าน `GET /api/auth/config`) → **ตั้งทั้งคู่แล้ว deploy พร้อมกันในรอบเดียว**
ปัจจุบันทั้งสองค่ายังไม่ตั้ง: `/login/` ยังไม่โหลด Turnstile และ endpoint ทุกตัวยังไม่ขอ token

- [ ] Cloudflare Dashboard → Turnstile → **Add widget**: hostname `naka-ai.com` (อยากทดสอบบนเครื่องเพิ่ม `localhost`),
      widget mode **Managed** → ได้ **Site Key** (ค่าสาธารณะ) และ **Secret Key** 🔑
- [ ] (A) เพิ่ม `"TURNSTILE_SITE_KEY": "<site key>"` ใน `"vars"` ของ `wrangler.jsonc`
- [ ] `npx wrangler secret put TURNSTILE_SECRET_KEY`
- [ ] deploy แล้วตรวจ: `/login/` มีกล่องยืนยันแสดงขึ้น → ล็อกอินทุกช่องทางยังผ่าน → `npx wrangler tail` ไม่มี 400 จาก siteverify
- [ ] ระวัง: เมื่อเปิดแล้ว การขอ OTP (`/api/auth/otp` ใช้เมื่อเปิด SMS) จะ**บังคับ** token บน https ทันที
      ปัจจุบัน `SMS_PROVIDER: "off"` จึงไม่กระทบใด ๆ และฟอร์มลืมรหัสผ่าน/ตั้งรหัสใหม่ (phase 9B) จะส่ง token ให้เองเมื่อ widget แสดง

## สิ่งที่ยังไม่มี (ไม่ขวางการเปิดใช้)

- ใบกำกับภาษีเต็มรูป (ต้องเก็บข้อมูลผู้ซื้อ ตอนนี้ออกด้วยมือ), ส่งใบเสร็จทางอีเมล, ใบลดหนี้
- ราคาเครดิตของละคร/AI Live (ขึ้นกับต้นทุน Wan)
- TikTok (รอ audit), Shopee (ไม่มี API วิดีโอ)
