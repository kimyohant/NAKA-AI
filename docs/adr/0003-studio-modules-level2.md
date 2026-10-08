# ADR-003: แยก Studio เป็นโมดูลตามเมนู (ระดับ 2)

**Status:** Proposed
**Date:** 2026-10-08
**ขอบเขต:** จัดโฟลเดอร์ภายใน `services/studio-api` และ `apps/studio-web` ใหม่ **ไม่เปลี่ยน URL ของ API, ไม่เปลี่ยน DB, ไม่เปลี่ยนวิธี deploy**

---

## 1. ผลการวิเคราะห์ dependency จริง (ไล่ import ทุกไฟล์ใน `backend/src`)

### 1.1 ภาพที่เจอ
```
                 ┌────────────┐
                 │   live     │──────────────┐
                 └────────────┘              │
┌────────────┐   ┌────────────┐              │
│viral-clone │──►│ product-   │──┐           │
└─────┬──────┘   │ studio     │  │           │
      │      ┌──►└─────┬──────┘  │           │
┌─────┴────┐ │         ▼         │           ▼
│  seller  │─┴──►┌────────────┐  │    ┌──────────────────────────┐
└──────────┘     │ marketer   │  └───►│          core            │
                 └─────┬──────┘       │ ai · generation · agents │
┌────────────┐         │              │ ffmpeg · tasks · db ·    │
│   drama    │─────────┴─────────────►│ production (episode/     │
└────────────┘                        │ storyboard/merge)        │
                                      └──────────────────────────┘
```

### 1.2 สิ่งสำคัญที่ค้นพบ (เปลี่ยนวิธีแบ่ง)

| # | ข้อค้นพบ | หลักฐาน | ผลต่อการแบ่ง |
|---|---|---|---|
| 1 | **Product Studio ใช้ตาราง dramas/episodes/storyboards ของ Drama เป็นไทม์ไลน์ผลิต** | `studio_projects.drama_id` (`sqlite-schema.ts:616`), `studio-shots.ts` เรียก `clearEpisodeStoryboards` | episode/storyboard/merge **ไม่ใช่ของ Drama** แต่เป็น "เครื่องผลิต" กลาง → ย้ายเข้า `core/production` |
| 2 | **core อ้างกลับไปหาโค้ด drama** | `generation.ts:14` → `storyboard-readiness`, `task-prep.ts:9` → `storyboard-readiness` | `storyboard-readiness`, `source-freshness` ต้องอยู่ใน core |
| 3 | **ตัวลงทะเบียน agent ใน core import tools ของทุกเมนู** | `agents/index.ts` import `marketer-tools`, `studio-tools` (`studio-tools` → `studio-shots`) | กลับทิศ: แต่ละโมดูลส่ง tools ของตัวเองให้ core ลงทะเบียน |
| 4 | Viral Clone ใช้ฟังก์ชันทั่วไปจาก `studio.ts` | `clone.ts:20` `getActiveVideoProviderInfo`, `waitForMergeCompletion` | สองฟังก์ชันนี้เป็นของกลาง → ย้ายเข้า core |
| 5 | Seller เรียก Product Studio ตรง | `seller.ts:19-20` `startAutoRender`, `getStudioTemplate` | อนุญาต แต่ต้องผ่าน `modules/product-studio/index.ts` |
| 6 | Marketer / Studio / Clone ใช้ `product-ingest`, `product-visuals` ร่วมกัน | `marketer.ts:13,15`, `studio.ts:18`, `clone.ts:26` | ย้ายเข้า `core/product` |
| 7 | **test 46 จาก 58 ไฟล์อ้าง path ของไฟล์ตรง ๆ** (หลายไฟล์ `readFileSync` อ่าน source เพื่อตรวจโครงสร้าง) | `backend/tests/*` | ทุกครั้งที่ย้ายไฟล์ต้องแก้ path ใน test ด้วย — นี่คืองานที่กินเวลาที่สุด |
| 8 | i18n เป็นไฟล์ก้อนเดียว 2,919 บรรทัด/ภาษา | `frontend/app/locales/{en,th}.json` | แยกตามเมนูได้ด้วย Nuxt layer |

