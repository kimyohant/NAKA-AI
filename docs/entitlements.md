# ฟีเจอร์ของสมาชิก (entitlements) — ใครใช้อะไรได้ และใช้ได้เดือนละเท่าไร

ระบบสมาชิกอยู่ที่ naka-ai.com (`apps/landing`, schema `account`) ที่เดียว: ล็อกอิน (Google + อีเมล/รหัสผ่าน), แพ็กเกจ, เครดิต
และ **ฟีเจอร์ที่ลูกค้าแต่ละคนได้รับ** สตูดิโอ (`apps/studio`) ไม่เก็บสิทธิ์เอง แต่ถามฐานข้อมูลเดียวกันทุกครั้ง (ADR-0004)

## แนวคิด

- **ฟีเจอร์** = พื้นที่ของ landing หรือเมนูของสตูดิโอ บางตัวมี **โควตารายเดือน** (นับตามเดือนเวลาไทย)
- **แพ็กเกจ** กำหนดว่ารวมฟีเจอร์ไหน และโควตาเท่าไร (ว่าง = ไม่จำกัด)
- **แอดมินตั้งรายคน** ทับค่าของแพ็กเกจได้: เปิด (พร้อมโควตาของตัวเอง) / ปิด / มีวันหมดอายุ / ต้องใส่เหตุผล — ทุกครั้งบันทึก audit
- **สวิตช์ทั้งระบบ** (`FEATURE_*` ใน `/admin/system/`) ยังปิดพื้นที่ของ landing ได้ทุกคนพร้อมกัน เหนือทุกอย่าง
- เครดิตยังคิดราคาทุกงานเหมือนเดิม โควตาแค่จำกัดจำนวนงานแพง (วิดีโอ) ต่อเดือน · ราคาเครดิตของแต่ละงาน (รวมภาพ/วิดีโอในสตูดิโอ) ตั้งได้ใน `/admin/system/` ดู `docs/credit-pricing.md`

```
ใช้ได้หรือไม่ =  บัญชี active
             และ ไม่ถูกปิดทั้งระบบ (landing)
             และ ( ค่าที่ตั้งรายคนที่ยังไม่หมดอายุ  ?? แพ็กเกจปัจจุบันรวมฟีเจอร์นี้ )
โควตา       =  โควตารายคน ?? โควตาของแพ็กเกจ   (null = ไม่จำกัด)
แพ็กเกจปัจจุบัน = subscription ที่ active และยังไม่หมดอายุ ไม่เช่นนั้น 'free'
```

## ฟีเจอร์ที่มี

| key | ใช้ที่ | ตรวจที่ | โควตา |
|---|---|---|---|
| `landing.clips` | คลิปรีวิวสินค้า | `POST /api/affiliate/reviews` | คลิป/เดือน |
| `landing.marketer` | นักการตลาด AI | ทุก route ที่ต้องล็อกอินใน `/api/marketer/*` | งาน/เดือน (`POST /tasks/*`) |
| `landing.ai_video` | วิดีโอ AI | `POST /api/marketer/videos` | วิดีโอ/เดือน |
| `landing.social` | โพสต์โซเชียลอัตโนมัติ | `/api/social/*` (ยกเว้นลิงก์สื่อที่ลงชื่อ) | — |
| `landing.inbox` | AI Inbox | `/api/inbox/*` | — |
| `studio.drama` | เมนูละครสั้น | `/api/v1/dramas` (marketer ก็ใช้) | — |
| `studio.marketer` | เมนู Marketer | `/api/v1/campaigns`, `trending-videos`, `gallery` | — |
| `studio.seller` | เมนู AI นักขาย | `/api/v1/seller` | — |
| `studio.product_studio` | เมนู Product Studio | `/api/v1/studio` (seller และ viral clone ก็ใช้) | — |
| `studio.viral_clone` | เมนู Viral Clone | `/api/v1/clone` | — |
| `studio.live` | เมนู AI Live | `/api/v1/live` | — |
| `studio.social` | เมนู Social Auto Reply (รวมตัวดึงคอมเมนต์เบื้องหลัง) | `/api/v1/social` | — |
| `studio.video` | สร้างวิดีโอ AI ในสตูดิโอ (ทุกเมนู) | `generateVideo` | วิดีโอ/เดือน |

route ที่ใช้ร่วมกันของสตูดิโอ (episodes, storyboards, tasks, upload, merge …) เปิดให้คนที่มีเมนูสตูดิโออย่างน้อย 1 เมนู
การตั้งค่าระบบ/AI config/ล็อกอิน ไม่ใช่เมนู จึงไม่ถูกตรวจ

### ค่าเริ่มต้น (ตั้งจริงที่ `/admin/system/` → แพ็กเกจและราคา → "ฟีเจอร์ในแพ็กเกจ")

ค่านี้มาจาก migration เป็น**ตัวตั้งต้น** ให้เจ้าของปรับ:

