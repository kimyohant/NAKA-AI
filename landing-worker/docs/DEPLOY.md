# คู่มือเปิดใช้จริง naka-ai

ลำดับจากบนลงล่าง ทำครบแต่ละขั้นก่อนไปขั้นถัดไป คำสั่งทั้งหมดรันในโฟลเดอร์ `naka-ai`
เครื่องหมาย 🔑 = ค่าที่ต้องเก็บเป็นความลับ ห้ามใส่ในไฟล์ที่ commit

## 0. ก่อนเริ่ม

- [ ] ล็อกอิน Cloudflare: `npx wrangler login`
- [ ] สำรองฐานข้อมูลจริง: `npx wrangler d1 export naka-ai-db --remote --output backup-before-phase1.sql`
- [ ] โค้ดที่จะ deploy คือ branch `integrate/phase1` (merge เข้า `main` ก่อน)

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

### Google Cloud — ล็อกอินด้วย Google + เสียงพากย์ไทย
- [ ] OAuth consent screen (External) + OAuth Client แบบ Web: Authorized redirect URI = `https://naka-ai.com/api/auth/google/callback`
- [ ] เปิด Cloud Text-to-Speech API แล้วสร้าง API key ที่จำกัดให้ใช้ได้แค่ API นี้
- [ ] (ไม่บังคับ) ฟังเสียงไทยแล้วเลือก voice เช่น `th-TH-Standard-A` ตั้งเป็น `GOOGLE_TTS_VOICE`
- ได้ค่า: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 🔑, `GOOGLE_TTS_API_KEY` 🔑

### ThaiBulkSMS — OTP ทางเบอร์โทร
- [ ] สมัครบัญชี เติมเครดิต และ**จดทะเบียนชื่อผู้ส่ง (sender name)** รออนุมัติ
- ได้ค่า: `SMS_API_KEY` 🔑, `SMS_API_SECRET` 🔑, `SMS_SENDER` (ชื่อที่อนุมัติแล้ว ตรงตัวพิมพ์เล็ก/ใหญ่)

