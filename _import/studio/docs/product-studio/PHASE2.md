# Product Studio — Phase 2: Auto-render · Captions · Marketer bridge

อ่านคู่กับ [`PLAN.md`](PLAN.md) (contract Phase 1 ยังใช้ทั้งหมด — Phase 2 เป็นของ **เพิ่ม** เท่านั้น ห้ามเปลี่ยน shape/endpoint เดิม)
Base: `master` @ `164f5f9` (migration ล่าสุด = v10)

## 1. เป้าหมาย

| ฟีเจอร์ | ปัญหาตอนนี้ | หลังทำ |
|---|---|---|
| **A. Auto-render บน server** | "สร้างทั้งหมด" ต่อ keyframes → videos อยู่ใน browser — ปิดแท็บแล้วหยุด, ไม่ต่อวิดีโอให้ | กดครั้งเดียว server ทำ keyframes → videos → merge จนจบเอง ปิดหน้าได้ รีสตาร์ท server แล้วทำต่อ/แจ้ง failed ชัดเจน |
| **B. Captions (ซับฝังวิดีโอ)** | วิดีโอไม่มีซับ — คลิปขายของส่วนใหญ่ดูแบบปิดเสียง และเสียงพูดภาษาที่ไม่ใช่ en/zh จากโมเดลวิดีโอยังไม่นิ่ง | ตอน merge ฝังซับจากบทพูด (หรือ onScreenText) ตามภาษาโปรเจกต์ + ไฟล์ `.srt` ให้ดาวน์โหลด + ป้าย "AI-generated" แบบเลือกได้ |
| **C. Marketer → Studio** | สินค้า/รูป/ตลาดใน Campaign ต้องกรอกใหม่ใน Studio | ปุ่มในแคมเปญ "ทำวิดีโอรีวิว" สร้างโปรเจกต์ Studio จาก campaign (+ creative ที่เลือก) ทันที |

## 2. API Contract (เพิ่มจาก PLAN.md ข้อ 4)

### ส่วนขยาย shape เดิม (additive)

```ts
type AutoRenderStage = 'idle' | 'keyframes' | 'videos' | 'merging' | 'done' | 'failed' | 'cancelled'
interface StudioProject {
  // ...เดิมทั้งหมด
  captions: boolean                     // default true
  captionStyle: 'clean' | 'bold' | 'boxed'   // default 'bold'
  aiLabelBurnIn: boolean                // default false — ฝังป้ายเล็ก "AI-generated" มุมจอ (ข้อความตามภาษาโปรเจกต์)
  autoRender: {
    stage: AutoRenderStage
    total: number; done: number; failed: number   // นับช็อตของ stage ปัจจุบัน (merging: total=1)
    errorMsg: string | null                       // รูปแบบ "E_CODE: message"
    startedAt: string | null; finishedAt: string | null
  }
  sourceCampaignId: number | null       // โปรเจกต์ที่สร้างจาก Marketer
}
interface StudioMerge {
  // ...เดิม
  captioned: boolean
  subtitleUrl: string | null            // /static/... ไฟล์ .srt (มีเมื่อมีบทพูด/ข้อความอย่างน้อย 1 ช็อต)
}
```

