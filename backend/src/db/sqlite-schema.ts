/**
 * SQLite 启动建表 DDL + 种子数据（自 mysql-schema.ts 翻译）
 * - AUTO_INCREMENT → AUTOINCREMENT；删除 ENGINE/CHARSET；TINYINT(1) → INTEGER
 * - MySQL 内联 INDEX 拆为独立 CREATE INDEX IF NOT EXISTS
 * - 种子语句去掉 FROM DUAL（SQLite 非法），幂等语义（WHERE NOT EXISTS）保留
 */
import type Database from 'better-sqlite3'

export const sqliteSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS dramas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    style TEXT DEFAULT '3d',
    aspect_ratio TEXT DEFAULT '16:9',
    total_episodes INTEGER DEFAULT 1,
    total_duration INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    thumbnail TEXT,
    tags TEXT,
    metadata TEXT,
    budget_thb REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    script_content TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    hook TEXT,
    video_url TEXT,
    thumbnail TEXT,
    image_config_id INTEGER,
    video_config_id INTEGER,
    resolution TEXT DEFAULT '720p',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    appearance TEXT,
    styling TEXT,
    final_prompt TEXT,
    personality TEXT,
    image_url TEXT,
    reference_images TEXT,
    seed_value TEXT,
    sort_order INTEGER,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_id INTEGER,
    location TEXT NOT NULL,
    time TEXT NOT NULL,
    prompt TEXT NOT NULL,
    lighting TEXT,
    final_prompt TEXT,
    storyboard_count INTEGER DEFAULT 1,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS storyboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER,
    storyboard_number INTEGER NOT NULL,
    title TEXT,
    location TEXT,
    time TEXT,
    shot_type TEXT,
    angle TEXT,
    movement TEXT,
    result TEXT,
    atmosphere TEXT,
    image_prompt TEXT,
    video_prompt TEXT,
    bgm_prompt TEXT,
    sound_effect TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    composed_image TEXT,
    first_frame_image TEXT,
    last_frame_image TEXT,
    reference_images TEXT,
    video_url TEXT,
    subtitle_url TEXT,
    composed_video_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS episode_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_characters_episode_id ON episode_characters (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_characters_character_id ON episode_characters (character_id)`,

  `CREATE TABLE IF NOT EXISTS episode_scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_scenes_episode_id ON episode_scenes (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_scenes_scene_id ON episode_scenes (scene_id)`,

  `CREATE TABLE IF NOT EXISTS episode_props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    prop_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_props_episode_id ON episode_props (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_props_prop_id ON episode_props (prop_id)`,

  `CREATE TABLE IF NOT EXISTS storyboard_characters (
    storyboard_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, character_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storyboard_characters_character_id ON storyboard_characters (character_id)`,

  `CREATE TABLE IF NOT EXISTS storyboard_props (
    storyboard_id INTEGER NOT NULL,
    prop_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, prop_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storyboard_props_prop_id ON storyboard_props (prop_id)`,


  `CREATE TABLE IF NOT EXISTS ai_service_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    provider TEXT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    endpoint TEXT,
    query_endpoint TEXT,
    priority INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    settings TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ai_service_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    display_name TEXT,
    service_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    default_url TEXT,
    preset_models TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS style_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    preview_path TEXT,
    category TEXT,
    source TEXT NOT NULL DEFAULT 'custom',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (value)
  )`,

  `CREATE TABLE IF NOT EXISTS sys_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    storyboard_id INTEGER,
    drama_id INTEGER,
    scene_id INTEGER,
    character_id INTEGER,
    prop_id INTEGER,
    provider TEXT,
    config_id INTEGER,
    prompt TEXT,
    model TEXT,
    params TEXT,
    task_id TEXT,
    result_url TEXT,
    local_path TEXT,
    status TEXT DEFAULT 'processing',
    error_msg TEXT,
    error_code TEXT,
    estimated_cost_thb REAL,
    source_snapshot TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_type ON sys_task (type)`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_drama_id ON sys_task (drama_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_storyboard_id ON sys_task (storyboard_id)`,

  `CREATE TABLE IF NOT EXISTS video_merges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER,
    drama_id INTEGER,
    title TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    scenes TEXT,
    merged_url TEXT,
    duration INTEGER,
    task_id TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    prompt TEXT,
    final_prompt TEXT,
    image_url TEXT,
    reference_images TEXT,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER,
    episode_id INTEGER,
    storyboard_id INTEGER,
    storyboard_num INTEGER,
    name TEXT,
    description TEXT,
    type TEXT,
    category TEXT,
    url TEXT,
    thumbnail_url TEXT,
    local_path TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    format TEXT,
    image_gen_id INTEGER,
    video_gen_id INTEGER,
    is_favorite INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  // 应用级全局设置（key-value，如 AI 内容语言 content_language）
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Agent pipeline 任务状态（提取/视频提示词批量）— DB 为唯一事实来源：
  // 进程重启后状态可恢复显示，boot 时把 running 行标记为失败（见 services/pipeline-tasks.ts）
  `CREATE TABLE IF NOT EXISTS pipeline_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    drama_id INTEGER,
    episode_id INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    total INTEGER DEFAULT 0,
    completed INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    current_key TEXT,
    error_msg TEXT,
    cancel_requested INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_episode_id ON pipeline_tasks (episode_id)`,

  // AI Influencer (buzzy-style): คลังพรีเซนเตอร์ AI — หน้าตา/บุคลิก/นิชา + รูปโปรไฟล์ที่ใช้เป็น reference
  // คุม consistency: รูปที่ generated อ่านสดจาก sys_task ผ่าน image_task_id (pattern เดียวกับ studio_avatars)
  `CREATE TABLE IF NOT EXISTS studio_influencers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    niche TEXT,
    persona TEXT NOT NULL DEFAULT '',
    appearance TEXT NOT NULL DEFAULT '',
    locale TEXT,
    tone TEXT,
    image_url TEXT,
    image_task_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  // คอนเทนต์รีวิวของ influencer — kind 'image' (ภาพรีวิวสินค้า per scene, ผลลัพธ์ใน sys_task)
  // หรือ 'script' (สคริปต์รีวิวสั้น เก็บข้อความใน script)
  `CREATE TABLE IF NOT EXISTS studio_influencer_contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    influencer_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    product_name TEXT NOT NULL DEFAULT '',
    product_image TEXT,
    scene TEXT,
    instruction TEXT,
    language TEXT,
    platform TEXT,
    duration_sec INTEGER,
    prompt TEXT NOT NULL DEFAULT '',
    task_id INTEGER,
    script TEXT,
    status TEXT NOT NULL DEFAULT 'processing',
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_studio_influencer_contents_influencer ON studio_influencer_contents (influencer_id)`,
]

/**
 * 风格预设种子数据 — value 存入 dramas.style，prompt 注入生图提示词（作为前缀拼接）
 *
 * prompt 统一按多维结构书写，保证跨模型/跨镜头的风格控制力：
 *   核心媒介与渲染 → 线条/造型 → 上色/材质 → 光影 → 色彩调性 → 背景处理 → 画质锚点 → avoid 禁忌项
 */
export const stylePresetSeeds = [
  {
    name: '3D 漫剧', value: '3d', sortOrder: 1,
    prompt: 'high-quality 3D CG animation still, modern game-engine cinematic render, Unreal Engine and Pixar grade quality, semi-realistic stylized characters with refined facial features, clean sculpted anatomy, detailed skin shader with subtle subsurface scattering, PBR materials with crisp detailed textures, volumetric cinematic lighting with soft rim light, rich depth of field, polished film color grading, detailed environment art, sharp focus, consistent character design across shots, avoid flat lighting, avoid plastic waxy skin, avoid low-poly blurry look, avoid 2D flat cel shading, avoid anime line art',
    description: '游戏引擎级 3D 渲染，半写实角色，当前短剧主流的 3D 漫剧质感',
  },
  {
    name: '日漫赛璐璐', value: 'anime', sortOrder: 2,
    prompt: 'Japanese TV anime style, clean cel shading with hard-edged shadow shapes, crisp uniform black line art, vivid saturated color palette, expressive large-eyed character design with on-model proportions, detailed hand-painted anime backgrounds, dramatic anime key lighting with screentone highlights, key-visual poster quality, consistent character design across shots, avoid 3D CGI look, avoid painterly soft blending, avoid watercolor texture, avoid photorealism, avoid thick western comic outlines',
    description: '日式赛璐璐动画风格',
  },
  {
    name: '吉卜力手绘', value: 'ghibli', sortOrder: 3,
    prompt: 'Studio Ghibli hand-drawn animation style, soft painterly brushwork with organic hand-crafted line quality, lush warm watercolor painted backgrounds, gentle natural daylight with nostalgic warm glow, muted earthy natural color palette, whimsical cozy storybook atmosphere, subtle film-grain softness, theatrical background art quality, consistent character design across shots, avoid hard cel shading, avoid 3D render look, avoid neon over-saturated colors, avoid sharp digital edges, avoid photorealism',
    description: '吉卜力手绘治愈风',
  },
  {
    name: '水彩绘本', value: 'watercolor', sortOrder: 4,
    prompt: 'delicate watercolor storybook illustration, soft translucent color washes, visible cold-press paper texture, fluid hand-painted brushstrokes with gentle pigment bleeds, light airy atmosphere, harmonious pastel palette, whimsical children book charm, loose expressive edges, consistent character design across shots, avoid bold black outlines, avoid digital airbrush look, avoid harsh contrast, avoid 3D rendering, avoid photorealism',
    description: '水彩插画质感',
  },
  {
    name: '美式漫画', value: 'comic', sortOrder: 5,
    prompt: 'Western graphic-novel comic book style, bold confident black ink outlines, halftone dot shading and screentone gradients, dynamic saturated colors with dramatic contrast, dramatic spotlight lighting, flat graphic print look, sharp inking details, dynamic cinematic composition, consistent character design across shots, avoid painterly soft blending, avoid watercolor washes, avoid photorealistic rendering, avoid 3D CGI look, avoid anime cel shading',
    description: '美式漫画粗线条风格',
  },
  {
    name: '国风 2.5D', value: 'guofeng', sortOrder: 7,
    prompt: 'Chinese guofeng 2.5D illustration style, semi-realistic donghua-quality character art, elegant flowing line work, rich traditional Chinese aesthetic elements, layered ink-wash inspired atmospheric backgrounds, refined silk and fabric textures, soft luminous lighting with gentle haze, sophisticated muted jewel-tone palette, xianxia drama poster quality, consistent character design across shots, avoid flat cel shading, avoid western comic ink style, avoid photorealism, avoid plastic 3D look, avoid modern clothing and props unless specified',
    description: '国风动画/仙侠剧质感，2.5D 半写实',
  },
  {
    name: '韩系网漫', value: 'webtoon', sortOrder: 8,
    prompt: 'Korean webtoon manhwa style, clean digital painting with soft gradient shading, slim elegant character proportions, large expressive eyes with detailed highlights, soft glowing skin rendering, romantic dreamy lighting, modern pastel-to-vivid color palette, detailed fashion and fabric rendering, webtoon key visual quality, consistent character design across shots, avoid heavy black ink outlines, avoid halftone dots, avoid 3D render look, avoid watercolor paper texture, avoid chibi proportions',
    description: '韩国条漫/网漫精致上色风',
  },
  {
    name: '黑白漫画', value: 'noir', sortOrder: 9,
    prompt: 'black and white manga illustration, high-contrast monochrome ink work, dynamic hatching and cross-hatching shading, bold solid blacks with dramatic negative space, screentone gray gradation, expressive confident ink linework, cinematic noir lighting, professional manga page quality, consistent character design across shots, strictly no color, avoid grayscale blur smudging, avoid painterly soft edges, avoid photorealism, avoid 3D render look',
    description: '黑白漫/ Noir 高对比墨水风',
  },
]

/**
 * 旧版种子 prompt（v1 一句话风格描述）— 用于内容寻址升级：
 * 仅当库中行的 prompt 仍等于旧种子值（未被用户在设置页编辑过）才覆盖为新 prompt
 */
const LEGACY_SEED_PROMPTS: Record<string, string> = {
  '3d': '3D CG animation style, game-engine quality render, semi-realistic stylized characters, refined facial features, detailed materials and textures, cinematic lighting, high detail',
  anime: 'Japanese anime style, cel shading, clean crisp line art, vivid saturated colors, expressive character designs, detailed painted backgrounds',
  ghibli: 'Studio Ghibli style, hand-drawn animation, soft watercolor painted backgrounds, warm nostalgic lighting, gentle natural palette, whimsical cozy atmosphere',
  watercolor: 'watercolor illustration style, soft translucent washes, visible paper texture, delicate fluid brushwork, light airy atmosphere, hand-painted storybook feel',
  comic: 'Western comic book style, bold black ink outlines, halftone dot shading, dynamic saturated colors, dramatic contrast lighting, flat graphic novel look',
}

/**
 * 已下架的种子预设 — 内容寻址删除：仅当库中行的 prompt 仍是种子原文
 * （未被用户编辑过）才删除；用户改过的同名行视为用户数据保留。
 * live（真人写实）：真人影像过不了平台真人内容审核，下架。
 */
const REMOVED_SEED_PROMPTS: Record<string, string> = {
  live: 'ultra-realistic cinematic live-action look, professional film photography, natural skin tones with detailed pores and realistic texture, true human anatomy and proportions, shallow depth of field with creamy bokeh, cinematic three-point lighting, subtle film grain, 35mm lens cinematic framing, true-to-life color grading, detailed real-world environments, consistent actor appearance across shots, avoid cartoon or anime features, avoid 3D render look, avoid illustration style, avoid plastic waxy skin, avoid over-smoothing beauty filter',
}

// INSERT ... SELECT WHERE NOT EXISTS → 幂等：只补缺失行，不覆盖用户编辑
// （SQLite 无 FROM DUAL，无 FROM 的 SELECT 合法）
const SEED_SQL = 'INSERT INTO style_presets ("name", "value", "prompt", "description", "sort_order", "is_active", "created_at", "updated_at") SELECT ?, ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM style_presets WHERE value = ?)'
// 内容寻址升级：命中旧种子原文才更新（用户在设置页改过的行不动）
const UPGRADE_SQL = 'UPDATE style_presets SET "name" = ?, "prompt" = ?, "description" = ?, "sort_order" = ?, "updated_at" = ? WHERE "value" = ? AND "prompt" = ?'
// 内容寻址下架：命中下架种子原文才删除
const REMOVE_SQL = 'DELETE FROM style_presets WHERE "value" = ? AND "prompt" = ?'

const MIGRATIONS: Array<{ version: number; columns: Array<{ table: string; column: string; ddl: string }>; statements?: string[] }> = [
  { version: 1, columns: [{ table: 'episodes', column: 'hook', ddl: 'ALTER TABLE episodes ADD COLUMN hook TEXT' }] },
  { version: 2, columns: [
    { table: 'sys_task', column: 'config_id', ddl: 'ALTER TABLE sys_task ADD COLUMN config_id INTEGER' },
    { table: 'sys_task', column: 'error_code', ddl: 'ALTER TABLE sys_task ADD COLUMN error_code TEXT' },
  ] },
  { version: 3, columns: [], statements: [
    `CREATE TABLE IF NOT EXISTS storyboard_media_selections (
      storyboard_id INTEGER NOT NULL,
      slot TEXT NOT NULL,
      task_id INTEGER NOT NULL,
      selected_at TEXT NOT NULL,
      PRIMARY KEY (storyboard_id, slot)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_storyboard_media_selections_task ON storyboard_media_selections (task_id)',
  ] },
  { version: 4, columns: [], statements: [
    `CREATE TABLE IF NOT EXISTS character_looks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      notes TEXT,
      image_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_character_looks_character ON character_looks (character_id)',
    `CREATE TABLE IF NOT EXISTS storyboard_character_looks (
      storyboard_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      look_id INTEGER NOT NULL,
      PRIMARY KEY (storyboard_id, character_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_storyboard_character_looks_look ON storyboard_character_looks (look_id)',
  ] },
  { version: 5, columns: [
    { table: 'dramas', column: 'budget_thb', ddl: 'ALTER TABLE dramas ADD COLUMN budget_thb REAL' },
    { table: 'sys_task', column: 'estimated_cost_thb', ddl: 'ALTER TABLE sys_task ADD COLUMN estimated_cost_thb REAL' },
    { table: 'sys_task', column: 'source_snapshot', ddl: 'ALTER TABLE sys_task ADD COLUMN source_snapshot TEXT' },
  ] },
  // AI Marketer：campaign（brief）→ docs（research/strategy markdown）→ creatives（广告脚本，produce 后成为 episode）
  // 数组字段（product_images / platforms）存 JSON TEXT，时间戳 ISO TEXT
  { version: 6, columns: [], statements: [
    `CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      product_url TEXT,
      product_name TEXT NOT NULL DEFAULT '',
      product_description TEXT,
      product_images TEXT,
      brand_notes TEXT,
      market TEXT NOT NULL DEFAULT 'TH',
      platforms TEXT,
      audience TEXT,
      goal TEXT,
      style TEXT DEFAULT '3d',
      aspect_ratio TEXT DEFAULT '9:16',
      status TEXT NOT NULL DEFAULT 'draft',
      error_msg TEXT,
      drama_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS campaign_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (campaign_id, kind)
    )`,
    `CREATE TABLE IF NOT EXISTS campaign_creatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      angle TEXT NOT NULL DEFAULT '',
      hook TEXT NOT NULL DEFAULT '',
      format TEXT NOT NULL DEFAULT 'ugc',
      platform TEXT NOT NULL DEFAULT 'tiktok',
      duration_sec INTEGER NOT NULL DEFAULT 30,
      cta TEXT,
      script TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      episode_id INTEGER,
      episode_number INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_campaign_creatives_campaign ON campaign_creatives (campaign_id)',
  ] },
  // AI Marketer เพิ่มเติม: เก็บ research notes (Evidence ที่ผู้ใช้วาง) + ประวัติการแก้ไขเอกสาร (revise/manual ทับแล้วย้อนดูได้)
  { version: 7, columns: [
    { table: 'campaigns', column: 'research_notes', ddl: 'ALTER TABLE campaigns ADD COLUMN research_notes TEXT' },
  ], statements: [
    `CREATE TABLE IF NOT EXISTS campaign_doc_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_campaign_doc_revisions_doc ON campaign_doc_revisions (doc_id)',
  ] },
  // AI Marketer: งบประมาณแคมเปญ (THB) — produce จะส่งต่อให้ dramas.budget_thb
  { version: 8, columns: [
    { table: 'campaigns', column: 'budget_thb', ddl: 'ALTER TABLE campaigns ADD COLUMN budget_thb REAL' },
  ] },
  // AI Marketer Phase 3: Recreate Viral Ad (ad references + analysis) + Product Visuals (งานรูปแยกจาก agent pipeline)
  { version: 9, columns: [
    { table: 'campaign_creatives', column: 'reference_id', ddl: 'ALTER TABLE campaign_creatives ADD COLUMN reference_id INTEGER' },
  ], statements: [
    `CREATE TABLE IF NOT EXISTS campaign_ad_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      transcript TEXT NOT NULL DEFAULT '',
      notes TEXT,
      analysis TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_campaign_ad_references_campaign ON campaign_ad_references (campaign_id)',
    `CREATE TABLE IF NOT EXISTS campaign_visuals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      source_image TEXT NOT NULL,
      instruction TEXT,
      prompt TEXT NOT NULL DEFAULT '',
      task_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_campaign_visuals_campaign ON campaign_visuals (campaign_id)',
  ] },
  // Product Studio (docs/product-studio/PLAN.md ข้อ 6): โปรเจกต์วิดีโอรีวิวสินค้า 1 ชิ้น + เทมเพลต
  // 1 โปรเจกต์ = 1 drama + episode ที่ระบบสร้างให้; ช็อต = storyboards เดิม (studio_shots เก็บเฉพาะส่วนเสริม)
  { version: 10, columns: [], statements: [
    `CREATE TABLE IF NOT EXISTS studio_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      product_url TEXT,
      product_description TEXT,
      product_images TEXT,
      template_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'th',
      market TEXT NOT NULL DEFAULT 'TH',
      platform TEXT NOT NULL DEFAULT 'tiktok',
      aspect_ratio TEXT NOT NULL DEFAULT '9:16',
      duration_sec INTEGER NOT NULL DEFAULT 24,
      avatar_id INTEGER,
      tone TEXT,
      notes TEXT,
      budget_thb REAL,
      ai_disclosure INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      error_msg TEXT,
      drama_id INTEGER,
      episode_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_studio_projects_drama ON studio_projects (drama_id)`,
    `CREATE TABLE IF NOT EXISTS studio_shots (
      storyboard_id INTEGER NOT NULL UNIQUE,
      project_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      dialogue TEXT,
      on_screen_text TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_studio_shots_project ON studio_shots (project_id)`,
    `CREATE TABLE IF NOT EXISTS studio_avatars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      locale TEXT,
      image_url TEXT,
      image_task_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS studio_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      platform TEXT,
      source_image TEXT NOT NULL,
      instruction TEXT,
      prompt TEXT NOT NULL DEFAULT '',
      task_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_studio_images_project ON studio_images (project_id)`,
  ] },
  // Product Studio Phase 2 (docs/product-studio/PHASE2.md ข้อ 3): captions + auto-render + Marketer bridge
  { version: 11, columns: [
    { table: 'studio_projects', column: 'captions', ddl: 'ALTER TABLE studio_projects ADD COLUMN captions INTEGER DEFAULT 1' },
    { table: 'studio_projects', column: 'caption_style', ddl: "ALTER TABLE studio_projects ADD COLUMN caption_style TEXT DEFAULT 'bold'" },
    { table: 'studio_projects', column: 'ai_label_burn_in', ddl: 'ALTER TABLE studio_projects ADD COLUMN ai_label_burn_in INTEGER DEFAULT 0' },
    { table: 'studio_projects', column: 'auto_render', ddl: 'ALTER TABLE studio_projects ADD COLUMN auto_render TEXT' },
    { table: 'studio_projects', column: 'source_campaign_id', ddl: 'ALTER TABLE studio_projects ADD COLUMN source_campaign_id INTEGER' },
    { table: 'video_merges', column: 'captioned', ddl: 'ALTER TABLE video_merges ADD COLUMN captioned INTEGER DEFAULT 0' },
    { table: 'video_merges', column: 'subtitle_url', ddl: 'ALTER TABLE video_merges ADD COLUMN subtitle_url TEXT' },
  ] },
  // Viral Clone Studio (docs/viral-clone/PLAN.md ข้อ 3): โคลนโครงคลิปไวรัล → ตัวแปรโฆษณา
  { version: 12, columns: [], statements: [
    `CREATE TABLE IF NOT EXISTS clone_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      reference_path TEXT,
      reference_transcript TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'th',
      blueprint_json TEXT,
      error_code TEXT,
      error_msg TEXT,
      render_state TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_clone_projects_status ON clone_projects (status)`,
    `CREATE TABLE IF NOT EXISTS clone_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      overrides_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      output_path TEXT,
      duration_sec REAL,
      error_code TEXT,
      error_msg TEXT,
      pipeline_task_id INTEGER,
      episode_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_clone_variants_project ON clone_variants (project_id)`,
  ] },
  // Style Gallery (docs/style-gallery/PLAN.md): พรีวิว/หมวด/แหล่งที่มาของ style preset
  { version: 13, columns: [
    { table: 'style_presets', column: 'preview_path', ddl: 'ALTER TABLE style_presets ADD COLUMN preview_path TEXT' },
    { table: 'style_presets', column: 'category', ddl: 'ALTER TABLE style_presets ADD COLUMN category TEXT' },
    { table: 'style_presets', column: 'source', ddl: `ALTER TABLE style_presets ADD COLUMN source TEXT NOT NULL DEFAULT 'custom'` },
  ] },
  // AI Influencer: คลังพรีเซนเตอร์ AI สำหรับรีวิวสินค้า + ผูก influencer เข้าโปรเจกต์ Studio
  { version: 14, columns: [
    { table: 'studio_projects', column: 'influencer_id', ddl: 'ALTER TABLE studio_projects ADD COLUMN influencer_id INTEGER' },
  ], statements: [
    `CREATE TABLE IF NOT EXISTS studio_influencers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      niche TEXT,
      persona TEXT NOT NULL DEFAULT '',
      appearance TEXT NOT NULL DEFAULT '',
      locale TEXT,
      tone TEXT,
      image_url TEXT,
      image_task_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS studio_influencer_contents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      influencer_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      product_image TEXT,
      scene TEXT,
      instruction TEXT,
      language TEXT,
      platform TEXT,
      duration_sec INTEGER,
      prompt TEXT NOT NULL DEFAULT '',
      task_id INTEGER,
      script TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      error_msg TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_studio_influencer_contents_influencer ON studio_influencer_contents (influencer_id)`,
  ] },
  // แก้ DB เก่าที่ campaigns ถูกสร้างก่อน DDL รูปแบบปัจจุบัน (ไม่มี error_msg) — failStaleCampaigns
  // และการเก็บ error ของ research/strategy/creatives set errorMsg แล้ว UPDATE ล้มทุก boot
  { version: 15, columns: [
    { table: 'campaigns', column: 'error_msg', ddl: 'ALTER TABLE campaigns ADD COLUMN error_msg TEXT' },
  ] },
  // v16 (docs/ai-marketer/GALLERY.md §2): ผลตอบรับจริงต่อ creative — ผู้ใช้กรอกเองจาก TikTok Analytics ต้นทาง (manual analytics)
  // (เดิมร่างไว้เป็น v13 แต่ master ใช้เลข 13 ไปแล้วกับ style gallery — เลื่อนเป็น v16)
  { version: 16, columns: [], statements: [
    `CREATE TABLE IF NOT EXISTS creative_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creative_id INTEGER NOT NULL UNIQUE,
      views INTEGER,
      likes INTEGER,
      comments INTEGER,
      shares INTEGER,
      sales_thb REAL,
      posted_url TEXT,
      posted_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_creative_results_creative ON creative_results (creative_id)`,
  ] },
  // v17: Viral Clone เลือก engine render ขั้นสุดท้ายต่อโปรเจกต์ — 'naka' (ffmpeg merge + ASS) | 'hypit' (study/hypit, HyperFrames)
  { version: 17, columns: [
    { table: 'clone_projects', column: 'render_engine', ddl: "ALTER TABLE clone_projects ADD COLUMN render_engine TEXT NOT NULL DEFAULT 'naka'" },
  ] },
]

export function initSqliteSchema(sqlite: Database.Database) {
  for (const statement of sqliteSchemaStatements) {
    sqlite.exec(statement)
  }
  sqlite.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const migrate = sqlite.transaction(() => {
    for (const migration of MIGRATIONS) {
      const applied = sqlite.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migration.version)
      if (applied) continue
      for (const { table, column, ddl } of migration.columns) {
        const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
        if (!cols.some(col => col.name === column)) sqlite.exec(ddl)
      }
      for (const statement of migration.statements || []) sqlite.exec(statement)
      sqlite.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString())
      console.log(`🧩 SQLite migration ${migration.version} applied`)
    }
  })
  migrate()
  const insertSeed = sqlite.prepare(SEED_SQL)
  const upgradeSeed = sqlite.prepare(UPGRADE_SQL)
  const removeSeed = sqlite.prepare(REMOVE_SQL)
  for (const s of stylePresetSeeds) {
    const ts = new Date().toISOString()
    insertSeed.run(s.name, s.value, s.prompt, s.description, s.sortOrder, ts, ts, s.value)
    const legacyPrompt = LEGACY_SEED_PROMPTS[s.value]
    if (legacyPrompt) {
      const res = upgradeSeed.run(s.name, s.prompt, s.description, s.sortOrder, ts, s.value, legacyPrompt)
      if (res.changes > 0) console.log(`🎨 风格预设「${s.name}」已升级为结构化提示词`)
    }
  }
  for (const [value, prompt] of Object.entries(REMOVED_SEED_PROMPTS)) {
    const res = removeSeed.run(value, prompt)
    if (res.changes > 0) console.log(`🗑️ 风格预设「${value}」已下架`)
  }
}
