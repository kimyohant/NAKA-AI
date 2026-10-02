# Agent B — Frontend: AI Marketer UI

อ่านก่อน: `CLAUDE.md`, `docs/ai-marketer/PLAN.md` (ข้อ 1 flow ของ Topview + ข้อ 4 API Contract — ยิง API ตามนั้นเท่านั้น)
เจ้าของไฟล์: `frontend/**` เท่านั้น — **ห้ามแก้ `backend/**`** (Agent A ทำ API อยู่ขนานกัน)
อย่า commit/push · อย่า kill server ที่ `127.0.0.1:5679`

## Tasks

1. **API client** — `app/composables/useApi.ts`: เพิ่ม `marketerAPI` (ทุก endpoint ใน contract) + types `Campaign`, `CampaignDoc`, `Creative` ตาม PLAN ข้อ 4

2. **Routes** — ลงทะเบียนใน `nuxt.config.ts` `pages:extend` (pattern เดิม, ห้ามใช้ `[id]` ใน path ไฟล์):
   - `/marketer` → `app/views/marketer/index.vue` — รายการ campaign + ปุ่ม "New Task"
   - `/marketer/:id` → `app/views/marketer/workspace.vue`
   - เพิ่มเมนู "AI Marketer" ใน `app/components/AppMenu.vue`

3. **New Task** (dialog หรือหน้าแรกของ workspace) — flow แบบ Topview "Describe the goal":
   - ช่อง Product URL + ปุ่ม "ดึงข้อมูลสินค้า" → `POST /campaigns/ingest-url` → prefill ชื่อ/คำอธิบาย/รูป (ล้มเหลวก็กรอกเองได้)
   - อัปโหลดรูปสินค้าเพิ่ม (ใช้ `uploadAPI` เดิม), brand notes, market (default TH), platforms (multi-select chips), audience, goal, style (style presets เดิม), aspect ratio (9:16 default)
   - quick-start chips แบบ Topview: "URL → แคมเปญ", "รีวิว/คู่แข่ง → คอนเทนต์", "1 brief → หลายฟอร์แมต"

4. **Workspace** — stepper ซ้าย (ใช้หน้าตา progress rail เดิมของ `views/drama/episode.vue` เป็นแบบ): `1 Brief · 2 Research · 3 Strategy · 4 Creatives · 5 Production`
   - **Research**: ปุ่ม Run research (+ textarea "วางข้อมูลคู่แข่ง/รีวิว" → `notes`) → poll `GET /campaigns/:id` ทุก 2s ระหว่าง status `*ing`; แสดง docs `product_brief`, `market_research`
   - **Strategy**: 4 docs เป็นแท็บ/การ์ด — แต่ละ doc: render markdown (เขียน renderer เล็กๆ เอง: heading/list/bold/table พอ — ไม่เพิ่ม dependency), Edit (textarea → PUT), Approve, "สั่งแก้" (instruction → `revise`) แสดง version
   - **Creatives**: form count/formats/platforms → generate; การ์ด creative แสดง hook (เด่น), angle, format, platform, duration, CTA, script (ขยายดู/แก้ได้), approve/delete
   - **Production**: creative ที่ approve → ปุ่ม "ส่งไปผลิต" → `produce` → `navigateTo('/drama/:dramaId/episode/:episodeNumber')` (workbench เดิมทำต่อ: extract → storyboard → video → merge); creative ที่ `in_production` แสดงลิงก์กลับไปหน้า episode
   - status `failed` → แสดง `errorMsg` + ปุ่ม retry; `E_NO_TEXT_MODEL` → ลิงก์ไปหน้า Settings แบบ banner เดิม

5. **i18n** — คีย์ใหม่ใต้ `marketer.*` ใน `app/locales/th.json` และ `en.json` (ครบทั้งสองไฟล์) + `errors.codes.E_CAMPAIGN_BUSY / E_INGEST_FAILED / E_STRATEGY_NEEDS_RESEARCH / E_CREATIVES_NEED_STRATEGY`

6. **Style** — ใช้ CSS variables/คลาสปุ่มเดิมของโปรเจกต์ (ดู `app/assets`), รองรับ light/dark theme เดิม, ไม่มี UI framework

7. **Tests** — เพิ่ม `frontend/tests/marketer-*.test.mjs` แบบ structure test ตามสไตล์เดิม

## Done when
- `npm run generate` ผ่าน (และ `npm run build` ตามที่ README ให้เช็ก), tests ใหม่ + เดิมผ่าน
- ถ้า API ของ Agent A ยังไม่พร้อม: ทดสอบ UI ด้วย mock ชั่วคราวใน dev เท่านั้น — **ห้ามเหลือ mock ในโค้ดที่ส่งมอบ**
- รายงานสั้นๆ: ไฟล์ที่แก้, หน้าจอที่ทำแล้ว, จุดที่ต้องการจาก backend เพิ่ม (ถ้ามี)