### Endpoints ใหม่

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/studio/projects/:id/auto-render` | `{ force?: boolean }` | `202 StudioProject` — เริ่ม pipeline (`force` = สร้าง keyframe/วิดีโอใหม่ทุกช็อตแม้ completed แล้ว) |
| POST | `/studio/projects/:id/auto-render/cancel` | — | `StudioProject` (`stage: 'cancelled'`) — งานที่ส่งให้ provider ไปแล้วปล่อยให้จบเอง ไม่ส่งงานใหม่เพิ่ม |
| POST | `/studio/projects/:id/merge` | เดิม + `{ captions?: boolean }` | `StudioMerge` — ไม่ส่ง = ใช้ค่า `project.captions` |
| POST | `/studio/projects/from-campaign` | `{ campaignId, creativeId?, templateId }` | `StudioProject` — คัด productName/Url/Description/Images, market (+ภาษาเริ่มต้นของตลาด), platform แรกของ campaign ที่ map ได้, budgetThb · มี `creativeId` ⇒ `notes` = hook + angle + CTA ของ creative · `sourceCampaignId` = campaignId |

กติกา auto-render:
- pipeline ระดับโปรเจกต์ใช้ `pipeline_tasks` (kind ใหม่ `studio_render`) — ระหว่างวิ่ง: `script`, `render`, `merge`, `auto-render` ซ้ำ ⇒ `E_STUDIO_BUSY`; `PUT shots` ยังทำได้ (มีผลกับรอบถัดไป)
- keyframes: ส่งทุกช็อตที่ยังไม่ completed → รอจน sys_task ทุกงานจบ (completed/failed/unknown) → videos: ทุกช็อตที่มี keyframe completed และวิดีโอยังไม่ completed → รอจบ → merge (ถ้ามีวิดีโอ ≥ 1) → `done`
- ช็อตที่ล้มเหลว **ไม่หยุด pipeline** — นับใน `failed`; ถ้าไม่มีวิดีโอสักช็อตตอนจะ merge ⇒ `failed` + `E_STUDIO_NO_VIDEOS`
- guard ก่อนเริ่ม: ไม่มีช็อต ⇒ `E_STUDIO_NEEDS_SCRIPT` · `E_AVATAR_REQUIRED` · `E_NO_IMAGE_MODEL` / `E_NO_VIDEO_MODEL` (เช็กก่อนส่งงานแรก) · budget error เดิม
- รีสตาร์ท server ระหว่างวิ่ง: ตอน boot ให้วิ่งต่อจาก stage ที่ค้าง (sys_task ที่ยัง processing จะถูก `recoverGenerationTasks` เดิม resume อยู่แล้ว) — ถ้า resume ไม่ได้ ⇒ `failed` + `E_TASK_INTERRUPTED` (รหัสเดิมที่มีคำแปลแล้ว)
- **ห้าม** poll ถี่กว่า 5s ฝั่ง server · ห้ามสร้าง timer ต่อโปรเจกต์ค้างหลัง `done/failed/cancelled`

กติกา captions:
- ข้อความต่อช็อต = `dialogue` ถ้ามี ไม่งั้น `onScreenText` ไม่งั้นไม่มีซับช่วงนั้น · เวลา = ความยาวจริงของคลิปแต่ละช็อต (ffprobe) สะสมตามลำดับ — **ห้ามใช้ durationSec จากบท**
- ตัดบรรทัดเอง (libass ตัดเฉพาะที่ช่องว่าง → ไทย/จีน/ญี่ปุ่นจะล้นจอ): ใช้ `Intl.Segmenter(language, { granularity: 'word' })` ไม่เกิน 2 บรรทัดต่อ cue, ความยาวบรรทัดตาม aspect (9:16 แคบกว่า 16:9), ยาวเกินแบ่งเป็นหลาย cue กระจายเวลาตามสัดส่วนตัวอักษร
- ฟอนต์: bundle ฟอนต์ใบอนุญาต **OFL** (Noto Sans / Noto Sans Thai / Noto Sans Arabic + CJK) ใน `backend/assets/fonts/` และส่ง `fontsdir` ให้ filter `subtitles`/`ass` — ห้ามพึ่งฟอนต์ของเครื่อง · ภาษา `ar` ต้องแสดงขวาไปซ้ายถูกต้อง
- สไตล์ 3 แบบ (ASS): `clean` ตัวขาวขอบบาง · `bold` ตัวหนาขอบหนา (default ขายของ) · `boxed` กล่องทึบหลังตัวอักษร — วางล่างกลาง เว้นขอบล่างให้พ้น UI ของ TikTok/Reels (~15% ความสูง)
- ฝังซับ = re-encode หลัง concat (คุณภาพ CRF ใกล้เคียงต้นฉบับ) · เก็บ `.srt` คู่กันเสมอเมื่อมีข้อความ · `captions: false` ⇒ ทำแบบเดิมทุกอย่าง (concat อย่างเดียว)

Error codes ใหม่ (frontend แปลใน `errors.codes.*`): `E_STUDIO_CAMPAIGN_NOT_FOUND` (from-campaign: campaign/creative ไม่มีหรือไม่ใช่ของกัน) · `E_CAPTION_FONT_MISSING` (ไม่มีฟอนต์สำหรับภาษานั้น — merge ต้อง fail ชัด ไม่ใช่ได้ตัวสี่เหลี่ยม)
ใช้รหัสเดิม: `E_STUDIO_BUSY`, `E_STUDIO_NEEDS_SCRIPT`, `E_STUDIO_NO_VIDEOS`, `E_AVATAR_REQUIRED`, `E_NO_*_MODEL`, `E_TASK_INTERRUPTED`, `E_INVALID_FIELD`, `E_TEMPLATE_UNKNOWN`

## 3. DB — migration v11 (Agent A)

- `studio_projects`: `captions INTEGER DEFAULT 1`, `caption_style TEXT DEFAULT 'bold'`, `ai_label_burn_in INTEGER DEFAULT 0`, `auto_render TEXT` (JSON ของ `autoRender`), `source_campaign_id INTEGER`
- `video_merges`: `captioned INTEGER DEFAULT 0`, `subtitle_url TEXT` (merge ของ drama ปกติไม่กระทบ — ค่า default)

## 4. การแบ่งงาน

| | Agent A — Backend | Agent B — Frontend |
|---|---|---|
| เจ้าของไฟล์ | `backend/**` + `desktop/electron-builder.yml` + `desktop/scripts/**` (ฟอนต์ในแอปเดสก์ท็อป) + ส่วน "Notes from Agent A" | `frontend/**` + ส่วน "Notes from Agent B" |
| ห้ามแตะ | `frontend/**` | `backend/**`, `desktop/**` |
| Branch | `feat/studio2-backend` | `feat/studio2-frontend` |
| Brief | [`AGENT-A-phase2.md`](AGENT-A-phase2.md) | [`AGENT-B-phase2.md`](AGENT-B-phase2.md) |

กติการ่วม (เหมือน Phase 1):
- worktree แยกของตัวเองเสมอ — `git fetch origin && git worktree add ../naka-studio2-<a|b> -b feat/studio2-<backend|frontend> origin/master`
- commit ได้ระหว่างทาง · **push branch ตัวเองเท่านั้น** — ห้าม push/merge เข้า `master` · **อย่าลืม push ก่อนแจ้งว่าเสร็จ**
- ข้อ 2–3 คือสัญญา — ต้องการเปลี่ยนให้เขียนใน Notes ของตัวเอง (additive เท่านั้น) พร้อมเหตุผล
- ห้ามรันงานที่ใช้ key จริงกับ `data/naka.sqlite3` · backend dev `PORT=5680` · ห้ามแตะระบบเสียง/TTS
- i18n ของ Studio อยู่ใต้ `productStudio.*` (ไม่ใช่ `studio.*` ซึ่งเป็นของหน้าแรก) — รวมคีย์ที่ประกอบด้วย template string

---

## Notes from Agent A (backend)

### สิ่งที่ทำ (branch `feat/studio2-backend` — 2 commits: refactor + feature)

**ไฟล์ที่แก้/เพิ่ม:**
- `backend/src/db/sqlite-schema.ts` + `schema.ts` — migration v11: `studio_projects` เพิ่ม `captions`/`caption_style`/`ai_label_burn_in`/`auto_render`/`source_campaign_id`, `video_merges` เพิ่ม `captioned`/`subtitle_url` (drama merge ปกติไม่กระทบ — default 0/null)
- `backend/src/services/studio-autorender.ts` (ใหม่) — pipeline keyframes → videos → merging → done: ใช้ `pipeline_tasks` kind `studio_render` (เพิ่มใน PipelineTaskKind) · submit ผ่าน `submitRenderStage` ของ studio.ts (ไม่ก๊อป logic) · poll sys_task ทุก 5s (บังคับ `Math.max(..., 5000)`) · ช็อตล้มไม่หยุด (นับ done/failed ระหว่างทาง) · cancel = cancel_requested (cooperative — หยุดก่อนส่งงาน stage ถัดไป, งานที่ส่งแล้วปล่อยจบเอง) · `resumeStaleAutoRenders()` ต่อ stage ค้างตอน boot (resume ไม่ได้ → failed + `E_TASK_INTERRUPTED`) · stage 'merging' รอ concat + captions เสร็จก่อนปิด done
- `backend/src/services/studio.ts` — `toProjectJson` คืน `captions`/`captionStyle`/`aiLabelBurnIn`/`autoRender`/`sourceCampaignId`, merge JSON คืน `captioned`/`subtitleUrl` (default ถูกต้องสำหรับแถวเก่า) · แยก `submitRenderStage` ออกจาก route (คืน `taskIds` ให้ pipeline monitor) · `assertNoAutoRender` บังคับ E_STUDIO_BUSY ระหว่าง auto-render (script/render/merge/ซ้ำ) · `mergeProject(id, { captions?, fromAutoRender? })` — ฝังซับหลัง concat เสร็จ (waitForMergeCompletion → burnCaptionsAfterMerge → อัปเดต mergedUrl/captioned/subtitleUrl) · `createProjectFromCampaign` (map platform: tiktok→tiktok, reels→instagram_reels, youtube_shorts→, facebook→, shopee→, lazada→ · market + ภาษาเริ่มต้นของตลาด · notes = Hook/Angle/CTA จาก creative · campaign soft-delete / creative ไม่ใช่ของกัน → `E_STUDIO_CAMPAIGN_NOT_FOUND`)
- `backend/src/services/captions.ts` (ใหม่) — cues จาก dialogue ?? onScreenText ต่อช็อต, **เวลาจาก ffprobe ของคลิปจริงสะสม (ห้ามใช้ durationSec)** · ตัดบรรทัด `Intl.Segmenter` word-granularity (ไทย/จีน/ญี่ปุ่นเชื่อมคำไม่เติมช่องว่าง, ≤2 บรรทัด/cue, ความยาวบรรทัดตาม aspect 18/24/32, ยาวเกินแบ่งหลาย cue ตามสัดส่วนตัวอักษร) · .srt + .ass สไตล์ clean/bold/boxed (วางล่างกลาง MarginV = 15% PlayResY) · ป้าย AI-generated มุมขวาบนตามภาษา (aiLabelBurnIn) · burn ด้วย ffmpeg filter `ass` + `fontsdir` re-encode CRF 18 · `assertCaptionFontAvailable` → `E_CAPTION_FONT_MISSING`
- `backend/src/utils/ffmpeg.ts` — export `getFfmpegBinPaths()` (burnSubtitles spawn ตรง)
- `backend/assets/fonts/` — ฟอนต์ OFL Noto + OFL.txt: NotoSans-{Regular,Bold}.ttf (1.2MB), NotoSansThai-{Regular,Bold}.ttf (74KB), NotoSansArabic-Regular.ttf (230KB), NotoSansSC-Variable.ttf (17.4MB), NotoSansJP-Variable.ttf (9.4MB), NotoSansKR-Variable.ttf (10.2MB) — **รวม ~38.7MB** (CJK เป็น variable font ไฟล์เดียวครอบทุกน้ำหนัก)
- `backend/scripts/caption-burn-e2e.ts` — สคริปต์ทดสอบ burn ซับจริง
- `backend/src/routes/studio.ts` — `POST /:id/auto-render` (202), `POST /:id/auto-render/cancel`, `POST /projects/from-campaign`
- Tests: `tests/studio2-pipeline.test.ts` (migration v11, cues ตัดบรรทัด th/en/zh/ja/ko/ar/vi, เวลาสะสม inject-probe, srt format, from-campaign mapping + guard, pipeline เดิน stage ครบ + ช็อตล้มไม่หยุด + cancel + **loop หยุดจริง** (เทียบ auto_render JSON หลัง pipeline จบ)), `tests/studio2-structure.test.mjs` (routes, error codes, submit ผ่าน studio.ts, drama merge ไม่กระทบ, desktop wiring) — migration tests เป็น [1..11]
- `desktop/electron-builder.yml` (extraResources fonts) + `desktop/scripts/prepare-resources.mjs` (copy backend/assets/fonts → resources/fonts) + `desktop/src/main.ts` (ฉีด `CAPTION_FONT_DIR` เฉพาะบรรทัด env)

**Endpoints ที่ทดสอบด้วย curl จริง (PORT=5680 + scratch DB):**
- `POST /:id/auto-render`: ไม่มีช็อต → E_STUDIO_NEEDS_SCRIPT ✓ · เทมเพลต required ไม่มี avatar → E_AVATAR_REQUIRED ✓ · ไม่มี image/video model → E_NO_IMAGE_MODEL / E_NO_VIDEO_MODEL ✓ · 202 + pipeline วิ่งจริง (ส่ง keyframe 2 งาน → dummy endpoint fail → videos → ไม่มี keyframe → **failed + E_STUDIO_NEEDS_KEYFRAMES** ✓) · budget error เดิมโผล่ถูกต้อง ("Set a price for this AI configuration...") · `POST /:id/auto-render/cancel` ✓
- `POST /projects/from-campaign`: mapping platform shopee ✓, market TH → language th ✓, sourceCampaignId/captions/captionStyle/autoRender ใน JSON ✓, campaign ไม่พบ → E_STUDIO_CAMPAIGN_NOT_FOUND ✓
- merge ระหว่าง auto-render → E_STUDIO_BUSY ✓ (ผ่าน test + code path)

**merge จริงพร้อมซับไทย (Done-when):**
- สคริปต์ `backend/scripts/caption-burn-e2e.ts`: สร้างคลิปทดสอบ ffmpeg testsrc (2s และ 3s) → cues ไทยจาก ffprobe จริง → burn-in ด้วยฟอนต์ Noto Sans Thai → ffprobe ยืนยัน
- ผลลัพธ์: `C:\Users\natta\AppData\Local\Temp\naka-caption-e2e-1kNvG9\final-captioned.mp4` (duration 2.0s, h264, มี audio) · ซับ: `...\captions.srt` · `...\captions.ass`

**ข้อแตกต่างจากสัญญา: ไม่มี** (หมายเหตุ: submission error ระดับ pipeline เช่น budget guard ทำ pipeline failed ทั้ง stage พร้อม "E_CODE: message" — ส่วนช็อตที่ provider fail รายช็อตไม่หยุด pipeline ตามสัญญา; ฟอนต์ CJK ใช้ variable TTF ไฟล์เดียว ประหยัดขนาด และ libass synthetic-bold เมื่อ style bold)

**ยังไม่ได้ทดสอบกับของจริง:** auto-render ผ่านโมเดลจริง (keyframe/video จริง) — ทดสอบด้วย dummy config ครอบถึง error path ทุกเส้น; burn ซับทดสอบกับคลิปจริงที่สร้างด้วย ffmpeg testsrc แล้ว (ผ่าน)

## Notes from Agent B (frontend)

**เสร็จครบ 6 tasks — branch `feat/studio2-frontend`, base `origin/master @ c0b85fa`**

ไฟล์ที่แก้/เพิ่ม:
- `app/composables/useApi.ts` — types ใหม่ `AutoRenderStage` / `StudioAutoRender`; `StudioProject` เพิ่ม `captions` / `captionStyle` / `aiLabelBurnIn` / `autoRender` / `sourceCampaignId`; `StudioMerge` เพิ่ม `captioned` / `subtitleUrl`; `studioAPI` เพิ่ม `autoRender(id, { force? })`, `cancelAutoRender(id)`, `fromCampaign({ campaignId, creativeId?, templateId })` และ `merge(id, { captions? })`
- `app/utils/studioFlow.js` — เพิ่ม logic ล้วน (test import รันจริง): `AUTO_RENDER_ACTIVE_STAGES`, `isAutoRenderActive`, `autoRenderProgress` (percent จาก done+failed เทียบ total), `captionSourceOf` (dialogue → onScreenText → null), `shotsWithoutCaptions`
- `app/views/studio/workspace.vue` — **ลบ chain ฝั่ง browser ทั้งหมด** (`autoVideosArmed` / `continueRenderAll` / `renderAll` / banner "ต้องเปิดหน้าไว้"); ปุ่ม "สร้างทั้งหมด (อัตโนมัติ)" + "สร้างใหม่ทุกช็อต" (`force`, แสดงเมื่อมีสื่อเสร็จแล้ว); แถบความคืบหน้าจาก `project.autoRender` (stage label + done/total + นับ failed + เปอร์เซ็นต์) + ปุ่มยกเลิก; `done` → toast + พาไปขั้นส่งออกอัตโนมัติ, `failed` → แสดง errorMsg ผ่าน `errors.codes.*` พร้อมปุ่มเริ่มใหม่, `cancelled` → toast; poll 3s ระหว่าง stage วิ่ง (timer เดียวเดิม — เพิ่ม branch `autoRenderActive` ใน `schedulePoll`); ปุ่ม render รายช็อต/รายขั้นปิดระหว่าง pipeline วิ่ง (`renderBlock` รวม `autoRenderActive`); merge ส่ง `{ captions }` จากสวิตช์; topbar มีลิงก์ "แคมเปญต้นทาง" เมื่อมี `sourceCampaignId`
- Captions — ขั้นตั้งค่า: เปิด/ปิดซับ, สไตล์ clean/bold/boxed พร้อมตัวอย่างจำลองด้วย CSS บนกรอบสัดส่วนตาม aspect ที่เลือก, `aiLabelBurnIn` + คำอธิบาย; ขั้นบท: badge "ไม่มีซับ" ต่อช็อต + แจ้งจำนวนช็อตที่จะไม่มีซับ; ขั้นส่งออก: สวิตช์ซับก่อน merge, ปุ่มดาวน์โหลด `.srt` เมื่อมี `subtitleUrl`, badge "มีซับ" เมื่อ `captioned`
- `app/pages/studio.vue` — badge ความคืบหน้า auto-render บนการ์ดโปรเจกต์ (stage + done/total) + poll เฉพาะตอนมีโปรเจกต์วิ่ง (`isAutoRenderActive`)
- `app/views/marketer/campaign.vue` + `app/components/MarketerCreativeCard.vue` + `app/components/StudioFromCampaignDialog.vue` (ใหม่) — ปุ่ม "ทำวิดีโอรีวิว (Product Studio)" ทั้งระดับแคมเปญและบนการ์ด creative → dialog เลือกเทมเพลต (reuse `StudioTemplateGallery`, โหลด templates เอง แสดง error ผ่าน errors.codes ถ้าโหลดไม่ได้) → `fromCampaign` → `navigateTo('/studio/:id')`
- i18n th+en: `productStudio.autoRender.*` (start/force/stage ×7/cancel/done/failed/started/toasts), `productStudio.captions.*` (enable/styles ×3/previewText/burnIn/exportSwitch/downloadSrt/hasSubs/noCaptionBadge/shotsNoCaption), `productStudio.fromCampaign.*` (title/desc/submit/created/backToCampaign ฯลฯ), `marketer.work.toStudio`, `marketer.creatives.toStudio`, `errors.codes.E_STUDIO_CAMPAIGN_NOT_FOUND` + `E_CAPTION_FONT_MISSING`
- `tests/studio2-structure.test.mjs` (ใหม่, 9 tests) + ต่อ `tests/studio-structure.test.mjs` (contract ขยายด้วยตาราง PHASE2 §2 — 24 endpoints; assertion ของ browser chain เดิมเปลี่ยนเป็น auto-render ฝั่ง server)

ผลตรวจ: `node --test tests/*.test.mjs` = **94/94 ผ่าน** · `npm run generate` ผ่าน (ไม่มี duplicated-import warning)

**ยังไม่ได้ทดสอบ:** ยิง API จริง (backend Phase 2 ของ Agent A อยู่บน `feat/studio2-backend`, ยังไม่ merge ตอนงานนี้เสร็จ) — ตรวจสัญญาด้วย test โครงสร้างเทียบ PHASE2.md เท่านั้น ไม่มี mock หลงเหลือ · สิ่งที่คาดหวังจาก backend ตามสัญญา: `auto-render`/`cancel`/`from-campaign`/`merge(captions)` คืน `StudioProject`/`StudioMerge` ตาม shape ข้อ 2 (autoRender เป็น JSON object เสมอ แม้ stage=idle) · `GET /studio/projects` (list) ต้องรวม `autoRender` ด้วยเพื่อให้ badge หน้า list แสดงผล · ฟอนต์ OFL ใน `backend/assets/fonts/` เป็นฝั่ง A/desktop ตามการแบ่งงาน

หมายเหตุ environment เครื่อง B (Mac): ใช้ symlink `node_modules` แทน `npm ci` (npm เครื่องนี้บล็อก install scripts; package.json ระหว่าง base เดิมกับ master ล่าสุดไม่ต่างกัน)
