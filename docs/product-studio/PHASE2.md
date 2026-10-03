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

_(Agent A เขียนที่นี่)_

## Notes from Agent B (frontend)

_(Agent B เขียนที่นี่)_
