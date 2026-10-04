# Agent A — Backend: Unsloth provider (H3 video + local text)

อ่านก่อน: `CLAUDE.md`, **`docs/unsloth/PLAN.md` (ข้อ 1 = ข้อเท็จจริงที่วัดแล้ว, ข้อ 3–4 = สัญญา)**, `docs/product-studio/PLAN.md` + `PHASE2.md`
เจ้าของไฟล์: `backend/**` — **ห้ามแก้ `frontend/**`**

## Setup

```
git fetch origin
git worktree add ../naka-unsloth-a -b feat/unsloth-backend origin/master
cd ../naka-unsloth-a/backend && npm ci
```
ขอ `UNSLOTH_BASE_URL` / `UNSLOTH_API_KEY` จากผู้ใช้ — ใช้ผ่าน env ตอนทดสอบเท่านั้น **ห้าม commit**

## Tasks

1. **Probe ก่อนเขียน** — อ่าน `<base>/openapi.json` · ลอง `POST /v1/videos` แบบไม่สร้างจริงไม่ได้ จึงทำแค่: ดู schema/ข้อความ error เมื่อส่ง body ไม่ครบ (422 บอกฟิลด์) เพื่อรู้ว่ารับ `first_frame`/`input_reference` ไหม · ตัดสินใจ `/v1/videos` vs native + เขียนเหตุผลใน Notes

2. **`services/adapters/unsloth-video.ts`** + ลงทะเบียนใน `registry.ts` (key `unsloth`) + เพิ่ม `unsloth` ใน `officialProviders` (video, text) ตาม PLAN ข้อ 3
   - `num_frames` lattice / presets ตาม aspect + `quality` / first frame เป็น data URL / load โมเดลถ้ายังไม่ load / ดาวน์โหลดผลลง storage
   - unit test: แปลง duration → num_frames (5→124, 6→141, 10→243, 15→345, 20→345 + ข้อความเตือน), aspect → size, payload ไม่มี URL `/static/` ดิบ

3. **Capabilities + คิว** (`adapters/types.ts`, `generation.ts`) ตาม PLAN ข้อ 3
   - งานเกิน `maxConcurrent` ต่อ config อยู่ `queued` ไม่ submit, เรียงตาม created_at, ไม่กินเวลา poll, `queue_timeout_minutes` → `E_VIDEO_QUEUE_TIMEOUT`, recover หลังรีสตาร์ท
   - **provider เดิมต้องทำงานเหมือนเดิมทุกอย่าง** — test ยืนยัน (เช่น volcengine 3 งานพร้อมกันยัง submit ทันทีทั้ง 3)
   - ตำแหน่งคิวสำหรับ UI (`GET /tasks/:id`, `StudioShot.videoQueuePosition`)

4. **Config defaults** — สร้าง config `unsloth` ใหม่: `price_thb_per_video_second = 0` อัตโนมัติ, settings default (`steps` 20, `quality` fast, `max_concurrent` 1, `queue_timeout_minutes` 240)

5. **Studio ↔ capabilities** — `scaleBeats`/`review_director` เคารพ `minDurationSec` (รวม beat ติดกันแทนยืดทุกช็อต), `GET /studio/options` คืน `videoProvider` · test: ugc_review 30s กับ H3 ได้ช็อตทุกตัว ≥ 5.17s และรวม ≈ 30s; กับ provider ไม่มี minDuration ได้ผลเท่าเดิม (snapshot)

6. **Text + test endpoint + async revise/analyze** ตาม PLAN ข้อ 3 — ขยาย `POST /ai-configs/test` เดิม · revise/analyze โหมด `{ async: true }` ผ่าน `pipeline_tasks` (sync เดิมไม่เปลี่ยน) · boot เคลียร์ค้าง

7. **Security** ตาม PLAN ข้อ 4 — ไม่ log data URL, ไม่มี key/IP จริงใน repo (เพิ่ม test grep กัน `sk-unsloth-` และ IP ที่ไม่ใช่ loopback/private ใน `backend/**`)

## ทดสอบกับ server จริง (จำกัด GPU)

- ทดสอบ `ai-configs/test` (text + video) และ adapter แบบ end-to-end **ได้ไม่เกิน 2 คลิป** (≈25 นาที GPU) — ช็อตจาก Product Studio จริง (keyframe ไทย + บทพูดไทย) ผ่าน auto-render บน `PORT=5680` + DB ทดสอบ
- ถ้าต้อง load/unload โมเดลบน server ให้เขียนใน Notes ว่าทำอะไร และคืนสภาพเดิม (H3 โหลดค้างอยู่ตอนเริ่มงาน)
- แนบ: เวลาที่ใช้จริงต่อคลิป, ขนาดไฟล์, มีเสียงไหม, 1 เฟรมจากคลิป

## Done when
- `npm run typecheck` ผ่าน · test เดิม + ใหม่ผ่าน 100% (`--test-concurrency=1` ได้)
- Notes from Agent A ใน `docs/unsloth/PLAN.md` (ไฟล์ที่แก้, ตัดสินใจ endpoint, ผลวัดจริง, ความต่างจากสัญญา)
- commit + `git push -u origin feat/unsloth-backend` + เช็ก `git ls-remote origin feat/unsloth-backend` — **ห้าม merge เข้า master**
