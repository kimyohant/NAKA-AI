# AI Influencer — สตูดิโอสินค้า (v14)

แรงบันดาลใจจาก buzzy.now AI Influencer — ปรับเข้ากับ pipeline ของ naka-ai:
**สร้างพรีเซนเตอร์ AI (จากข้อความ/รูปอ้างอิง) → คุมหน้าเดิมทุกภาพ (reference image) → สเกลคอนเทนต์รีวิวสินค้า**
(ภาพรีวิวต่อฉาก + สคริปต์รีวิวสั้นสำหรับ TikTok/Shopee-style)

Base: master @ d817906 (branch `integrate/style-and-unsloth-image`) · migration **v14**

## โมเดลข้อมูล

### `studio_influencers` (v14)
| คอลัมน์ | ประเภท | หมายเหตุ |
|---|---|---|
| id | INTEGER PK | |
| name | TEXT NOT NULL | ชื่อแสดงผล |
| niche | TEXT | `beauty/fashion/food/tech/fitness/lifestyle/gaming/travel/home/mom_baby` |
| persona | TEXT | บุคลิก/สไตล์การพูด — ใช้เขียนสคริปต์รีวิว |
| appearance | TEXT | ลุค/หน้าตา — ใช้ประกอบ prompt รูป |
| locale / tone | TEXT | ตลาดหลัก (StudioMarket) / โทนเสียง |
| image_url | TEXT | รูปอัปโหลด (มาก่อนเสมอ — pattern เดียวกับ studio_avatars) |
| image_task_id | INTEGER | → sys_task ของ portrait ที่ AI สร้าง |
| created_at / updated_at / deleted_at | TEXT | soft delete |

### `studio_influencer_contents` (v14)
คอนเทนต์รีวิวต่อชิ้น — `kind = 'image'` (ผลลัพธ์อ่านสดจาก sys_task ผ่าน `task_id`)
หรือ `kind = 'script'` (ข้อความอยู่ใน `script`, รัน async ผ่าน `pipeline_tasks` kind `influencer_script`)

### `studio_projects.influencer_id` (v14)
ผูก influencer เข้าโปรเจกต์ — presenter ที่มีรูป = avatar **หรือ** influencer ตัวใดตัวหนึ่ง:
- `E_AVATAR_REQUIRED` ผ่านเมื่อ influencer มีรูป (template.avatarMode = required)
- บท: แนบ persona/tone ของ influencer ให้ review_director
- keyframes: ใส่รูป influencer ต่อท้าย reference images (คุมหน้าเดิม)
- prompt ช็อต: presenter = avatar ก่อน ไม่มี → influencer (persona + appearance)

## ความสม่ำเสมอ (Consistency)

- Portrait: ถ้ามีรูปตัวตนอยู่แล้ว (upload หรือ portrait เดิม) → ส่งเป็น reference image เพื่อรักษาหน้าเดิม
- ภาพรีวิว: references = `[รูป influencer, รูปสินค้า]` — prompt ล็อกสองอย่าง:
  identity (หน้า/ทรงผม ตาม reference แรก) + product accuracy (ดีไซน์/ฉลาก/สี ตาม reference ที่สอง)
- ฉากมาตรฐาน: `unboxing / holding / using / closeup / lifestyle`

## Endpoints — เพิ่มใน `/api/v1/studio`

| VERB | Path | Body / Query | คืน |
|---|---|---|---|
| GET | `/influencers` | — | `StudioInfluencer[]` (ใหม่→เก่า) |
| POST | `/influencers` | `{ name*, niche?, persona?, appearance?, locale?, tone?, imageUrl? }` | `StudioInfluencer` |
| PUT | `/influencers/:id` | ฟิลด์เดียวกับ POST (partial) | `StudioInfluencer` |
| DELETE | `/influencers/:id` | — | soft delete |
| POST | `/influencers/:id/generate-image` | `{ instruction? }` | `StudioInfluencer` (imageStatus → poll) |
| GET | `/influencers/:id/contents` | — | `StudioInfluencerContent[]` |
| POST | `/influencers/:id/contents/images` | `{ productName*, productImage*, scenes?, count?, aspectRatio?, instruction? }` | `StudioInfluencerContent[]` (processing) |
| POST | `/influencers/:id/contents/script` | `{ productName*, productDescription?, language?, platform?, durationSec?, instruction? }` | `StudioInfluencerContent` (processing → poll GET contents) |
| DELETE | `/influencers/:id/contents/:contentId` | — | hard delete รายชิ้น |

JSON camelCase เหมือน studio endpoints อื่น · error codes ใหม่:
`E_INFLUENCER_NO_IMAGE` (ยังไม่มีรูปพรีเซนเตอร์ — ต้องมีก่อนสร้างภาพรีวิว),
`E_INFLUENCER_BUSY` (สคริปต์รีวิวกำลังวิ่งอยู่)

## Agent

`influencer_writer` (ไม่มี tool — คืนข้อความล้วน แบบเดียวกับ viral_translator):
เขียนสคริปต์รีวิวสั้น HOOK → PROBLEM → DEMO/PROOF → CTA ตาม persona/tone ของ influencer
ภาษาตามที่กำหนด · ความยาวตาม durationSec · ห้ามอ้าง claim ที่ไม่ได้ให้ · ห้ามชื่อแบบคู่แข่ง

## UI

- แท็บที่ 3 "อินฟลูเอนเซอร์" ในหน้าสตูดิโอสินค้า (`/studio?tab=influencers`) — การ์ด `StudioInfluencerCard.vue`
  + ไดอะล็อกคอนเทนต์ `StudioInfluencerContentDialog.vue` (สินค้า + ฉาก + ภาพรีวิว + สคริปต์ + ผลลัพธ์ poll)
- workspace ขั้น "ตั้งค่า": picker เลือก influencer คู่กับ avatar (`settingsDraft.influencerId`)

## ขอบเขต (ออกแบบให้เลียนแบบ buzzy แต่ทำใน pipeline ของ naka-ai)

- ภาพ/สคริปต์รีวิวอยู่นอก pipeline วิดีโอ (ไม่ผูก drama/episode) — ใช้ `sys_task`/`pipeline_tasks` ของเดิม
- วิดีโอรีวิวเต็มรูปแบบยังผลิตผ่านโปรเจกต์ Studio (ผูก influencer เข้า project ได้จากขั้นตั้งค่า)