### 1.3 ทิศทางที่อนุญาต (กฎหลังแยก)
```
drama          → core
marketer       → core
product-studio → core, marketer
seller         → core, marketer, product-studio
viral-clone    → core, product-studio
live           → core
core           → (ห้าม import modules/* เด็ดขาด)
```
ไม่มีวงวน (cycle) → แยกได้จริง

---

## 2. โครงสร้างเป้าหมาย — Backend

```
services/studio-api/src/
├─ index.ts                     ← บูต app: โหลด core + วนลูป modules[] (mount routes, ลงทะเบียน agent tools, recovery)
├─ modules.ts                   ← รายชื่อโมดูลตามลำดับ (ลำดับนี้ = ลำดับ recovery)
│
├─ core/
│  ├─ http/          response.ts · logger.ts · errors (AppError)          ← utils/response, middleware/logger
│  ├─ db/            index.ts · backup.ts · schema-core.ts · ddl-core.ts  ← db/* (ส่วนกลาง)
│  ├─ auth/          naka-sso.ts · owner-context.ts · ownership.ts · admin.ts
│  ├─ ai/            ai.ts · app-settings.ts · adapters/* (openai, gemini, volcengine, minimax, wan, unsloth…)
│  ├─ agents/        index.ts (registry) · context.ts · language.ts · prompts.ts · skills.ts · skill-library.ts
│  │                 tools/image-prompt-tools.ts       ← ใช้ร่วมหลายเมนู
│  ├─ generation/    generation.ts · generation-cost.ts · task-prep.ts · final-prompt.ts · style-preset.ts
│  ├─ production/    storyboard-readiness.ts · source-freshness.ts · export-health.ts
│  │                 ffmpeg-merge.ts · captions.ts · video-poster · merge-wait.ts (ย้ายจาก studio.ts)
│  ├─ product/       product-ingest.ts · product-visuals.ts
│  ├─ tasks/         pipeline-tasks.ts · task-logger.ts
│  ├─ storage/       paths.ts · storage.ts · dirsize.ts · safe-fetch.ts · ffmpeg.ts · transform.ts
│  └─ routes/        tasks · upload · ai-configs · ai-providers · style-presets · prompts · agent
│                    skills · storage · settings · auth/naka
│
└─ modules/
   ├─ drama/
   │  ├─ index.ts                 ← public API + module definition
   │  ├─ routes/   dramas.ts · episodes.ts · storyboards.ts · scenes.ts · characters.ts · props.ts · merge.ts
   │  ├─ services/ extraction.ts · drama-context.ts · video-prompts.ts
   │  ├─ agent-tools/ script-tools.ts · extract-tools.ts · storyboard-tools.ts
   │  └─ schema.ts               ← drizzle tables (ดู §4)
   ├─ marketer/
   │  ├─ routes/   campaigns.ts · trending.ts · gallery.ts
   │  ├─ services/ marketer.ts · trending.ts · gallery.ts · style-gallery.ts
   │  └─ agent-tools/ marketer-tools.ts
   ├─ product-studio/
   │  ├─ routes/   studio.ts
   │  ├─ services/ studio.ts · studio-autorender.ts · studio-shots.ts · studio-templates.ts · studio-influencer.ts
   │  └─ agent-tools/ studio-tools.ts
   ├─ seller/
   │  ├─ routes/   seller.ts
   │  └─ services/ seller.ts
   ├─ viral-clone/
   │  ├─ routes/   clone.ts
   │  └─ services/ clone.ts · hypit-render.ts
   └─ live/
      ├─ routes/   live.ts
      └─ services/ ai-live.ts · tiktok-live.ts · live-avatars.ts
```
**คงไว้:** `routes/serverUpdate.ts`, `services/server-update.ts` — ปุ่มอัปเดตใน /admin ใช้กับ Docker ผ่าน Watchtower ไม่ใช่ของ desktop (แก้ไขจากร่างแรก) · ย้ายเข้า `core/routes` ใน PR 2

