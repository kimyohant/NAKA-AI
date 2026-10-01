# ตรวจความปลอดภัยของ `origin/main` — ตุลาคม 2026

ตรวจที่ commit `7077b11` บน branch `review/security-audit` โดยอ่านโค้ดและรันเฉพาะการทดสอบในเครื่อง ไม่เรียก `naka-ai.com` หรือ Stripe จริง ไม่ใช้ secret จริง ไม่แก้โค้ด ไม่ merge และไม่ deploy ผลจำลองที่ระบุว่า "ยืนยันในเครื่อง" ใช้ฟังก์ชันจริงจาก `src/` กับ SQLite adapter ที่จำลอง D1 (batch = ธุรกรรมแบบอนุกรม คำสั่งเดี่ยวนอก batch สลับกันได้ตามจริง) แต่ไม่ได้ทดสอบบนฐานข้อมูล production

> **หมายเหตุของการตรวจรอบที่สอง (commit นี้):** งานชิ้นนี้ถูกมอบหมายซ้ำจากอีกเครื่อง เพื่อไม่ทับงานเดิม (commit `7707850`) จึงทำเป็น**การตรวจซ้ำอย่างเป็นอิสระแล้วต่อยอด**: อ่านโค้ดใหม่ทั้งหมดด้วยตนเอง พิสูจน์ข้อค้นพบเดิมข้อ 1–3 ในเครื่องด้วยสคริปต์จำลองที่เขียนขึ้นใหม่ (อยู่นอก repo) แก้ไขรายละเอียดที่ไม่ครบ (ข้อ 1 พบว่าเครดิตหายด้วย, ข้อ 3 พบรูปแบบ failed + คืนเครดิต) และเพิ่มข้อค้นพบใหม่ข้อ 6–7 พร้อมหมายเหตุเชิงสังเกต

## สถานะการแก้ (อัปเดตโดยผู้รวมงาน)

| ข้อ | เรื่อง | สถานะ | commit |
|---|---|---|---|
| 1 | ชำระแพ็กเกจเดียวกันพร้อมกัน | แก้แล้ว · deploy 2026-10-01 (version `8040aef2`) | `da67c1e` |
| 2 | คำขอลิงก์รีเซ็ตพร้อมกันข้าม limit | แก้แล้ว · รอ deploy | `01c0b4e` |
| 3 | worker ที่ lease หมดเขียนทับ attempt ใหม่ | แก้แล้ว · รอ deploy | `50301c3` |
| 4 | webhook อ่าน body ก่อนตรวจขนาด | แก้แล้ว · รอ deploy | `b3746a4` |
| 5 | error อาจพาข้อมูลลูกค้าเข้า log | แก้แล้ว (รวมข้อความ Anthropic ใน `src/affiliate.ts`) · รอ deploy | `b3746a4`, ดู commit ถัดไป |
| 6 | rate limiter อื่นนับก่อนเขียน | แก้แล้ว (ล็อกอิน, สมัคร, เปลี่ยนรหัส, เดา token รีเซ็ต, เปิด Checkout) · รอ deploy | `481ffe7` |
| 7 | token แอดมินเทียบไม่ constant-time | แก้แล้ว · รอ deploy | `b3746a4` |

## ข้อค้นพบ

### 1. ชำระเงินแพ็กเกจเดียวกันพร้อมกันแล้วได้อายุและเครดิตของการซื้อเพียงหนึ่งรายการ

