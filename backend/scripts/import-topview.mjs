/**
 * 从 Topview Drama Studio 导出的 JSON 导入为 huobao 项目（可重复执行，幂等）
 *
 * 用法（后端运行中）：
 *   node scripts/import-topview.mjs ../data/imports/topview-<project>.json
 *
 * 阶段一（总能执行）：风格预设、项目、角色、场景、道具
 * 阶段二（需已启用图片+视频配置）：各集 + 原文/剧本 + 集与角色/场景/道具的关联
 *   创建集时后端会锁定当前启用的图片/视频配置，所以没有配置时跳过，配置好后再跑一次即可。
 * 集与资产的多对多关联没有对外 API，这里直接写 episode_* 关联表。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const here = path.dirname(fileURLToPath(import.meta.url))
const API = process.env.HUOBAO_API || `http://localhost:${process.env.PORT || 5679}/api/v1`
const DB_PATH = process.env.SQLITE_PATH || path.join(here, '..', '..', 'data', 'huobao.sqlite3')

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/import-topview.mjs <topview-export.json>')
  process.exit(1)
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'))

async function call(method, p, body) {
  const res = await fetch(API + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (json.code >= 400 || !res.ok) throw new Error(`${method} ${p} → ${json.message || res.status}`)
  return json.data
}
const log = (...a) => console.log('•', ...a)

// ---------- 阶段一 ----------
const sourceTag = `topview:${data.source.project_id}`

// 风格预设
const presets = await call('GET', '/style-presets?all=1')
let style = presets.find(p => p.value === data.style_preset.value)
if (!style) {
  style = await call('POST', '/style-presets', { ...data.style_preset, sort_order: 0 })
  log('style preset created:', data.style_preset.value)
}

// 项目（按 metadata.source 查重）
const { items: dramas = [] } = await call('GET', '/dramas')
let drama = dramas.find(d => {
  try { return JSON.parse(d.metadata || '{}').source === sourceTag } catch { return false }
})
const d = data.drama
if (!drama) {
  drama = await call('POST', '/dramas', {
    title: d.title,
    description: `${d.logline}\n\nคำถามใหญ่ของเรื่อง: ${d.grand_expectation}`,
    genre: d.genre,
    style: data.style_preset.value,
    aspect_ratio: d.aspect_ratio,
    tags: d.tags,
    metadata: JSON.stringify({ source: sourceTag, url: data.source.url, topview_settings: d.topview_settings }),
  })
  log('drama created:', drama.id, d.title)
} else {
  log('drama exists:', drama.id, drama.title)
}
const full = await call('GET', `/dramas/${drama.id}`)

// 角色 / 场景 / 道具（按名称查重）
const charIds = {}
for (const c of data.characters) {
  let row = (full.characters || []).find(x => x.name === c.name)
  if (!row) {
    row = await call('POST', '/characters', {
      drama_id: drama.id,
      name: c.name,
      role: c.role,
      appearance: c.appearance,
      styling: c.styling,
      description: `บุคลิก: ${c.traits.join(' · ')}`,
    })
    log('character:', c.name)
  }
  charIds[c.name] = row.id
}
const sceneIds = {}
for (const e of data.environments) {
  let row = (full.scenes || []).find(x => x.location === e.location)
  if (!row) {
    row = await call('POST', '/scenes', { drama_id: drama.id, location: e.location, prompt: e.description })
    log('scene:', e.location)
  }
  sceneIds[e.key] = row.id
}
const propIds = {}
for (const p of data.props) {
  let row = (full.props || []).find(x => x.name === p.name)
  if (!row) {
    row = await call('POST', '/props', { drama_id: drama.id, name: p.name, type: p.type, description: p.description })
    log('prop:', p.name)
  }
  propIds[p.key] = row.id
}

// ---------- 阶段二：集 ----------
const configs = await call('GET', '/ai-configs')
const active = t => configs.some(c => c.service_type === t && c.is_active)
if (!active('image') || !active('video')) {
  console.log('\n⚠ ยังไม่ได้ตั้งค่าบริการรูปภาพ/วิดีโอ — ข้ามการสร้างตอน')
  console.log('  ตั้งค่าที่ ตั้งค่า → บริการ AI แล้วรันคำสั่งนี้อีกครั้ง ตอนทั้ง 8 จะถูกสร้างต่อจากที่มีอยู่')
  console.log(`\nimported drama #${drama.id} (phase 1 only)`)
} else {
  await importEpisodes()
  console.log(`\nimported drama #${drama.id} with ${data.episodes.length} episodes`)
}

async function importEpisodes() {
const existingEps = (full.episodes || [])
const db = new Database(DB_PATH)
const now = new Date().toISOString()
const link = (table, col, episodeId, id) => {
  const hit = db.prepare(`SELECT 1 FROM ${table} WHERE episode_id = ? AND ${col} = ?`).get(episodeId, id)
  if (!hit) db.prepare(`INSERT INTO ${table} (episode_id, ${col}, created_at) VALUES (?, ?, ?)`).run(episodeId, id, now)
}

for (const ep of data.episodes) {
  let row = existingEps.find(x => Number(x.episode_number) === ep.number)
  if (!row) {
    row = await call('POST', '/episodes', { drama_id: drama.id, title: ep.title, resolution: '720p' })
    log(`episode ${ep.number}:`, ep.title)
  }
  const content = [
    ep.summary,
    '',
    `เป้าหมายของตอน: ${ep.goal}`,
    `จุดอารมณ์: ${ep.emotion}`,
    `ความยาวโดยประมาณ: ${ep.duration_s} วินาที`,
  ].join('\n')
  await call('PUT', `/episodes/${row.id}`, {
    title: ep.title,
    content,
    ...(ep.script ? { script_content: ep.script } : {}),
  })
  for (const name of ep.characters) if (charIds[name]) link('episode_characters', 'character_id', row.id, charIds[name])
  for (const key of ep.environments) if (sceneIds[key]) link('episode_scenes', 'scene_id', row.id, sceneIds[key])
  for (const key of ep.props) if (propIds[key]) link('episode_props', 'prop_id', row.id, propIds[key])
}
db.close()
}
