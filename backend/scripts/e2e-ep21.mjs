/**
 * EP1 ผลิตงานที่เหลือ (รอบสอง — แก้บั๊กจากรอบแรก)
 * - ใช้รายการ asset ระดับ drama (ไม่ใช่เฉพาะที่ link กับ EP21)
 * - poll path ใช้ plural ตลอด (แก้ 404 รอบแรก)
 * - วิดีโอ: ยิงทุกช็อตที่ยังไม่มี video_url (แก้เงื่อนไข skip กลับด้าน)
 * - วิดีโอ: ส่งภาพอ้างอิงฉาก/ตัวละคร/พร็อพและแปลง @ชื่อ เป็น @图片N ก่อนส่ง
 * - merge ใหม่ท้ายงาน
 */
import Database from 'better-sqlite3'
// needs the frontend repo next to this one (../naka-drama-studio)
import { analyzeVideoShot } from '../../../naka-drama-studio/frontend/app/utils/videoPreflight.js'

const API = 'http://localhost:5679/api/v1'
const EP_ID = 21
const DRAMA_ID = 2
const DB_PATH = new URL('../../data/huobao.sqlite3', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function api(method, path, body) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await resp.json().catch(() => ({}))
  if (!resp.ok || (json.code && json.code >= 400)) throw new Error(json.message || `HTTP ${resp.status}`)
  return json.data
}

function dbRO() { return new Database(DB_PATH, { readonly: true }) }

const hasImage = (m) => !!(m.image_url || m.imageUrl || m.local_path || m.localPath)
const SUBMIT_PATH = { character: 'characters', scene: 'scenes', prop: 'props' }

async function waitAssetImage(kindPlural, id, name, maxMs = 6 * 60_000) {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    await sleep(5000)
    try {
      const list = await api('GET', `/dramas/${DRAMA_ID}`) // drama detail มีครบทุกประเภท
      const pool = kindPlural === 'characters' ? list.characters : kindPlural === 'scenes' ? list.scenes : list.props
      const rec = (pool || []).find(x => x.id === id)
      if (rec && hasImage(rec)) return rec.image_url || rec.imageUrl
    } catch { /* รอบถัดไป */ }
  }
  throw new Error(`timeout รอรูป ${name}`)
}

async function phase1Images() {
  const d = dbRO()
  const groups = [
    ['character', 'characters', d.prepare("SELECT id, name FROM characters WHERE drama_id=? AND deleted_at IS NULL AND (image_url IS NULL OR image_url='')").all(DRAMA_ID)],
    ['scene', 'scenes', d.prepare("SELECT id, location AS name FROM scenes WHERE drama_id=? AND deleted_at IS NULL AND (image_url IS NULL OR image_url='')").all(DRAMA_ID)],
    ['prop', 'props', d.prepare("SELECT id, name FROM props WHERE drama_id=? AND deleted_at IS NULL AND (image_url IS NULL OR image_url='')").all(DRAMA_ID)],
  ]
  d.close()
  let done = 0, failed = 0
  for (const [kind, plural, missing] of groups) {
    log(`📋 ${plural}: ต้องสร้าง ${missing.length}`)
    for (const m of missing) {
      const name = m.name || `#${m.id}`
      try {
        log(`🖼️ [${kind}] ${name} → submit`)
        await api('POST', `/${SUBMIT_PATH[kind]}/${m.id}/generate-image`, { episode_id: EP_ID })
        const url = await waitAssetImage(plural, m.id, name)
        log(`   ✅ ${name} → ${url}`)
        done++
      } catch (e) {
        failed++
        log(`   ❌ ${name}: ${e.message}`)
      }
      await sleep(3000)
    }
  }
  log(`📊 เฟส 1: สำเร็จ ${done}, พลาด ${failed}`)
}

async function phase2Videos() {
  const d = dbRO()
  const shots = d.prepare('SELECT id, storyboard_number, video_prompt, duration, video_url FROM storyboards WHERE episode_id=? ORDER BY storyboard_number').all(EP_ID)
  const pending = shots.filter(s => !s.video_url)
  log(`📋 วิดีโอ: ต้องสร้าง ${pending.length}/${shots.length}`)
  for (const sb of pending) {
    const assets = []
    const scene = d.prepare('SELECT sc.location AS name, sc.image_url AS url FROM storyboards sb JOIN scenes sc ON sc.id=sb.scene_id WHERE sb.id=?').get(sb.id)
    if (scene) assets.push(scene)
    assets.push(...d.prepare(`SELECT c.name, COALESCE(l.image_url, c.image_url) AS url
      FROM storyboard_characters j JOIN characters c ON c.id=j.character_id
      LEFT JOIN storyboard_character_looks a ON a.storyboard_id=j.storyboard_id AND a.character_id=c.id
      LEFT JOIN character_looks l ON l.id=a.look_id
      WHERE j.storyboard_id=? ORDER BY c.id`).all(sb.id))
    assets.push(...d.prepare(`SELECT p.name, p.image_url AS url FROM storyboard_props j
      JOIN props p ON p.id=j.prop_id WHERE j.storyboard_id=? ORDER BY p.id`).all(sb.id))
    const plan = analyzeVideoShot({ prompt: sb.video_prompt, assets, limit: 9, duration: sb.duration })
    if (!plan.references.length || plan.issues.length) {
      throw new Error(`ช็อต ${sb.storyboard_number} ยังไม่พร้อมส่งวิดีโอ: ${JSON.stringify(plan.issues)}`)
    }
    log(`🎥 ช็อต ${sb.storyboard_number} → submit (${sb.duration}s)`)
    const task = await api('POST', '/tasks', {
      type: 'video', storyboard_id: sb.id, drama_id: DRAMA_ID, episode_id: EP_ID,
      prompt: plan.resolvedPrompt, reference_image_urls: plan.references,
      duration: sb.duration, resolution: '720p', aspect_ratio: '9:16',
    })
    const started = Date.now()
    let ok = false
    while (Date.now() - started < 15 * 60_000) {
      await sleep(15_000)
      const d2 = dbRO()
      const t = d2.prepare('SELECT status, error_msg, local_path FROM sys_task WHERE id=?').get(task.id)
      d2.close()
      if (t.status === 'completed') { log(`   ✅ ช็อต ${sb.storyboard_number} → ${t.local_path}`); ok = true; break }
      if (t.status === 'failed') { log(`   ❌ ช็อต ${sb.storyboard_number}: ${t.error_msg}`); break }
    }
    if (!ok) log(`   ⚠️ ช็อต ${sb.storyboard_number} ยังไม่จบในเวลา — ข้ามไปก่อน`)
    await sleep(3000)
  }
  d.close()
}

async function phase3Merge() {
  log('🎬 merge EP1 ใหม่ (หลังมีวิดีโอครบ)')
  await api('POST', `/merge/episodes/${EP_ID}/merge`, {})
  const started = Date.now()
  while (Date.now() - started < 12 * 60_000) {
    await sleep(10_000)
    const st = await api('GET', `/merge/episodes/${EP_ID}/merge`)
    if (st?.status === 'completed') { log(`   ✅ merge → ${st.merged_url || ''}`); return }
    if (st?.status === 'failed') throw new Error(`merge ล้มเหลว: ${st.error_msg || ''}`)
  }
  throw new Error('timeout merge')
}

try {
  log('🚀 รอบสอง: ผลิตงานที่เหลือของ EP1')
  await phase1Images()
  await phase2Videos()
  await phase3Merge()
  log('🎉 เสร็จสมบูรณ์')
} catch (e) {
  log('💥 หยุด: ' + e.message)
  process.exitCode = 1
}
