# Product Studio (สตูดิโอสินค้า) — วิดีโอรีวิวสินค้า · Avatar · ภาพสินค้า

เมนูหลักใหม่ 1 เมนู: **Product Studio** (th: "สตูดิโอสินค้า") — ทำคอนเทนต์ขายของสำหรับ TikTok / TikTok Shop / Shopee / Lazada / Facebook / Instagram / YouTube Shorts / Amazon แบบ **global** (หลายภาษา หลายตลาด)
แยกจาก AI Marketer: Marketer = แคมเปญเต็มรูป (research → strategy → creatives) · Studio = **ได้วิดีโอรีวิวเร็ว ๆ จากสินค้า 1 ชิ้น + เทมเพลต 1 แบบ**
Base: `master` @ `224ec66` (migration ล่าสุด = v9)

แรงบันดาลใจ: ฟีเจอร์ที่ Topview เปิดเผยต่อสาธารณะ (URL-to-video, avatar ถือ/ใช้สินค้า, วางสินค้าในฉาก, คลังเทมเพลต UGC, เสียงหลายภาษา)
**ห้ามคัดลอก** วิดีโอ/รูป/ข้อความ/ชื่อเทมเพลตของ Topview — เทมเพลตทั้งหมดเราออกแบบเอง (ข้อ 3)

## 1. Flow ผู้ใช้

```
[เมนู Product Studio]
  ├─ แท็บ Projects ── New ─► 1 สินค้า ─► 2 เทมเพลต (Creative Gallery) ─► 3 ตั้งค่า ─► 4 บท ─► 5 สร้างวิดีโอ ─► 6 ส่งออก
  ├─ แท็บ Avatars ── คลัง avatar ของผู้ใช้ (อัปโหลดรูป / ให้ AI สร้างจากคำบรรยาย)
  └─ (ในโปรเจกต์) Product images ── packshot / lifestyle / on_model / banner ต่อแพลตฟอร์ม
```

1. **สินค้า** — วางลิงก์ (reuse `ingestUrl` ของ Marketer) หรือกรอกเอง + อัปโหลดรูป
2. **Creative Gallery** — เลือกเทมเพลต (การ์ด + timeline beat) กรองตามหมวด / แพลตฟอร์ม / ต้องใช้ avatar ไหม
3. **ตั้งค่า** — ภาษาพูด, ตลาด, แพลตฟอร์ม (กำหนด aspect + ความยาวเริ่มต้น), ความยาว, avatar (ถ้าเทมเพลตต้องใช้), โทน, หมายเหตุ, งบ (THB)
4. **บท** — AI เขียน shot list ตามเทมเพลต (บทพูดเป็นภาษาที่เลือก) → แก้บทพูด/ภาพ/ความยาวต่อช็อตได้
5. **สร้าง** — keyframe ต่อช็อต (รูปสินค้าจริง + avatar เป็น reference) → image-to-video ต่อช็อต **พร้อมเสียงพูดจากโมเดลวิดีโอ** (`generateAudio`) → สร้างใหม่รายช็อตได้
6. **ส่งออก** — ต่อทุกช็อตด้วย FFmpeg merge เดิม → ดู/ดาวน์โหลด + checklist ก่อนโพสต์ (ป้าย AI-generated, ข้อห้ามโฆษณาต่อแพลตฟอร์ม)

## 2. การใช้ของเดิม (สำคัญ — ห้ามเขียนใหม่ซ้ำ)

