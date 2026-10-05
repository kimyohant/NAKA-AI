/**
 * Drizzle schema - SQLite column mappings.
 * 自 MySQL 迁移：varchar(x)→text（SQLite 不校验长度）、int→integer、
 * boolean→integer boolean mode、时间戳仍为 text 存 ISO 字符串，表/列名不变。
 */
import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core'

export const dramas = sqliteTable('dramas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  genre: text('genre'),
  style: text('style').default('3d'),
  aspectRatio: text('aspect_ratio').default('16:9'),
  totalEpisodes: integer('total_episodes').default(1),
  totalDuration: integer('total_duration').default(0),
  status: text('status').notNull().default('draft'),
  thumbnail: text('thumbnail'),
  tags: text('tags'),
  metadata: text('metadata'),
  budgetThb: real('budget_thb'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const episodes = sqliteTable('episodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  scriptContent: text('script_content'),
  description: text('description'),
  duration: integer('duration').default(0),
  status: text('status').default('draft'),
  hook: text('hook'),
  videoUrl: text('video_url'),
  thumbnail: text('thumbnail'),
  imageConfigId: integer('image_config_id'),
  videoConfigId: integer('video_config_id'),
  resolution: text('resolution').default('720p'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const pipelineTasks = sqliteTable('pipeline_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  key: text('key').notNull().unique(),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  status: text('status').notNull().default('running'),
  total: integer('total').default(0),
  completed: integer('completed').default(0),
  failed: integer('failed').default(0),
  currentKey: text('current_key'),
  errorMsg: text('error_msg'),
  cancelRequested: integer('cancel_requested').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  finishedAt: text('finished_at'),
})

export const characters = sqliteTable('characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
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
  sortOrder: integer('sort_order'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// Episode-Character many-to-many
export const episodeCharacters = sqliteTable('episode_characters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  characterId: integer('character_id').notNull(),
  createdAt: text('created_at').notNull(),
})

// Episode-Scene many-to-many
export const episodeScenes = sqliteTable('episode_scenes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  sceneId: integer('scene_id').notNull(),
  createdAt: text('created_at').notNull(),
})

// Episode-Prop many-to-many
export const episodeProps = sqliteTable('episode_props', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  propId: integer('prop_id').notNull(),
  createdAt: text('created_at').notNull(),
})

export const scenes = sqliteTable('scenes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
  episodeId: integer('episode_id'),
  location: text('location').notNull(),
  time: text('time').notNull(),
  prompt: text('prompt').notNull(),
  lighting: text('lighting'),
  finalPrompt: text('final_prompt'),
  storyboardCount: integer('storyboard_count').default(1),
  imageUrl: text('image_url'),
  status: text('status').default('pending'),
  localPath: text('local_path'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const storyboards = sqliteTable('storyboards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id').notNull(),
  sceneId: integer('scene_id'),
  storyboardNumber: integer('storyboard_number').notNull(),
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
  duration: integer('duration').default(0),
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

export const storyboardCharacters = sqliteTable('storyboard_characters', {
  storyboardId: integer('storyboard_id').notNull(),
  characterId: integer('character_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.characterId] }),
])

export const storyboardProps = sqliteTable('storyboard_props', {
  storyboardId: integer('storyboard_id').notNull(),
  propId: integer('prop_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.propId] }),
])

export const aiServiceConfigs = sqliteTable('ai_service_configs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  serviceType: text('service_type').notNull(),
  provider: text('provider'),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  model: text('model'),
  endpoint: text('endpoint'),
  queryEndpoint: text('query_endpoint'),
  priority: integer('priority').default(0),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  settings: text('settings'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // 注意: 此表无 deleted_at
})

export const characterLooks = sqliteTable('character_looks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  characterId: integer('character_id').notNull(),
  name: text('name').notNull(),
  notes: text('notes'),
  imageUrl: text('image_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const storyboardCharacterLooks = sqliteTable('storyboard_character_looks', {
  storyboardId: integer('storyboard_id').notNull(),
  characterId: integer('character_id').notNull(),
  lookId: integer('look_id').notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.characterId] }),
])

// Explicitly selected generated media for each shot. History remains in sys_task.
export const storyboardMediaSelections = sqliteTable('storyboard_media_selections', {
  storyboardId: integer('storyboard_id').notNull(),
  slot: text('slot').notNull(),
  taskId: integer('task_id').notNull(),
  selectedAt: text('selected_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.storyboardId, table.slot] }),
])

export const aiServiceProviders = sqliteTable('ai_service_providers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  displayName: text('display_name'),
  serviceType: text('service_type').notNull(),
  provider: text('provider').notNull(),
  defaultUrl: text('default_url'),
  presetModels: text('preset_models'),
  description: text('description'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const stylePresets = sqliteTable('style_presets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  value: text('value').notNull(),
  prompt: text('prompt').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  // Style Gallery (docs/style-gallery/PLAN.md): รูปพรีวิว/หมวด/แหล่งที่มา
  previewPath: text('preview_path'),
  category: text('category'),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // 注意: 此表无 deleted_at（硬删除），value 列有唯一索引（见 sqlite-schema.ts DDL）
})

// 统一生成任务表：图片/视频生成共用，type 区分，生成参数存 params(JSON)
export const sysTask = sqliteTable('sys_task', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(), // image | video
  storyboardId: integer('storyboard_id'),
  dramaId: integer('drama_id'),
  sceneId: integer('scene_id'),
  characterId: integer('character_id'),
  propId: integer('prop_id'),
  provider: text('provider'),
  configId: integer('config_id'),
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
  estimatedCostThb: real('estimated_cost_thb'),
  sourceSnapshot: text('source_snapshot'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
})

export const videoMerges = sqliteTable('video_merges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  episodeId: integer('episode_id'),
  dramaId: integer('drama_id'),
  title: text('title'),
  provider: text('provider'),
  model: text('model'),
  status: text('status').default('pending'),
  scenes: text('scenes'), // JSON
  mergedUrl: text('merged_url'),
  duration: integer('duration'),
  taskId: text('task_id'),
  errorMsg: text('error_msg'),
  // v11 (Phase 2): Studio captions (drama merge ปกติไม่กระทบ — default)
  captioned: integer('captioned', { mode: 'boolean' }).default(false),
  subtitleUrl: text('subtitle_url'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
  deletedAt: text('deleted_at'),
})

export const props = sqliteTable('props', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id').notNull(),
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

export const assets = sqliteTable('assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  storyboardId: integer('storyboard_id'),
  storyboardNum: integer('storyboard_num'),
  name: text('name'),
  description: text('description'),
  type: text('type'),
  category: text('category'),
  url: text('url'),
  thumbnailUrl: text('thumbnail_url'),
  localPath: text('local_path'),
  fileSize: integer('file_size'),
  mimeType: text('mime_type'),
  width: integer('width'),
  height: integer('height'),
  duration: integer('duration'),
  format: text('format'),
  imageGenId: integer('image_gen_id'),
  videoGenId: integer('video_gen_id'),
  isFavorite: integer('is_favorite', { mode: 'boolean' }).default(false),
  viewCount: integer('view_count').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// AI Marketer（迁移 version 6）— 数组字段存 JSON TEXT，对外由 services/marketer.ts 统一转 camelCase 结构
export const campaigns = sqliteTable('campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
  dramaId: integer('drama_id'),
  // v7: Evidence จากผู้ใช้ (คู่แข่ง/รีวิว) ที่กรอกตอนสั่ง research — เก็บไว้ดูย้อนหลัง
  researchNotes: text('research_notes'),
  // v8: งบประมาณแคมเปญ (THB) — produce ส่งต่อให้ dramas.budget_thb
  budgetThb: real('budget_thb'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

export const campaignDocs = sqliteTable('campaign_docs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  campaignId: integer('campaign_id').notNull(),
  kind: text('kind').notNull(),
  content: text('content').notNull().default(''),
  status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const campaignCreatives = sqliteTable('campaign_creatives', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  campaignId: integer('campaign_id').notNull(),
  angle: text('angle').notNull().default(''),
  hook: text('hook').notNull().default(''),
  format: text('format').notNull().default('ugc'),
  platform: text('platform').notNull().default('tiktok'),
  durationSec: integer('duration_sec').notNull().default(30),
  cta: text('cta'),
  script: text('script').notNull().default(''),
  status: text('status').notNull().default('draft'),
  episodeId: integer('episode_id'),
  episodeNumber: integer('episode_number'),
  // v9: creative ที่สร้างจากโหมด recreate — อ้าง campaign_ad_references.id
  referenceId: integer('reference_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v7: ประวัติเนื้อหาเอกสารก่อนถูกทับ (revise โดย agent = 'agent', แก้มือผ่าน PUT = 'manual')
export const campaignDocRevisions = sqliteTable('campaign_doc_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  docId: integer('doc_id').notNull(),
  version: integer('version').notNull(),
  content: text('content').notNull().default(''),
  source: text('source').notNull().default('agent'),
  createdAt: text('created_at').notNull(),
})

// v9 (Phase 3): Recreate Viral Ad — ผู้ใช้วาง transcript เอง (backend ไม่ดึงวิดีโอ); analysis ว่าง = draft
export const campaignAdReferences = sqliteTable('campaign_ad_references', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  campaignId: integer('campaign_id').notNull(),
  title: text('title').notNull().default(''),
  sourceUrl: text('source_url'),
  transcript: text('transcript').notNull().default(''),
  notes: text('notes'),
  analysis: text('analysis'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v9 (Phase 3): Product Visuals — งานรูปแยกจาก agent pipeline; status/imageUrl/errorMsg อ่านสดจาก sys_task
export const campaignVisuals = sqliteTable('campaign_visuals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  campaignId: integer('campaign_id').notNull(),
  kind: text('kind').notNull(),
  sourceImage: text('source_image').notNull(),
  instruction: text('instruction'),
  prompt: text('prompt').notNull().default(''),
  taskId: integer('task_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})


// v10 (Product Studio): โปรเจกต์วิดีโอรีวิวสินค้า — 1 โปรเจกต์ = 1 drama + episode (metadata.studioProjectId)
export const studioProjects = sqliteTable('studio_projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
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
  durationSec: integer('duration_sec').notNull().default(24),
  avatarId: integer('avatar_id'),
  // v14: AI Influencer — พรีเซนเตอร์ AI ที่ตั้งค่า persona/หน้าตาไว้ (ใช้แทนหรือคู่กับ avatar)
  influencerId: integer('influencer_id'),
  tone: text('tone'),
  notes: text('notes'),
  budgetThb: real('budget_thb'),
  aiDisclosure: integer('ai_disclosure', { mode: 'boolean' }).default(true),
  status: text('status').notNull().default('draft'),
  errorMsg: text('error_msg'),
  dramaId: integer('drama_id'),
  episodeId: integer('episode_id'),
  // v11 (Phase 2): captions + auto-render + Marketer bridge
  captions: integer('captions', { mode: 'boolean' }).default(true),
  captionStyle: text('caption_style').default('bold'),
  aiLabelBurnIn: integer('ai_label_burn_in', { mode: 'boolean' }).default(false),
  autoRender: text('auto_render'),
  sourceCampaignId: integer('source_campaign_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// v10: ส่วนเสริมของช็อต (storyboard_id เดิมเก็บภาพ/ความยาว/prompt ตามปกติ)
export const studioShots = sqliteTable('studio_shots', {
  storyboardId: integer('storyboard_id').notNull().unique(),
  projectId: integer('project_id').notNull(),
  role: text('role').notNull().default(''),
  dialogue: text('dialogue'),
  onScreenText: text('on_screen_text'),
})

// v10: คลัง avatar ของผู้ใช้ (imageUrl อ่านจาก sys_task ผ่าน image_task_id เมื่อ AI สร้าง)
export const studioAvatars = sqliteTable('studio_avatars', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  locale: text('locale'),
  // รูปจาก uploadAPI เดิม (ผู้ใช้อัปโหลดเอง) — AI-generated อ่านจาก sys_task ผ่าน imageTaskId
  imageUrl: text('image_url'),
  imageTaskId: integer('image_task_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// v10: ภาพสินค้าในโปรเจกต์ (เหมือน campaign_visuals + platform)
export const studioImages = sqliteTable('studio_images', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull(),
  kind: text('kind').notNull(),
  platform: text('platform'),
  sourceImage: text('source_image').notNull(),
  instruction: text('instruction'),
  prompt: text('prompt').notNull().default(''),
  taskId: integer('task_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v12: Viral Clone Studio (docs/viral-clone/PLAN.md ข้อ 3) — โคลน "โครง" คลิปไวรัล → ตัวแปรโฆษณา
export const cloneProjects = sqliteTable('clone_projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  referencePath: text('reference_path'),
  referenceTranscript: text('reference_transcript').notNull().default(''),
  language: text('language').notNull().default('th'),
  blueprintJson: text('blueprint_json'),
  errorCode: text('error_code'),
  errorMsg: text('error_msg'),
  renderState: text('render_state'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const cloneVariants = sqliteTable('clone_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull(),
  label: text('label').notNull().default(''),
  overridesJson: text('overrides_json'),
  status: text('status').notNull().default('draft'),
  outputPath: text('output_path'),
  durationSec: real('duration_sec'),
  errorCode: text('error_code'),
  errorMsg: text('error_msg'),
  pipelineTaskId: integer('pipeline_task_id'),
  episodeId: integer('episode_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v14 (AI Influencer): คลังพรีเซนเตอร์ AI — persona/appearance ใช้ประกอบสคริปต์และ generate รูป
export const studioInfluencers = sqliteTable('studio_influencers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  niche: text('niche'),
  persona: text('persona').notNull().default(''),
  appearance: text('appearance').notNull().default(''),
  locale: text('locale'),
  tone: text('tone'),
  imageUrl: text('image_url'),
  imageTaskId: integer('image_task_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
})

// v14 (AI Influencer): คอนเทนต์รีวิวของ influencer — kind 'image' (task_id → sys_task) หรือ 'script' (ข้อความ)
export const studioInfluencerContents = sqliteTable('studio_influencer_contents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  influencerId: integer('influencer_id').notNull(),
  kind: text('kind').notNull(),
  productName: text('product_name').notNull().default(''),
  productImage: text('product_image'),
  scene: text('scene'),
  instruction: text('instruction'),
  language: text('language'),
  platform: text('platform'),
  durationSec: integer('duration_sec'),
  prompt: text('prompt').notNull().default(''),
  taskId: integer('task_id'),
  script: text('script'),
  status: text('status').notNull().default('processing'),
  errorMsg: text('error_msg'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
