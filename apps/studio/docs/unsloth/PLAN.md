# Unsloth (local) provider — MiniMax H3 video + local text

เพิ่ม **Unsloth Studio** เป็นผู้ให้บริการ **อีกตัว** (ห้ามถอด/เปลี่ยนพฤติกรรมของ provider เดิม: Seedance/volcengine, MiniMax cloud, Wan, Aliyun, OpenAI ฯลฯ — ผู้ใช้เลือกเองใน Settings)
Base: `master` @ `2599adb` (migration ล่าสุด = v11)

## 1. ข้อเท็จจริงที่วัดแล้ว (2026-10-04, server จริง)

Server: RTX 3090 24GB · Ryzen 9 7950X · RAM 64GB · Linux · Unsloth UI Backend **2026.9.14** · API ต้องใช้ `Authorization: Bearer <key>` (ไม่มี key → 401)
Spec เต็ม: `GET <base>/openapi.json` (451 paths) — **อ่านเองก่อนเขียนโค้ด**

| | ค่า |
|---|---|
| วิดีโอ | `unsloth/MiniMax-H3-GGUF` · ไฟล์ `minimax_h3_fl2va_pruned-Q8_0.gguf` (21.4GB, ดาวน์โหลดแล้ว) · family `minimax-h3` · engine `sd_cpp` · `device: cuda` · offload `group` |
| ความสามารถ | `has_audio: true` (เสียงในตัว) · `supports_keyframes: true` (first/last frame) · `supports_references: false` (ต้องใช้ไฟล์ `ref2va` ซึ่งยังไม่ได้โหลด — **ไม่ต้องใช้**, Studio ใช้ keyframe) |
| ความยาว | `num_frames` ต้องอยู่บน lattice `17k + 5`, **ต่ำสุด 124 (5.17s) สูงสุด 345** · fps 24 · presets 5 / 10 / 14.4s |
| ขนาด | presets: 544×960, 768×1344, 768×1024, 1024×1024, 1024×768, 1344×768, 960×544, 1536×672 |
| ความเร็ว | **716s (~12 นาที) ต่อคลิป 5.17s ที่ 544×960, 20 steps** (default 30 steps) · GPU ทำได้ทีละงาน |
| ผลลัพธ์ | mp4 h264 544×960 24fps + AAC stereo 32kHz (mean −34 dB) · ภาพคุณภาพดี (คน/สินค้าคงที่) |
| ข้อความ | `unsloth/Qwen3.8-27B-GGUF` UD-Q5_K_M (19.8GB) — OpenAI-compatible `/v1/chat/completions` · GGUF engine เลือก CPU ได้ (Settings → System → GGUF inference engine) เพื่อไม่แย่ง VRAM กับ H3 |

Endpoints ที่เกี่ยวข้อง (ยืนยันว่ามีใน spec):
- native: `POST /api/inference/video/load` (`model_path`, `gguf_filename`, `h3_task: "fl2va"`, `memory_mode`) · `GET /api/inference/video/status` (loaded/defaults/presets) · `POST /api/inference/video/generate` (`prompt`, `width`, `height`, `num_frames`, `steps`, `seed`, `first_frame`/`last_frame` = **base64/data-URL**, `model` สำหรับ auto-switch) → `{status:"started"}` · `GET /api/inference/video/generate-progress` (**ความคืบหน้าระดับระบบ ไม่ผูก job id**) · ผลอยู่ใน gallery `GET /api/inference/video/gallery/{id}/file`
- OpenAI-style: `POST /v1/videos` → `{id, status, progress, …}` · `GET /v1/videos/{id}` · `GET /v1/videos/{id}/content` — **ติดตามรายงานได้** แต่ request body ไม่ระบุใน spec → ต้อง probe (ดูข้อ 3)
- `GET /v1/models` (คืน `loaded` ต่อโมเดล) · `GET /v1/status`

## 2. เป้าหมาย