### 2.1 สัญญาของโมดูล (ทุกเมนูหน้าตาเหมือนกัน)
```ts
// core/module.ts
export interface StudioModule {
  name: 'drama' | 'marketer' | 'product-studio' | 'seller' | 'viral-clone' | 'live'
  routes: Array<{ path: string; router: Hono }>        // path เดิม เช่น '/dramas' → URL ไม่เปลี่ยน
  agentTools?: Record<string, Tool>                    // core/agents เอาไปลงทะเบียน
  recover?: () => Promise<void>                        // startup sweep ของเมนูนี้
}
```
```ts
// modules/viral-clone/index.ts
import { cloneRoutes } from './routes/clone.js'
import { failStaleCloneAnalyzes, resumeStaleCloneRenders } from './services/clone.js'
export const viralClone: StudioModule = {
  name: 'viral-clone',
  routes: [{ path: '/clone', router: cloneRoutes }],
  recover: async () => { await failStaleCloneAnalyzes(); await resumeStaleCloneRenders() },
}
// เปิดให้โมดูลอื่นใช้ (ถ้ามี) — export เฉพาะตรงนี้
```
```ts
// modules.ts — ลำดับ = ลำดับ recovery เดิมใน index.ts
//  (auto-render ต้อง resume ก่อน seller videos)
export const modules = [drama, marketer, productStudio, seller, viralClone, live]
```
```ts
// index.ts (ย่อ)
for (const m of modules) for (const r of m.routes) api.route(r.path, r.router)
registerAgents(modules.flatMap(m => Object.entries(m.agentTools ?? {})))
await recoverGenerationTasks(); await failStaleRunningTasks()           // core ก่อน
for (const m of modules) { try { await m.recover?.() } catch (e) { log.error(e) } }
```

### 2.2 บังคับกฎด้วยเครื่องมือ (ไม่พึ่งความจำ)
`.dependency-cruiser.cjs`
```js
module.exports = { forbidden: [
  { name: 'core-no-modules', from: { path: '^src/core' }, to: { path: '^src/modules' } },
  { name: 'only-via-index', from: { path: '^src/modules/([^/]+)/' },
    to: { path: '^src/modules/([^/]+)/(?!index\\.ts)', pathNot: '^src/modules/$1/' } },
  { name: 'allowed-deps', comment: 'ตามตาราง §1.3', /* ... */ },
  { name: 'no-cycles', from: {}, to: { circular: true } },
]}
```
CI: `npx depcruise src --validate` → ถ้าใคร (หรือ AI agent) import ข้ามเมนูผิดทาง build แดง

---

## 3. โครงสร้างเป้าหมาย — Frontend (Nuxt Layers)

Nuxt 3 รองรับ **layers**: แต่ละโฟลเดอร์เป็นมินิแอปที่มี `pages/ components/ composables/ locales/ nuxt.config.ts` ของตัวเอง แล้วแอปหลัก `extends` เข้ามา — auto-import ยังทำงานเหมือนเดิม

```
apps/studio-web/
├─ nuxt.config.ts         extends: ['./layers/core', './layers/drama', './layers/marketer',
│                                   './layers/product-studio', './layers/seller', './layers/viral-clone', './layers/live']
├─ app/layouts/default.vue   ← เมนูข้าง (sidebar) — อ่านรายการเมนูจาก layer ที่โหลด
└─ layers/
   ├─ core/        components: AppMenu, AppMenuItem, BaseSelect, ConfirmDialog, LanguageSwitchDialog,
   │               LocaleSwitcher, MentionTextarea, MigrateOverlay, ModelSelect, ThemeToggle
   │               composables: useApi, i18n, useAdminUrl, useAgent, useMedia, useToast, useTheme,
   │               usePopover, useProviderIcon, useTour, useUnifiedLanguage, useCreativeTags, useMigrateState
   │               utils: videoPreflight, unslothFlow · locales: common.{th,en}.json
   ├─ drama/       pages: /drama, /drama/:id, /drama/:id/board, /drama/:id/episode/:n
   │               views/drama/{detail,board,episode}.vue · locales: drama.{th,en}.json
   ├─ marketer/    pages: /marketer, /marketer/gallery, /marketer/:id
   │               Marketer*.vue (9) · marketerFlow, marketerMarkdown
   ├─ product-studio/ pages: /studio, /studio/:id · Studio*.vue (11) · studioFlow, studioArt
   ├─ seller/      pages: /seller, /seller/:id · SellerSkillVideo.vue · sellerCopy
   ├─ viral-clone/ pages: /viral-clone, /viral-clone/:id · ViralClone*.vue (5) · viralCloneFlow
   └─ live/        pages: /live · liveFlow
```
**ลบ:** `useDesktopBridge.ts` (desktop เลิกใช้)

