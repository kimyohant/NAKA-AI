# Style Gallery (คลังสไตล์เลขที่) — เลือกสไตล์ภาพด้วยตา จากคลัง 305 แบบ

แรงบันดาลใจจาก [yang0/handraw-style](https://github.com/yang0/handraw-style) (ศึกษา 2026-10-04): แก้ปัญหา "อธิบายสไตล์ไม่ได้ → generate แล้วสไตล์เพี้ยนทุกครั้ง" ด้วยการทำให้เลือกสไตล์เป็น**เลขที่ + รูปพรีวิว** แล้วระบบฉีด prompt ที่ตรงไปให้เอง

**ที่มาข้อมูล/หน้าที่ต้องแนบ:** ข้อมูล 305 สไตล์ (`backend/src/data/handraw-styles.json`) คัดลอก verbatim จาก `skills/handdraw-style-prompter/references/styles.json` ของต้นทาง — license ต้นทางเป็นแบบ permissive มีเงื่อนไข**ต้องแนบ credit ผู้สร้าง** (ดู [ATTRIBUTION.md](ATTRIBUTION.md) + บรรทัด credit ใน UI)

Base: `master` @ `d72c5c3` (หลัง merge Viral Clone Studio; migration ล่าสุด v12 → งานนี้เพิ่ม **v13**)

**หมายเหตุการแบ่งงาน:** รอบนี้ทำทั้ง backend + frontend ใน branch เดียว (`feat/style-gallery`) ตามคำสั่งเจ้าของโปรเจกต์ — backend ส่วนนี้เล็กพอที่ Agent A ใช้รีวิวแทนการเขียนซ้ำ

## 1. แนวคิด

- `style_presets` เดิมมีอยู่แล้ว (dramas.style/campaigns.style ผูกผ่าน `value` → backend ฉีด `prompt` ตอน generate) — งานนี้**ไม่เปลี่ยนสัญญาเดิม** แค่เติม 3 คอลัมน์ + คลัง builtin + UI แกลเลอรี
- เลขสไตล์ (เช่น `FA-001`) อยู่เฉพาะ `name`/`value`/`category` — **ห้ามเข้า `prompt`** (กติกาจาก upstream SKILL.md: โมเดลสร้างภาพจะวาดเลขลงในภาพ)
- `traits` จากต้นทางเป็นภาษาจีน — เก็บตามจริงใน prompt (แก้ไขได้ทุกแถว) · 12 รายการ traits ว่างใช้ชื่อสไตล์ EN อย่างเดียว (ส่วนใหญ่เป็นสไตล์ศิลปิน/แฟรนไชส์ที่โมเดลรู้จักชื่อ)

## 2. Contract

### Migration v13 (`style_presets` + 3 คอลัมน์)

`preview_path TEXT` (รูปพรีวิว /static/...) · `category TEXT` (รหัสกลุ่ม FA–FH) · `source TEXT NOT NULL DEFAULT 'custom'` ('builtin' | 'custom')

### API

| Endpoint | พฤติกรรม |
|---|---|
| `POST /style-presets/import-builtin` | นำเข้าคลัง 305 แบบ **idempotent** — value = `handraw-<เลขลowercase>` (เช่น `handraw-fa-001`), ข้าม value ที่มีอยู่แล้วทั้งหมด (ผู้ใช้แก้/ลบไปไม่ถูกทับ) → `{ imported, skipped }` |
| `PUT /style-presets/:id` | เดิม + รับ `preview_path` (ตั้ง/ล้าง) |
| `GET /style-presets?all=1` | เดิม (snake_case) — คืนคอลัมน์ใหม่ด้วย |

### Prompt composition (กติกา upstream)

`composeStylePrompt(generation_name, traits)` = `{generation_name} hand-drawn illustration style. Core style traits: {traits}` (traits ว่าง → ตัด section ทิ้ง) — test กันเลขหลุด (`\b[A-Z]{2}-\d{3}\b`, `\b\d{3}\b`)

### พรีวิว (ใช้ infra เดิมทั้งสาย — ไม่เขียน backend AI ใหม่)

Frontend ยิง `POST /tasks {type:'image', prompt: <preset.prompt> + หัวข้อทดสอบคงที่}` → poll `GET /tasks/:id` (สูงสุด ~4 นาที) → completed → `PUT /style-presets/:id {preview_path: resultUrl||localPath}` · อัปโหลดเองได้ด้วย `uploadAPI.image` · หัวข้อทดสอบ: หญิงสาวครึ่งตัวถาดกาแฟ พื้นหลังเรียบ (คงที่เพื่อเทียบสไตล์ข้าม preset)

## 3. UI (Settings → สไตล์ภาพ)

แถวเครื่องมือ: ค้นหา (ชื่อ/เลข/ศิลปิน) · ปุ่ม "นำเข้าคลัง 305 สไตล์" (idempotent กดซ้ำได้) · เพิ่มสไตล์ — ชิปหมวด: ทั้งหมด / FA–FH (8 กลุ่ม i18n ไทย+อังกฤษ) / ของฉัน (source=custom) — การ์ด: พรีวิว 4:3 (ไม่มี → ไอคอน), เลข chip, ชื่อ, หมวด, prompt (clamp 2 บรรทัด), toggle ใช้งาน, แก้ไข, ลบ, สร้าง/อัปโหลดพรีวิว — บรรทัด credit ท้ายแท็บ

## 4. Tests

Backend **140/140** (เพิ่ม `style-gallery.test.ts` 5 ตัว: catalog 305/เลขไม่ซ้ำ/8 กลุ่ม, categoryCode, composeStylePrompt + กันเลขหลุด, display name, migration v13 idempotent + fresh-DDL) + อัปเดต version list [1..13] ใน 4 test เดิม · Frontend **113/113** (เพิ่ม `style-gallery-structure.test.mjs` 4 ตัว: gallery UI, สายพรีวิว + กันเลขใน STYLE_PREVIEW_SUBJECT, i18n parity 21 keys + credit, endpoint contract) · typecheck ผ่าน · `npm run generate` ผ่าน

## 5. Phase 2 (ไม่อยู่ใน branch นี้)

- แปล traits จีน → EN prompt ด้วย text provider (ปุ่มต่อแถว/แบตช์) · พรีวิวแบตช์ทั้งหมวด · เลือกสไตล์จากแกลเลอรีตอนกรอก brief ของ Marketer (select พร้อมรูป) · LAYOUTS.md/COLORS.md (โครงร่าง/พาเลต 161+36 รายการของต้นทาง)

---

## Notes from Agent B (ทำเต็ม backend+frontend ตามคำสั่งเจ้าของโปรเจกต์)

- ตัดสินใจ: ไม่ seed ตอน boot (305 แถว) — ใช้ปุ่มนำเข้าใน UI แทน (ผู้ใช้คุมเอง, boot เร็วเหมือนเดิม) · ไม่แตะ `stylePresetSeeds` เดิม (3d/anime/ghibli ฯลฯ ยังทำงานเหมือนเดิม)
- value ใช้ lowercase (`handraw-fa-001`) เพราะ `VALUE_PATTERN` ของ route รับ `[a-z0-9-]` — เลขแสดงจริงบน UI มาจาก `name` ที่มีตัวใหญ่ตามต้นทาง (`FA-001 · …`)
- พรีวิวใช้ route `/tasks` เดิมแบบไม่ผูก storyboard — backend ไม่ต้องแก้ AI ทางสายนี้เลย; งานที่ค้าง reload หน้าจะหาย (เก็บ task id ใน memory การ์ด) — ยอมรับใน MVP
- GET /style-presets คืน snake_case อยู่แล้ว — คอลัมน์ใหม่ไหลผ่านอัตโนมัติ (`preview_path`, `category`, `source`)
