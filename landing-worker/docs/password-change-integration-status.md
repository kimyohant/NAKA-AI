# Phase 8A — สถานะ API เปลี่ยนรหัสผ่าน

Branch `feat/password-change` เริ่มจาก `main` commit `156b72a`

## สิ่งที่ส่ง

- `POST /api/auth/password/change` ใช้ session และ Origin check ใน auth router เดิม รับ JSON ไม่เกิน 4 KB และตรวจรหัสผ่านด้วย `verifyPassword`/`checkPassword`/`hashPassword` ที่มีอยู่
- รหัสปัจจุบันที่ผิดบันทึกใน `auth_password_attempts` ชนิด `login` ด้วย key เดียวกับการล็อกอินด้วยอีเมล ผิดครบ 5 ครั้งใน 15 นาทีตอบ 429 พร้อม `Retry-After: 900`
- เมื่อสำเร็จ อัปเดต hash แบบมีเงื่อนไขว่ารหัสและ session เดิมยังไม่เปลี่ยน ลบ session ทั้งหมดของผู้ใช้ แล้วออก session ใหม่ให้เครื่องนี้ใน `DB.batch` เดียว ถ้าการสร้าง session ล้มเหลว ธุรกรรมย้อนกลับทั้งหมด
- `GET /api/auth/me` เพิ่ม `hasPassword: boolean` เมื่อฐานข้อมูลมี migration `0012_password_login.sql` แล้ว สำหรับ schema รุ่นก่อน 0012 ยังคง response เดิมเพื่อให้ auth เดิมทำงานระหว่างทยอย migration
- บัญชี Google/LINE ที่ไม่มี password identity ได้ 400 ตามสัญญา; ไม่ส่งรหัสผ่านหรือ hash ใน response/log

## การตรวจ

- เทสใหม่ครอบคลุมเปลี่ยนรหัสสำเร็จ รหัสเก่าใช้ไม่ได้ รหัสใหม่ใช้ได้ session เครื่องอื่นหลุดแต่เครื่องนี้ยังอยู่ รหัสชั่วคราวจากแอดมิน ความผิดพลาดและ rate limit, `hasPassword`, Origin/ขนาด JSON และ transaction rollback
- มีเทสบน Cloudflare workerd กับ D1 จริงแบบ local runtime สำหรับ register → change → session ใหม่ → login ด้วยรหัสใหม่
- `npm run typecheck` ผ่าน; `npm test` ผ่านทั้งชุด 198/198 รวมเทส auth เดิมโดยไม่แก้ไฟล์เทสเดิม

## จุดต่อกับ 8B / Claude

- หน้า `/app/account/` ของ 8B อ่าน `hasPassword` จาก `/api/auth/me` และส่ง `{ currentPassword, newPassword }` ไป `/api/auth/password/change`; session cookie ใหม่ถูกเบราว์เซอร์รับจาก response เอง
- ไม่มี migration, secret หรือ route ใน `src/index.ts` เพิ่มสำหรับ 8A; ควรให้ migration `0012_password_login.sql` ที่มีอยู่บน main ทำงานก่อนเปิดหน้า 8B
