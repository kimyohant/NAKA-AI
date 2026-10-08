import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('characters and scenes tables store the agent-written final prompt', () => {
  const schema = read('src/core/db/schema.ts')
  const sqliteSchema = read('src/core/db/sqlite-schema.ts')

  // Drizzle 表定义（SQLite 化：sqliteTable + text）
  assert.match(schema, /export const characters = sqliteTable\('characters'[\s\S]*?finalPrompt: text\('final_prompt'\)/)
  assert.match(schema, /export const scenes = sqliteTable\('scenes'[\s\S]*?finalPrompt: text\('final_prompt'\)/)
  // SQLite 启动建表 DDL 含最终提示词列（幂等重放）
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS characters \([\s\S]*?final_prompt TEXT/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS scenes \([\s\S]*?final_prompt TEXT/)
})

test('grid prompt agent tools save agent-written final prompts with style injection', () => {
  const tools = read('src/core/agents/tools/image-prompt-tools.ts')

  assert.match(tools, /save_character_final_prompt/)
  assert.match(tools, /save_scene_final_prompt/)
  // 保存时注入项目视觉风格并落库
  assert.match(tools, /getDramaStylePrompt/)
  assert.match(tools, /set\(\{ finalPrompt, updatedAt: now\(\) \}\)/)
  // 提示词由 Agent 创作，不再由工具机械拼接
  assert.doesNotMatch(tools, /generate_character_prompt/)
  assert.doesNotMatch(tools, /generate_scene_prompt/)
})

test('prompt agent instructions reference per-asset skills; skill files define the specs', () => {
  const agents = read('src/core/agents/index.ts')
  const charSkill = read('workspace/skills/prompt-generator/character-prompt/SKILL.md')
  const sceneSkill = read('workspace/skills/prompt-generator/scene-prompt/SKILL.md')

  // 三类图片规范入口（具体创作规则在各自 SKILL.md 中）；settings.vue 的默认提示词副本由前端自管，不再断言
  assert.match(agents, /角色三视图/)
  assert.match(agents, /场景固定视角/)
  assert.match(agents, /道具白底单品/)
  // 保存工具约定
  assert.match(agents, /save_character_final_prompt/)
  assert.match(agents, /save_scene_final_prompt/)
  // 角色三视图 / 场景固定视角的必备要素由技能文件承载（输出语言交给语言指令，不再写死纯中文）
  assert.match(charSkill, /正脸特写/)
  assert.match(charSkill, /正面、90 度侧面、背面/)
  assert.match(charSkill, /三个视图的脸、发型和服装完全一致/)
  assert.doesNotMatch(charSkill, /只输出中文|纯中文/)
  assert.match(sceneSkill, /固定机位广角镜头/)
  assert.match(sceneSkill, /出入口/)
  assert.doesNotMatch(sceneSkill, /只输出中文|纯中文/)
})

test('image generation prefers the stored final prompt with agent generation and legacy fallback', () => {
  const service = read('src/core/generation/final-prompt.ts')
  const characters = read('src/routes/characters.ts')
  const scenes = read('src/routes/scenes.ts')

  assert.match(service, /export async function ensureCharacterFinalPrompt/)
  assert.match(service, /export async function ensureSceneFinalPrompt/)
  assert.match(service, /getAgent\('prompt_generator'/)
  // 已有最终提示词直接复用（force 时忽略强制重新生成）
  assert.match(service, /if \(char\.finalPrompt && !force\) return char\.finalPrompt/)
  assert.match(service, /if \(scene\.finalPrompt && !force\) return scene\.finalPrompt/)
  assert.match(service, /force = false/)

  assert.match(characters, /ensureCharacterFinalPrompt\(char, ep\.id, /)
  // 文本模型覆盖（text_model/text_config_id）透传到提示词 Agent
  assert.match(characters, /text_model/)
  assert.match(characters, /finalPrompt \|\| characterImagePrompt\(char, stylePrompt\)/)
  assert.match(scenes, /ensureSceneFinalPrompt\(scene, ep\.id, /)
  // 描述字段编辑不再自动清空最终提示词（以传入值为准，未传入保留原值）
  assert.match(characters, /finalPrompt = body\.final_prompt \|\| null/)
  assert.match(scenes, /finalPrompt = body\.final_prompt \|\| null/)
  assert.doesNotMatch(characters, /updates\.finalPrompt = null\n/)
})
