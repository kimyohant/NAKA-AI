# Social Connector — Agent A / feat/social

วันที่ 2026-09-29 ทำเฉพาะ `C:\Users\natta\OneDrive\Desktop\naka-ai-social`
ตาม AGENTS.md รอบ 2 งาน Turnstile commit แยก `efa0997` แล้ว
Social ต้องรวมหลัง commit นี้ เพราะใช้ `readJson(request, maxBytes)` ร่วมกับ auth

## สิ่งที่ทำแล้ว

- `handleSocial` ครบ 8 routes ตาม `phase3-social.md`; `publishDuePosts` พร้อมให้ cron เรียก
- Facebook Login แบบ authorization code; state สุ่ม 256 bits ใน HttpOnly/SameSite=Lax cookie
  และ hash ใน D1 ผูก user, อายุ 10 นาที, DELETE RETURNING ใช้ได้ครั้งเดียว
  callback ต้องมี session เดิม, การยกเลิก/ผิดพลาดไป `/app/?error=meta`
- ใช้ตัวเลือกให้สิทธิ์เพจในหน้าของ Meta แล้วบันทึก **ทุกเพจที่ Meta คืนให้และมีสิทธิ์สร้างเนื้อหา**
  พร้อม Instagram ที่เชื่อมอยู่; ยังไม่มีหน้าคัดเลือกเพจภายใน NAKA หรือ route เพิ่มจากสัญญา
  UI แสดงบัญชีหลัง callback และให้เลือก `accountId` ตอนตั้งโพสต์; ลบบัญชีที่ไม่ต้องการได้
- แลกเป็น long-lived user token แล้วอ่าน page tokens; เก็บเฉพาะ page tokens แบบ AES-GCM
  IV สุ่ม 12 bytes, AAD ผูกผู้ใช้/platform/external ID; reconnect ใช้ local ID เดิม
  ใช้วันหมดอายุของ parent token เป็นเพดานเมื่อ Meta ส่งมา ไม่สมมติว่า token อยู่ตลอดไป
- MP4/WebM raw upload ≤ 50 MiB (52,428,800 bytes), ตรวจ MIME, magic และจำนวน bytes จริง
  ใช้ buffer จำกัด 50 MiB เพื่อรองรับ chunked body; ไม่มี transcoding/ตรวจ codec เต็มรูปแบบ
  R2 key เป็น UUID, metadata/DB ผูกเจ้าของ; DB ล้มเหลวพยายามลบ object ที่เพิ่งเขียน
- URL คลิป HMAC-SHA256 อายุ 1 ชั่วโมง แยก signing key ด้วย HKDF จาก SOCIAL_TOKEN_KEY
  ผูก origin/key/expiry; อ่านได้โดยไม่ใช้ session เฉพาะลายเซ็นที่ถูกต้อง ไม่มี public bucket
  signature URL เกิดใน cron ตอนถึงเวลา จึงไม่หมดอายุระหว่างรอวันโพสต์
- เวลา Unix seconds, ตั้งล่วงหน้าได้ 30 วัน, caption สูงสุด 2,200 Unicode code points
  Instagram ต้องเป็น MP4; WebM อัปโหลดได้และใช้ Facebook ได้ตามการตรวจไฟล์ของ Meta
- Facebook Page ส่ง video ผ่าน `/videos`; Instagram ส่ง Reel ผ่าน container → poll → publish
  งานนี้ไม่ได้สร้าง Facebook Reel ด้วย `/video_reels` และไม่เผยแพร่ไป personal profile
- แยกเจ้าของทุก query และมี composite foreign keys ป้องกัน post อ้างบัญชี/คลิปคนอื่น
  DELETE ล้าง token และยกเลิกงาน queued; ไม่ลบโพสต์ที่เผยแพร่ไปแล้วบน Meta

## คิว การ retry และข้อจำกัดเรื่องโพสต์ซ้ำ

