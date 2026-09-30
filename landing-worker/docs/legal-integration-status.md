# Phase 6B — สถานะงานหน้ากฎหมาย (Agent B / Z.AI)

Branch: `feat/legal` (แตกจาก `main` @ 812ee92) · สถานะ: **merge แล้ว** (Claude ทำส่วนที่เหลือให้ — ดูท้ายไฟล์)

## ตารางข้อมูลจากโค้ดจริง (ตรวจยืนยันทุกแถว — ห้ามเดา)

| ข้อมูล | เก็บที่ไหน | ส่งให้ใคร | ไฟล์ที่ยืนยัน |
|---|---|---|---|
| เบอร์โทร (ยืนยัน OTP) | ตาราง `auth_identities` (Cloudflare D1) | **ThaiBulkSMS** — ส่ง SMS รหัส 6 หลัก | `src/auth/otp.ts`, `src/auth/sms.ts`, `migrations/0001_auth.sql` |
| รหัส OTP | `otp_codes` เก็บเป็นแฮช HMAC หมดอายุ 5 นาที — **ไม่เก็บรหัสจริง** | ไม่ส่งออก | `src/auth/otp.ts` |
| อีเมล (ล็อกอินด้วย Google) | `auth_identities` (provider='google') | **Google** (OAuth: openid email profile) | `src/auth/google.ts` |
| cookie `naka_session` | ตาราง `sessions` เก็บเป็นแฮช SHA-256 อายุ 30 วัน — cookie จริงอยู่ที่เบราว์เซอร์ของคุณ (HttpOnly) | ไม่ส่งออก | `src/auth/session.ts` |
| ชื่อที่แสดง | `users.display_name` | ไม่ส่งออก | `src/auth/session.ts` |
| บรีฟสินค้า/ข้อความที่กรอกเพื่อสร้างงาน (ชื่อสินค้า จุดเด่น ราคา ช่องทาง โทน) | ตาราง `jobs.input`/`output` (JSON) | **Anthropic** (Claude API — เขียนสคริปต์/ร่างข้อความ) | `src/jobs.ts`, `src/studio.ts`, `src/agent.ts`, `src/affiliate.ts` |
| รูปสินค้า | ประมวลผลในเบราว์เซอร์ของคุณเป็นคลิป 9:16 (ไม่อัปโหลดรูปต้นฉบับไป AI) | ไม่ส่งออกจากอุปกรณ์ของคุณ | `src/affiliate.ts` (หัวไฟล์), `public/review/` |
| ข้อความพากย์ | ส่งข้อความ (ไม่ใช่เสียง/รูป) ไป **Google Cloud Text-to-Speech** แล้วได้ไฟล์เสียงกลับ | **Google Cloud TTS** | `src/affiliate.ts` (synthesize) |
| คลิป/สื่อรอโพสต์ | R2 bucket `naka-ai-media` (Cloudflare R2, private) | เรียกใช้ผ่าน Graph API ตอนโพสต์ | `wrangler.jsonc`, `src/social/media.ts` |
| เพจ Facebook/Instagram (ชื่อ, external id, token) | `social_accounts` — **token เข้ารหัส AES-GCM** (`token_enc`, v1) ถอดเฉพาะฝั่งเซิร์ฟเวอร์ตอนเรียก Meta | **Meta Graph API** (โพสต์, คอมเมนต์, แชต) | `src/social/crypto.ts`, `src/social/meta.ts`, `migrations/0003_social.sql` |
| ข้อความลูกค้าใน Inbox (คอมเมนต์/แชต, ร่างตอบ, สถานะ) | `inbox_threads`, `inbox_messages`, ใบเสร็จ webhook `inbox_webhook_receipts` | ส่งข้อความ/บริบทไป **Anthropic** เพื่อร่างคำตอบ · ตอบกลับผ่าน **Meta** | `src/inbox/*`, `migrations/0005_inbox.sql` |
| ความรู้ประจำร้าน (KB) + โทน | `inbox_kb`, `inbox_settings` | ส่งเป็นบริบทให้ **Anthropic** ตอนร่าง | `src/inbox/draft.ts`, `migrations/0005_inbox.sql` |
| การชำระเงิน (แพ็กเกจ, ยอด, method, omise_charge_id) | `payments` — **ไม่เก็บเลขบัตร** (บัตรถูกแปลงเป็น token `tokn_` โดย Omise.js ในเบราว์เซอร์ เราส่งต่อ token ให้ Omise เท่านั้น) | **Omise (Opn Payments)** — charge/PromptPay QR + webhook | `src/billing/omise.ts`, `src/billing/index.ts`, `migrations/0007_payments.sql` |
| ใบเสร็จ/เล่มทะเบียน | `receipts` (เลขรันนิ่งรายปี, ผูก payment_id) | ไม่ส่งออก | `src/receipts/index.ts`, `migrations/0007_payments.sql` |
| เครดิตและประวัติใช้เครดิต | `credit_ledger` (delta, reason, note) | ไม่ส่งออก | `src/credits.ts`, `migrations/0002_credits_jobs.sql` |
| แชตขายผ่าน LINE OA | `conversations`, `products`, `orders` (schema เดิม) | **LINE Messaging API** · บริบทไป **Anthropic** | `schema.sql`, `src/line.ts`, `src/agent.ts` |
| ตรวจบอทตอนขอ OTP (ถ้าเปิดใช้) | ไม่เก็บ — token ส่งตรวจกับ Cloudflare ครั้งเดียว | **Cloudflare Turnstile** | `src/auth/turnstile.ts` |
| โครงสร้างพื้นฐานทั้งหมด (Workers, D1, R2) | Cloudflare | **Cloudflare** (ตามนโยบายของ Cloudflare) | `wrangler.jsonc` |