- **ความรุนแรง:** สูง — ลูกค้าจ่ายเงินจริงสองครั้ง แต่ได้อายุแพ็กเกจหนึ่งรอบ **และเครดิตรายเดือนหายไปหนึ่งชุด**
- **หมายเหตุผู้รวมงาน (2026-10-01):** ยืนยันว่า `extending` ตัดสินจากการอ่านนอก batch จริง แต่เรื่องเครดิตไม่นับเป็นความเสียหาย — การจ่ายซ้ำแบบปกติ (ไม่พร้อมกัน) ก็เข้าสาขา "ต่ออายุ" ซึ่งไม่เติมเครดิตอยู่แล้วตามที่ออกแบบ ความเสียหายจริงคืออายุแพ็กเกจหาย 1 รอบ
- **ตำแหน่ง:** `src/billing/index.ts:52-55` (อ่าน subscription นอกธุรกรรม), `src/billing/index.ts:61-75` (batch), `src/billing/index.ts:67` (สาขา `?8 = 1`), `src/billing/index.ts:73` (top-up ถูกข้าม)
- **สถานะ:** ยืนยันในเครื่อง — จำลอง `applyPayment` จริงสองคำขอพร้อมกัน: `payments` ทั้งสอง `successful`, `subscriptions.expires_at` ~30 วันแทน ~60 วัน, ยอดเครดิต 30 แทน 60
- **ขั้นตอนที่ทำให้เกิดปัญหา:** ผู้ใช้ที่ยังไม่มี subscription เปิด Checkout สองรายการของแพ็กเกจเดียวกันแล้วชำระทั้งคู่ (กดซ้ำ/สองอุปกรณ์) webhook และการ polling ของสองรายการเรียก `applyPayment` เกือบพร้อมกัน ทั้งคู่อ่าน `SELECT subscriptions` ก่อน batch ใดจะเกิดขึ้น จึงได้ `extending = false` ทั้งคู่ แล้ว batch ทั้งสองทำงานอนุกรม: รายการแรก INSERT subscription (30 วัน + เครดิต 30) รายการที่สองชน `ON CONFLICT` เข้าสาขา `?8 = 0` จึง**ตั้ง** `expires_at = ตอนนี้ + 30 วัน` ทับแทนที่จะ**บวก** ส่วน top-up ของรายการที่สองถูกเงื่อนไข `monthly_credits > balance` ข้ามเพราะยอดถึงเพดานรายเดือนแล้ว กรณี webhook ซ้ำสำหรับ **payment เดียวกัน** ปลอดภัย: claim ที่ `src/billing/index.ts:61` (`apply_token IS NULL`) กับการเช็ค `claim.meta.changes === 1` ที่บรรทัด 75 ทำให้ apply ครั้งที่สองคืน `false`
- **วิธีแก้ที่แนะนำ:** ย้ายการตัดสินใจ "ต่อ" เข้าไปใน SQL ของ UPSERT เอง — ให้ `ON CONFLICT` เทียบ `subscriptions.plan_id = excluded.plan_id AND subscriptions.status = 'active' AND subscriptions.expires_at > ?ตอนนี้` ที่**เวลาเขียนจริง** จึงเลือก `expires_at + ?duration` หรือ `?ตอนนี้ + ?duration` และใช้เงื่อนไขเดียวกันกำหนดว่าจะเขียน top-up หรือไม่ พร้อมลบการอ่าน `current` นอกธุรกรรม เพิ่มเทสสอง payment ที่ apply ติดกันและยืนยันอายุ + เครดิตรวมสองรอบ

### 2. คำขอลิงก์รีเซ็ตรหัสผ่านพร้อมกันข้าม limit ต่ออีเมล/IP ได้

- **ความรุนแรง:** ปานกลาง — ส่งอีเมลรีเซ็ตเกิน 3 ครั้งต่ออีเมล หรือสร้างแถวเกิน 10 ครั้งต่อ IP ในชั่วโมงเดียวได้ ทั้งที่ endpoint ตอบ 200 เสมอ หน้าบ้านจึงไม่มีทางรู้ว่า limit ถูกข้าม
- **ตำแหน่ง:** `src/auth/password.ts:226-234` (นับ COUNT แยกจากการเขียน), `src/auth/password.ts:243-249` (INSERT)
- **สถานะ:** ยืนยันในเครื่อง — จำลอง `forgotPassword` จริง 6 คำขอพร้อมกัน (อีเมลที่ไม่มีบัญชี จึงไม่มีการเรียกผู้ส่งอีเมลเลย): ได้ 200 ทั้ง 6 คำขอ และมี 6 แถวใน `auth_password_resets` แทนที่จะ 429 ตั้งแต่คำขอที่ 4
- **ขั้นตอนที่ทำให้เกิดปัญหา:** ยิง `POST /api/auth/password/forgot` พร้อมกันหลายคำขอจาก IP เดียวไปยังอีเมลเดียวกัน ทุกคำขออ่าน `COUNT(*)` ก่อนมี INSERT ใด ๆ (การนับอยู่นอกธุรกรรมเขียน) ทุกคำขอจึงเห็นยอด 0 และผ่าน limit พร้อมกันหมด ผลคือ (ก) เขียนแถวเกินโควตาได้ (ข) เมื่อ Resend เปิดแล้ว ระบายอีเมลผ่านผู้ให้บริการเกินโควตาที่ออกแบบไว้ และ (ค) คำขอที่รับมาทับศพทำลิงก์ที่ใช้ได้ของผู้ใช้จริงถูกยกเลิกก่อนเวลา (`src/auth/password.ts:244-245` ยกเลิก token เดิมทั้งหมดของ user)
- **วิธีแก้ที่แนะนำ:** ทำเหมือน `src/auth/otp.ts:37-42` ที่ถูกแบบแล้ว — ย้ายเงื่อนไข COUNT เข้า `WHERE` ของ INSERT เดียวกับการเขียน (ธุรกรรมเดียว นับ ณ เวลาเขียน) แล้วส่งอีเมลเฉพาะเมื่อ INSERT คืนแถว เพิ่มเทสคำขอพร้อมกันบน D1 จริงเช็คจำนวนแถว