claim เป็น atomic `UPDATE … WHERE status='queued' … RETURNING` พร้อม lease ID อายุ 180 วินาที
ทุก checkpoint ตรวจ lease; cron หลายตัวไม่ส่งโพสต์เดียวกันพร้อมกัน
`maxPosts` ต้องเป็นจำนวนเต็ม 1–20 (แนะนำเริ่มที่ 2) และนับจำนวนงานที่หยิบ ไม่ใช่เฉพาะงานสำเร็จ
คืน `{ published, failed }` ซึ่ง failed รวม expired lease ที่เปลี่ยนเป็น failed ในรอบนั้น

Instagram เก็บ container ID และคืน queued เพื่อรอรอบถัดไป 60 วินาที ไม่สร้าง container ใหม่ทุก poll
รอประมวลผลสูงสุด 30 รอบ; poll ปกติไม่นับเป็น failed attempt
network/429/5xx ระหว่างเตรียมหรืออ่านสถานะ retry สูงสุด 5 attempts แบบ exponential backoff
ก่อน final publish บันทึก `phase='publish_sent'` ลง D1 **ก่อน** เรียก Meta
ถ้า timeout, 5xx, success ที่ไม่มี ID หรือ worker ตายหลังจุดนี้ จะ failed และไม่ส่งซ้ำอัตโนมัติ
ยกเว้น Meta ตอบปฏิเสธ rate limit ชัดเจนด้วย HTTP 400/429 และ code 4/17/32/613 จึง retry ได้
ถ้า worker ตายก่อนบันทึกการปฏิเสธ จะยัง quarantine แบบไม่ส่งซ้ำ

นี่เป็นการเลือกหลีกเลี่ยง duplicate เมื่อผลลัพธ์ไม่แน่นอน ไม่ใช่ exactly-once transaction ข้าม D1/Meta
อาจมีงานที่ Meta โพสต์แล้วแต่ NAKA แสดง failed; ต้องตรวจ Meta ก่อนสร้างงานใหม่
`scheduled_posts.error` เก็บเฉพาะ stage/HTTP/numeric code หรือรหัสภายใน ไม่เก็บ provider body
API แสดงข้อความไทยทั่วไป; ไม่คืน token, ciphertext, lease หรือ error ภายใน
DELETE/revoke ขณะ upstream publish อยู่ระหว่างทางไม่สามารถเรียกคืนคำขอนั้นได้
Facebook `published` หมายถึง Meta รับคำขอ `published=true` และคืน video ID แล้ว
วิดีโออาจยังประมวลผล/ถูกปฏิเสธภายหลัง ยังไม่มี webhook ตรวจผลปลายทาง

## Migration และ storage

รัน `0001_auth.sql` ก่อน `0003_social.sql` (production ควรรัน migrations ตามลำดับทั้งหมด)
เพิ่ม `social_accounts`, `scheduled_posts` ตามสัญญา พร้อมตารางรอง:
`social_media` สำหรับ ownership/metadata และ `social_oauth_states` สำหรับ state single use
scheduled_posts เพิ่ม next_attempt_at, lease_id, lease_until, container_id, phase, polls
ไม่แตะ LINE/credits tables และ migration ทำซ้ำได้

ยังไม่มี API ลบคลิป/retention job; ห้ามตั้ง R2 lifecycle ลบก่อนวันโพสต์และช่วงที่ Meta ดาวน์โหลด
ควรกำหนด retention/โควตาพื้นที่และทดสอบโหลด upload หลายคำขอก่อนเปิดสาธารณะ
การเปลี่ยน SOCIAL_TOKEN_KEY จะทำให้ token เก่าและ signed URL เดิมใช้ไม่ได้ ต้อง reconnect
ถ้าต้องการหมุน key โดยไม่หลุด ต้องเพิ่ม keyring/re-encryption ในงานรอบต่อไป

## ขอให้ Claude แก้

