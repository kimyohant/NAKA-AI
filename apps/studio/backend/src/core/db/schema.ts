/**
 * Drizzle schema — PostgreSQL (schema `studio`, reached through the role's search_path;
 * DDL in migrations/pg/, docs/adr/0004). Was SQLite until 2026-10: integers are bigint
 * (ids are identity columns), the former integer-boolean columns are boolean, timestamps are
 * still ISO-8601 text and JSON is still text, so values look the same to the code.
 */
import { pgTable, text, bigint, doublePrecision, boolean, primaryKey } from 'drizzle-orm/pg-core'
import { currentOwnerId } from '../auth/owner-context.js'

// v21: owning member (naka-ai SSO user id; 'local' = single-user / legacy rows). Stamped from the request scope on insert.
const ownerUserId = () => text('owner_user_id').notNull().$defaultFn(currentOwnerId)

export const dramas = pgTable('dramas', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  title: text('title').notNull(),
  description: text('description'),
  genre: text('genre'),
  style: text('style').default('3d'),
  aspectRatio: text('aspect_ratio').default('16:9'),
  totalEpisodes: bigint('total_episodes', { mode: 'number' }).default(1),
  totalDuration: bigint('total_duration', { mode: 'number' }).default(0),
  status: text('status').notNull().default('draft'),
  thumbnail: text('thumbnail'),
  tags: text('tags'),
  metadata: text('metadata'),
  budgetThb: doublePrecision('budget_thb'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const episodes = pgTable('episodes', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  dramaId: bigint('drama_id', { mode: 'number' }).notNull(),
  episodeNumber: bigint('episode_number', { mode: 'number' }).notNull(),
  title: text('title').notNull(),
  content: text('content'),
  scriptContent: text('script_content'),
  description: text('description'),
  duration: bigint('duration', { mode: 'number' }).default(0),
  status: text('status').default('draft'),
  hook: text('hook'),
  videoUrl: text('video_url'),
  thumbnail: text('thumbnail'),
  imageConfigId: bigint('image_config_id', { mode: 'number' }),
  videoConfigId: bigint('video_config_id', { mode: 'number' }),
  resolution: text('resolution').default('720p'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const pipelineTasks = pgTable('pipeline_tasks', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  kind: text('kind').notNull(),
  key: text('key').notNull().unique(),
  dramaId: bigint('drama_id', { mode: 'number' }),
  episodeId: bigint('episode_id', { mode: 'number' }),
  status: text('status').notNull().default('running'),
  total: bigint('total', { mode: 'number' }).default(0),
  completed: bigint('completed', { mode: 'number' }).default(0),
  failed: bigint('failed', { mode: 'number' }).default(0),
  currentKey: text('current_key'),
  errorMsg: text('error_msg'),
  cancelRequested: bigint('cancel_requested', { mode: 'number' }).default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  finishedAt: text('finished_at'),
})

export const characters = pgTable('characters', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  dramaId: bigint('drama_id', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  role: text('role'),
  description: text('description'),
  appearance: text('appearance'),
  styling: text('styling'),
  finalPrompt: text('final_prompt'),
  personality: text('personality'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  seedValue: text('seed_value'),
  sortOrder: bigint('sort_order', { mode: 'number' }),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// Episode-Character many-to-many
export const episodeCharacters = pgTable('episode_characters', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  episodeId: bigint('episode_id', { mode: 'number' }).notNull(),
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  createdAt: text('created_at').notNull(),
})

// Episode-Scene many-to-many
export const episodeScenes = pgTable('episode_scenes', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  episodeId: bigint('episode_id', { mode: 'number' }).notNull(),
  sceneId: bigint('scene_id', { mode: 'number' }).notNull(),
  createdAt: text('created_at').notNull(),
})

// Episode-Prop many-to-many
export const episodeProps = pgTable('episode_props', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  episodeId: bigint('episode_id', { mode: 'number' }).notNull(),
  propId: bigint('prop_id', { mode: 'number' }).notNull(),
  createdAt: text('created_at').notNull(),
})

export const scenes = pgTable('scenes', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  dramaId: bigint('drama_id', { mode: 'number' }).notNull(),
  episodeId: bigint('episode_id', { mode: 'number' }),
  location: text('location').notNull(),
  time: text('time').notNull(),
  prompt: text('prompt').notNull(),
  lighting: text('lighting'),
  finalPrompt: text('final_prompt'),
  storyboardCount: bigint('storyboard_count', { mode: 'number' }).default(1),
  imageUrl: text('image_url'),
  status: text('status').default('pending'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const storyboards = pgTable('storyboards', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  episodeId: bigint('episode_id', { mode: 'number' }).notNull(),
  sceneId: bigint('scene_id', { mode: 'number' }),
  storyboardNumber: bigint('storyboard_number', { mode: 'number' }).notNull(),
  title: text('title'),
  location: text('location'),
  time: text('time'),
  shotType: text('shot_type'),
  angle: text('angle'),
  movement: text('movement'),
  result: text('result'),
  atmosphere: text('atmosphere'),
  imagePrompt: text('image_prompt'),
  videoPrompt: text('video_prompt'),
  bgmPrompt: text('bgm_prompt'),
  soundEffect: text('sound_effect'),
  description: text('description'),
  duration: bigint('duration', { mode: 'number' }).default(0),
  composedImage: text('composed_image'),
  firstFrameImage: text('first_frame_image'),
  lastFrameImage: text('last_frame_image'),
  referenceImages: text('reference_images'),
  videoUrl: text('video_url'),
  subtitleUrl: text('subtitle_url'),
  composedVideoUrl: text('composed_video_url'),
  status: text('status').default('pending'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const storyboardCharacters = pgTable('storyboard_characters', {
  storyboardId: bigint('storyboard_id', { mode: 'number' }).notNull(),
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.characterId] }),
])

export const storyboardProps = pgTable('storyboard_props', {
  storyboardId: bigint('storyboard_id', { mode: 'number' }).notNull(),
  propId: bigint('prop_id', { mode: 'number' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.propId] }),
])

export const aiServiceConfigs = pgTable('ai_service_configs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  serviceType: text('service_type').notNull(),
  provider: text('provider'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  model: text('model'),
  endpoint: text('endpoint'),
  queryEndpoint: text('query_endpoint'),
  priority: bigint('priority', { mode: 'number' }).default(0),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  settings: text('settings'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // 注意: 此表无 deleted_at
})

export const characterLooks = pgTable('character_looks', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  notes: text('notes'),
  imageUrl: text('image_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const storyboardCharacterLooks = pgTable('storyboard_character_looks', {
  storyboardId: bigint('storyboard_id', { mode: 'number' }).notNull(),
  characterId: bigint('character_id', { mode: 'number' }).notNull(),
  lookId: bigint('look_id', { mode: 'number' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.characterId] }),
])

// Explicitly selected generated media for each shot. History remains in sys_task.
export const storyboardMediaSelections = pgTable('storyboard_media_selections', {
  storyboardId: bigint('storyboard_id', { mode: 'number' }).notNull(),
  slot: text('slot').notNull(),
  taskId: bigint('task_id', { mode: 'number' }).notNull(),
  selectedAt: text('selected_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.slot] }),
])

export const aiServiceProviders = pgTable('ai_service_providers', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  serviceType: text('service_type').notNull(),
  provider: text('provider').notNull(),
  defaultUrl: text('default_url'),
  presetModels: text('preset_models'),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const stylePresets = pgTable('style_presets', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  value: text('value').notNull(),
  prompt: text('prompt').notNull(),
  description: text('description'),
  sortOrder: bigint('sort_order', { mode: 'number' }).default(0),
  isActive: boolean('is_active').default(true),
  // Style Gallery (docs/style-gallery/PLAN.md): รูปพรีวิว/หมวด/แหล่งที่มา
  previewPath: text('preview_path'),
  category: text('category'),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // 注意: 此表无 deleted_at（硬删除），value 列有唯一索引（见 migrations/pg/0001_baseline.sql）
})

// 统一生成任务表：图片/视频生成共用，type 区分，生成参数存 params(JSON)
export const sysTask = pgTable('sys_task', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  type: text('type').notNull(), // image | video
  storyboardId: bigint('storyboard_id', { mode: 'number' }),
  dramaId: bigint('drama_id', { mode: 'number' }),
  sceneId: bigint('scene_id', { mode: 'number' }),
  characterId: bigint('character_id', { mode: 'number' }),
  propId: bigint('prop_id', { mode: 'number' }),
  provider: text('provider'),
  configId: bigint('config_id', { mode: 'number' }),
  prompt: text('prompt'),
  model: text('model'),
  // image: {size, frameType, referenceImages[]}
  // video: {referenceMode, firstFrameUrl, lastFrameUrl, referenceImageUrls[], referenceVideoUrls[], referenceAudioUrls[], referenceFileUrl, referenceLinkUrl, generateAudio, duration, aspectRatio, resolution, seed, promptExtend, watermark}
  params: text('params'),
  taskId: text('task_id'),
  resultUrl: text('result_url'),
  localPath: text('local_path'),
  status: text('status').default('processing'),
  errorMsg: text('error_msg'),
  errorCode: text('error_code'),
  estimatedCostThb: doublePrecision('estimated_cost_thb'),
  // naka-ai credits held for this task (auth/credits.ts): the account.credit_ledger id of the hold, and how many
  creditHoldId: bigint('credit_hold_id', { mode: 'number' }),
  creditsCharged: bigint('credits_charged', { mode: 'number' }),
  sourceSnapshot: text('source_snapshot'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
})

export const videoMerges = pgTable('video_merges', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  episodeId: bigint('episode_id', { mode: 'number' }),
  dramaId: bigint('drama_id', { mode: 'number' }),
  title: text('title'),
  provider: text('provider'),
  model: text('model'),
  status: text('status').default('pending'),
  scenes: text('scenes'), // JSON
  mergedUrl: text('merged_url'),
  duration: bigint('duration', { mode: 'number' }),
  taskId: text('task_id'),
  errorMsg: text('error_msg'),
  // v11 (Phase 2): Studio captions (drama merge ปกติไม่กระทบ — default)
  captioned: boolean('captioned').default(false),
  subtitleUrl: text('subtitle_url'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  deletedAt: text('deleted_at'),
})

export const props = pgTable('props', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  dramaId: bigint('drama_id', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  type: text('type'),
  description: text('description'),
  prompt: text('prompt'),
  finalPrompt: text('final_prompt'),
  imageUrl: text('image_url'),
  referenceImages: text('reference_images'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const assets = pgTable('assets', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  dramaId: bigint('drama_id', { mode: 'number' }),
  episodeId: bigint('episode_id', { mode: 'number' }),
  storyboardId: bigint('storyboard_id', { mode: 'number' }),
  storyboardNum: bigint('storyboard_num', { mode: 'number' }),
  name: text('name'),
  description: text('description'),
  type: text('type'),
  category: text('category'),
  url: text('url'),
  thumbnailUrl: text('thumbnail_url'),
  localPath: text('local_path'),
  fileSize: bigint('file_size', { mode: 'number' }),
  mimeType: text('mime_type'),
  width: bigint('width', { mode: 'number' }),
  height: bigint('height', { mode: 'number' }),
  duration: bigint('duration', { mode: 'number' }),
  format: text('format'),
  imageGenId: bigint('image_gen_id', { mode: 'number' }),
  videoGenId: bigint('video_gen_id', { mode: 'number' }),
  isFavorite: boolean('is_favorite').default(false),
  viewCount: bigint('view_count', { mode: 'number' }).default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// AI Marketer（迁移 version 6）— 数组字段存 JSON TEXT，对外由 services/marketer.ts 统一转 camelCase 结构
export const campaigns = pgTable('campaigns', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  title: text('title').notNull(),
  productUrl: text('product_url'),
  productName: text('product_name').notNull().default(''),
  productDescription: text('product_description'),
  productImages: text('product_images'),
  brandNotes: text('brand_notes'),
  market: text('market').notNull().default('TH'),
  platforms: text('platforms'),
  audience: text('audience'),
  goal: text('goal'),
  style: text('style').default('3d'),
  aspectRatio: text('aspect_ratio').default('9:16'),
  status: text('status').notNull().default('draft'),
  errorMsg: text('error_msg'),
  dramaId: bigint('drama_id', { mode: 'number' }),
  // v7: Evidence จากผู้ใช้ (คู่แข่ง/รีวิว) ที่กรอกตอนสั่ง research — เก็บไว้ดูย้อนหลัง
  researchNotes: text('research_notes'),
  // v8: งบประมาณแคมเปญ (THB) — produce ส่งต่อให้ dramas.budget_thb
  budgetThb: doublePrecision('budget_thb'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// AI Marketer quick start: one-off analyses from the prompt box / templates (modules/marketer/services/marketer-quick.ts)
export const marketerInsights = pgTable('marketer_insights', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  templateId: text('template_id'),
  prompt: text('prompt').notNull(),
  expert: text('expert').notNull().default('general'),
  category: text('category'),
  productName: text('product_name'),
  status: text('status').notNull().default('processing'),
  result: text('result'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const campaignDocs = pgTable('campaign_docs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  campaignId: bigint('campaign_id', { mode: 'number' }).notNull(),
  kind: text('kind').notNull(),
  content: text('content').notNull().default(''),
  status: text('status').notNull().default('draft'),
  version: bigint('version', { mode: 'number' }).notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const campaignCreatives = pgTable('campaign_creatives', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  campaignId: bigint('campaign_id', { mode: 'number' }).notNull(),
  angle: text('angle').notNull().default(''),
  hook: text('hook').notNull().default(''),
  format: text('format').notNull().default('ugc'),
  platform: text('platform').notNull().default('tiktok'),
  durationSec: bigint('duration_sec', { mode: 'number' }).notNull().default(30),
  cta: text('cta'),
  script: text('script').notNull().default(''),
  status: text('status').notNull().default('draft'),
  episodeId: bigint('episode_id', { mode: 'number' }),
  episodeNumber: bigint('episode_number', { mode: 'number' }),
  // v9: creative ที่สร้างจากโหมด recreate — อ้าง campaign_ad_references.id
  referenceId: bigint('reference_id', { mode: 'number' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v16 (docs/ai-marketer/GALLERY.md): ผลตอบรับจริงต่อ creative — ผู้ใช้กรอกเอง (manual analytics), 1:1 กับ creative
export const creativeResults = pgTable('creative_results', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  creativeId: bigint('creative_id', { mode: 'number' }).notNull().unique(),
  views: bigint('views', { mode: 'number' }),
  likes: bigint('likes', { mode: 'number' }),
  comments: bigint('comments', { mode: 'number' }),
  shares: bigint('shares', { mode: 'number' }),
  salesThb: doublePrecision('sales_thb'),
  postedUrl: text('posted_url'),
  postedAt: text('posted_at'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v7: ประวัติเนื้อหาเอกสารก่อนถูกทับ (revise โดย agent = 'agent', แก้มือผ่าน PUT = 'manual')
export const campaignDocRevisions = pgTable('campaign_doc_revisions', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  docId: bigint('doc_id', { mode: 'number' }).notNull(),
  version: bigint('version', { mode: 'number' }).notNull(),
  content: text('content').notNull().default(''),
  source: text('source').notNull().default('agent'),
  createdAt: text('created_at').notNull(),
})

// v9 (Phase 3): Recreate Viral Ad — ผู้ใช้วาง transcript เอง (backend ไม่ดึงวิดีโอ); analysis ว่าง = draft
export const campaignAdReferences = pgTable('campaign_ad_references', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  campaignId: bigint('campaign_id', { mode: 'number' }).notNull(),
  title: text('title').notNull().default(''),
  sourceUrl: text('source_url'),
  transcript: text('transcript').notNull().default(''),
  notes: text('notes'),
  analysis: text('analysis'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v9 (Phase 3): Product Visuals — งานรูปแยกจาก agent pipeline; status/imageUrl/errorMsg อ่านสดจาก sys_task
export const campaignVisuals = pgTable('campaign_visuals', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  campaignId: bigint('campaign_id', { mode: 'number' }).notNull(),
  kind: text('kind').notNull(),
  sourceImage: text('source_image').notNull(),
  instruction: text('instruction'),
  prompt: text('prompt').notNull().default(''),
  taskId: bigint('task_id', { mode: 'number' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})


// v10 (Product Studio): โปรเจกต์วิดีโอรีวิวสินค้า — 1 โปรเจกต์ = 1 drama + episode (metadata.studioProjectId)
export const studioProjects = pgTable('studio_projects', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  title: text('title').notNull(),
  productName: text('product_name').notNull().default(''),
  productUrl: text('product_url'),
  productDescription: text('product_description'),
  productImages: text('product_images'),
  templateId: text('template_id').notNull(),
  language: text('language').notNull().default('th'),
  market: text('market').notNull().default('TH'),
  platform: text('platform').notNull().default('tiktok'),
  aspectRatio: text('aspect_ratio').notNull().default('9:16'),
  durationSec: bigint('duration_sec', { mode: 'number' }).notNull().default(24),
  avatarId: bigint('avatar_id', { mode: 'number' }),
  // v14: AI Influencer — พรีเซนเตอร์ AI ที่ตั้งค่า persona/หน้าตาไว้ (ใช้แทนหรือคู่กับ avatar)
  influencerId: bigint('influencer_id', { mode: 'number' }),
  tone: text('tone'),
  notes: text('notes'),
  budgetThb: doublePrecision('budget_thb'),
  aiDisclosure: boolean('ai_disclosure').default(true),
  status: text('status').notNull().default('draft'),
  errorMsg: text('error_msg'),
  dramaId: bigint('drama_id', { mode: 'number' }),
  episodeId: bigint('episode_id', { mode: 'number' }),
  // v11 (Phase 2): captions + auto-render + Marketer bridge
  captions: boolean('captions').default(true),
  captionStyle: text('caption_style').default('bold'),
  aiLabelBurnIn: boolean('ai_label_burn_in').default(false),
  autoRender: text('auto_render'),
  sourceCampaignId: bigint('source_campaign_id', { mode: 'number' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// v10: ส่วนเสริมของช็อต (storyboard_id เดิมเก็บภาพ/ความยาว/prompt ตามปกติ)
export const studioShots = pgTable('studio_shots', {
  storyboardId: bigint('storyboard_id', { mode: 'number' }).notNull().unique(),
  projectId: bigint('project_id', { mode: 'number' }).notNull(),
  role: text('role').notNull().default(''),
  dialogue: text('dialogue'),
  onScreenText: text('on_screen_text'),
})

// v10: คลัง avatar ของผู้ใช้ (imageUrl อ่านจาก sys_task ผ่าน image_task_id เมื่อ AI สร้าง)
export const studioAvatars = pgTable('studio_avatars', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  locale: text('locale'),
  // รูปจาก uploadAPI เดิม (ผู้ใช้อัปโหลดเอง) — AI-generated อ่านจาก sys_task ผ่าน imageTaskId
  imageUrl: text('image_url'),
  imageTaskId: bigint('image_task_id', { mode: 'number' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// v10: ภาพสินค้าในโปรเจกต์ (เหมือน campaign_visuals + platform)
export const studioImages = pgTable('studio_images', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  projectId: bigint('project_id', { mode: 'number' }).notNull(),
  kind: text('kind').notNull(),
  platform: text('platform'),
  sourceImage: text('source_image').notNull(),
  instruction: text('instruction'),
  prompt: text('prompt').notNull().default(''),
  taskId: bigint('task_id', { mode: 'number' }).notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v12: Viral Clone Studio (docs/viral-clone/PLAN.md ข้อ 3) — โคลน "โครง" คลิปไวรัล → ตัวแปรโฆษณา
export const cloneProjects = pgTable('clone_projects', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  referencePath: text('reference_path'),
  referenceTranscript: text('reference_transcript').notNull().default(''),
  language: text('language').notNull().default('th'),
  blueprintJson: text('blueprint_json'),
  errorCode: text('error_code'),
  errorMsg: text('error_msg'),
  renderState: text('render_state'),
  renderEngine: text('render_engine').notNull().default('naka'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const cloneVariants = pgTable('clone_variants', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  projectId: bigint('project_id', { mode: 'number' }).notNull(),
  label: text('label').notNull().default(''),
  overridesJson: text('overrides_json'),
  status: text('status').notNull().default('draft'),
  outputPath: text('output_path'),
  durationSec: doublePrecision('duration_sec'),
  errorCode: text('error_code'),
  errorMsg: text('error_msg'),
  pipelineTaskId: bigint('pipeline_task_id', { mode: 'number' }),
  episodeId: bigint('episode_id', { mode: 'number' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v14 (AI Influencer): คลังพรีเซนเตอร์ AI — persona/appearance ใช้ประกอบสคริปต์และ generate รูป
export const studioInfluencers = pgTable('studio_influencers', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  name: text('name').notNull(),
  niche: text('niche'),
  persona: text('persona').notNull().default(''),
  appearance: text('appearance').notNull().default(''),
  locale: text('locale'),
  tone: text('tone'),
  imageUrl: text('image_url'),
  imageTaskId: bigint('image_task_id', { mode: 'number' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// v14 (AI Influencer): คอนเทนต์รีวิวของ influencer — kind 'image' (task_id → sys_task) หรือ 'script' (ข้อความ)
export const studioInfluencerContents = pgTable('studio_influencer_contents', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  influencerId: bigint('influencer_id', { mode: 'number' }).notNull(),
  kind: text('kind').notNull(),
  productName: text('product_name').notNull().default(''),
  productImage: text('product_image'),
  scene: text('scene'),
  instruction: text('instruction'),
  language: text('language'),
  platform: text('platform'),
  durationSec: bigint('duration_sec', { mode: 'number' }),
  prompt: text('prompt').notNull().default(''),
  taskId: bigint('task_id', { mode: 'number' }),
  script: text('script'),
  status: text('status').notNull().default('processing'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// Social Auto Reply (migrations/pg/0004_social.sql; spec in .scratch/social-auto-reply/): Social Accounts,
// Posts, Comments. Tokens are plain text, like the stored AI service API keys. An account belongs to one
// member (owner_user_id); posts and comments resolve through their account.
export const socialAccounts = pgTable('social_accounts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  platform: text('platform').notNull(),
  platformAccountId: text('platform_account_id').notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  status: text('status').notNull().default('disconnected'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: text('token_expires_at'),
  replyMode: text('reply_mode').notNull().default('draft'),
  watching: boolean('watching').notNull().default(true),
  watchDays: bigint('watch_days', { mode: 'number' }).notNull().default(7),
  replyToPraise: boolean('reply_to_praise').notNull().default(true),
  brandAbout: text('brand_about'),
  brandTone: text('brand_tone'),
  brandFaq: text('brand_faq'),
  brandForbidden: text('brand_forbidden'),
  defaultLanguage: text('default_language').notNull().default('th'),
  pausedUntil: text('paused_until'),
  backoffStep: bigint('backoff_step', { mode: 'number' }).notNull().default(0),
  lastPolledAt: text('last_polled_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const socialPosts = pgTable('social_posts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  accountId: bigint('account_id', { mode: 'number' }).notNull(),
  platformPostId: text('platform_post_id').notNull(),
  text: text('text'),
  url: text('url'),
  postedAt: text('posted_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const socialComments = pgTable('social_comments', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  accountId: bigint('account_id', { mode: 'number' }).notNull(),
  postId: bigint('post_id', { mode: 'number' }),
  platformCommentId: text('platform_comment_id').notNull(),
  parentPlatformCommentId: text('parent_platform_comment_id'),
  text: text('text'),
  authorId: text('author_id'),
  authorName: text('author_name'),
  commentedAt: text('commented_at'),
  status: text('status').notNull().default('new'),
  verdict: text('verdict'),
  reason: text('reason'),
  fallback: boolean('fallback').notNull().default(false),
  judgeAttempts: bigint('judge_attempts', { mode: 'number' }).notNull().default(0),
  sendAttempts: bigint('send_attempts', { mode: 'number' }).notNull().default(0),
  statusNote: text('status_note'),
  replyText: text('reply_text'),
  replySource: text('reply_source'),
  replyPlatformId: text('reply_platform_id'),
  repliedAt: text('replied_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v18: AI นักขาย — โพสต์ขายสินค้า + แคปชั่น/แฮชแท็ก/คอมเมนต์ต่อช่องทาง (content = JSON ตาม channel)
export const sellerPosts = pgTable('seller_posts', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  ownerUserId: ownerUserId(),
  title: text('title').notNull().default(''),
  productName: text('product_name').notNull().default(''),
  productUrl: text('product_url'),
  productPrice: text('product_price'),
  productDescription: text('product_description'),
  productImages: text('product_images').notNull().default('[]'),
  affiliateUrl: text('affiliate_url'),
  videoUrl: text('video_url'),
  studioProjectId: bigint('studio_project_id', { mode: 'number' }),
  channels: text('channels').notNull().default('[]'),
  language: text('language').notNull().default('th'),
  tone: text('tone').notNull().default('casual'),
  notes: text('notes'),
  content: text('content').notNull().default('{}'),
  status: text('status').notNull().default('draft'),
  errorMsg: text('error_msg'),
  generatedAt: text('generated_at'),
  // v19: ทำวิดีโอจากคลังสกิล
  videoTemplateId: text('video_template_id'),
  videoAuto: boolean('video_auto').notNull().default(false),
  videoError: text('video_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// v20: members signed in through naka-ai.com SSO ('local' in single-user mode)
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull().default(''),
  email: text('email'),
  isAdmin: boolean('is_admin').notNull().default(false),
  lastLoginAt: text('last_login_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
