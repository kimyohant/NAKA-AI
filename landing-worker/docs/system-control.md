# ระบบตั้งค่าหลังร้าน — `/admin/system/`

หน้าเดียวคุมทั้งระบบ: เปิด/ปิดฟีเจอร์ ใส่ API key ค่าทั่วไป และแพ็กเกจ/ราคา
มีผลภายใน ~10 วินาทีโดยไม่ต้อง deploy · ทุกการแก้ถูกบันทึกในแท็บ "ประวัติการแก้" (ตาราง `system_audit`)

## การเข้าหลังร้าน (`/admin/`, `/admin/customers/`, `/admin/system/`)

- **เข้าด้วย Google** — บัญชีที่อีเมล (Google ยืนยันแล้ว) อยู่ใน `ADMIN_EMAILS` เท่านั้น · บัญชีอีเมล+รหัสผ่านที่อีเมลตรงกันไม่นับ
- ต้องเข้าใหม่ทุก **12 ชั่วโมง** (เซสชันลูกค้ายังอยู่ได้ 30 วันตามเดิม)
- การแก้ไขผ่านเซสชันต้องมาจากหน้าเว็บของเราเอง (ตรวจ `Origin`) · ประวัติทุกหน้าบันทึกว่า **ใครแก้** (`system_audit.actor`, `admin_audit.actor`)
- **โทเคนฉุกเฉิน** `ADMIN_TOKEN` ยังใช้ได้ (ซ่อนอยู่ใต้ "เข้าด้วยโทเคนฉุกเฉิน") สำหรับตอน Google ใช้ไม่ได้ — เช่นปิดสวิตช์ "ล็อกอินด้วย Google" ในหน้านี้
- โค้ด: `src/admin/auth.ts` · เทสต์: `tests/admin-auth.test.cjs`

## ทำงานอย่างไร

- ค่าที่ตั้งจากหน้านี้เก็บใน D1 ตาราง `system_settings` · API key เข้ารหัส AES-GCM ด้วย `SETTINGS_KEY` (ผูกกับชื่อค่า) เก็บแค่ 4 ตัวท้ายไว้ให้จำได้ หน้าเว็บไม่เคยได้รับค่าเต็มกลับไป
- ทุก request และ cron เรียก `withSettings(env)` (`src/system/store.ts`): **ค่าจากหน้านี้ → ค่าใน wrangler vars/secrets → ค่าเริ่มต้นของสวิตช์** โค้ดเดิมทุกโมดูลอ่าน `env.X` เหมือนเดิม
- ถ้าตารางอ่านไม่ได้หรือถอดรหัสไม่ได้ ระบบใช้ค่าใน wrangler ต่อ (เว็บไม่ล่ม)
- ค่าที่แก้ได้มีแค่ที่อยู่ใน `src/system/registry.ts` · ค่าหลักที่ **ยังต้องแก้ด้วย wrangler**: `ADMIN_TOKEN`, `SETTINGS_KEY`, `SESSION_SECRET`, `SOCIAL_TOKEN_KEY`, `APP_ORIGIN`, binding `DB`/`MEDIA`

## สวิตช์ฟีเจอร์

| สวิตช์ | ปิดแล้ว |
|---|---|
| โหมดปิดปรับปรุง (ค่าเริ่มต้นปิด) | API ของลูกค้าตอบ 503 · หลังร้าน, `/api/health`, `/api/auth/config`, webhook ยังทำงาน |
| ชำระเงินออนไลน์ | เริ่มจ่ายใหม่ไม่ได้ · webhook ของรายการที่จ่ายแล้วยังทำงาน |
| สร้างคลิปรีวิว | ส่งงานใหม่ไม่ได้ · งานในคิวทำต่อ |
| โพสต์โซเชียล | หยุด cron โพสต์ + ปิด `/api/social` (ยกเว้นลิงก์ media ที่ส่งไปแล้ว) |
| AI Inbox | หยุด cron ตอบแชต + ปิด `/api/inbox` · webhook ยังเก็บข้อความ |
| บอท LINE OA | รับ webhook แต่ไม่ตอบ |
| ล็อกอิน Google / LINE · Turnstile | ซ่อนค่า config → ปุ่มหาย/ไม่ตรวจบอท |

ล็อกอินด้วยเบอร์โทร = ค่า `SMS_PROVIDER` · ลืมรหัสผ่านทางอีเมล = `EMAIL_PROVIDER` · เครดิตฟรี = `SIGNUP_CREDITS` (แท็บ API / ค่าทั่วไป)

## แพ็กเกจ

แก้ชื่อ ราคา เครดิต/เดือน งานพร้อมกัน และ "เปิดขาย" · ราคาใหม่มีผลกับการซื้อครั้งถัดไป · หยุดขาย = หายจากหน้าราคา (`/api/plans`) และหน้าชำระเงิน แต่สมาชิกเดิมใช้ต่อ · แพ็กเกจ `free` ราคา 0 เสมอ
หน้าแรกดึงราคาจาก `/api/plans` (ตัวเลขใน `index.html` เป็นค่าสำรองถ้าโหลดไม่ได้)

## เปิดใช้ครั้งแรก (ทำตามลำดับ)

0. **A** ใส่อีเมล Google ของผู้ดูแลใน `wrangler.jsonc` → `vars.ADMIN_EMAILS` (คั่นด้วยจุลภาค)
1. **เจ้าของ** สร้างกุญแจเข้ารหัส (ครั้งเดียว เก็บไว้ ถ้าหายต้องใส่ API key ใหม่หมด):
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put SETTINGS_KEY
   ```
2. **เจ้าของ** สำรอง D1 แล้วรัน migration 0014–0015 (**ต้องก่อน deploy** — โค้ดใหม่อ่าน `plans.on_sale` และเขียน `admin_audit.actor`):
   ```
   npx wrangler d1 export naka-ai-db --remote --output backups/backup-before-0014.sql
   npx wrangler d1 migrations apply naka-ai-db --remote
   ```
3. **A** deploy (`npx wrangler deploy`)
4. เปิด `https://naka-ai.com/admin/system/` → เข้าด้วย Google → แท็บ "API และการเชื่อมต่อ" → **ย้ายค่าเข้าระบบ** (คัดลอก vars/secrets ที่มีอยู่เข้ามา ค่าที่ตั้งจากหน้าแล้วไม่ถูกทับ)
5. (ไม่บังคับ) ลบ secret เดิมใน Cloudflare ได้เมื่อเห็นว่าหน้าแสดง "ตั้งจากหน้านี้" ครบ: `npx wrangler secret delete <ชื่อ>` · vars ใน `wrangler.jsonc` จะถูกใช้เป็นค่าสำรองต่อ

ทดสอบ: `node --test tests/system-control.test.cjs tests/admin-auth.test.cjs`