1. `src/index.ts`: import `handleSocial, publishDuePosts` จาก `./social`
   เรียกก่อน static assets/fallback: `/api/social/media/*` ส่ง userId=null;
   social route อื่นเรียก `requireUser(request, env)` และส่ง `user?.id ?? null`
   callback ต้องใช้ session เดิม ห้ามยกเว้น auth แบบ signed media
   อย่าบังคับ JSON parser ครอบ raw upload, และอย่าเรียก external API เพื่อหา userId
2. เพิ่มใน scheduled handler เดิมผ่าน `ctx.waitUntil(publishDuePosts(env, { maxPosts: 2 }))`
   แยก catch จากคิว credits เดิม เพื่อ missing config ของ social ไม่ทำให้คิวอื่นล้ม
   log ได้เฉพาะข้อความคงที่/ตัวเลข ห้าม dump request/URL OAuth/token/provider error
3. `wrangler.jsonc`: bind private R2 ชื่อ `MEDIA` และ cron `* * * * *`
   ใช้ bucket ของ environment นั้น ๆ; ไม่มีการสร้าง bucket/deploy ในรอบนี้
4. `package.json`: เพิ่ม `src/social/tests/*.test.cjs` ใน test discovery
   ปัจจุบัน `npm test` ยังไม่รัน social suite ต้องใช้คำสั่งด้านล่างเพิ่ม
5. secrets: META_APP_ID, META_APP_SECRET, SOCIAL_TOKEN_KEY (base64 มาตรฐานของ random 32 bytes),
   TURNSTILE_SECRET_KEY และ APP_ORIGIN ที่เป็น HTTPS จริง ไม่มี path/trailing query
   แก้ env example ตามเหมาะสม; `src/types.ts` มี fields ครบแล้ว ไม่ต้องเพิ่ม
6. หน้า login ใส่ Turnstile ตาม `docs/auth-integration-status.md` ส่วนรอบ 2
   หน้า social ต่อ 8 routes และ raw upload; แสดง callback error/reconnect/processing/failed
   บันทึกโพสต์สำเร็จหลัง 202 แล้วหยุดปุ่ม submit ซ้ำ; API ยังไม่มี idempotency key สำหรับ create
   `GET /posts` คืน 100 รายการล่าสุด เรียง createdAt/id; ยังไม่มี pagination cursor

## เตรียม Meta App และ App Review

1. เจ้าของสร้าง Meta developer app สำหรับธุรกิจ เพิ่ม Facebook Login และ Instagram API
   เลือกการเชื่อมต่อ **Instagram API with Facebook Login** (ต้องผูก Page)
   ตั้ง Web OAuth และ Valid OAuth Redirect URI ตรง `${APP_ORIGIN}/api/social/meta/callback`
   ใช้ code flow แบบ scope ตาม implementation นี้; ถ้า dashboard บังคับ Business Login
   แบบ config_id ต้องเพิ่ม contract/config ก่อน อย่าใส่ config ID แทน app ID
2. ใส่ app domains, privacy policy และ data deletion URL ที่เป็นของจริง
   มีบัญชี developer/tester, เพจทดสอบ และ Instagram Business/Creator ที่เชื่อมเพจ
   ส่วนนี้ต้องให้เจ้าของ environment ทำ ไม่ได้สร้าง app หรือกรอกค่าจริงแทนในรอบนี้
