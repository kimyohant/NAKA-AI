# Phase 7A — สถานะ integration LINE Login

Branch `feat/line-login` เริ่มจาก `main` commit `5428549`

## สิ่งที่ทำ

- เพิ่ม `GET /api/auth/line/start` และ `GET /api/auth/line/callback` ผ่าน router auth เดิม
- ใช้ state สุ่มผูก cookie `naka_line_state` และแถวใน `auth_oauth_states` อายุ 10 นาที ใช้ได้ครั้งเดียว; ใช้ PKCE S256 และ nonce แยกจาก state
- แลก authorization code ฝั่ง Worker แล้วส่ง ID token ไปให้ LINE verify พร้อม `client_id` และ `nonce`; ตรวจ `iss`, `aud`, `exp`, `nonce`, `sub` อีกครั้งก่อนสร้าง session โดยใช้ `sub` เป็น provider UID และไม่รวมบัญชีตามชื่อหรืออีเมล
- Migration `0011_line_login.sql` สร้าง `auth_identities` ใหม่เพื่อขยาย CHECK เป็น `phone`/`google`/`line` พร้อมคงข้อมูลเดิม UNIQUE และ index
- หน้า login วางปุ่ม LINE เหนือ Google ปุ่มซ่อนจน `/api/auth/config` ส่ง `lineLogin: true`; ข้อผิดพลาด `?error=line` เป็นภาษาไทย

## เอกสาร LINE ที่ตรวจ

- [การเชื่อม LINE Login กับเว็บและ Callback URL](https://developers.line.biz/en/docs/line-login/integrate-line-login/)
- [LINE Login v2.1 API: ออก token และ Verify ID token](https://developers.line.biz/en/reference/line-login/)
- [PKCE สำหรับ LINE Login](https://developers.line.biz/en/docs/line-login/integrate-pkce/)
- [การสร้าง LINE Login channel](https://developers.line.biz/en/docs/line-login/getting-started/)

## การตั้งค่าที่เจ้าของระบบต้องทำ

1. สร้าง **LINE Login channel** ใน LINE Developers Console และเปิด App type **Web app** (แยกจาก Messaging API channel ของบอตเดิม)
2. ในแท็บ LINE Login ตั้ง Callback URL เป็น `https://naka-ai.com/api/auth/line/callback` หรือ URL ตรงกับ `APP_ORIGIN` ของสภาพแวดล้อมนั้น ไม่ต้องขอสิทธิ์อีเมล เพราะใช้ scope `openid profile`
3. ตั้ง secret ของ Worker: `LINE_LOGIN_CHANNEL_ID` และ `LINE_LOGIN_CHANNEL_SECRET` จาก channel นี้ ห้ามใช้ `LINE_CHANNEL_SECRET` หรือ `LINE_CHANNEL_ACCESS_TOKEN` ของบอตแทน

## งานที่ขอให้ Claude ต่อสายตอน merge

- เพิ่ม `LINE_LOGIN_CHANNEL_ID` และ `LINE_LOGIN_CHANNEL_SECRET` ใน `Env` ที่ `src/types.ts`
- ให้ `GET /api/auth/config` ใน `src/auth/index.ts` ส่ง `lineLogin: boolean` โดยเป็น `true` เมื่อค่าทั้งสองตั้งครบเท่านั้น ตอนนี้ `undefined` ทำให้หน้า login ซ่อนปุ่ม LINE ตามสัญญา ไม่แตะ endpoint นี้ใน branch เพราะ brief จำกัดการแก้ `src/auth/index.ts` ไว้ที่ route
- หลังตั้งค่า channel และ merge ให้ตรวจ login จริงบนเว็บผ่าน LINE กับบัญชีใหม่และบัญชีเดิม รวมถึงการยกเลิก consent

## ผลตรวจ

- `node --test tests/line-login.test.cjs` ผ่าน 7/7: URL/PKCE/state, session และล็อกอินซ้ำ, replay/หมดอายุ/ไม่มี cookie, ID token ผิด, ไม่รวมบัญชี Google, migration ข้อมูลเดิม, การแสดงปุ่มตาม config
- `npm run db:migrate:local` ผ่านครบถึง `0011_line_login.sql` บน D1 local
- ทดสอบ SQL บน D1 local กับ identity phone/Google ที่ใส่ไว้จริง: ทั้งสองแถวยังอยู่หลังสร้างตารางใหม่ และ `PRAGMA foreign_key_check` ไม่มีปัญหา
- `npm run typecheck` ผ่าน; `npm test` ผ่าน 175/175 รวมชุด auth เดิมโดยไม่แก้เทสเดิม
