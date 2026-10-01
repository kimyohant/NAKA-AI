# Phase 7B — ส่ง OTP ผ่านมือถือ Android ของร้าน (Z.AI)

สัญญากลาง Claude เป็นเจ้าของ ห้ามเปลี่ยนเอง ถ้าต้องเปลี่ยนให้เขียนขอใน `docs/sms-gateway-integration-status.md`
กติการ่วมทั้ง 8 ข้อใน `docs/phase1-tasks.md` ใช้ด้วย

## ทำไม

ช่วงเปิดตัวลูกค้ายังน้อย ใช้มือถือ Android + ซิมของร้านส่ง SMS OTP แทน ThaiBulkSMS ได้ ด้วยแอป open source
**SMS Gateway for Android** (github.com/capcom6/android-sms-gateway, Apache-2.0) โหมด **Cloud server** (มือถือไม่ต้องมี IP สาธารณะ)
ThaiBulkSMS ต้องใช้ต่อได้เหมือนเดิม เลือกด้วย `SMS_PROVIDER`

## Branch และไฟล์ที่เป็นเจ้าของ

แตก branch `feat/sms-gateway` จาก `main` ล่าสุด

`src/auth/sms.ts` (แก้ได้ทั้งไฟล์ แต่ต้องคงพฤติกรรม `mock` และ `thaibulksms` เดิมทุกอย่าง), `tests/sms-gateway.test.cjs`, `docs/sms-gateway-integration-status.md`

**ห้ามแก้** `src/auth/otp.ts`, `src/auth/index.ts`, `src/auth/session.ts`, `src/auth/line.ts` (ChatGPT ทำอยู่), `public/login/**` (ChatGPT ทำอยู่), `src/index.ts`, `src/types.ts`, `migrations/**`
เทส auth เดิมใน `src/auth/tests/` ต้องผ่านทั้งหมดโดยไม่แก้เทสเดิม

## สัญญา

`SMS_PROVIDER=android_gateway` ใช้ env (Claude เพิ่มใน `src/types.ts` ตอน merge — ระหว่างทำให้ cast แบบที่ `src/onboarding/signup.ts` เคยทำ):

| env | ความหมาย |
|---|---|
| `SMS_GATEWAY_URL` | base URL ของ API ถ้าไม่ตั้ง = cloud server ตามเอกสารของโปรเจกต์ ต้องเป็น `https://` เท่านั้น |
| `SMS_GATEWAY_USERNAME` | username จากแอป |
| `SMS_GATEWAY_PASSWORD` 🔑 | password จากแอป |

ขาดค่าใด = `AuthError(503, 'ระบบส่งรหัสยังไม่พร้อมใช้งาน')` แบบเดียวกับ thaibulksms

- **ตรวจ endpoint, วิธียืนยันตัวตน, รูปแบบ body และ response จากเอกสาร/README ของโปรเจกต์จริง** เขียน URL เอกสารและวันที่ตรวจไว้ในคอมเมนต์ (แบบคอมเมนต์ของ thaibulksms) ห้ามเดา
- เบอร์ที่ได้มาเป็น `+66…` (จาก `normalizePhone`) แปลงเป็นรูปแบบที่ API ต้องการตามเอกสาร
- timeout 10 วินาที, `redirect: 'manual'`, ส่งไม่สำเร็จ/ตอบไม่ใช่ 2xx/response ไม่ตรงรูปแบบ → `AuthError(502, 'ส่งรหัสไม่สำเร็จ กรุณาลองอีกครั้งภายหลัง')`
- **ห้าม log เบอร์ ข้อความ รหัส OTP หรือ credentials** (ดูคอมเมนต์ใน `src/auth/index.ts`)
- ถ้าเอกสารบอกว่า API แค่รับเข้าคิว (ยังไม่ส่งจริง) ให้ถือว่าสำเร็จเมื่อรับเข้าคิวได้ และเขียนข้อจำกัดนี้ใน status doc

## เทสที่ต้องมี (`tests/sms-gateway.test.cjs` — mock `fetch` แบบ `tests/billing.test.cjs` ห้ามเรียกของจริง)

- ส่งสำเร็จ: URL/method/auth header/body ตรงตามเอกสาร, เบอร์ถูกแปลง, ข้อความ OTP อยู่ใน body
- env ขาดแต่ละตัว / URL ไม่ใช่ https → 503 และไม่เรียก fetch
- ตอบ 4xx/5xx, timeout, network error, response ผิดรูปแบบ → 502
- `SMS_PROVIDER=thaibulksms` และ `mock` ทำงานเหมือนเดิม

## ก่อนส่งงาน

`npm run typecheck` และ `npm test` ต้องผ่านทั้งหมด **commit ลง branch ก่อนแจ้งว่าเสร็จ** (ห้ามทิ้ง uncommitted, ห้าม commit ไฟล์ probe)
เขียนใน status doc: ลิงก์เอกสารที่ใช้, ขั้นตอนตั้งแอปบนมือถือให้เจ้าของทำ (ติดตั้ง, เปิด Cloud server, เอา username/password),
ข้อจำกัด (มือถือต้องเปิดตลอด, ชื่อผู้ส่งเป็นเบอร์, ค่ายอาจจำกัดการส่งจำนวนมาก, ความเร็วในการส่ง) และสิ่งที่ขอให้ Claude ต่อสาย