3. ขอสิทธิ์ `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `instagram_basic`, `instagram_content_publish`; ไม่ขอสิทธิ์ comments/messages/ads โดยไม่จำเป็น
   สำหรับผู้ใช้ภายนอก app roles ต้องขอ Advanced Access/App Review ตาม dashboard
   รวม Business Verification หาก Meta กำหนดสำหรับ app นั้น
4. เตรียม reviewer instructions และ screencast: NAKA login → connect Meta → เลือกสิทธิ์เพจ
   → เห็น Page/IG → upload → schedule → เห็นผลบน Meta → disconnect
   ให้บัญชีทดสอบและขั้นตอนที่ reviewer ทำซ้ำได้ อธิบายแต่ละ permission ตามการใช้งานจริง
5. หลัง review และ integration พร้อม ค่อยทำ live acceptance ที่ผู้ใช้อนุญาต:
   grant/deny/partial grant, หลายเพจ, linked IG, token expiry/revocation,
   MP4/WebM จริงจาก browser, Meta ดึง signed URL, วิดีโอล้มเหลว/processing/limit
   และผลเผยแพร่สาธารณะ App development mode ไม่ใช่หลักฐานว่าโพสต์เห็นได้ทุกคน

## เอกสาร API ที่ตรวจจริง

Graph version รวมไว้ที่ `src/social/meta.ts`: **v26.0**
ตรวจวันที่ 2026-09-29; web reader ของ Meta ตอบ 429/อ่านไม่ได้บางหน้า
จึงอ่านหน้า docs เดิมด้วย HTTP แบบอ่านอย่างเดียวและใช้ Meta Postman/SDK ประกอบ
ไม่มีการเรียก graph.facebook.com หรือ graph-video.facebook.com จริง

- [Manual login flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/):
  versioned dialog, code exchange GET, redirect_uri/client_id/client_secret และ state
- [Permissions reference](https://developers.facebook.com/docs/permissions/reference/pages_manage_posts/):
  pages_manage_posts สำหรับสร้างวิดีโอบน Page ขึ้นกับ pages_show_list/pages_read_engagement
- [Page videos reference](https://developers.facebook.com/docs/graph-api/reference/page/videos/)
  และ [Video publishing](https://developers.facebook.com/docs/video-api/guides/publishing/):
  POST page/videos, file_url, description, published และ video ID
- [Instagram Facebook Login publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/):
  media/video_url/REELS, status_code, media_publish/creation_id
- [Meta Instagram collection](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00):
  me/accounts, page tokens, linked IG และ MP4/MOV สำหรับ Reels
- [Meta SDK OAuth](https://github.com/facebookarchive/php-graph-sdk/blob/5.x/src/Facebook/Authentication/OAuth2Client.php)
  สำหรับ long-lived exchange และ [current SDK version](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js)
  ยืนยัน version; ไม่เพิ่ม SDK/dependency เข้าโครงการ

## ผลตรวจและสิ่งที่ยังไม่ทดสอบ

- `npm run typecheck`: ผ่าน
- `node --test tests/*.test.cjs src/auth/tests/*.test.cjs src/social/tests/*.test.cjs`:
  **ผ่าน 90/90** (Social 27, ชุดเดิมรวม Turnstile 63)
- ครอบคลุม SQLite schema/ownership, AES-GCM tamper/context/key, OAuth replay/parallel/pagination,
  MIME/ขนาด upload, HMAC expiry/tampering, คิวพร้อมกัน/backoff/lease/final-publish ambiguity,
  revoke/expiry/disabled user และ reconnect ระหว่าง provider error
- workerd/D1/R2 จริงผ่าน session → OAuth → upload → enqueue → concurrent cron
  → signed media → disconnect โดย mock เฉพาะ HTTP ของ Meta
- `git diff --check`: ผ่าน; commit เฉพาะ src/social/**, migration 0003 และเอกสารนี้

ใช้ HTTP mocks ทุก provider: ไม่มี SMS/Turnstile/Google/Meta call จริง ไม่มีโพสต์จริง
ไม่ได้ deploy, push, เปลี่ยน router/types/package/wrangler หรือแตะ worktree อื่น
ยังไม่ได้ทดสอบ live OAuth, App Review, token จริง, CDN/network ของ Meta หรือ codec จริง
เทสต์ runtime ใช้ harness ต่อ requireUser + handleSocial ใน workerd/D1/R2 จริง;
การต่อ router/cron production เป็นรายการส่งให้ Claude ด้านบน ไม่อ้างว่าต่อเสร็จแล้ว
หลัง commit งานนี้ Agent A หยุดรอตาม AGENTS.md
