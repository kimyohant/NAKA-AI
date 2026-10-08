import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('Phase 3 routes: ad references + visuals ครบตาม PHASE3 ข้อ 2', () => {
  const route = read('src/routes/campaigns.ts')

  // Ad references CRUD + analyze
  assert.match(route, /app\.post\('\/:id\/references'/)
  assert.match(route, /app\.put\('\/:id\/references\/:rid'/)
  assert.match(route, /app\.delete\('\/:id\/references\/:rid'/)
  assert.match(route, /app\.post\('\/:id\/references\/:rid\/analyze'/)
  // Product visuals
  assert.match(route, /app\.post\('\/:id\/visuals\/generate'/)
  assert.match(route, /app\.delete\('\/:id\/visuals\/:vid'/)
  assert.match(route, /app\.post\('\/:id\/visuals\/:vid\/promote'/)

  // error codes ใหม่ตามสัญญา
  assert.match(route, /E_REFERENCE_NOT_ANALYZED/) // ใน service แต่ route ต้องส่งต่อ errorCode
  const service = read('src/services/marketer.ts')
  assert.match(service, /E_REFERENCE_NOT_ANALYZED/)
  assert.match(service, /E_VISUAL_NOT_READY/)
  assert.match(service, /E_NO_IMAGE_MODEL/)
  assert.match(service, /E_INVALID_FIELD/)
  assert.match(service, /E_CAMPAIGN_BUSY/)

  // transcript guard
  assert.match(service, /MAX_TRANSCRIPT_LENGTH/)
  assert.match(service, /20_000/)

  // GET /:id คืน references + visuals เพิ่ม
  // async analyze (unsloth plan): reference json รับ opts {analyzing} — flags มาจาก pipeline_tasks ที่ running
  assert.match(service, /references: references\.map\(r => toAdReferenceJson\(r, \{ analyzing: analyzingKeys\.has\(`reference_analyze:\$\{id\}:\$\{r\.id\}`\) \}\)\)/)
  assert.match(service, /visuals,/)
})

test('ad_analyst agent registered ครบทุกจุด และ output ผ่าน tool', () => {
  const agents = read('src/core/agents/index.ts')
  assert.match(agents, /ad_analyst: \{/) // DEFAULT_PROMPTS

  const skills = read('src/core/agents/skills.ts')
  assert.match(skills, /ad_analyst: \['ad-analyst'\]/)

  const tools = read('src/modules/marketer/agent-tools.ts')
  assert.match(tools, /save_reference_analysis/)
  // tools come from the marketer module (core never imports menu code)
  assert.match(tools, /registerAgentTools\('ad_analyst', \{\s*saveReferenceAnalysis: marketerTools\.saveReferenceAnalysis/)
  assert.match(tools, /campaignAdReferences/)

  // prompt/skill ไฟล์ครบ + หัวข้อบังคับ 6 อัน (PHASE3 ข้อ 3) + กฎห้ามลอก
  for (const file of ['workspace/prompts/ad_analyst.md', 'workspace/prompts/ad_analyst.en.md',
    'workspace/skills/ad-analyst/SKILL.md', 'workspace/skills/ad-analyst/SKILL.en.md']) {
    const content = read(file)
    assert.match(content, /Hook \(0–3s\)/)
    assert.match(content, /## Structure/)
    assert.match(content, /Pacing & Format/)
    assert.match(content, /Persuasion Levers/)
    assert.match(content, /## CTA/)
    assert.match(content, /Reuse Template/)
    assert.match(content, /เกิน 1 ประโยค|more than one sentence|超过一句/, 'ไฟล์ต้องมีกฎห้ามลอกถ้อยคำต้นฉบับเกิน 1 ประโยค')
  }
})

test('ad_scriptwriter รู้จักบล็อก reference (recreate mode) ทั้ง DEFAULT_PROMPTS และ workspace', () => {
  const agents = read('src/core/agents/index.ts')
  assert.match(agents, /【Reference ad structure】/)

  for (const file of ['workspace/prompts/ad_scriptwriter.md', 'workspace/prompts/ad_scriptwriter.en.md',
    'workspace/skills/ad-scriptwriter/SKILL.md', 'workspace/skills/ad-scriptwriter/SKILL.en.md']) {
    const content = read(file)
    assert.match(content, /Reference ad structure|recreate/i, `${file} ต้องอธิบาย recreate mode`)
  }
  // tool ชื่อ save_creatives ต้องปรากฏใน prompt files (ผูกให้ agent บันทึกผ่าน tool)
  for (const file of ['workspace/prompts/ad_scriptwriter.md', 'workspace/prompts/ad_scriptwriter.en.md']) {
    assert.match(read(file), /save_creatives/)
  }

  // save_creatives บันทึก reference_id จาก request context
  const tools = read('src/modules/marketer/agent-tools.ts')
  assert.match(tools, /referenceId: \(rc\?\.get\('referenceId' as never\) as number \| undefined\) \?\? null/)
  const service = read('src/services/marketer.ts')
  assert.match(service, /referenceId: reference\?\.id/)
})

test('product visuals อ่านสดจาก sys_task และไม่แตะ write-back ของ generation.ts', () => {
  const service = read('src/services/marketer.ts')
  // อ่าน status/imageUrl จาก sys_task (ไม่เก็บซ้ำใน campaign_visuals)
  assert.match(service, /schema\.sysTask/)
  assert.match(service, /visualStatusFromTask/)
  assert.match(service, /task\?\.localPath \|\| task\?\.resultUrl/)
  assert.match(service, /'unknown'/) // unknown → failed
  // ใช้ generateImage เดิม + dramaId สำหรับ budget guard + reference image = sourceImage
  assert.match(service, /generateImage\(\{/)
  assert.match(service, /dramaId: campaign\.dramaId \?\? undefined/)
  assert.match(service, /referenceImages: \[sourceImage\]/)
  // packshot สี่เหลี่ยมจัตุรัส / ขนาดตาม aspectRatio — builder อยู่ใน services/product-visuals.ts (ใช้ร่วมกับ Studio)
  assert.match(service, /visualSizeFor\(/) // เรียกผ่าน builder ที่ย้ายไป
  const productVisuals = read('src/core/product/product-visuals.ts')
  assert.match(productVisuals, /export function buildVisualPrompt/)
  assert.match(productVisuals, /export function visualSizeFor/)
  assert.match(productVisuals, /'1024x1024'/)
  // ห้ามแตะ writeBackImageAssets / createTask ใน generation.ts (งาน visual ไม่มี prop/character ให้ write-back)
  assert.doesNotMatch(service, /writeBackImageAssets/)
  const generation = read('src/core/generation/generation.ts')
  assert.match(generation, /async function writeBackImageAssets/) // ยังอยู่ครบ ไม่ถูกแก้ให้หาย
  // promote: ต่อท้าย productImages ไม่ซ้ำ + promoted คำนวณจาก productImages
  assert.match(service, /E_VISUAL_NOT_READY/)
  assert.match(service, /productImages: JSON\.stringify\(next\)/)
  assert.match(service, /promoted = !!imageUrl && productImages\.some/)
})
