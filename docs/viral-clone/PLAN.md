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

**เสร็จครบ 8 tasks — branch `feat/viralclone-frontend`, 109/109 tests ผ่าน, `npm run generate` ผ่าน**

ไฟล์ที่แก้/เพิ่ม:
- `app/utils/viralCloneFlow.js` (ใหม่ — logic ล้วน): `CLONE_BEAT_ROLES/CLONE_VISUALS/CLONE_LANGUAGES/CLONE_MATRIX_CAP(12)/CLONE_POLL_INTERVAL_MS(3000)`, `isCloneProjectBusy/isCloneVariantBusy`, `cloneErrorCodeOf` (ดึง `E_CODE` จาก "E_CODE: message"), `matrixVariantCount` (Cartesian — มุมว่าง = default นับ 1), `matrixOverCap`, `beatsTotalSeconds`, `usableHooks`, `isValidBlueprint`, `cloneBeatDefaults`
- `app/composables/useApi.ts` — types `CloneProject/CloneVariant/CloneBeat/CloneBlueprint/CloneVariantOverrides/CloneMatrix/CloneDetail` + `cloneAPI` (list/create/get/update/analyze/saveBlueprint/createVariants/renderVariant/renderAll/del/delVariant — async endpoints ส่ง `{ async: true }` เสมอ)
- `app/pages/viral-clone.vue` (ใหม่ — รายการโปรเจกต์): การ์ดสถานะ/beats/วันที่ + create dialog (name, transcript บังคับ, language th/en, อัปโหลดคลิปต้นแบบ optional ผ่าน `uploadAPI.video` → ส่ง `referencePath`) + **license notice แสดงบังคับ** (PLAN ข้อ 4) + delete ผ่าน ConfirmDialog + poll รายการเบา ๆ เมื่อมี analyzing
- `app/views/viralclone/workspace.vue` (ใหม่ — workspace 3 แท็บ): Blueprint (analyze ปุ่มเดียวเมื่อยังไม่มี + แสดง error ผ่าน `errors.codes.*` เมื่อ project status=error) / ตัวแปร (MatrixBuilder + render-all + การ์ดตัวแปร) / อ้างอิง (แก้ transcript + พรีวิวคลิป) · **poll timer เดียว 3s** เมื่อ analyzing หรือมี variant queued/rendering เท่านั้น · โหลด products/avatars จาก `studioAPI` ครั้งเดียวสำหรับ matrix และชิปชื่อ
- `app/components/ViralCloneBlueprintEditor.vue` (ใหม่): แก้ beats ได้ทุก field + hooks เพิ่ม/ลบ + total seconds + validate ก่อนบันทึก; **draft + dirty flag — poll ระหว่าง render ไม่ทับสิ่งที่กำลังแก้**
- `app/components/ViralCloneMatrixBuilder.vue` (ใหม่): hooks (ไม่เลือก = ใช้ของเดิม) × สินค้า × avatar × ภาษา, แสดงจำนวนสด + เกิน cap 12 → เตือน + disabled สร้าง
- `app/components/ViralCloneVariantCard.vue` (ใหม่): สถานะ/คิวที่ n/ชิปสรุป overrides/พรีวิววิดีโอ/error แปลรหัสก่อน/render+download+delete
- `app/layouts/default.vue` — ลิงก์ `/viral-clone` (ไอคอน lucide `Copy`) + `isViralCloneRoute`
- `nuxt.config.ts` — route `viralclone-workspace` `/viral-clone/:id` → workspace (ใน `pages:extend` เดิม)
- i18n th+en: `layout.nav.viralClone`, `viralClone.*` (102 leaf keys, parity ยืนยันด้วย test), `errors.codes.{E_CLONE_ANALYZE_FAILED,E_CLONE_MATRIX_TOO_LARGE}`
- `tests/viralclone-structure.test.mjs` (ใหม่, 8 tests): nav+route, endpoint surface ตาม PLAN §3, logic รันจริง, **สแกนชื่อ export ซ้ำกับ flow อื่น (กัน auto-import collision)**, wiring, security scan, i18n parity

**ความต่างจากสัญญา/brief (additive):**
1. **Base ของ branch = `docs/viral-clone-plan` @ 35b03c7** (origin/master efb1060 + เอกสาร 3 ไฟล์) ไม่ใช่ origin/master ตรง ๆ — ตอนเริ่มงาน PLAN/brief ยังไม่ได้ push ขึ้น origin; merge branch นี้จะได้เอกสารมาด้วย
2. **workspace เป็น dynamic route `/viral-clone/:id` ผ่าน `pages:extend` + `app/views/viralclone/`** ตามสถาปัตยกรรมจริงของแอป (marketer/studio/drama ล้วนทำแบบนี้ — brief เดิมเข้าใจว่า marketer ใช้ state ในหน้าเดียวซึ่งไม่จริง); หน้า list ยังเป็น `pages/viral-clone.vue` ตามสัญญา
3. **เพิ่ม `DELETE /clone/projects/:id` และ `DELETE /clone/variants/:id`** — PLAN §3 ไม่มีตาราง DELETE แต่ UX รายการ/การ์ดต้องลบได้เหมือน marketer; Agent A ทำตามนี้ได้เลย
4. **reference อัปโหลดแยกก่อน**: `uploadAPI.video` → `POST /clone/projects` รับ `referencePath` (string path จาก upload) — ไม่ส่ง multipart ตรงตามที่ PLAN เขียนไว้ ("+ไฟล์ reference แบบ multipart ได้"); backend เลือกรับแบบเดียว (referencePath) ก็พอ
5. i18n เพิ่ม keys ที่งานต้องใช้นอกชุดร่างแรก: `viralClone.delete.{title,message}`, `viralClone.blueprint.analyzeStarted`, `viralClone.work.{tabsLabel,loadFailed}`, `viralClone.variants.{created,renderAllQueued,deleted,duration}`, `viralClone.languages.{th,en}`, `viralClone.roles.*`, `viralClone.visuals.*` — ทุก key อยู่ใต้ `viralClone.*` เท่านั้น

**สิ่งที่คาดหวังจาก backend (Agent A):** JSON camelCase เหมือน marketer/studio · `blueprint` คืนเป็น object · `outputPath` เป็น path แบบ `/static/...` ที่ `<video>`/`<a download>` ใช้ตรง ๆ · `errorCode` + `errorMsg` รูปแบบ `"E_CODE: message"` · variant `queuePosition` (งาน queued ตามคิว unsloth) · `analyze`/`render*` รับ `{ async: true }` → 202 · `GET /clone/projects/:id` คืน project + `variants` · status enums ตาม types ใน useApi.ts

**ยังไม่ได้ทดสอบ:** ยิง API จริง (backend ยังไม่มี — ตรวจสัญญาด้วย test โครงสร้าง) · environment เครื่อง B (Mac): symlink node_modules แทน npm ci (package.json ตรงกับ base)
