# Viral Clone Studio (สตูดิโอโคลนไวรัล) — โคลน "โครง" คลิปไวรัลเป็นตัวแปรโฆษณาหลายชุด

เมนูใหม่ตัวที่ 4 ของ NAKA-AI แรงบันดาลใจจาก [hypit-ai/hypit](https://github.com/hypit-ai/hypit) (ศึกษา 2026-10-01): ยัดคลิปต้นแบบ → แยกเป็น **workflow ทั้งชุด** (beat, ซับ word-level, B-roll, เอฟเฟกต์ — ยึดกับ *คำพูด* ไม่ใช่วินาที) → สร้างตัวแปรจำนวนมากโดยสลับเฉพาะ hook / สินค้า / ผู้พูด / ภาษา แล้ว render ทั้งชุด

**ปรับเป็นของ NAKA-AI เอง — ห้ามคัดลอกโค้ดจาก Hypit** (license ของมันเป็น "Hypit Open Source License" เฉพาะของตัวเอง ไม่ใช่ Apache/MIT แม้ README ติด badge — ใช้เฉพาะแนวคิด รูปแบบเดียวกับที่เคยทำกับ Topview)

Base: `master` @ `efb1060` (unsloth merge แล้ว · migration ล่าสุด = v11 → งานนี้เพิ่ม v12)

## 1. แนวคิดและขอบเขต

**Core loop 3 ขั้น (หน้าเดียว `/viral-clone` — pattern เดียวกับ marketer):**

1. **สร้างโปรเจกต์** — ชื่อ + **transcript ของคลิปต้นแบบ (ผู้ใช้วางเอง)** + ภาษา + ไฟล์วิดีโออ้างอิง (optional, อัปโหลดเอง)
2. **Blueprint** (โครงคลิป) — กด "วิเคราะห์" → LLM แปลง transcript เป็น beat list ที่ยึดกับคำพูด + hook สำรอง + สไตล์ซับ → **ผู้ใช้แก้ไขได้ทุก beat**
3. **ตัวแปร + Render** — เลือก matrix (hook × สินค้าจาก Product Studio × avatar × ภาษา) → สร้าง batch variants → เข้าคิว render ผ่าน pipeline เดิม → กระดานผลลัพธ์ (สถานะ/พรีวิว/ดาวน์โหลด)

**ทำไม transcript-first:** ระบบไม่มี ASR (และห้ามแตะ TTS) — transcript ที่ผู้ใช้วางเองให้ผลลัพธ์ word-anchored ตรงแนวคิด Hypit โดยไม่ต้องเพิ่ม audio pipeline; ไฟล์วิดีโออ้างอิงเก็บไว้เพื่อ "ดูเทียบ" ในหน้า workspace (phase 2 จะทำตัดเฟรมเทียบ)

**Out of scope Phase 1** (บันทึกไว้ทำภายหลัง — ไม่อยู่ใน brief นี้): ASR อัตโนมัติ (whisper local) · import จาก AdReference ของ Marketer · ส่ง variant เข้าแคมเปญ · aspect อื่นนอกจาก 9:16 · ตัดเฟรมเทียบกับคลิปต้นฉบับ · **ตัวดาวน์โหลดจาก TikTok/Reels/YouTube — ห้ามทำ** (ดูข้อ 4)

## 2. เป้าหมาย (Phase 1 — วัดได้)

1. สร้างโปรเจกต์จาก transcript → กดวิเคราะห์ (async 202) → ได้ Blueprint ตาม schema ข้อ 3 และแก้ไข/บันทึกได้
2. สร้างตัวแปรแบบ matrix (Cartesian) ได้จริง: เลือก hooks 2 ตัว + สินค้า 2 + ภาษา 2 = 8 variants ในคลิกเดียว (cap 12/batch)
3. Render ทั้ง batch ผ่านคิวเดิม — เห็นสถานะ queued/progress/queue position, งานล้มมี error_code เป็นภาษาผู้ใช้ (toastJobError pattern)
4. กระดานตัวแปรแสดงผลครบ: พรีวิววิดีโอ, ความยาวจริง, ดาวน์โหลด, สร้างเพิ่มจาก matrix เดิมได้
5. i18n th/en ครบทุกข้อความใหม่ (namespace `viralClone.*`)

## 3. Contract

### Data model (migration **v12**)

- `clone_projects`: `id, name, status ('draft'|'analyzing'|'ready'|'error'), reference_path (NULL ได้), reference_transcript (TEXT), language ('th' default), blueprint_json (NULL จนวิเคราะห์เสร็จ), error_code, created_at, updated_at`
- `clone_variants`: `id, project_id, label, overrides_json {hookIndex, productId, avatarId, language}, status ('draft'|'queued'|'rendering'|'completed'|'failed'), output_path, duration_sec, error_code, pipeline_task_id, created_at`
- `productId`/`avatarId` อ้างตารางของ Product Studio เดิม (เก็บ id, ตรวจว่ามีจริงตอน render — ไม่ทำ FK แข็ง)
- งาน async ทุกชนิดผูกกับ `pipeline_tasks` + `error_code` ตาม pipeline เดิม (migration 7) — **ห้ามใช้ข้อความ error ดิบจาก provider**

### Blueprint JSON (สัญญากลาง — Agent A สร้าง/validate, Agent B แสดง/แก้)

```json
{
  "title": "…",
  "durationSec": 30,
  "beats": [
    { "id": "b1", "role": "hook|demo|proof|offer|cta", "line": "ข้อความพูด/ซับ", "visual": "product|avatar|broll|text", "visualHint": "…", "durationSec": 3.5 }
  ],
  "hooks": ["ข้อความ hook สำรอง (แทน beat แรก)", "…"],
  "captionStyle": { "…เหมือน Studio เดิม…" }
}
```

- `hooks[]` = ทางเลือกแทน `line` ของ beat แรก (role `hook`) — variant ที่ระบุ `hookIndex` ใช้ข้อความนั้นแทน
- `durationSec` รวมของ beats อาจไม่ตรง `durationSec` หัวโปรเจกต์พอดี — แสดงผลตามจริง ไม่บังคับปัด

### API (`routes/clone.ts`, mount ใต้ `/api/v1/clone`)

| Method + Path | พฤติกรรม |
|---|---|
| `POST /clone/projects` | สร้างโปรเจกต์ `{ name, transcript, language? }` (+ไฟล์ reference แบบ multipart ได้) → 201 · transcript ว่าง → 400 ข้อความชัด |
| `GET /clone/projects` · `GET /clone/projects/:id` | รายการ / รายละเอียด (รวม variants) |
| `PATCH /clone/projects/:id` | แก้ name/transcript/language |
| `POST /clone/projects/:id/analyze` | `{ async: true }` → **202** + pipeline_tasks (pattern เดียวกับ analyzeReference) → เขียน `blueprint_json`; ตรวจ JSON ที่ LLM คืนกับ schema — พัง → repair 1 ครั้ง แล้วยังพัง → project `error` + `E_CLONE_ANALYZE_FAILED` |
| `PUT /clone/projects/:id/blueprint` | บันทึก blueprint ที่แก้ (validate schema ก่อนเซฟ) |
| `POST /clone/projects/:id/variants` | `{ matrix: { hookIndexes: [], productIds: [], avatarIds: [], languages: [] } }` → Cartesian → 201 list · **เกิน 12 ต่อ batch → 400 + `E_CLONE_MATRIX_TOO_LARGE`** |
| `POST /clone/variants/:id/render` · `POST /clone/projects/:id/render-all` | `{ async: true }` → 202 → variant `queued` → เข้าคิว pipeline |

### Render path (reuse pipeline ของ Product Studio — ไม่สร้าง renderer ใหม่)

- variant → beats → keyframe (image provider, refs จาก productImages/avatar) → คลิป (video provider + `capabilities.minDurationSec` — beat สั้นกว่านั้น **รวม beat ติดกัน** เหมือน `scaleBeats` เดิม) → captions burn-in → FFmpeg merge → `output_path` + `duration_sec` จาก ffprobe
- ภาษาตัวแปร ≠ ภาษาโปรเจกต์ → แปล `line`/`hooks` ด้วย text provider ก่อน render (เก็บผลแปลต่อ variant ใน overrides_json หรือ field แยก — **Agent A ตัดสินและบันทึกใน Notes**)
- จะใช้ `pipeline_tasks.kind` เดิม (`studio_render`) หรือ kind ใหม่ (`clone_render`) — **Agent A ตัดสิน**; ถ้า kind ใหม่ ต้องครอบ boot-resume + `recoverGenerationTasks` ให้ครบ (บทเรียนจาก unsloth Notes ข้อ 4)

### Error codes ใหม่

`E_CLONE_ANALYZE_FAILED` · `E_CLONE_MATRIX_TOO_LARGE` · render fail ใช้ code เดิมที่ครอบคลุมอยู่แล้วถ้าไม่ต้องเพิ่ม (ยืนยันจริงใน Notes)

### i18n

- namespace ใหม่ top-level **`viralClone.*`** (ห้ามใช้ `studio.*` — เป็นของหน้าแรก; ห้ามแตะ `productStudio.*` ยกเว้น reuse ข้อความเดิมตรง ๆ)
- `layout.nav.viralClone` = "สตูดิโอโคลนไวรัล" / "Viral Clone Studio" · th/en parity บังคับด้วย test

## 4. ความปลอดภัยและข้อกฎหมาย

- **โคลน "โครง" ไม่ใช่ทรัพย์สิน**: UI หน้าสร้างโปรเจกต์ต้องมีข้อความแนะนำชัด — ใช้วิดีโอ/ภาพ/เสียงของผู้ใช้เองหรือที่ได้สิทธิ์แล้วเท่านั้น; ระบบเก็บเฉพาะ transcript + ไฟล์ที่ผู้ใช้อัปโหลด
- **ห้ามสร้างตัวดาวน์โหลด URL จากแพลตฟอร์ม** (TikTok/Reels/YouTube — ผิด ToS) — รับเฉพาะไฟล์อัปโหลด
- คงกติกาเดิมทุกข้อ: ไม่มี API key/IP จริงในโค้ด-เอกสาร-log (test สแกน `sk-…` + IPv4 ที่ไม่ใช่ loopback/private) · ไม่แตะ TTS · log ไม่พิมพ์ data URL

## 5. การแบ่งงาน

| | Agent A — Backend | Agent B — Frontend |
|---|---|---|
| เจ้าของไฟล์ | `backend/**` + "Notes from Agent A" | `frontend/**` + "Notes from Agent B" |
| Branch | `feat/viralclone-backend` | `feat/viralclone-frontend` |
| Brief | [`AGENT-A-backend.md`](AGENT-A-backend.md) | [`AGENT-B-frontend.md`](AGENT-B-frontend.md) |

กติการ่วม: worktree แยก (`git worktree add ../naka-viralclone-<a|b> -b feat/viralclone-<backend|frontend> origin/master`) · push branch ตัวเองเท่านั้น และ **เช็ก `git ls-remote` ก่อนแจ้งเสร็จ** · ห้าม merge เข้า master · สัญญาเปลี่ยนระหว่างทาง → บันทึกใน Notes แบบ additive

Phase 2 (ภายหลัง — แยก brief): import จาก AdReference · ส่ง variant เข้าแคมเปญ Marketer · ASR local · aspect อื่น · ตัดเฟรมเทียบ

---

## Notes from Agent A (backend)

(จะบันทึกเมื่อทำงานจริง)

## Notes from Agent B (frontend)

(จะบันทึกเมื่อทำงานจริง)