1. **Video provider `unsloth`** — Product Studio / episode workbench สร้างวิดีโอด้วย H3 local ได้ (keyframe → video พร้อมเสียง) ค่าใช้จ่าย 0
2. **คิวสำหรับ provider ที่ทำได้ทีละงาน** — ส่งทั้งโปรเจกต์ได้ งานรอคิวไม่ล้ม (ปัจจุบันรอ busy ได้แค่ ~10 นาที)
3. **Studio รู้ข้อจำกัดของโมเดลวิดีโอ** — ช็อตสั้นกว่าที่โมเดลทำได้ไม่ได้ (H3 ≥ 5.17s)
4. **Text provider `unsloth`** — preset ของ OpenAI-compatible + ปุ่มทดสอบ (เชื่อมต่อ + tool calling) + งาน sync ที่ช้า (revise/analyze) เปลี่ยนเป็น async กัน proxy timeout เมื่อใช้โมเดลบน CPU

## 3. Contract

### Provider config (`ai_service_configs`)

- `provider: 'unsloth'` ใช้ได้ทั้ง `service_type` `video` และ `text` (เพิ่มใน `officialProviders`) · `base_url` เช่น `http://127.0.0.1:8888` · `api_key` = key ของ Unsloth
- video `model` = repo id (`unsloth/MiniMax-H3-GGUF`) · `settings` JSON เพิ่ม (ทั้งหมด optional):
  `gguf_filename` (default ไฟล์ fl2va ที่ดาวน์โหลดแล้ว — อ่านจาก `GET /api/models/gguf-variants`), `steps` (default 20), `quality: 'fast' | 'standard'` (fast = preset เล็กสุดตาม aspect เช่น 544×960 · standard = 768×1344), `max_concurrent` (default 1), `queue_timeout_minutes` (default 240)
- **ราคา**: config ใหม่ของ unsloth ตั้ง `price_thb_per_video_second = 0` ให้อัตโนมัติ (ไม่งั้น budget guard จะบล็อก "Set a price…")

### Capabilities (ใหม่ — additive บน `VideoProviderAdapter`)

```ts
interface VideoCapabilities {
  minDurationSec?: number          // H3: 124/24 = 5.17
  durationStepSec?: number         // H3: 17/24
  maxDurationSec?: number          // H3: 345/24
  maxConcurrent?: number           // H3: 1
  nativeAudio?: boolean            // H3: true
  needsPublicUrls?: boolean        // H3: false (ส่ง base64 เอง — ไม่ต้องใช้ PUBLIC_BASE_URL)
}
```
`GET /api/v1/ai-configs/:id/capabilities` (หรือรวมใน response ของ config เดิม) คืนค่านี้ให้ frontend

### Adapter `services/adapters/unsloth-video.ts`

- ส่งงานผ่าน **`/v1/videos`** ถ้า probe แล้วรับ first frame ได้ (ติดตามด้วย id) — ไม่งั้นใช้ native `/api/inference/video/generate` โดยมีคิวภายใน (max 1 งานต่อ config) และยืนยันผลด้วย gallery (prompt/seed/created_at) — **ห้ามมีโอกาสผูกผลผิดงาน**; เขียนเหตุผลที่เลือกใน Notes
- `num_frames` = ค่า lattice ที่เล็กที่สุดที่ ≥ `duration × 24` (ต่ำสุด 124) · ขนาดจาก preset ตาม aspect + `quality`
- first frame: อ่านไฟล์ local แล้วส่งเป็น data URL (ใช้ helper ใน `utils/storage.ts`) — ไม่พึ่ง `PUBLIC_BASE_URL`
- โมเดลยังไม่ load → load ให้ (หรือใช้ `model` auto-switch) แล้วรอ `load-progress` · error ของ Unsloth (เช่น frame count) ต้องขึ้นเป็นข้อความชัดใน sys_task
- ดาวน์โหลดผลลง storage แบบเดียวกับ provider อื่น (poster frame เดิมทำงาน)