ต้องแก้:
- dynamic routes ที่ลงทะเบียนเองใน `pages:extend` ของ `nuxt.config.ts` → ย้ายไปไว้ใน `nuxt.config.ts` ของแต่ละ layer
- locales 2,919 บรรทัด → แยกตาม key ระดับบนสุด (`drama.*`, `marketer.*`, …) ด้วยสคริปต์ แล้วรวมกลับตอน build (i18n รองรับหลายไฟล์ต่อภาษา)
- **ข้อดีที่ได้ทันที:** ปิดเมนูไหนก็แค่เอา layer ออกจาก `extends` (เช่นทำ build ที่ไม่มี Live)

---

## 4. ฐานข้อมูล (ยังเป็นไฟล์ SQLite เดียว แค่แยกเจ้าของ)

| เจ้าของ | ตาราง |
|---|---|
| **core** | users, ai_service_configs, ai_service_providers, style_presets, sys_task, pipeline_tasks, app_settings, assets, schema_migrations |
| **core/production** (ใช้ร่วม Drama + Product Studio + Clone) | dramas, episodes, storyboards, scenes, characters, props, episode_characters, episode_scenes, episode_props, storyboard_characters, storyboard_props, character_looks, storyboard_character_looks, storyboard_media_selections, video_merges |
| **marketer** | campaigns, campaign_docs, campaign_creatives, campaign_doc_revisions, campaign_ad_references, campaign_visuals, creative_results |
| **product-studio** | studio_projects, studio_shots, studio_avatars, studio_images, studio_influencers, studio_influencer_contents |
| **seller** | seller_posts |
| **viral-clone** | clone_projects, clone_variants |
| **live** | — (ไม่มีตารางของตัวเอง) |

- `db/schema.ts` (655 บรรทัด) แยกเป็น `schema.ts` ในแต่ละโมดูล แล้ว `core/db/index.ts` รวม `{...coreSchema, ...dramaSchema, ...}` ให้ drizzle
- `db/sqlite-schema.ts` (870 บรรทัด, DDL + migration ตามเวอร์ชัน) **ยังไม่แยกในรอบนี้** — ลำดับ migration ผูกกับ test (`grep -rn "19, 20, 21" backend/tests`) เสี่ยงเกินคุ้ม ค่อยแยกทีหลัง
- ข้อสังเกต: Drama เป็น "หน้าจอ" ที่ใช้ตาราง production ตรงที่สุด แต่ไม่ได้เป็นเจ้าของคนเดียว

---

## 5. ลำดับการย้าย (ทีละ PR, ทุก PR ต้อง typecheck + test ผ่าน)