### 3. Worker ที่ lease หมดอายุเขียนผลทับ attempt ใหม่ หรือทำงานที่กำลังสำเร็จกลายเป็น failed พร้อมคืนเครดิต

- **ความรุนแรง:** ปานกลาง — ผลจาก attempt เก่าทับผลใหม่ หรืองานที่ผู้ให้บริการทำสำเร็จแล้วถูกปิดเป็น failed + คืนเครดิต (ต้นทุนผู้ให้บริการหาย ลูกค้าไม่ได้ผล)
- **ตำแหน่ง:** `src/jobs.ts:109` (`completeJob` ตรวจแค่ `id AND status='running'`), `src/jobs.ts:126,132-133` (`failJob` เงื่อนไขหลวมเช่นกัน), `src/jobs.ts:144-150` (`recoverExpiredLeases`), `src/jobs.ts:90-102` (claim ไม่มี fencing token)
- **สถานะ:** ยืนยันในเครื่อง — จำลองด้วยฟังก์ชันจริงครบสองรูปแบบ:
  - รูปแบบ A: A claim (attempts=1) → lease หมด → recovery ส่งกลับคิว → B claim (attempts=2) → A กลับมาเรียก `completeJob` → แถวเป็น `done` พร้อมผลของ A; B เรียก `completeJob` ทีหลังเป็น no-op
  - รูปแบบ B: งานถูก claim ครบ 3 attempt (worker ค้างสองรอบก่อนหน้า) → B กำลังรัน attempt ที่ 3 → worker เก่าที่ตื่นช้าเรียก `failJob` → งานถูกตั้ง `failed` และ**คืนเครดิต** (refund statement ที่ `src/jobs.ts:212-220` ทำงานเพราะสถานะเป็น `failed` แล้ว) → B เรียก `completeJob` เป็น no-op — สุดท้าย `failed`, ผลของ B หาย, เครดิตถูกคืนทั้งที่งานสำเร็จ
- **ขั้นตอนที่ทำให้เกิดปัญหา:** ต้องมี worker ค้างเกิน lease 5 นาที (default) แล้วกลับมาจบในช่วงที่งานถูก claim ใหม่ — เกิดได้จาก isolate ถูก evict แล้ว retry ช้า, ผู้ให้บริการอืด (Anthropic timeout 120 วินาที/ครั้ง × หลายฉาก + TTS ต่อฉาก) จนแตะขอบ lease หรือ cron recovery แย่งจังหวะ claim เป็น atomic (`src/jobs.ts:90-102`) แต่ไม่มี token ผูก attempt จึงตรวจไม่ได้ว่าผู้เขียนผลคือเจ้าของ attempt ปัจจุบัน
- **วิธีแก้ที่แนะนำ:** ให้ `claimNextJob` คืนเลข attempt (มีอยู่แล้วใน `RETURNING *`) ใช้เป็น fencing token ส่งต่อ `runJob → completeJob/failJob` และเติม `AND attempts = ?` ใน WHERE ทั้งสอง ตรวจ `meta.changes` ก่อนถือว่าสำเร็จ เพิ่มเทส worker ค้างข้าม lease ทั้งสองรูปแบบ

### 4. Webhook endpoints อ่าน request body ทั้งก้อนก่อนตรวจขนาด/ลายเซ็น

