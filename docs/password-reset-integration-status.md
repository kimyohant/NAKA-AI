# Phase 9A — สถานะ API ลืมรหัสผ่าน

Branch `feat/password-reset` เริ่มจาก `origin/main` commit `a0f0019`.

## สิ่งที่ส่ง

- `POST /api/auth/password/forgot` รับอีเมลและ Turnstile เมื่อเปิดใช้ ตอบ `{ "ok": true }` เหมือนกันสำหรับบัญชีที่ไม่มีอยู่ ไม่มีรหัสผ่าน หรือถูกระงับ และไม่ส่งอีเมลให้บัญชีเหล่านั้น คำขอที่รับไว้ใช้ `ctx.waitUntil` ส่งอีเมล จึงไม่ต้องรอผู้ให้บริการก่อนตอบ
- จำกัดการขอ 3 ครั้งต่ออีเมลและ 10 ครั้งต่อ IP ในหนึ่งชั่วโมง โดยคำขอที่รับไว้บันทึก HMAC ของอีเมล/IP ส่วนคำขอที่เกิน limit ตอบ 429 ก่อนเขียนฐานข้อมูล จึงไม่เพิ่มแถวหรือทำให้ token ปัจจุบันเสีย; ลบแถวอายุมากกว่า 24 ชั่วโมงเมื่อรับคำขอใหม่
- token สุ่ม 32 bytes เก็บเฉพาะ SHA-256 ใน migration `0013_password_reset.sql` มีอายุ 30 นาที ลิงก์อยู่ใน URL fragment และคำขอใหม่ทำให้ token เดิมของบัญชีเดียวกันใช้ไม่ได้
- `POST /api/auth/password/reset` ตรวจรหัสใหม่ก่อน token, จำกัดการเดา token ด้วย IP, ใช้ `hashPassword` เดิม และอัปเดตรหัส ทำเครื่องหมาย token ว่าใช้แล้ว และลบ session ทั้งหมดใน `DB.batch` เดียว ไม่ออก session ใหม่
- `GET /api/auth/config` เพิ่ม `passwordReset` ตามความพร้อมของผู้ส่งอีเมล; `EMAIL_PROVIDER=off` หรือไม่ได้ตั้งค่าเป็นปิด, `mock` ใช้ได้เฉพาะ `APP_ORIGIN` แบบ HTTP, `resend` ใช้ API key และผู้ส่งจาก environment
- Resend ใช้ plain text ภาษาไทย, POST `/emails`, Bearer auth, ไม่ตาม redirect และหมดเวลาหลัง 10 วินาที; การส่งล้มเหลวตอบลูกค้า 200 และ log ข้อความทั่วไปโดยไม่บันทึกอีเมลหรือ token อ้างอิง [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) ตรวจเมื่อ 2026-09-30

## การตรวจ

- `npm run typecheck` ผ่าน
- `node --test tests/password-reset.test.cjs tests/password-login.test.cjs` ผ่าน 18/18 รวมการ reset พร้อมกันบน Cloudflare workerd + D1 จริง, session revocation, token หมดอายุ/ใช้ซ้ำ, rate limits ที่ 429 ซ้ำแล้วจำนวนแถวคงเดิม, บัญชีไม่มีรหัสผ่าน, Resend และ Origin/JSON 4 KB
- ปรับ assertion หนึ่งบรรทัดใน `tests/password-login.test.cjs` ให้คาด `passwordReset: false` ตามที่เจ้าของงานอนุญาต โดยไม่เปลี่ยนพฤติกรรม test เดิม
- `npm test` ผ่านทั้งชุด 215/215 รวม test auth เดิม

## จุดต่อกับ 9B / Claude

- หน้า 9B อ่าน `passwordReset` จาก `/api/auth/config`; แสดงลิงก์ลืมรหัสผ่านเมื่อเป็น `true` และส่ง `POST /api/auth/password/forgot` ด้วย `{ email, turnstileToken }` จากนั้นแสดงข้อความกลางเสมอเมื่อได้ 200
- หน้า reset อ่าน token จาก `#token=` ของ `/login/reset/` แล้วลบ fragment จาก address bar หลังรับค่า ส่ง `POST /api/auth/password/reset` ด้วย `{ token, newPassword, turnstileToken }`; เมื่อสำเร็จให้ผู้ใช้ล็อกอินใหม่ ไม่มี cookie ใหม่จาก endpoint นี้
- Claude ต้อง apply migration `0013_password_reset.sql` ก่อนเปิดใช้งาน ตั้ง `EMAIL_PROVIDER=resend`, secret `RESEND_API_KEY` และ `EMAIL_FROM` ใน Worker environment; ยืนยันโดเมนผู้ส่งและ DNS ตามข้อกำหนด Resend ก่อนเปิดจริง ไม่มีการแก้ `wrangler.jsonc` ใน 9A