### Omise (Opn Payments) — รับเงินค่าแพ็กเกจ
- [ ] สมัครบัญชีร้านค้าที่ omise.co ยืนยันตัวตน/ธุรกิจ และเปิดใช้ **PromptPay** กับ**บัตร** (รอ Omise อนุมัติ)
- [ ] ทดสอบด้วย test keys ก่อน (`pkey_test_…` / `skey_test_…`) แล้วค่อยเปลี่ยนเป็น live keys
- [ ] Webhooks: เพิ่ม endpoint `https://naka-ai.com/webhook/omise` แล้วคัดลอก **webhook secret** (ใช้ตรวจลายเซ็น `Omise-Signature`)
- ได้ค่า: `OMISE_PUBLIC_KEY` (สาธารณะ), `OMISE_SECRET_KEY` 🔑, `OMISE_WEBHOOK_SECRET` 🔑

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
  "SMS_PROVIDER": "thaibulksms",
  "TURNSTILE_SITE_KEY": "<site key>",
  "OMISE_PUBLIC_KEY": "<pkey_…>",
  "RECEIPT_SELLER_NAME": "<ชื่อผู้ขายบนใบเสร็จ ตรงกับที่จดทะเบียน>",
  "RECEIPT_SELLER_ADDRESS": "<ที่อยู่>",
  "RECEIPT_SELLER_TAX_ID": "<เลขผู้เสียภาษี 13 หลัก ไม่มีก็เว้นไว้>",
  "RECEIPT_VAT_REGISTERED": "<\"1\" ถ้าจด VAT แล้ว ไม่งั้นลบบรรทัดนี้>"
}
```

ใบเสร็จ: ยังไม่ตั้ง `RECEIPT_SELLER_NAME` = ยังไม่ออกใบ ตั้งแล้ว cron จะออกย้อนหลังให้ทุกการชำระที่สำเร็จ
ใบที่ออกแล้วแก้ไม่ได้ (ชื่อ/ที่อยู่/VAT ถูกเก็บไว้ในใบ) **ตรวจค่าให้ถูกก่อนตั้ง**

ค่าลับ ตั้งทีละตัว (คำสั่งจะถามค่า ไม่เก็บในไฟล์):

```sh
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_TTS_API_KEY
npx wrangler secret put SMS_API_KEY
npx wrangler secret put SMS_API_SECRET
npx wrangler secret put SMS_SENDER
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN
npx wrangler secret put SOCIAL_TOKEN_KEY
npx wrangler secret put OMISE_SECRET_KEY
npx wrangler secret put OMISE_WEBHOOK_SECRET
```

ค่าเดิมที่ควรมีอยู่แล้ว: `ANTHROPIC_API_KEY`, `ADMIN_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`
ตรวจ: `npx wrangler secret list`

## 4. ฐานข้อมูลและ deploy

```sh
npm run typecheck && npm test                               # ต้องผ่านทั้งหมด
npx wrangler d1 migrations apply naka-ai-db --remote        # 0001 → 0007 ไม่แตะตาราง LINE เดิม
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
- [ ] `/login/` มี Turnstile → ขอ OTP ด้วยเบอร์ตัวเอง → ได้ SMS → เข้า `/app/` ได้
- [ ] ล็อกอินด้วย Google ได้
- [ ] แอดมินเติมเครดิตทดสอบ: `curl -X POST https://naka-ai.com/api/admin/credits/<user-id> -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"amount":5,"note":"ทดสอบ"}'`
- [ ] `/review/` สร้างคลิปรีวิวจริง 1 คลิป (ใช้ 1 เครดิต) → ได้บท + เสียงไทย → สร้างวิดีโอ → ดาวน์โหลด
- [ ] `/app/inbox/` → เชื่อมเพจ Facebook → คอมเมนต์ใต้โพสต์เพจด้วยอีกบัญชี → ข้อความขึ้นใน inbox ภายใน 1–2 นาที
- [ ] ตั้งบอทเป็น "ร่างรออนุมัติ" → ได้ draft → กดส่ง → คำตอบขึ้นบน Facebook
- [ ] `/app/billing/` (test keys) → เลือกแพ็กเกจเริ่มต้น → PromptPay ได้ QR → ใน Omise dashboard กด mark as paid → หน้าแจ้งสำเร็จ แพ็กเกจเปิด เครดิตขึ้น 30
- [ ] จ่ายด้วยบัตรทดสอบของ Omise (รวมบัตรที่ต้องผ่าน 3-D Secure) → กลับมาที่ `/app/billing/?payment=…` แล้วสำเร็จ
- [ ] ดู log: `npx wrangler tail`

## 6. แพ็กเกจลูกค้า

ลูกค้าซื้อเองได้ที่ `/app/billing/` (PromptPay/บัตร ผ่าน Omise) ระบบเปิดแพ็กเกจ เติมเครดิตรายเดือน และหมดอายุให้อัตโนมัติ
ถ้าลูกค้าโอนเงินนอกระบบ แอดมินตั้งแพ็กเกจด้วยมือได้ด้วย SQL:

```sh
# หา user id จากเบอร์ (เก็บเป็น +66…) หรือ Google (ใช้อีเมล)
npx wrangler d1 execute naka-ai-db --remote --command "SELECT user_id, provider, provider_uid, email FROM auth_identities WHERE provider_uid = '+66812345678' OR email = 'shop@example.com'"

npx wrangler d1 execute naka-ai-db --remote --command "INSERT OR REPLACE INTO subscriptions (user_id, plan_id) VALUES ('<user-id>', 'pro')"
```

แล้วเติมเครดิตตามแพ็กเกจด้วย `/api/admin/credits` (ข้อ 5) · plan id: `starter`, `pro`, `business`, `max`

## สิ่งที่ยังไม่มี (ไม่ขวางการเปิดใช้)

- ใบกำกับภาษีเต็มรูป (ต้องเก็บข้อมูลผู้ซื้อ ตอนนี้ออกด้วยมือ), ส่งใบเสร็จทางอีเมล, ใบลดหนี้
- เครดิตฟรีตอนสมัคร
- ราคาเครดิตของละคร/AI Live (ขึ้นกับต้นทุน Wan)
- TikTok (รอ audit), Shopee (ไม่มี API วิดีโอ)