- **ความรุนแรง:** ต่ำถึงปานกลาง — ใช้ทรัพยากร Worker ตามขนาด body ที่แพลตฟอร์มยอมรับ ก่อนตัดสินว่าคำขอถูกต้อง
- **ตำแหน่ง:** `src/billing/index.ts:223-224` (`await request.text()` ก่อนเช็ค 256 KiB และก่อนตรวจ `Stripe-Signature`), `src/index.ts:146` (`/webhook/line` อ่าน body ทั้งก้อนก่อนตรวจ `x-line-signature`)
- **สถานะ:** ยังไม่ยืนยันผลกระทบจริงบน Cloudflare (ขีดจำกัด body/หน่วยความจำของแพลตฟอร์มอาจตัดปัญหาก่อน และงานห้ามยิง request จริง)
- **ขั้นตอนที่ทำให้เกิดปัญหา:** ส่ง POST ไป webhook ด้วย body ใหญ่และลายเซ็นไม่ถูกต้อง โค้ดอ่าน body ครบทุกไบต์เข้าหน่วยความจำก่อนตรวจอะไรเลย เทียบกับจุดที่ทำถูกแบบแล้ว: `src/auth/common.ts:50-65`, `src/studio.ts:53-77`, `src/social/media.ts:19-30` อ่านแบบ stream นับไบต์และหยุดทันทีที่เกิน
- **วิธีแก้ที่แนะนำ:** ปฏิเสธ `Content-Length` เกิน limit ตั้งแต่แรกเมื่อมี header และอ่าน stream นับไบต์ หยุดเมื่อเกิน (คง raw bytes เพื่อตรวจลายเซ็น) — ทำเหมือน `readJson` ของ `src/auth/common.ts`

### 5. Error จากงาน/ผู้ให้บริการอาจพาข้อมูลลูกค้าเข้า log

- **ความรุนแรง:** ต่ำ — ขึ้นกับว่า error ของผู้ให้บริการกลับมามีข้อมูลลูกค้าหรือไม่ และใครเข้าถึง log ได้
- **ตำแหน่ง:** `src/jobs.ts:188` (log error object ทั้งก้อน), `src/agent.ts:162-163` (log + ส่ง `String(err)` กลับเข้าบทสนทนาของโมเดล), `src/index.ts:105,152`, `src/line.ts:41,43,49` (log `await res.text()` ของ LINE), `src/affiliate.ts:236-242` (เก็บ `error.message` ของ provider ไว้ใน `jobs.error` ด้วย)
- **สถานะ:** ยังไม่ยืนยันว่าข้อมูลส่วนตัวปรากฏจริง — เส้นทาง log ยืนยันจากโค้ดแล้ว แต่ยังไม่มีหลักฐานว่า error ของ Anthropic/LINE สะท้อนเนื้อหาลูกค้ากลับมา
- **ขั้นตอนที่ทำให้เกิดปัญหา:** job handler ที่โยน error มีข้อความลูกค้าจะถูก log เต็มก้อนที่ `src/jobs.ts:188` ฝั่ง LINE เมื่อ API ตอบ non-2xx จะ log response body ทั้งก้อน
- **วิธีแก้ที่แนะนำ:** log เฉพาะรหัสเหตุที่กำหนดไว้ (status/code) ไม่ log error object หรือ response body เต็ม และเก็บ `jobs.error` ให้สั้น ไม่มีเนื้อหาลูกค้า (ปัจจุบัน API ฝั่งลูกค้าไม่เปิดเผย `jobs.error` อยู่แล้ว — `src/affiliate.ts:293` ส่งข้อความกลาง)

### 6. Rate limiter อื่น ๆ ใช้รูปแบบ "นับก่อนเขียน" เช่นเดียวกับข้อ 2

- **ความรุนแรง:** ต่ำ — ข้าม limit ได้เฉพาะหน้าต่าง concurrency สั้น ๆ และถูกบล็อกทันทีที่แถวแรกถูกเขียน
- **ตำแหน่ง:** `src/auth/password.ts:134-137,144` (ล็อกอินผิด: 5/อีเมล, 30/IP ต่อ 15 นาที), `src/auth/password.ts:99-102` (สมัคร 5/IP ต่อชั่วโมง), `src/billing/index.ts:131-133` (เปิด Checkout 5 รายการ/ชั่วโมง)
- **สถานะ:** ยังไม่ยืนยันเป็นรายจุด — โครงสร้าง read-then-write เหมือนข้อ 2 ที่ยืนยันแล้ว แต่ยังไม่ได้จำลองแยกแต่ละจุด
- **ขั้นตอนที่ทำให้เกิดปัญหา:** เหมือนข้อ 2 — คำขอพร้อมกันทุกตัวอ่าน COUNT ก่อน INSERT ใด ๆ ทุกตัวจึงผ่านเกณฑ์พร้อมกันในรอบแรก (ขอบเขตการเกินคือจำนวนคำขอที่ยังไม่เห็นการเขียนของกันเอง)
- **วิธีแก้ที่แนะนำ:** ย้ายเงื่อนไขนับเข้า WHERE ของ INSERT (แบบเดียวกับที่แนะนำในข้อ 2 และเหมือน `src/auth/otp.ts:37-42`) แก้ทีเดียวทั้งสามจุด