## ช่องที่เจ้าของธุรกิจต้องกรอก (fill-me) — รายการครบ

ใช้ชื่อบริการ "NAKA-AI Tech" และโทร 089-278-8587 บนหน้าแล้ว (มีอยู่จริงในเว็บ) ส่วนต่อไปนี้**ยังไม่มีข้อมูลจริง ห้ามแต่ง**:

1. `[ชื่อผู้ประกอบการ]` — privacy §ผู้ควบคุมข้อมูล
2. `[ที่อยู่ติดต่อ]` — privacy §ผู้ควบคุมข้อมูล
3. `[เลขทะเบียนผู้ประกอบการ]` — privacy §ผู้ควบคุมข้อมูล
4. `[อีเมลติดต่อ]` — privacy §ผู้ควบคุมข้อมูล / terms / refund
5. `[เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล]` — privacy §DPO

(เทสนับช่อง `fill-me` ใน `public/legal/**` ต้องตรงกับรายการ 5 ช่องนี้)

## ทุกหน้ามี "ปรับปรุงล่าสุด: 30 กันยายน 2026"

## ผลทดสอบ

- `npm run typecheck`: ✅ (งานนี้แก้เฉพาะ HTML/CSS/เอกสาร ไม่มี TS ใหม่)
- `npm test`: ✅ (ผลอัปเดตหลังรัน — ด้านล่าง)

## ทดสอบหน้าจริง (npm run dev) — สรุปหลังรัน

## หมายเหตุสำคัญ

- **ควรให้ผู้รู้กฎหมาย/ที่ปรึกษา PDPA ตรวจหน้าเหล่านี้ก่อนเปิดใช้จริง** — ร่างจากข้อเท็จจริงในโค้ด ไม่ใช่คำแนะนำทางกฎหมาย
- ใบเสร็จและข้อมูลการชำระเงินเก็บต่อตามกฎหมายบัญชี/ภาษี แม้ลบบัญชี (เขียนบอกตรงๆ ในหน้า data-deletion)

## Claude merge แล้ว (2026-09-30)

Z.AI ส่ง 4 หน้า + CSS + ตารางข้อมูลนี้ (ยังไม่ได้ commit) Claude ทำส่วนที่ขาดและแก้ข้อความที่ไม่ตรงกับระบบจริง:

- ลิงก์: footer หน้าแรก (ทั้ง 4 หน้า), ข้อความยอมรับใต้ฟอร์ม `/login/`, ท้าย `/app/billing/`
- `tests/legal.test.cjs`: lang/title/h1/ไม่มี noindex, ลิงก์ภายในมีจริง, ลิงก์จาก 3 หน้า, ช่อง fill-me ตรงกับรายการข้างบน
- privacy: ลบประโยค "หน้าเว็บทำงานได้โดยไม่ต้องใช้ JavaScript" (ไม่จริง) แทนด้วยการใช้ localStorage; เพิ่มแถวรูปสินค้า (อยู่บนอุปกรณ์ ไม่อัปโหลด)
- terms: แก้คำผิด "ลิ้มชัก" → "ลามกอนาจาร"
- refund: ลบข้อ "งานที่ยกเลิกเองอาจถูกนับเครดิต" — ระบบไม่มีการยกเลิกงาน
- data-deletion: ระบบส่ง OTP ยืนยันตัวตนตามคำขอไม่ได้ เปลี่ยนเป็นยืนยันด้วยเบอร์ที่ใช้สมัคร/เข้าสู่ระบบ
- ตรวจบน `npm run dev`: 4 หน้า 200, ที่ 360px ไม่ล้น, ฟอนต์เดียวกับหน้าแรก

## ข้อมูลเจ้าของที่กรอกแล้ว (2026-09-30)

ชื่อผู้ประกอบการ, ที่อยู่, เจ้าหน้าที่คุ้มครองข้อมูล (เจ้าของกิจการเอง) และเบอร์ที่สอง 099-656-7792
อีเมลติดต่อ nattapong.n8m@gmail.com · ยังเหลือ: `[เลขทะเบียนผู้ประกอบการ]`
