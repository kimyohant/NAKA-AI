# Agent A — Backend: Product Studio

อ่านก่อน: `CLAUDE.md`, **`docs/product-studio/PLAN.md` (ข้อ 2–6 คือสัญญา)**, `docs/ai-marketer/PLAN.md` + `PHASE3.md` (pattern ที่ใช้ซ้ำ)
เจ้าของไฟล์: `backend/**` เท่านั้น — **ห้ามแก้ `frontend/**`** (Agent B ทำขนานกัน)

## Setup

```
git fetch origin
git worktree add ../naka-studio-a -b feat/studio-backend origin/master
cd ../naka-studio-a/backend && npm ci
```
ทำงานใน `../naka-studio-a` เท่านั้น · dev: `PORT=5680 SQLITE_PATH=<db ทดสอบ> npm run dev`

## Tasks

1. **Refactor ก่อน (ห้ามเปลี่ยนพฤติกรรมเดิม)**
   - ย้าย logic เตรียมงานวิดีโอใน `src/routes/tasks.ts` (`resolveTaskContext`, `prepareVideoTask`) ไปเป็น service (เช่น `src/services/task-prep.ts`) ให้ route เดิมเรียกผ่าน service — `POST /tasks` ต้องทำงานเหมือนเดิมทุกกรณี
   - ย้าย `buildVisualPrompt` / `visualSizeFor` (+ ชนิด visual) จาก `src/services/marketer.ts` ไป `src/services/product-visuals.ts` — Marketer เรียกจากที่ใหม่ ผลลัพธ์ prompt/size ต้องเท่าเดิมทุกตัวอักษร
   - test เดิมทั้งหมดต้องผ่านหลัง refactor ก่อนเริ่มงานใหม่ (commit แยก)

2. **Migration v10** — `src/db/sqlite-schema.ts` + Drizzle tables ใน `src/db/schema.ts` ตาม PLAN ข้อ 6
   แก้ expected migrations เป็น `[1..10]` ใน `tests/campaigns-migration.test.ts` และ `tests/sqlite-migration-backup.test.ts`

3. **Options + Templates** — `src/services/studio-templates.ts`: 12 เทมเพลตตาม PLAN ข้อ 3 (id/category/avatarMode/hasDialogue/defaultDurationSec/platforms/beats) + ตาราง options (languages, markets พร้อม currency/defaultLanguage, platforms พร้อม defaultAspect/maxDurationSec)
   ฟังก์ชันสเกล beats ตาม `durationSec` (ปัดเป็นวินาทีเต็ม, ผลรวม = durationSec, แต่ละช็อต ≥ 2s และไม่เกินความยาวสูงสุดที่โมเดลวิดีโอรองรับ)

4. **Projects** — `src/services/studio.ts` + `src/routes/studio.ts` mount ที่ `api.route('/studio', studio)` ใน `src/index.ts`
   - CRUD + `ingest-url` (เรียก service ingest เดิม) ตาม PLAN ข้อ 4 · default ของ platform/market (aspect, language) ตอนสร้าง
   - validate ทุก enum → `E_INVALID_FIELD`; `templateId` ไม่รู้จัก → `E_TEMPLATE_UNKNOWN`
   - `GET /projects/:id` ประกอบ shots (storyboards + studio_shots + สถานะจาก sys_task ล่าสุดต่อ storyboard/ชนิด), images, latestMerge (`video_merges` ล่าสุดของ episode), avatar

5. **Agent `review_director` + script** — register ใน `src/agents/index.ts` + `AGENT_SKILL_MAP` + DEFAULT_PROMPTS · tool `save_studio_shots` ใน `src/agents/tools/` · prompts/skill ตาม PLAN ข้อ 5 (zh/en/SKILL ให้ sync กัน)
   - `POST /projects/:id/script` async (pattern `pipeline_tasks` เดียวกับ Marketer, busy ระดับโปรเจกต์ → `E_STUDIO_BUSY`, boot แล้วเคลียร์ `scripting` ค้างเป็น `failed`)
   - สร้าง drama (title = project.title, aspectRatio, budget_thb, `metadata: { studioProjectId }`) + episode ถ้ายังไม่มี → ลบ storyboards เดิมของ episode (soft delete ตาม pattern เดิม) → เขียนช็อตใหม่ + `studio_shots`
   - สร้าง prop สินค้าพร้อม `reference_images` = productImages แบบเดียวกับ Marketer `produce` (reuse ฟังก์ชันเดิม) เพื่อให้หน้า episode เดิมใช้ต่อได้
   - imagePrompt/videoPrompt สร้างแบบ deterministic จาก visual + dialogue + language + avatar description (ฟังก์ชันเดียวกับที่ `PUT shots/:shotId` ใช้)

6. **Render + Merge**
   - `render { stage: 'keyframes' }` → `generateImage({ storyboardId, frameType: 'first_frame', referenceImages: [...productImages.slice(0,3), avatar.imageUrl?], size ตาม aspect })`
   - `render { stage: 'videos' }` → ผ่าน service จาก task 1 (first frame = keyframe, `generateAudio` ตาม PLAN, duration, aspectRatio) — ช็อตที่ไม่มี keyframe ข้าม; ไม่มีเลย → `E_STUDIO_NEEDS_KEYFRAMES`
   - เทมเพลต `avatarMode: required` แต่ไม่มี avatar ที่มีรูป → `E_AVATAR_REQUIRED` (เช็กตอน script และตอน render keyframes)
   - `merge` → `mergeEpisodeVideos(episodeId, dramaId)` · ไม่มีวิดีโอเลย → `E_STUDIO_NO_VIDEOS`

7. **Images + Avatars** — ตาม PLAN ข้อ 4 ใช้ `product-visuals.ts` (เพิ่ม kind `banner` + ขนาดตาม platform) · avatar `generate-image` ใช้ `generateImage` ไม่มี propId/characterId แล้วอ่านผลจาก `image_task_id` (pattern เดียวกับ `campaign_visuals`) · **ห้ามแก้ `writeBackImageAssets`**

8. **Tests** — `tests/studio-*.test.*`: migration v10, routes ครบตามตาราง, error codes ใหม่, `review_director` register ครบทุกจุด, templates 12 ตัว + สเกล beats (ผลรวม = durationSec), refactor ไม่เปลี่ยน prompt ของ Marketer visuals (snapshot เทียบ string), `remove-audio-tts-structure` ยังผ่าน

## Done when
- `npm run typecheck` ผ่าน · test เดิม + ใหม่ผ่าน 100%
- `PORT=5680` + DB ทดสอบ: curl ครบทุก endpoint — script/render/avatar ทดสอบถึง `E_NO_TEXT_MODEL` / `E_NO_IMAGE_MODEL` / `E_NO_VIDEO_MODEL` ถ้าไม่มี key (ห้ามใช้ key จริงกับ production DB)
- เขียน "Notes from Agent A" ใน `docs/product-studio/PLAN.md`: ไฟล์ที่แก้, endpoint ที่ทดสอบ, ความต่างจากสัญญา (ควรไม่มี)
- commit + `git push -u origin feat/studio-backend` — **ห้าม merge เข้า master**
