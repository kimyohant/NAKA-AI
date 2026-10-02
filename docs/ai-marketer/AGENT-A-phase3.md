# Agent A — Backend: AI Marketer Phase 3

อ่านก่อน: `CLAUDE.md`, `docs/ai-marketer/PLAN.md` (ข้อ 4 + Notes from Agent A), **`docs/ai-marketer/PHASE3.md` (ข้อ 2–4 คือสัญญา)**
เจ้าของไฟล์: `backend/**` เท่านั้น — **ห้ามแก้ `frontend/**`** (Agent B ทำขนานกัน)

## Setup

```
git fetch origin
git worktree add ../naka-p3-a -b feat/p3-backend origin/master
cd ../naka-p3-a/backend && npm ci
```
ทำงานใน `../naka-p3-a` เท่านั้น · dev: `PORT=5680 SQLITE_PATH=<db ทดสอบ> npm run dev`

## Tasks

1. **Migration v9** — `src/db/sqlite-schema.ts` (ต่อจาก v8 ตาม pattern `MIGRATIONS` เดิม) + Drizzle tables ใน `src/db/schema.ts`
   ตาม PHASE3 ข้อ 4 · แก้ expected migrations เป็น `[1..9]` ใน `tests/campaigns-migration.test.ts` **และ** `tests/sqlite-migration-backup.test.ts` + เพิ่ม assert ตาราง/คอลัมน์ใหม่

2. **Ad references (Recreate Viral Ad)**
   - CRUD + `analyze` ตาม PHASE3 ข้อ 2 ใน `src/services/marketer.ts` + `src/routes/campaigns.ts` (pattern เดียวกับ `reviseDoc`)
   - Agent ใหม่ `ad_analyst` — register ใน `src/agents/index.ts` + `AGENT_SKILL_MAP` (`src/agents/skills.ts`) + DEFAULT_PROMPTS fallback แบบเดียวกับ 3 agents marketer
     - prompts `workspace/prompts/ad_analyst.md` + `.en.md`, skill `workspace/skills/ad-analyst/SKILL.md` + `SKILL.en.md`
     - output ต้องมีหัวข้อครบตาม PHASE3 ข้อ 3 · **ห้ามคัดลอกถ้อยคำต้นฉบับเกิน 1 ประโยค** · ระบุเมื่อ transcript ไม่พอให้สรุป (อย่าเดา)
     - บันทึกผลผ่าน tool ใน `src/agents/tools/marketer-tools.ts` (เช่น `save_reference_analysis`) — ไม่ parse ข้อความดิบเอง
   - `transcript` ว่าง/ยาวเกิน 20,000 → `E_INVALID_FIELD` · `analyze` ระหว่าง campaign `*ing` → `E_CAMPAIGN_BUSY` · ไม่มี text model → `E_NO_TEXT_MODEL`
   - **ห้ามดึงเนื้อหาจาก `sourceUrl`** (เก็บ string เฉยๆ แต่ validate เป็น http/https)

3. **Recreate ใน creatives/generate**
   - `startCreatives` รับ `referenceId` → ตรวจว่าเป็นของ campaign นี้และ `analyzed` (ไม่ใช่ → `E_REFERENCE_NOT_ANALYZED`)
   - แนบบล็อก `【Reference ad structure】` (analysis) ใน message + คำสั่ง: ทุก creative ใช้โครง beat/hook-type/pacing เดียวกัน แต่เป็นสินค้าเรา, ถ้อยคำใหม่ทั้งหมด
   - `save_creatives` บันทึก `reference_id` · `toCreativeJson` คืน `referenceId`
   - อัปเดต prompt/skill ของ `ad_scriptwriter` (zh/en/SKILL/DEFAULT_PROMPTS ให้ sync กันเหมือน round 5) ให้รู้จักบล็อกนี้ — กฎ formatted script เดิมทั้งหมดยังบังคับ

4. **Product visuals**
   - `POST /:id/visuals/generate`: validate `kind` / `count` 1–4 / `sourceImage ∈ campaign.productImages` → สร้าง `count` งานด้วย `generateImage` เดิม
     (`referenceImages: [sourceImage]`, `dramaId: campaign.dramaId ?? undefined`, ขนาดตาม `campaign.aspectRatio` — packshot ใช้สี่เหลี่ยมจัตุรัส)
   - prompt ต่อ kind เขียนเป็น template ใน service (ภาษาอังกฤษ): packshot = สินค้าเดิมเป๊ะบนพื้นขาวล้วน แสงสตูดิโอ ไม่มี props/ตัวอักษร · on_model = คนถือ/ใช้สินค้า (ใช้ `instruction` กำหนดคน/ฉาก) · lifestyle = สินค้าในบริบทใช้งานจริง — ทุกแบบย้ำ "keep the exact product design, label, color from the reference"
   - `campaign_visuals` เก็บ `task_id`; ตอนอ่าน join `sys_task` → status/imageUrl/errorMsg ตาม PHASE3 ข้อ 2 (`unknown` → `failed`)
   - **ห้ามแก้ `writeBackImageAssets` / `createTask` ใน `generation.ts`** — งาน visual ไม่มี propId/characterId จึงไม่ถูก write-back ไปที่ไหน ตรงตามต้องการ
   - `promote` → `E_VISUAL_NOT_READY` ถ้ายังไม่ completed · ต่อท้าย productImages ไม่ซ้ำ · `promoted` คำนวณจาก productImages
   - `GET /:id` คืน `references` + `visuals` เพิ่ม

5. **Tests** — structure test ใน `tests/campaigns-structure.test.mjs` (หรือไฟล์ใหม่ `campaigns-phase3-*.test.*`) ครอบ: routes ใหม่ครบ, error codes ใหม่, ad_analyst register ครบทุกจุด, ad_scriptwriter prompt มีบล็อก reference, visuals ไม่แตะ `writeBackImageAssets`

## Done when
- `npm run typecheck` ผ่าน · test เดิม + ใหม่ผ่าน 100% (รวม `remove-audio-tts-structure` — ห้ามเพิ่มอะไรเกี่ยวกับเสียง)
- `PORT=5680` + DB ทดสอบ: curl ครบทุก endpoint ใหม่ — analyze/visuals ทดสอบได้ถึง `E_NO_TEXT_MODEL` / `E_NO_IMAGE_MODEL` ถ้าไม่มี key (ห้ามใช้ key จริงของผู้ใช้กับ production DB)
- เขียน "Notes from Agent A" ใน PHASE3.md: ไฟล์ที่แก้, endpoint ที่ทดสอบ, จุดที่ต่างจาก contract (ควรไม่มี)
- commit + `git push -u origin feat/p3-backend` — **ห้าม merge เข้า master**