### คิว (generation.ts — ทุก provider ที่ประกาศ `maxConcurrent`)

- งานเกิน `maxConcurrent` ต่อ config คงสถานะ `queued` (ไม่ submit) จนช่องว่าง → submit ตามลำดับ `created_at` · ไม่นับเวลารอคิวเป็น timeout ของ poll · เกิน `queue_timeout_minutes` → `failed` + ข้อความชัด
- รีสตาร์ท server: งาน queued กลับเข้าคิวเดิม (`recoverGenerationTasks`)
- provider ที่ไม่ประกาศ `maxConcurrent` ทำงาน **เหมือนเดิมทุกอย่าง**
- sys_task ที่ queued รอคิว: เพิ่มข้อมูลให้ UI แสดง "คิวที่ n" (เช่น ฟิลด์คำนวณใน response ของ `GET /tasks/:id` และ `StudioShot.videoQueuePosition`)

### Studio

- `scaleBeats` / `review_director` ใช้ `minDurationSec` ของ video config ที่ active: ช็อตสั้นกว่านั้นให้รวม beat ติดกัน (ไม่ใช่ยืดทุกช็อต) — ความยาวรวมยังเท่า `durationSec` ของโปรเจกต์ (ปัดขึ้นได้ ≤ 1 ช็อต)
- `durationSec` ต่อช็อตที่ส่งให้วิดีโอ = ค่าบนบท (adapter ปัดขึ้นตาม lattice) · captions ใช้ความยาวจริงจาก ffprobe อยู่แล้ว
- `GET /studio/options` เพิ่ม `videoProvider: { provider, minDurationSec, maxConcurrent, nativeAudio, estimatedSecondsPerClip? }` ของ config ที่ active

### Text

- provider `unsloth` (text) = OpenAI-compatible (`/v1`) — reuse เส้นทางเดียวกับ `openai`
- ขยาย **`POST /ai-configs/test` เดิม** (`routes/aiConfigs.ts`) — provider อื่นทำงานเหมือนเดิม; สำหรับ `unsloth`: text = (1) list models (2) chat ข้อความสั้น (3) **tool-call** ด้วย tool จำลอง 1 ตัว · video = เชื่อมต่อ + `video/status` + ไฟล์ gguf ดาวน์โหลดแล้วไหม (ไม่สร้างวิดีโอ) — ฟิลด์เพิ่มใน response: `{ latencyMs, toolCallOk?, model, loaded, capabilities? }`
- `POST /campaigns/:id/docs/:docId/revise` และ `POST /campaigns/:id/references/:rid/analyze` → เพิ่มโหมด async: body `{ async: true }` ⇒ `202` + สถานะผ่าน `pipeline_tasks` และ `GET` เดิม (doc มี `revising: boolean`, reference มี `analyzing: boolean`) — โหมด sync เดิมยังทำงานเหมือนเดิม

Error codes ใหม่: `E_LOCAL_PROVIDER_UNREACHABLE` (เชื่อมต่อ base URL ไม่ได้/401) · `E_LOCAL_MODEL_NOT_DOWNLOADED` (ไฟล์ gguf ไม่อยู่ในเครื่อง) · `E_VIDEO_QUEUE_TIMEOUT`

## 4. ความปลอดภัย

- **ห้าม commit API key / base URL จริง / IP ของ server** ลง repo, test, docs, log — ใช้ env `UNSLOTH_BASE_URL`, `UNSLOTH_API_KEY` ตอนทดสอบเท่านั้น (ขอจากผู้ใช้)
- production ควรชี้ `http://127.0.0.1:8888` (ปิดพอร์ต 8888 จากภายนอก) — UI Settings แสดงคำเตือนเมื่อ base URL ของ provider `unsloth` เป็น public IP / ไม่ใช่ loopback หรือ private network
- log ต้องไม่พิมพ์ data URL ของรูป (ยาว + เป็นข้อมูลผู้ใช้) — ใช้ `redactUrl` / ตัดสั้น