| PR | งาน | ไฟล์ที่ย้าย | ความเสี่ยง | เวลา |
|---|---|---|---|---|
| **1** ✅ | `src/modules.ts`: แต่ละเมนูประกาศ routes + failStale/resume, `index.ts` วนลูปโหลด (commit `78efbbd4`) — dependency-cruiser ย้ายไป PR 9 เพราะ path ยังไม่ใช่ core/modules | 13 | ต่ำ | 0.5 วัน |
| **2** | **core** — ย้าย utils, db, auth, ai, adapters, tasks, generation, production, product, agents | ~45 | **สูง** (ทุกไฟล์ import เปลี่ยน) | 2–3 วัน |
| **3** | กลับทิศ agent registry (ข้อค้นพบ #3) + ย้าย `getActiveVideoProviderInfo`/`waitForMergeCompletion` เข้า core (#4) | ~5 | กลาง | 1 วัน |
| **4** | **live** | 4 | ต่ำ | 0.5 วัน |
| **5** | **drama** | 11 | กลาง | 1 วัน |
| **6** | **marketer** | 8 | กลาง | 1 วัน |
| **7** | **product-studio** | 7 | กลาง | 1 วัน |
| **8** | **seller** + **viral-clone** | 5 | ต่ำ | 1 วัน |
| **9** | เปิด dependency-cruiser โหมด error ใน CI | 1 | ต่ำ | 0.5 วัน |
| **10** | Frontend: สร้าง layers + ย้าย (ทีละ layer ได้เหมือนกัน) | ~60 | กลาง | 3–4 วัน |
| **11** | แยก locales ตามเมนู (สคริปต์) | 2→14 | ต่ำ | 0.5 วัน |
| **12** | อัปเดต CLAUDE.md, openwiki, README ให้ตรงโครงใหม่ | — | ต่ำ | 0.5 วัน |

**รวมประมาณ 2.5–3 สัปดาห์** (คนเดียว + AI agent)

### วิธีย้ายที่ปลอดภัย (ใช้ทุก PR)
1. `git mv` (เก็บ history ของไฟล์) — ห้าม copy แล้วลบ
2. แก้ import ด้วย TypeScript (`tsc --noEmit` บอกทุกจุดที่พัง) หรือ VS Code "Move to file"
3. แก้ path ใน test (ข้อค้นพบ #7) — ค้นด้วย `grep -rn "services/<ชื่อไฟล์>" backend/tests`
4. `npm run typecheck && npx tsx --test tests/*.test.ts tests/*.test.mjs`
5. รัน server จริง เปิดเมนูนั้น ทดสอบ 1 flow (สร้าง → generate → ดูผล)
6. **ห้ามแก้ logic ใน PR เดียวกับการย้ายไฟล์** — review จะได้ดูแค่ว่า "ย้ายถูกไหม"

---

## 6. สิ่งที่ไม่เปลี่ยน
- URL ของ API ทั้งหมด (`/api/v1/dramas`, `/api/v1/clone`, …) — frontend ไม่ต้องแก้ useApi
- Database schema และข้อมูล
- Docker image / compose / วิธี deploy (ยังเป็น process เดียว)
- SSO กับ naka-ai.com

## 7. สิ่งที่ได้หลังจบ
- เปิดโฟลเดอร์เดียวเห็นทุกอย่างของเมนูนั้น (backend + frontend + คำแปล)
- CI กันไม่ให้เมนูพันกันใหม่ (สำคัญมากเมื่อให้ AI agent เขียนโค้ด)
- เปิด/ปิดเมนูได้ด้วยรายการใน `modules.ts` และ `extends`
- พร้อมระดับ 3 (package แยก) หรือแยก container ต่อเมนู (ADR-002 §5.3) โดยไม่ต้องรื้ออีก

## 8. ความเสี่ยง
| ความเสี่ยง | ป้องกัน |
|---|---|
| ลำดับ recovery ผิด → งาน seller ค้างหลังรีสตาร์ท | `modules.ts` เรียงตามลำดับเดิมใน `index.ts` + test ลำดับ |
| PR 2 (core) ใหญ่มาก merge ยาก | ทำตอนไม่มีงานอื่นค้าง (freeze สั้น ๆ 2–3 วัน) หรือแบ่งเป็น 2a utils/db/auth, 2b ai/generation/agents |
| structure test พังเยอะ | ถือเป็นงานหลักของแต่ละ PR ไม่ใช่งานแถม; ถ้า test ตรวจ path ที่ไม่มีความหมายแล้ว ให้แก้ test ให้ตรวจพฤติกรรมแทน |
| auto-import ของ Nuxt ชื่อชนกันระหว่าง layer | ตั้ง prefix component ตาม layer หรือคงชื่อเดิมที่มี prefix อยู่แล้ว (Marketer*, Studio*, ViralClone*) |
