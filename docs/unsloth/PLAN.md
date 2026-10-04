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

_(Agent A เขียนที่นี่)_

## Notes from Agent B (frontend)

_(Agent B เขียนที่นี่)_