## 5. การแบ่งงาน

| | Agent A — Backend | Agent B — Frontend |
|---|---|---|
| เจ้าของไฟล์ | `backend/**` + "Notes from Agent A" | `frontend/**` + "Notes from Agent B" |
| Branch | `feat/unsloth-backend` | `feat/unsloth-frontend` |
| Brief | [`AGENT-A-backend.md`](AGENT-A-backend.md) | [`AGENT-B-frontend.md`](AGENT-B-frontend.md) |

กติการ่วม: worktree แยก (`git worktree add ../naka-unsloth-<a|b> -b feat/unsloth-<backend|frontend> origin/master`) · push branch ตัวเองเท่านั้น และ **เช็ก `git ls-remote` ก่อนแจ้งเสร็จ** · ห้าม merge เข้า master · ห้ามแตะ TTS · i18n Studio อยู่ใต้ `productStudio.*`
**GPU ของ server มีใบเดียวและผู้ใช้ใช้งานอยู่** — การทดสอบที่สร้างวิดีโอจริงทำได้ไม่เกิน 2 คลิป (≈25 นาที GPU) และห้าม unload/load โมเดลอื่นทับโดยไม่บอกในรายงาน

---

## Notes from Agent A (backend)

**สถานะ**: ทำครบ 7 tasks + ทดสอบกับ server จริง (2 คลิป) · branch `feat/unsloth-backend` · `npm run typecheck` ผ่าน · node --test (`--test-concurrency=1`) **112/112 ผ่าน** (เดิม 88 + ใหม่ 24)

### ไฟล์ที่แก้
- ใหม่: `services/adapters/unsloth-video.ts` · tests: `unsloth-video-adapter.test.ts`, `unsloth-queue.test.ts` + `unsloth-queue-scenario.ts` (scratch DB), `studio-minduration.test.ts`, `unsloth-security.test.mjs`, `e2e-seed-unsloth-studio.ts` (helper seed สำหรับ e2e ซ้ำ)
- แก้: `adapters/types.ts` (VideoCapabilities + ctx ของ parseGenerateResponse/parsePollResponse + AIConfig.settings), `registry.ts`, `services/ai.ts` (officialProviders + `/v1` base URL + parseConfigSettings), `services/generation.ts` (คิว), `studio-templates.ts` (scaleBeats minDurationSec), `services/studio.ts` + `routes/studio.ts` (options.videoProvider + videoQueuePosition), `routes/tasks.ts` (queuePosition), `routes/aiConfigs.ts` (test endpoint + defaults), `services/marketer.ts` + `pipeline-tasks.ts` + `routes/campaigns.ts` (async revise/analyze), `utils/task-logger.ts` (redact `data:` ทุกชนิด), `utils/storage.ts` (downloadFile รับ headers + เดา ext จาก content-type), tests โครงสร้างเดิม 2 ไฟล์ปรับ regex ให้รวม `unsloth`

### ตัดสินใจ endpoint: ใช้ **native** `/api/inference/video/*` ไม่ใช่ `/v1/videos`
- Probe: `POST /v1/videos` body ว่าง → 400 `prompt: Field required` (handler ตรวจทีละฟิลด์แล้ว early-return, spec ไม่ระบุ body) → **พิสูจน์ไม่ได้ว่ารับ first_frame โดยไม่เสี่ยงสร้างงานจริง**
- Native รับ `first_frame`/`last_frame` (base64/data-URL) ชัดเจนใน spec, คุม `num_frames` บน lattice ได้ตรง และ `GET /video/generate-progress` **คืนผลจบพร้อม GalleryVideo ทั้ง `seed` และ `url`** รวมถึง `error` ตอน failed → ผูกผลด้วย seed ที่ระบบตั้งเอง (`taskId = seed`), ถ้า seed ไม่ตรง = คลิปคนอื่น (progress ระดับระบบ) → รอต่อ ไม่ผูกผลผิด ⇒ ไม่ต้องเดาจาก gallery เลย
- งานทีละงานบังคับด้วย `capabilities.maxConcurrent=1` (คิวใน generation.ts); มีคนใช้ GPU คู่ขนานผ่าน Unsloth UI → submit โดน **HTTP 409** → `isRetryableSubmit` (รอ 15s × 40 ≈ 10 นาที) — generation.ts ส่ง body จาก non-ok response ให้ adapter ตัดสิน (additive, provider อื่นไม่ประกาศ = เหมือนเดิม)

