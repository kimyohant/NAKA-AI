# Agent A — Backend: AI Marketer module

อ่านก่อน: `CLAUDE.md`, `docs/ai-marketer/PLAN.md` (โดยเฉพาะข้อ 4 API Contract — ต้องตรงตามนั้น)
เจ้าของไฟล์: `backend/**` เท่านั้น — **ห้ามแก้ `frontend/**`** (Agent B ทำอยู่)
อย่า commit/push · อย่า kill server ที่ `127.0.0.1:5679` · dev ใช้ `PORT=5680 npm run dev`

## Tasks

1. **DB** — `src/db/sqlite-schema.ts`: เพิ่ม migration `version: 6` (ดูแพทเทิร์น `MIGRATIONS` เดิม) สร้างตาราง
   `campaigns`, `campaign_docs`, `campaign_creatives` ตาม shape ใน PLAN ข้อ 4 (array/JSON เก็บเป็น TEXT JSON, timestamp เป็น ISO text, `deleted_at` สำหรับ campaigns)
   แล้วเพิ่ม Drizzle table ใน `src/db/schema.ts`

2. **URL ingest** — `src/services/product-ingest.ts`: `fetch` หน้าสินค้า → parse JSON-LD `Product`, OpenGraph, `<title>`/meta description
   → ดาวน์โหลดรูป (สูงสุด ~6) ลง storage ด้วย util เดิมใน `src/utils/storage.ts` → คืน `/static/...`
   - timeout + จำกัดขนาด response, อนุญาตเฉพาะ http/https, บล็อก private/loopback IP (กัน SSRF)
   - ล้มเหลว → `AppError(..., 'E_INGEST_FAILED')` (Shopee/Lazada อาจบล็อก bot — ให้ผู้ใช้กรอกเองได้)

3. **Agents ใหม่ 3 ตัว** (register ใน `src/agents/index.ts` แบบเดียวกับ 4 ตัวเดิม + `AGENT_SKILL_MAP` ใน `src/agents/skills.ts`)
   - `market_researcher` → เขียน doc `product_brief` + `market_research` (category opportunity, competitor angles, review pain points, search terms, ราคา/positioning) — **ต้องแยกหัวข้อ Evidence (จากหน้าสินค้า/notes ผู้ใช้) vs Assumptions (ความรู้โมเดล)**
   - `strategist` → อ่าน docs ที่มี → เขียน 4 docs: `audience_insight` (personas + pains/desires), `message_map` (core message, proof points, objections→answers), `campaign_plan` (channels, จำนวน creatives, cadence), `content_brief` (hooks, formats, do/don't, CTA)
   - `ad_scriptwriter` → สร้าง N creatives: angle/hook/format/platform/durationSec/cta + `script` **ในรูปแบบ formatted script เดิมของ `script_rewriter`** (ให้ extractor/storyboard_breaker เดิมรับต่อได้) โดยสินค้าต้องถูกเขียนเป็นสิ่งของที่ extractor จะดึงเป็น prop ได้, hook อยู่ 0–3 วินาทีแรก, ความยาวรวมตาม `durationSec`
   - ใช้ tools (`src/agents/tools/marketer-tools.ts`) อ่าน campaign/docs และบันทึกผลลง DB — ไม่ parse ข้อความดิบเอง
   - prompts: `workspace/prompts/<agent>.md` + `.en.md`; skills: `workspace/skills/market-researcher/`, `strategist/`, `ad-scriptwriter/` (`SKILL.md` + `SKILL.en.md`) — โทน/แนวทางเหมาะกับตลาดไทย (TikTok Shop, Shopee, Lazada) แต่ไม่ hardcode ภาษา ใช้ language directive เดิม
   - ใส่ DEFAULT_PROMPTS fallback แบบตัวเดิม

4. **Service + routes** — `src/services/marketer.ts` + `src/routes/campaigns.ts` mount ที่ `api.route('/campaigns', campaigns)` ใน `src/index.ts`
   - research/strategy/creatives เป็น async (pattern เดียวกับ `startExtraction` + `pipeline-tasks`) — set status `*ing` → เสร็จ set `*_ready` / ผิดพลาด `failed` + `errorMsg`; มีงานวิ่งอยู่แล้ว → `E_CAMPAIGN_BUSY`
   - guard: strategy ต้องมี `market_research` (`E_STRATEGY_NEEDS_RESEARCH`), creatives ต้องมี `content_brief` (`E_CREATIVES_NEED_STRATEGY`)
   - `revise`: sync เรียก agent ที่เป็นเจ้าของ doc kind นั้นพร้อม instruction → version+1
   - `produce`: สร้าง drama (title = campaign.title, style/aspectRatio จาก campaign, metadata `{ campaignId }`) ถ้า `dramaId` ยังว่าง → สร้าง episode ถัดไป (`scriptContent` = creative.script, `content` = creative.script, `hook` = creative.hook) → set creative `in_production` + episodeId/Number → คืน `{ dramaId, episodeNumber }` — ดู `src/routes/dramas.ts` / `episodes.ts` ว่าสร้างแบบไหน แล้ว reuse ฟังก์ชันเดิม
   - model: ใช้ text config เดิม (`getTextConfig`) — ไม่มี config → `E_NO_TEXT_MODEL`

5. **Tests** — เพิ่ม `backend/tests/campaigns-*.test.*` ตามสไตล์ test เดิม (structure test + migration test), รัน `npm run typecheck` ให้ผ่าน

## Done when
- `npm run typecheck` ผ่าน, tests ใหม่ + เดิมผ่าน
- รัน `PORT=5680 npm run dev` แล้ว `curl` ครบทุก endpoint ใน contract (research/strategy/creatives ทดสอบได้ถึงขั้น `E_NO_TEXT_MODEL` ถ้าไม่มี key — ห้ามใช้ key จริงของผู้ใช้เกินจำเป็น)
- รายงานสั้นๆ: ไฟล์ที่แก้, endpoint ที่ทดสอบแล้ว, จุดที่เบี่ยงจาก contract (ถ้ามี — ควรไม่มี)