| ต้องการ | ใช้ของเดิม |
|---|---|
| ดึงข้อมูลสินค้าจาก URL (SSRF-safe) | `marketer.ingestUrl` / `services/product-ingest.ts` |
| เก็บช็อต + สร้างรูป/วิดีโอ + ต่อวิดีโอ | 1 โปรเจกต์ = 1 **drama + episode** ที่ระบบสร้างให้ (`metadata: { studioProjectId }`) · ช็อต = **storyboards** · รูป/วิดีโอผ่าน `generateImage` / `generateVideo` (write-back ลง storyboard อัตโนมัติ) · ต่อด้วย `mergeEpisodeVideos` |
| พารามิเตอร์วิดีโอ (first frame, duration, aspect, resolution, generateAudio, config ล็อกต่อ episode) | logic ใน `routes/tasks.ts` (`resolveTaskContext` / `prepareVideoTask`) — ย้ายออกมาเป็น service แล้วเรียกซ้ำ ห้ามก๊อปแยก |
| ภาพสินค้า (packshot/lifestyle/on_model) | prompt builder ของ Marketer Phase 3 (`buildVisualPrompt` / `visualSizeFor`) — ย้ายไป `services/product-visuals.ts` ให้ Marketer กับ Studio ใช้ร่วมกัน (พฤติกรรม Marketer ต้องเหมือนเดิม) |
| งบ | `drama.budget_thb` + budget guard เดิมใน `createTask` |
| เสียงพูด | **เสียงจากโมเดลวิดีโอ** (`generate_audio` ของ Seedance / Wan; MiniMax H3 มีเสียงในตัว) — **ไม่นำ TTS กลับมา** (test `remove-audio-tts-structure` ต้องผ่านต่อ) |

## 3. Creative Gallery — เทมเพลต (กำหนดใน code ฝั่ง backend: `services/studio-templates.ts`)

| id | หมวด | avatar | beats (วินาทีโดยประมาณ, ความยาวรวมปรับสเกลตามที่ผู้ใช้เลือก) |
|---|---|---|---|
| `ugc_review` | review | ✅ | hook พูดเข้ากล้อง 3 → ปัญหา 5 → ใช้สินค้า 8 → ผลลัพธ์ 5 → CTA 3 |
| `unboxing` | review | มือ | hook 3 → แกะกล่อง 6 → เผยสินค้า 5 → รายละเอียด 6 → CTA 3 |
| `before_after` | demo | ไม่บังคับ | hook "ก่อน" 4 → ระหว่างใช้ 8 → "หลัง" 6 → CTA 3 |
| `problem_solution` | demo | ไม่บังคับ | ปัญหา 5 → แนะนำสินค้า 4 → แก้ปัญหา 8 → CTA 3 |
| `how_to_use` | demo | มือ | hook 3 → ขั้น 1 5 → ขั้น 2 5 → ขั้น 3 5 → CTA 3 |
| `three_reasons` | review | ✅ | hook 3 → เหตุผล 1 5 → เหตุผล 2 5 → เหตุผล 3 5 → CTA 3 |
| `comparison` | demo | ไม่บังคับ | hook 3 → แบบทั่วไป 6 → สินค้าเรา 8 → CTA 3 (**ห้ามใส่ชื่อแบรนด์คู่แข่ง**) |
| `try_on` | fashion/beauty | ✅ | hook 3 → ลอง/ทา 8 → หมุนโชว์ 6 → CTA 3 |
| `creator_story` | review | ✅ | ประสบการณ์ส่วนตัว 6 → จุดเปลี่ยน 6 → ผล 5 → CTA 3 (เป็น "รีวิวจาก creator" — **ห้ามอ้างว่าเป็นลูกค้าจริง**) |
| `lifestyle_showcase` | showcase | ไม่ใช้ | ฉาก 1 5 → ฉาก 2 5 → ฉาก 3 5 → packshot + CTA 4 (เสียงบรรยาย) |
| `asmr_closeup` | showcase | มือ | macro 4 → texture 5 → เสียงใช้งาน 6 → packshot 4 (ไม่มีบทพูด) |
| `flash_deal` | promo | ✅ | hook ราคา/โปร 3 → โชว์สินค้า 6 → ข้อเสนอ 5 → CTA เร่งด่วน 3 (สไตล์ live-selling TikTok Shop/Shopee) |