### คิว (Task 3)
- Gate อยู่ใน `startTask` — เกิน `maxConcurrent` (settings `max_concurrent` ทับ capabilities) คง `queued` ไม่ submit; slot นับจาก DB (submitting/processing/unknown) + in-process claims (กัน race ตอน status ยังไม่เปลี่ยน)
- pump หลังงานจบ/ล้ม + sweep ทุก 60s; เกิน `queue_timeout_minutes` → `failed` + `E_VIDEO_QUEUE_TIMEOUT`; `recoverGenerationTasks` คืน queued เข้าคิวเดิม
- UI: `GET /tasks/:id` เพิ่ม `queuePosition`; shot เพิ่ม `videoQueuePosition`
- Test ยืนยัน volcengine 3 งานพร้อมกันถูก submit ทันทีทั้งหมด (ไม่มี gate เหมือนเดิม)

### ความต่างจากสัญญา / จุดที่ต้องรู้
1. **duration → num_frames ใช้ lattice "ใกล้สุด" ไม่ใช่ "เล็กสุดที่ ≥"** — สัญญาเดิมเขียน ceil แต่ชุดเคสใน brief (5→124, 6→141, 10→243, 15→345, 20→345) ต้องใช้ nearest + clamp [124,345] (ceil ให้ 6→158, floor ให้ 10→226) · คลิปจริง ±0.35s จากที่ขอ, captions ใช้ความยาว ffprobe อยู่แล้ว
2. **ดาวน์โหลดผลต้องแนบ Authorization** — gallery file 401 ถ้ายิงเปล่า → `downloadProviderFile` (fallback 401/403 ดึง key จาก config เดิมของงาน) และ `downloadFile` เดานามสกุลจาก Content-Type (gallery URL ไม่มี `.mp4` ใน path → ได้ `.mp4` ถูกต้อง)
3. `estimatedSecondsPerClip` ประกาศ 716s ตามข้อ 1 — **วัดจริงวันนี้ช้ากว่า** (ดูผลวัดด้านล่าง; กระทบแค่ตัวเลข UI)
4. boot order ของ master: `failStaleRunningTasks` ทำงาน**ก่อน** `resumeStaleAutoRenders` → running pipeline ของ auto-render ถูก mark error ก่อน resume จะวิ่ง ⇒ resume pipeline ไม่เคยทำงาน (pre-existing, ไม่ใช่จาก branch นี้ — แนะนำ integrator สลับลำดับ/ยกเว้น kind `studio_render`)
5. Text test ยืนยันถึงขั้น list models + ข้อความ error ชัด (server บอกเอง "No model loaded. Call POST /inference/load first") — **ไม่ได้ยิง chat/tool-call จริง** เพราะ Qwen3.8 ยังไม่โหลด และไม่ load 19.8GB แทนผู้ใช้; ยืนยันเพิ่มได้เมื่อโมเดล warm (endpoint รองรับอยู่แล้ว)
6. `joinProviderUrl` ใส่ query ใน path ไม่ได้ (pathname setter escape `?`) — gguf-variants ต่อ `searchParams` เอง
7. งานรูป/unsloth: ไม่มี image adapter (ตาม PLAN — H3 วิดีโอ + text เท่านั้น)