### 7. การเทียบ token แอดมินใน `src/admin/customers.ts` ยังไม่ constant-time

- **ความรุนแรง:** เชิงสังเกต — ตาม wiring ปัจจุบัน ทุกคำขอ `/api/admin/*` ผ่านประตู `constantTimeEqual` ที่ `src/index.ts:97-98` มาก่อนแล้ว เงื่อนไข `!==` ที่ `src/admin/customers.ts:196` จึงเป็นชั้นสำรอง (สำคัญเฉพาะถ้านำ module ไป mount แยกในอนาคต)
- **สถานะ:** ยืนยันจากโค้ดว่ามีสองแบบปนกัน — แต่ยังไม่ยืนยันว่า timing attack ทำได้จริงผ่านเครือข่าย
- **วิธีแก้ที่แนะนำ:** ใช้ `constantTimeEqual` ให้ครบทุกชั้น เพื่อไม่ให้มาตรฐานภายในต่างกันตามไฟล์

## สิ่งที่ตรวจแล้วและไม่พบช่องโหว่ (ยืนยันซ้ำอย่างอิสระในรอบที่สอง)

- **Stripe:** `src/billing/stripe.ts:67-75` ตรวจ `Stripe-Signature` จาก raw body ด้วย `constructEventAsync` + SubtleCrypto (tolerance มาตรฐาน 5 นาที); `src/billing/index.ts:89-96,233` re-read Checkout Session จาก Stripe และเทียบ session id, ยอด, สกุลเงิน, `client_reference_id`, `metadata.payment_id` ก่อนเปลี่ยนสถานะใด ๆ; apply ซ้ำสำหรับ payment เดียวกันถูก claim token ปิด (`:61,75`); ราคามาจากตาราง `plans` ฝั่ง server เท่านั้น (`:32-34,126,135-139`) เบราว์เซอร์ตั้งราคาไม่ได้; `getCheckoutSession` จำกัดรูปแบบ session id (`stripe.ts:62`)
- **Auth:** session token สุ่ม 32 bytes เก็บ SHA-256, cookie `HttpOnly; SameSite=Lax; Secure` บน https (`src/auth/common.ts:47-49`, `src/auth/session.ts:37-55`); OTP จำกัด atomic ใน INSERT เดียวและ claim ครั้งเดียวด้วย DELETE (`src/auth/otp.ts:34-48,92-97`); ล็อกอินผิดใช้ timing padding + `constantTimeEqual` และ PBKDF2 จำกัด iterations กันการใช้ hash จาก DB มาตั้งค่าสูงเพื่อ DoS (`src/auth/password.ts:49-59`); รีเซ็ตรหัสผ่าน token ใช้ครั้งเดียว ผูก user สถานะ active และล้างทุก session ใน batch เดียว (`src/auth/password.ts:281-294`); Google OAuth ใช้ state (cookie + DB ใช้ครั้งเดียว) + PKCE + identity จาก userinfo เท่านั้น + ต้อง `email_verified` + ไม่ merge บัญชีด้วยอีเมล (`src/auth/google.ts:37-62`); LINE ตรวจ ID token ผ่าน endpoint ของ LINE พร้อม nonce (`src/auth/line.ts:75-85`); CSRF ปิดด้วย canonical origin + Origin + Sec-Fetch-Site (`src/auth/index.ts:30-35`) และ Origin เช็คครบทั้ง billing (`src/billing/index.ts:198`), affiliate (`src/index.ts:44`), admin (`src/admin/customers.ts:200-202`)
- **เครดิต:** hold เครดิตเขียนภายใต้เงื่อนไขยอด + เพดานงานขนานใน **statement เดียวกับการเขียน** (`src/jobs.ts:62-79`) D1 อนุกรมธุรกรรมเขียน จึงไม่มีหน้าต่างให้หักเกินยอดจากการ enqueue พร้อมกัน; คืนเครดิตครั้งเดียวด้วย unique index `(job_id, reason)` (`migrations/0002_credits_jobs.sql:36-38`) — ตรวจแล้วว่า index มีจริง (สาเหตุที่การ failJob พร้อมกันสองครั้งตามข้อ 3 ไม่คืนเครดิตซ้ำ)
- **แอดมิน:** `/api/admin/*` ทุกเส้นรวม `/api/admin/studio` ต้องผ่าน bearer token ด้วย `constantTimeEqual` และ fail-closed เมื่อไม่ตั้ง `ADMIN_TOKEN` (`src/index.ts:96-99`); mutation เขียน audit ก่อนแล้วผลผูกกับ audit row ในธุรกรรมเดียว (`src/admin/customers.ts:130-159`); คำค้นใช้ `instr` ไม่มี LIKE/SQL injection; input จำกัดครบ (เครดิต 1–10000, เดือน 1–12, plan ต้องมีราคา)
- **การแบ่งเขตข้อมูล:** billing (`:161,170`), receipts (`src/receipts/index.ts:130,139-140`), works (`src/works/index.ts:63-64`), affiliate (`src/affiliate.ts:285`), jobs (`src/jobs.ts:195`) ผูกทุก query กับ user id จาก session — ไม่พบเส้นทางอ่านข้ามผู้ใช้; ใบเสร็จเก็บ PII ผู้ซื้อใน snapshot แต่เปิดให้เจ้าของเท่านั้น
- **ทรัพยากร/ความลับ:** จุดอ่าน JSON ใน request (ยกเว้นข้อ 4) จำกัดขนาดแบบ stream; social token เข้ารหัส AES-GCM ผูก AAD ตาม user/platform/external และลิงก์สื่อใช้ HMAC key ที่ derive แยกด้วย HKDF + หมดอายุ + เทียบ constant-time (`src/social/crypto.ts`, `src/social/media.ts:49-62`); mock SMS/email ใช้ได้เฉพาะ origin แบบ loopback (`src/auth/email.ts:9-12`); ตัวแปรสถานะ OAuth เก็บ hash และใช้ครั้งเดียว