Template shape (ส่งให้ frontend ผ่าน API ข้อ 4): `{ id, category, avatarMode: 'required'|'optional'|'hands'|'none', hasDialogue, defaultDurationSec, platforms: Platform[], beats: { role, seconds }[] }` — ชื่อ/คำอธิบายแสดงผลอยู่ใน i18n ฝั่ง frontend (`studio.templates.<id>.*`)
การ์ด gallery ใช้ภาพประกอบ/ไอคอน + timeline beat (ยังไม่มีวิดีโอตัวอย่าง — เพิ่มภายหลังได้)

## 4. API Contract — `/api/v1/studio`

Response helper เดิม `{ code, data, message }` / error `{ code, message, errorCode? }` · JSON camelCase · async failure เก็บแบบ `"E_CODE: message"` เหมือน Marketer

### Global options

```ts
type Language = 'th' | 'en' | 'id' | 'vi' | 'ms' | 'fil' | 'zh' | 'ja' | 'ko' | 'es' | 'pt' | 'ar'
type Market = 'TH' | 'SG' | 'MY' | 'ID' | 'VN' | 'PH' | 'US' | 'UK' | 'EU' | 'JP' | 'KR' | 'CN' | 'LATAM' | 'MENA' | 'GLOBAL'
type Platform = 'tiktok' | 'tiktok_shop' | 'shopee' | 'lazada' | 'facebook' | 'instagram_reels' | 'youtube_shorts' | 'amazon'
type AspectRatio = '9:16' | '1:1' | '16:9'
```
`GET /options` คืน `{ languages: Language[], markets: { id, currency, defaultLanguage }[], platforms: { id, defaultAspect, maxDurationSec }[] }` — frontend ห้าม hardcode ค่าเหล่านี้ซ้ำ
หมายเหตุ: คุณภาพเสียงพูดแต่ละภาษาขึ้นกับโมเดลวิดีโอ — UI แสดงคำเตือนสำหรับภาษาที่ไม่ใช่ en/zh

### Data shapes

```ts
type StudioStatus = 'draft' | 'scripting' | 'script_ready' | 'failed'
interface StudioProject {
  id: number; title: string
  productName: string; productUrl: string | null; productDescription: string | null
  productImages: string[]                 // /static/...
  templateId: string
  language: Language; market: Market; platform: Platform; aspectRatio: AspectRatio
  durationSec: number                     // 10–60
  avatarId: number | null
  tone: string | null; notes: string | null
  budgetThb: number | null
  aiDisclosure: boolean                   // default true — แสดงใน checklist ส่งออก
  status: StudioStatus; errorMsg: string | null
  dramaId: number | null; episodeId: number | null
  createdAt: string; updatedAt: string
}
type MediaStatus = 'none' | 'processing' | 'completed' | 'failed'
interface StudioShot {
  id: number                              // = storyboard id
  number: number; role: string            // role จาก beats ของเทมเพลต
  durationSec: number
  dialogue: string | null                 // ภาษา = project.language; null = ไม่มีเสียงพูด
  visual: string                          // คำบรรยายภาพ (ภาษาเดียวกับ UI content language)
  onScreenText: string | null
  keyframeUrl: string | null; keyframeStatus: MediaStatus; keyframeError: string | null
  videoUrl: string | null; videoStatus: MediaStatus; videoError: string | null
}
interface StudioMerge { id: number; status: 'processing' | 'completed' | 'failed'; videoUrl: string | null; errorMsg: string | null; createdAt: string }
interface StudioAvatar {
  id: number; name: string
  description: string                     // ใช้ใน prompt (หน้าตา/อายุ/สไตล์/การแต่งตัว)
  locale: Market | null
  imageUrl: string | null; imageStatus: MediaStatus; imageError: string | null
  createdAt: string; updatedAt: string
}
type StudioImageKind = 'packshot' | 'lifestyle' | 'on_model' | 'banner'
interface StudioImage {
  id: number; projectId: number; kind: StudioImageKind; platform: Platform | null
  sourceImage: string; instruction: string | null; prompt: string
  taskId: number; status: 'processing' | 'completed' | 'failed'
  imageUrl: string | null; errorMsg: string | null; promoted: boolean
  createdAt: string; updatedAt: string
}
```

### Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/options` | — | ข้างบน |
| GET | `/templates` | — | `Template[]` |
| GET | `/projects` | — | `StudioProject[]` (ใหม่→เก่า) |
| POST | `/projects` | `Partial<StudioProject>` (ต้องมี `productName` หรือ `productUrl` + `templateId`) | `StudioProject` — default ตาม platform/market |
| POST | `/ingest-url` | `{ url }` | เหมือน `/campaigns/ingest-url` (เรียก service เดียวกัน) |
| GET | `/projects/:id` | — | `StudioProject & { shots: StudioShot[]; images: StudioImage[]; latestMerge: StudioMerge \| null; avatar: StudioAvatar \| null }` |
| PUT | `/projects/:id` | `Partial<StudioProject>` | `StudioProject` — แก้ template/language/duration หลังมีบทแล้ว ⇒ ต้องสั่ง script ใหม่ (ไม่ลบช็อตเอง) |
| DELETE | `/projects/:id` | — | soft delete (drama ที่ผูกไว้ไม่ลบ) |
| POST | `/projects/:id/script` | `{ instruction? }` | `202 { status: 'scripting' }` — agent `review_director` → สร้าง drama+episode ถ้ายังไม่มี → **แทนที่** storyboards ทั้งหมดของ episode → `script_ready` |
| PUT | `/projects/:id/shots/:shotId` | `{ dialogue?, visual?, onScreenText?, durationSec? }` | `StudioShot` — สร้าง imagePrompt/videoPrompt ใหม่แบบ deterministic; keyframe/video เดิมยังอยู่จนกว่าจะสั่งสร้างใหม่ |
| POST | `/projects/:id/render` | `{ stage: 'keyframes' \| 'videos', shotIds?: number[] }` | `{ queued: number }` — สร้าง sys_task ต่อช็อต (ไม่ระบุ shotIds = ทุกช็อตที่ยังไม่ `completed`) |
| POST | `/projects/:id/merge` | — | `StudioMerge` — ต่อเฉพาะช็อตที่มีวิดีโอ เรียงตามลำดับ |
| POST | `/projects/:id/images/generate` | `{ kind, sourceImage, count?: 1–4, platform?, instruction? }` | `StudioImage[]` |
| DELETE | `/projects/:id/images/:imageId` | — | ลบ row |
| POST | `/projects/:id/images/:imageId/promote` | — | `StudioProject` — ต่อท้ายเข้า `productImages` |
| GET | `/avatars` | — | `StudioAvatar[]` |
| POST | `/avatars` | `{ name, description, locale?, imageUrl? }` | `StudioAvatar` (imageUrl จาก `uploadAPI` เดิม) |
| PUT | `/avatars/:id` | `Partial<{ name, description, locale, imageUrl }>` | `StudioAvatar` |
| POST | `/avatars/:id/generate-image` | `{ instruction? }` | `StudioAvatar` (`imageStatus: processing`) — portrait ครึ่งตัว พื้นเรียบ |
| DELETE | `/avatars/:id` | — | soft delete — โปรเจกต์ที่ใช้อยู่เก็บ id เดิม แต่ GET คืน `avatar: null` |