### ผลวัดจริง 2026-10-04 (server ผู้ใช้, H3 โหลดค้างตามเดิม — ไม่ load/unload อะไร)
ผ่าน Product Studio จริง (keyframe ไทย + บทพูดไทย, seed ผ่าน scratch DB) → วิดีโอ 2 คลิป → FFmpeg merge:
| | ขอ | num_frames | ได้จริง | ไฟล์ | เวลา render |
|---|---|---|---|---|---|
| คลิป 1 (shot scene1) | 5s | 124 | 5.175s · 544×960 · h264 + **AAC 32kHz (มีเสียงพูดไทย)** | 3.70 MB | ≈ 14.3 นาที (07:37:08→07:51:23) |
| คลิป 2 (shot packshot) | 6s | 141 | 5.875s · 544×960 · h264 + AAC | 2.03 MB | ≈ 15.9 นาที (07:06:30→07:22:26) |
| merge | — | — | 11.095s | 1.55 MB | < 20s |
- เฟรมตัวอย่าง: `$TEMP/naka-unsloth-e2e/frame-clip1.png`, `frame-clip2.png` (scratch DB/ไฟล์อยู่ `$TEMP/naka-unsloth-e2e` — ลบได้เมื่อไม่ใช้; มี api_key อยู่ใน scratch DB ของเครื่องนี้เท่านั้น)
- ช่วงทดสอบ server มีงานของผู้ใช้รันค้างอยู่ช่วงหนึ่ง → งานเราได้ 409 ตามคาด และคิว/retry จัดการให้จบเองโดยไม่บุกสล็อต
- งาน 409 ที่หมด retry ก่อนหน้า (task 3/4/5) ไม่ได้เปลือง GPU เลย (submit ไม่ผ่าน) — โควตา 2 คลิปใช้ครบตาม brief

## Notes from Agent B (frontend)

**เสร็จครบ 6 tasks — branch `feat/unsloth-frontend`, base `origin/master @ a453509`**

ไฟล์ที่แก้/เพิ่ม:
- `app/utils/unslothFlow.js` (ใหม่ — logic ล้วน, test import รันจริง): `UNSLOTH_PROVIDER`, `UNSLOTH_VIDEO_DEFAULTS` (gguf_filename/steps/quality/max_concurrent/queue_timeout_minutes ตาม PLAN ข้อ 3), `isLocalOrPrivateBaseUrl` (loopback/10/172.16-31/192.168/169.254/.local/.lan/.internal + IPv6 ::1), `estimateRenderSeconds/Minutes` (ช็อต × เวลาต่อคลิป), `shotsBelowMinDuration`
- `app/pages/settings.vue` — provider `unsloth` ใน text + video (preset "Unsloth (Local)" base `http://127.0.0.1:8888`, โมเดล `unsloth/Qwen3.8-27B-GGUF` / `unsloth/MiniMax-H3-GGUF`); ฟอร์ม video settings (gguf_filename/steps/quality fast-standard/max_concurrent/queue_timeout_minutes — เก็บเป็น `settings` JSON ของ config, defaults ตาม PLAN); ราคาแสดง "฿0 (local)" และ create/update ส่ง `price_*: 0` ให้เอง (ไม่งั้น budget guard บล็อก); คำเตือนเมื่อ base URL ไม่ใช่ loopback/private; คำอธิบาย H3 local (ฟรี ~12 นาที/คลิป ทีละคลิป); ผล test เพิ่ม latency/model/loaded/toolCallOk (toolCall ไม่ผ่านมี hint ว่า agent บันทึกผลไม่ได้); payload ทดสอบแนบ `settings` ให้ backend เช็ค gguf ได้
- `app/composables/useProviderIcon.ts` — MODEL_PROVIDER_HINTS: โมเดล `unsloth/...` → provider `unsloth` (ยังไม่มีไอคอนไฟล์ — ใช้ letter badge "U"; ถ้ามีไฟล์ icon มาภายหลังเพิ่มใน FILENAMES จุดเดียว)
- `app/composables/useApi.ts` — `StudioShot.videoQueuePosition`, `StudioOptions.videoProvider` (`StudioVideoProviderInfo`), `CampaignDoc.revising`, `AdReference.analyzing`; `reviseDoc`/`analyzeReference` เพิ่ม param `asyncMode = true` (ส่ง `{ async: true }` เสมอ)
- Product Studio — `workspace.vue`: ใช้ `options.videoProvider` — ขั้นตั้งค่าแสดง min duration + เตือนช็อตที่สั้นกว่า + ประมาณเวลาทั้งโปรเจกต์ (~นาที จาก `estimatedSecondsPerClip` × จำนวนช็อต เฉพาะ provider local), แถบ auto-render แสดงจำนวนช็อตรอคิว; `StudioShotCard.vue`: skeleton วิดีโอแสดง "คิวที่ n" จาก `videoQueuePosition`
- `app/views/drama/episode.vue` — row builder ส่ง `queuePosition` (จาก `t.queue_position`), `genTaskStatusLabel` รู้จัก `queued`, chip "คิวที่ n" คู่สถานะ (เฉพาะ kind=video — provider อื่นไม่มีค่านี้จึงไม่เปลี่ยน)
- Marketer — `MarketerDocCard`/`MarketerReferenceCard`: revise/analyze ส่ง async (POST 202) → emit `async-started` → หน้า `campaign.vue` refresh + poll ต่อด้วย timer เดิม (เงื่อนไขเพิ่ม `anyDocBusy` = มี `doc.revising` หรือ `reference.analyzing`) · การ์ดแสดง spinner จาก flag ที่ GET รายงาน · จบ → toast ครั้งเดียว · ปุ่มอื่นไม่ถูกบล็อก
- i18n th+en: `settings.cfg.unsloth.*` (15 keys), `productStudio.settings.{minDurationHint,belowMinWarn,estimateTotal,queuedCount,queuePosition}`, `episode.tasks.{queued,queuePosition}`, `errors.codes.{E_LOCAL_PROVIDER_UNREACHABLE,E_LOCAL_MODEL_NOT_DOWNLOADED,E_VIDEO_QUEUE_TIMEOUT}`
- `tests/unsloth-structure.test.mjs` (ใหม่, 8 tests) + ปรับ `tests/official-provider-settings.test.mjs` (list text/video รับ 'unsloth')