## หมายเหตุเชิงสังเกต (ไม่ใช่ช่องโหว่)

- `wrangler.jsonc:25` เปิด `workers_dev: true` — worker เดียวกันให้บริการที่ `naka-ai.<account>.workers.dev` ด้วย cookie/CSRF แยกโดเมนกันเอง จึงไม่พบเส้นทาง bypass แต่เป็น origin ซ้ำที่ควรปิดถ้าไม่ใช้ (การตัดสินใจเป็นของผู้ดูแล `wrangler.jsonc` เท่านั้น)
- ผลตอบของ `runSalesAgent` ถูกใช้เป็นข้อความถึงลูกค้าโดยตรง — system prompt กำหนดขอบเขตไว้และมี handoff เมื่อโมเดลปฏิเสธ ถือว่ายอมรับความเสี่ยง prompt injection ระดับต่ำไว้ตามธุรกิจ
- `GET /api/receipts` คืน snapshot ที่มีเบอร์โทร/อีเมลผู้ซื้อ — เป็นข้อมูลของผู้ใช้เองตามการออกแบบ

## การตรวจในเครื่อง

- `npm run typecheck` ผ่าน · `npm test` ผ่าน 215/215 รายการ (รอบที่สองรันเองได้ผลเดียวกัน)
- จำลองข้อ 1–3 ด้วยฟังก์ชันจริงจาก `src/` (คอมไพล์ด้วย tsc ของโปรเจกต์) + SQLite ในหน่วยความจำที่จำลอง D1: batch เป็นธุรกรรมอนุกรม คำสั่งเดี่ยวสลับกันที่ await ได้ — ทุกสคริปต์ติดตั้ง guard ที่ทำให้ `fetch` ใด ๆ ที่พยายามออกนอกเครื่องพังทันที (พิสูจน์ว่าไม่มี request หลุดไป naka-ai.com/Stripe/Resend) สคริปต์ทั้งหมดอยู่นอก repo ไม่มีการเพิ่ม/แก้ไฟล์ทดสอบใน repo
- ไม่ตรวจค่าการตั้งค่า production, secret, ขีดจำกัด request ของ Cloudflare หรือ error จริงของบริการภายนอก จึงคงข้อ 4–6 ไว้เป็น "ยังไม่ยืนยัน" ตามข้อห้ามของงาน