กติกา render:
- `keyframes`: reference images = รูปสินค้า (สูงสุด 3 รูปแรกของ `productImages`) + รูป avatar (ถ้าเทมเพลตใช้ avatar) · ขนาดตาม `aspectRatio`
- `videos`: ต้องมี keyframe `completed` ของช็อตนั้น (ไม่มี ⇒ ข้ามช็อตนั้น; ถ้าไม่มีสักช็อต ⇒ `E_STUDIO_NEEDS_KEYFRAMES`) · first frame = keyframe · `generateAudio: true` เมื่อ `dialogue` ไม่ว่างหรือเทมเพลตมีเสียง · `durationSec` ตามช็อต (ปัดเข้าค่าที่โมเดลรองรับ)
- prompt วิดีโอต้องมีบทพูด **คำต่อคำในภาษาที่เลือก** + คำสั่งให้พูดภาษานั้น + ห้ามมีตัวอักษร/โลโก้แปลกปลอม
- status ของ keyframe/video อ่านสดจาก sys_task ล่าสุดของ storyboard นั้น (ไม่เก็บซ้ำ)

Error codes ใหม่ (frontend แปลใน `errors.codes.*`):
`E_STUDIO_BUSY` (script ระหว่าง `scripting`) · `E_STUDIO_NEEDS_SCRIPT` (render ก่อนมีช็อต) · `E_STUDIO_NEEDS_KEYFRAMES` · `E_STUDIO_NO_VIDEOS` (merge ตอนไม่มีวิดีโอ) · `E_AVATAR_REQUIRED` (เทมเพลต `avatarMode: required` แต่ไม่มี avatar ที่มีรูป) · `E_TEMPLATE_UNKNOWN`
ใช้รหัสเดิม: `E_INVALID_FIELD`, `E_NO_TEXT_MODEL`, `E_NO_IMAGE_MODEL`, `E_NO_VIDEO_MODEL`, `E_INGEST_FAILED`, budget error เดิม

## 5. Agent ใหม่ `review_director`

- input: product + template beats (สเกลตาม `durationSec`) + language + market + platform + avatar description + tone/notes/instruction
- output ผ่าน tool `save_studio_shots` (ไม่ parse ข้อความดิบ): ต่อช็อต `role, durationSec, dialogue, visual, onScreenText`
- กฎ: บทพูดเป็น**ภาษาที่เลือก** สั้นพอพูดทันในเวลาช็อต (ประมาณ 2.5 คำ/วินาทีสำหรับ en — ภาษาอื่นเทียบเท่า) · hook ใน 3 วินาทีแรก · CTA ท้าย · ปรับคำพูด/สกุลเงิน/วัฒนธรรมตาม market
- **compliance**: ห้ามอ้างสรรพคุณทางการแพทย์/ผลลัพธ์ที่พิสูจน์ไม่ได้ · ห้ามบอกว่าเป็นลูกค้าจริงหรือรีวิวจริง · ห้ามชื่อแบรนด์คู่แข่ง · ราคา/โปรใช้เฉพาะที่ผู้ใช้ให้มา
- prompts `workspace/prompts/review_director{,.en}.md` + skill `workspace/skills/review-director/SKILL{,.en}.md` + DEFAULT_PROMPTS (pattern เดียวกับ agents marketer)

## 6. DB — migration v10 (Agent A)

- `studio_projects` (ฟิลด์ตาม `StudioProject` + `deleted_at`)
- `studio_shots` (storyboard_id PK/unique, project_id, role, dialogue, on_screen_text) — ข้อมูลภาพ/ความยาว/prompt อยู่ใน storyboards เดิม
- `studio_avatars` (+ `image_task_id`, `deleted_at`)
- `studio_images` (เหมือน `campaign_visuals` + `platform`)

## 7. การแบ่งงาน

| | Agent A — Backend | Agent B — Frontend |
|---|---|---|
| เจ้าของไฟล์ | `backend/**` + ส่วน "Notes from Agent A" | `frontend/**` + ส่วน "Notes from Agent B" |
| ห้ามแตะ | `frontend/**` | `backend/**` |
| Branch | `feat/studio-backend` | `feat/studio-frontend` |
| Brief | [`AGENT-A-backend.md`](AGENT-A-backend.md) | [`AGENT-B-frontend.md`](AGENT-B-frontend.md) |

