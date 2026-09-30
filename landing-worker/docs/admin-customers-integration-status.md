# Phase 5C — สถานะงานจัดการลูกค้าหลังร้าน

วันที่ 2026-09-30 · branch `feat/admin-customers` · อัปเดตจาก `main` ถึง `42b47af` (รวม onboarding แล้ว)

## งานที่ส่ง

- `migrations/0009_admin_audit.sql`: ตาราง append-only `admin_audit` พร้อม action constraint, JSON detail, note ที่บังคับ และ index สำหรับประวัติลูกค้า
- `src/admin/customers.ts`: export `handleAdminCustomers(request, env, url)` สำหรับค้นหา ดูรายละเอียด เติมเครดิต เปิด/ต่อแพ็กเกจ และเปลี่ยนสถานะ ตรวจ token ซ้ำแม้ router กลางจะตรวจให้อยู่แล้ว อ่าน/เขียนเฉพาะคอลัมน์จริงจาก migration 0001–0009
- รายละเอียดแสดงลูกค้า แพ็กเกจ เครดิต ประวัติ ledger 50 รายการ payments 20 รายการ ใบเสร็จ บัญชีโซเชียลที่เชื่อม และ audit โดย SQL เลือกเฉพาะฟิลด์โซเชียลที่อนุญาต ไม่มี `token_enc`
- ทุก mutation เขียน audit พร้อมการเปลี่ยนแปลงใน `DB.batch` เดียว audit อ่านค่าก่อน/หลังใน transaction เดียวเพื่อไม่ให้ต่อแพ็กเกจหรือเติมเครดิตพร้อมกันใช้ค่าที่เก่า อ่าน audit snapshot กลับไปใช้ในคำสั่งเปลี่ยนจริง การเขียนล้มเหลวทำให้ทั้ง batch rollback
- แพ็กเดิมที่ยังไม่หมดอายุต่อจากวันหมดเดิมโดยไม่เติมเครดิต แพ็กใหม่/หมดอายุเริ่มวันนี้และเติม ledger ให้ถึงเครดิตรายเดือนของแพ็กโดยไม่ลดยอดเดิม ตั้ง `next_credit_at` อีก 30 วัน แพ็กเกจนอกระบบไม่สร้าง payment หรือ receipt
- `public/admin/customers/`: หน้าไทยค้นหาและเปิดรายละเอียด มีฟอร์ม 3 รายการ ทุกฟอร์มแสดงชื่อ/เบอร์/ผลที่จะเกิดและเหตุผลให้ยืนยันในหน้าก่อน POST ใช้ `textContent` กับข้อมูลลูกค้า เก็บ token ใน `sessionStorage` เท่านั้น (ปิดแท็บแล้วหาย), ส่ง token ใน header, 401 ล้าง token/ข้อมูลบนจอ, รับมือ network ที่ไม่ทราบผลโดยให้โหลดประวัติก่อนทำซ้ำ รองรับจอเล็กและคีย์บอร์ด
- `src/admin/dev-worker.ts` เป็น entry ชั่วคราวสำหรับทดสอบ route จริงผ่าน `npm run dev` โดยไม่แก้ router ของ Claude; `src/admin/local-fixture.sql` เพิ่มเฉพาะลูกค้าสมมติใน D1 local ไม่มีข้อมูลจริงหรือ secret
- `tests/admin-customers.test.cjs` ใช้ helper D1 เดิม ทดสอบ handler, DOM script, Cloudflare workerd + D1 และคำขอพร้อมกัน

## ผลการตรวจ