ผลตรวจ: `node --test tests/*.test.mjs` = **102/102 ผ่าน** · `npm run generate` ผ่าน

**ความปลอดภัย (PLAN ข้อ 4):** ไม่มี API key/IP จริงในโค้ด (test กันไว้: สแกน `sk-…` และ IPv4 literal ที่ไม่ใช่ loopback/private) · base URL เดียวที่ปรากฏคือ `http://127.0.0.1:8888` ตามที่ PLAN แนะนำ · ไม่มี data URL ใดเกี่ยวข้องฝั่ง frontend

**สิ่งที่คาดหวังจาก backend (Agent A):** ชื่อ field `settings` (JSON) บน `ai_service_configs` — create/update รับและ GET คืนเป็น object หรือ JSON string (frontend parse ทั้งสองได้) · งาน queued รายงาน `queue_position` ใน `GET /episodes/:id/generation-tasks` และ `StudioShot.videoQueuePosition` · `GET /studio/options` → `videoProvider` เฉพาะเมื่อ config วิดีโอ active เป็น local (ไม่มี = frontend ซ่อน estimate/คำเตือน) · `revise/analyze` รับ `async: true` และ GET รายงาน `revising`/`analyzing` · test endpoint คืน `latencyMs/toolCallOk/model/loaded/capabilities`

**ยังไม่ได้ทดสอบ:** ยิง API จริง (backend Unsloth อยู่บน `feat/unsloth-backend`, ยังไม่ merge ตอนงานนี้เสร็จ) — ตรวจสัญญาด้วย test โครงสร้าง ไม่มี mock หลงเหลือ · environment เครื่อง B (Mac): ใช้ symlink `node_modules` แทน `npm ci` (npm เครื่องนี้บล็อก install scripts; package.json ไม่ต่างจาก base)