กติการ่วม:
- **worktree แยกของตัวเองเสมอ** — `git fetch origin && git worktree add ../naka-studio-<a|b> -b feat/studio-<backend|frontend> origin/master`
- commit ได้ระหว่างทาง · **push branch ตัวเองเท่านั้น** — ห้าม push/merge เข้า `master`
- ข้อ 3–6 คือสัญญา — ต้องการเปลี่ยนให้เขียนใน Notes ของตัวเอง (additive เท่านั้น) พร้อมเหตุผล
- ห้ามรันงานที่ใช้ key จริงกับ `data/naka.sqlite3` (ใช้ `SQLITE_PATH` ชี้ DB ทดสอบ) · backend dev `PORT=5680`
- เขียนให้เหมือนโค้ดรอบข้าง · ไม่มี UI framework · ไม่เพิ่ม dependency · ห้ามแตะระบบเสียง/TTS

---

## Notes from Agent A (backend)

_(Agent A เขียนที่นี่)_

## Notes from Agent B (frontend)

**เสร็จครบ 7 tasks — branch `feat/studio-frontend`, base `origin/master @ 5a70cda`**

ไฟล์ที่แก้/เพิ่ม:
- `app/composables/useApi.ts` — types ตาม PLAN §4 ครบ (`StudioProject/StudioShot/StudioMerge/StudioAvatar/StudioImage/StudioTemplate/StudioOptions` + enum types) และ `studioAPI` ครบทั้ง 20 endpoints
- `app/utils/studioFlow.js` (ใหม่) — logic ล้วน: `STUDIO_STEPS` (6 ขั้น), `isStepDone`, `nextIncompleteStep`, `clampStudioDuration` (10–60 + ceiling ตาม platform), `speechSeconds`/`dialogueTooLong` (นับคำ 2.5 คำ/วินาที สำหรับภาษาเว้นวรรค · นับตัวอักษร 4.5 ตัว/วินาที สำหรับ th/zh/ja/ko), `beatBars` (timeline สัดส่วน %), `applyPlatformDefaults`, `studioErrorCodeOf`
- `app/components/` (ใหม่ 6 ตัว): `StudioTemplateCard` (ไอคอนตามหมวด + badge avatar/มือ/ไม่มีบทพูด + timeline beat), `StudioTemplateGallery` (กรองหมวด/แพลตฟอร์ม/ต้องใช้ avatar), `StudioShotCard` (โหมด script: แก้บทพูดพร้อมนับเวลาพูดเตือนเกิน / โหมด render: keyframe+video พร้อมสร้างใหม่รายช็อต), `StudioAvatarCard` (อัปโหลด/AI สร้าง/แก้/ลบ), `StudioImageCard` (ภาพสินค้า packshot/lifestyle/on_model/banner + promote), `StudioProductImages` (แผงรองภาพสินค้าในขั้นสินค้า)
- `app/views/studio/workspace.vue` — stepper 6 ขั้น (sidebar + rail มือถือ แบบ marketer), poll timer เดียว (scripting 2s / งานสื่อ+merge 3s), โหมด "สร้างทั้งหมด" ทำ keyframes → รอครบ → videos ต่อเอง (มี banner เตือนต้องเปิดหน้าไว้), error banner แยก `E_AVATAR_REQUIRED` (ปุ่มพาไปเลือก avatar) และ `E_NO_*_MODEL` (ลิงก์ Settings)
- `app/pages/studio.vue` — แท็บ Projects/Avatars (tab ผ่าน `?tab=avatars`), New dialog รวมสองโหมด (โปรเจกต์: ชื่อ/ลิงก์/เทมเพลตเริ่มต้น · avatar: ชื่อ/คำบรรยาย/locale/อัปโหลดรูปด้วย `uploadAPI`), poll ระหว่าง scripting/สร้างรูป avatar
- `app/layouts/default.vue` — เมนู "สตูดิโอสินค้า" ถัดจาก AI Marketer (`isProductStudioRoute`), `nuxt.config.ts` — route `studio-workspace` → `/studio/:id`
- i18n th+en: `layout.nav.studio`, `studio.*` 27 กลุ่ม (รวม templates 12 แบบ × name/description/beats, languages 12, markets 15, platforms 8, imageKinds, mediaStatus, steps 6 ขั้น) + `errors.codes` 6 ตัวใหม่
- `tests/studio-structure.test.mjs` (ใหม่, 14 tests): endpoint ครบตามตาราง PLAN §4 (parse จาก PLAN เทียบ client ทุกตัว), routes/เมนู, i18n parity + ครบ 12 เทมเพลต, logic studioFlow รันจริง, no-mock/no-hardcode