- `npm run typecheck`: ผ่าน
- `npm test`: ผ่าน **157/157** หลังอัปเดต `main` (รวม onboarding; 17 tests ใหม่ของงานนี้)
- ทดสอบ API บน Wrangler local ด้วย `src/admin/dev-worker.ts` และ D1 local: หน้า `/admin/customers/` 200, ไม่มี token 401, ค้นเบอร์ไทยเจอ, เติมเครดิต, เปิด Pro, ต่อ Pro อีกเดือน, ระงับ/เปิดบัญชี, audit 5 รายการ, ไม่ออกใบเสร็จ — ผ่านทั้งหมด
- ใช้ script หน้าเว็บจริงใน DOM จำลองต่อกับ handler จริงในเทส: ทั้ง 3 ฟอร์มไม่ POST ก่อนยืนยัน, ยกเลิกไม่เปลี่ยนข้อมูล, กดยืนยันซ้ำส่งครั้งเดียว, 401 ล้าง token, network ผลไม่แน่ชัดไม่ส่งซ้ำ
- ยัง **ไม่ได้ตรวจหน้าจริงใน browser**: เครื่องมือ browser inventory คืนค่าว่าง แม้เปิด Wrangler local แล้ว จึงยังไม่ได้ยืนยันภาพที่ 360px/คีย์บอร์ดกับ browser จริงตามใบงาน ขอให้ตรวจจุดนี้ก่อน merge ถ้า browser เชื่อมต่อได้
- ไม่ใช้ระบบชำระเงินจริง ไม่ deploy และไม่ใส่ secret ใน repo

## วิธีเปิดทดสอบ local

จาก worktree ของ branch นี้:

```sh
npm ci
npm run db:migrate:local
node node_modules/wrangler/bin/wrangler.js d1 execute naka-ai-db --local -c wrangler.dev.jsonc --file=src/admin/local-fixture.sql
node node_modules/wrangler/bin/wrangler.js dev src/admin/dev-worker.ts -c wrangler.dev.jsonc --name naka-admin-customers-local --ip 127.0.0.1 --port 18765 --var ADMIN_TOKEN:local-admin-customers-test-only
```

เปิด `http://127.0.0.1:18765/admin/customers/`, ใส่ token ทดสอบ `local-admin-customers-test-only`, ค้น `0800000001`, แล้วลองทั้ง 3 ฟอร์มกับลูกค้า `ร้านทดสอบหลังร้าน` **เฉพาะฐาน local** ค่า token ในคำสั่งเป็นตัวอย่างสำหรับเครื่องทดสอบ ไม่ใช่ token ที่ใช้ deploy จริง ไม่ควรใช้ค่าตัวอย่างกับ server ที่เปิดสู่อินเทอร์เน็ต

## จุดให้ Claude ต่อสายตอน merge

1. ใช้ migration `0009_admin_audit.sql` หลัง `0008_receipts.sql` ก่อนเปิด API ใหม่
2. ใน `src/index.ts` import `handleAdminCustomers` จาก `./admin/customers` แล้วเพิ่ม **ภายใน** block `/api/admin/*` หลังการตรวจ `ADMIN_TOKEN` และก่อน `handleAdmin` เดิม:

   ```ts
   const customerResponse = await handleAdminCustomers(request, env, url);
   if (customerResponse) return customerResponse;
   ```

3. เพิ่มลิงก์ไป `/admin/customers/` จากเมนูหลังร้านเดิมตามความเหมาะสม โดยไม่เอา token ใส่ URL หน้าใหม่ให้กรอก token และเก็บใน sessionStorage ของแท็บนั้น
4. ตรวจบน browser จริงที่ 360px, ลำดับ Tab/Focus, และลองทั้งสามฟอร์มใน local ก่อน merge ตามข้อจำกัดด้านบน; CI บน branch ต้องผ่าน

ไม่มี field ใหม่ใน `src/types.ts` หรือ dependency ใหม่ และไม่ขอเปลี่ยนสัญญากลาง

ข้อสังเกต: `grantCredits()` เดิมทำ `.run()` แยกเอง จึง import มาเรียกตรง ๆ ใน transaction audit ไม่ได้ โมดูลนี้ใช้ `INSERT credit_ledger` ที่มีผลเหมือน `grantCredits(..., 'grant', note)` ภายใน `DB.batch` และมีเทสเทียบ balance/reason/note/rollback ครบ ถ้า shared helper ในอนาคตรองรับ batch ได้ อาจรวม implementation นี้กลับไปที่ helper โดยเจ้าของไฟล์