| แพ็กเกจ | ฟีเจอร์ |
|---|---|
| free | คลิป 3/เดือน, นักการตลาด 5/เดือน |
| starter | คลิป, นักการตลาด, วิดีโอ AI 10, โซเชียล, สตูดิโอ: ละคร, AI นักขาย, Product Studio, วิดีโอ 10 |
| pro | ทุกอย่างยกเว้น AI Live · วิดีโอ AI 30, สตูดิโอวิดีโอ 30 |
| business / max | ทุกอย่าง · วิดีโอ 80 / 200 |

สมาชิกเดิมได้ตามแพ็กเกจที่ถืออยู่ตอนนี้ทันที (ไม่ต้องย้ายข้อมูล)

## ที่อยู่ในโค้ด

- ตารางและกติกา: `apps/landing/migrations/pg/0003_entitlements.sql`
  - `features`, `plan_features (plan_id, feature_key, monthly_limit)`, `user_features` (ค่ารายคน), `feature_usage (user, feature, 'YYYY-MM', used)`
  - `member_features(user)` → ทุกฟีเจอร์: ใช้ได้ไหม, โควตา, ใช้ไปเท่าไร, มาจากไหน (`plan` / `override` / `none`)
  - `use_feature(user, feature, n)` → ตัดสินและนับใน statement เดียว (`ON CONFLICT … DO UPDATE … WHERE used + n <= limit`) — สองคำขอพร้อมกันเอาหน่วยสุดท้ายไปไม่ได้ทั้งคู่
  - `release_feature(user, feature, n, period)` → คืนการใช้ที่งานเริ่มไม่ได้
  - `studio_app` ได้ EXECUTE เฉพาะ 3 ฟังก์ชันนี้ (SECURITY DEFINER, search_path ตายตัว) อ่านตารางตรงไม่ได้ — ทดสอบที่ `infra/postgres/tests/entitlements.test.mjs`
- landing: `src/entitlements.ts` (`memberFeatures`, `hasFeature`, `useFeature`, `releaseFeature`, `featureRefusal`) + สวิตช์ทั้งระบบ; `/api/auth/me` คืน `features`
- หลังร้าน: `src/admin/features.ts` — หน้าลูกค้า (`POST /api/admin/customers/:id/feature`, audit ใน `admin_audit` action `feature`) และหน้าแพ็กเกจ (`PUT /api/admin/system/plans/:id/features`, audit ใน `system_audit`)
- สตูดิโอ: `backend/src/core/auth/entitlements.ts` — `entitlementGuard` (403 `E_FEATURE_DISABLED`), `useVideoQuota`/`releaseFeatureUse` ใน `generateVideo` (`E_FEATURE_QUOTA`), `/api/v1/auth/naka/me` คืน `features` ให้ sidebar ซ่อนเมนู
  - ไม่ตรวจเมื่อ: ปิด SSO (โหมดผู้ใช้คนเดียว), ผู้ใช้เป็นแอดมิน, หรือ `NAKA_ENTITLEMENTS=off` (สตูดิโอที่ไม่ได้ต่อฐานข้อมูลร่วม)
  - cache คำตอบ 10 วินาทีต่อคน: แอดมินเปลี่ยนแล้วมีผลในไม่กี่วินาที แม้ session สตูดิโอ (12 ชม.) ยังไม่หมด

## การนับโควตา

- นับ **ก่อน** เริ่มงาน; ถ้างานเริ่มไม่ได้ (เครดิตไม่พอ, งานพร้อมกันเต็ม, สร้าง task ไม่สำเร็จ) คืนให้ทันที
- งานที่เริ่มแล้วแต่ผู้ให้บริการทำไม่สำเร็จภายหลัง **ไม่คืนโควตา** (เครดิตคืนตามระบบเดิม) — ถ้าต้องการ แอดมินเพิ่มโควตารายคนได้
- วิดีโอในสตูดิโอนับกับ **เจ้าของโปรเจกต์** (คนเดียวกับที่ task ติด `owner_user_id`) แม้งานถูกสร้างตอน resume หลังรีสตาร์ท

## การล็อกอิน

Google และอีเมล+รหัสผ่านเปิดอยู่แล้ว (`src/auth/google.ts`, `password.ts`) — ปุ่ม Google แสดงเมื่อตั้ง `GOOGLE_CLIENT_ID/SECRET`
ใน `/admin/system/` ถ้าไม่ต้องการ LINE / เบอร์โทร: ไม่ต้องตั้ง LINE Login channel และตั้ง `SMS_PROVIDER = off` (ปุ่มจะไม่แสดง)
แอดมินหลังร้านต้องเป็นบัญชี Google ใน `ADMIN_EMAILS`

## ยังไม่ได้ทำ

- งานเบื้องหลังของ landing (ตอบ inbox อัตโนมัติ, โพสต์โซเชียลตามเวลา) ยังทำงานต่อสำหรับลูกค้าที่ถูกปิดฟีเจอร์ภายหลัง — ปิดแค่การตั้งค่า/สั่งงานใหม่ผ่าน API
- เมนู Drama ของสตูดิโอถูกตรวจที่รายการ/สร้างละคร; หน้า episode ที่เปิดจาก Marketer ยังใช้ได้ด้วยสิทธิ์ Marketer (ตั้งใจ)