**⚠️ เบี่ยงเปื้อนจากสัญญา 1 จุด (additive — ตามกติกาข้อ จึงบันทึกที่นี่):** i18n keys ใช้ prefix **`productStudio.*`** แทนที่ PLAN เขียนไว้เป็น `studio.*` — เพราะ key `studio.*` ระดับบนสุด **ถูกหน้าแรก (Drama Studio) ใช้อยู่ก่อนแล้ว** ใน th.json/en.json ใช้ร่วมกันไม่ได้ ถ้าผู้ประสานงานต้องการคีย์ `studio.*` ตาม PLAN เป๊ะ ต้องย้าย key ของหน้าแรกก่อน (นอกขอบเขต frontend ของงานนี้)

**beat roles — สิ่งที่ต้องการจาก backend:** ชื่อ `role` ใน `beats` ของเทมเพลต (PLAN §3 ไม่ได้ fix ค่า string) ฝั่ง frontend กำหนดและแปลผ่าน `productStudio.templates.<id>.beats.<role>` ดังนี้ — `ugc_review`: hook/problem/use_product/result/cta · `unboxing`: hook/unbox/reveal/details/cta · `before_after`: hook/during/after/cta · `problem_solution`: problem/intro/solve/cta · `how_to_use`: hook/step1/step2/step3/cta · `three_reasons`: hook/reason1/reason2/reason3/cta · `comparison`: hook/generic/ours/cta · `try_on`: hook/try/show/cta · `creator_story`: story/turning_point/result/cta · `lifestyle_showcase`: scene1/scene2/scene3/packshot · `asmr_closeup`: macro/texture/sound/packshot · `flash_deal`: hook/show/offer/cta — **Agent A ใช้ role strings เหล่านี้ใน `services/studio-templates.ts` ให้ตรงกัน** (ถ้าต่าง UI จะแสดง role ดิบเป็น fallback ไม่พัง) · หมวดเทมเพลต (category): `review/demo/fashion_beauty/showcase/promo`

**ยังไม่ได้ทดสอบ:** ยิง API จริง (backend Phase Studio ของ Agent A อยู่บน `feat/studio-backend`, ยังไม่ merge) — ตรวจสัญญาด้วย test โครงสร้างเทียบตาราง PLAN เท่านั้น ไม่มี mock หลงเหลือ · environment เครื่อง B (Mac): ใช้ symlink `node_modules` แทน `npm ci` (npm เครื่องนี้บล็อก install scripts; package.json ระหว่าง base เดิมไม่ต่างกัน)

ผลตรวจ: `node --test tests/*.test.mjs` = **83/83 ผ่าน** · `npm run generate` ผ่าน (ไม่มี warning duplicated imports — เปลี่ยนชื่อ exports ฝั่ง studioFlow ที่ชนกับ marketerFlow: `SCRIPT_POLL_INTERVAL_MS`/`isStepDone`/`nextIncompleteStep`/`studioErrorCodeOf`)
