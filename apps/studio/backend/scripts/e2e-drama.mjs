/**
 * End-to-end drama pipeline test — drives the same HTTP APIs the workbench UI uses:
 *   story → script rewrite → asset extraction → asset images → storyboard → video prompts → videos → merge
 *
 *   WAN_ACCESS_KEY=wan-sk.… node scripts/e2e-drama.mjs [--text-model gemini-2.5-flash] [--budget 120] [--max-shots 6]
 *
 * Creates an isolated "[E2E]" project; image/video are locked to a low-priority Wan Create config so
 * no other project changes. Writes a JSON report to data/e2e/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const API = process.env.HUOBAO_API || 'http://localhost:5679/api/v1'
const WAN_BASE = 'https://create.wan.video'
const WAN_KEY = process.env.WAN_ACCESS_KEY || ''
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt }
const TEXT_MODEL = arg('--text-model', 'gemini-2.5-flash')
const BUDGET = Number(arg('--budget', 120))
const MAX_SHOTS = Number(arg('--max-shots', 6))
if (!/^wan-sk\.[^.\s]+\.[^.\s]+$/.test(WAN_KEY)) throw new Error('set WAN_ACCESS_KEY')

const STORY = `ฝนตกหนักคืนวันศุกร์ที่ร้านกาแฟเล็ก ๆ ริมถนนสุขุมวิท "น้ำ" บาริสต้าสาวอายุ 22 ผมสั้นประบ่า ใส่ผ้ากันเปื้อนสีเขียว กำลังเก็บร้าน
ชายหนุ่มในชุดสูทเปียกฝน "ภาคิน" รีบเดินออกจากร้าน ลืมกระเป๋าสตางค์หนังสีน้ำตาลไว้บนเคาน์เตอร์
น้ำเห็นกระเป๋าสตางค์ วิ่งฝ่าฝนตามออกไปที่ป้ายรถเมล์ ตะโกนเรียก "คุณคะ! ลืมของค่ะ!"
ภาคินหันกลับมา ประหลาดใจ รับกระเป๋าไปแล้วยิ้ม "ขอบคุณครับ ผมเพิ่งสัมภาษณ์งานไม่ผ่าน แต่คืนนี้คุณทำให้ผมยิ้มได้"
น้ำยื่นร่มของตัวเองให้เขา แล้ววิ่งกลับเข้าร้านทั้งที่ตัวเปียก ภาคินมองตามพร้อมรอยยิ้ม`

const report = { startedAt: new Date().toISOString(), textModel: TEXT_MODEL, budget: BUDGET, steps: [], ids: {}, findings: [] }
const reportDir = path.resolve(here, '../../data/e2e')
fs.mkdirSync(reportDir, { recursive: true })
const reportFile = path.join(reportDir, `report-${Date.now()}.json`)
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const redact = s => String(s).replace(/wan-sk\.[\w.]+|AIza[\w-]+|sk-[\w-]{12,}/g, '<KEY>')

async function api(method, p, body, timeoutMs = 120_000) {
  const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || (j.code && j.code >= 400)) throw new Error(`${method} ${p} → ${r.status} ${redact(j.message || JSON.stringify(j).slice(0, 300))}`)
  return j.data
}
async function wanCredits() {
  const r = await fetch(WAN_BASE + '/wanx/api/common/imagineCount', { method: 'POST', headers: { Authorization: `Bearer ${WAN_KEY}`, 'content-type': 'application/json', 'x-platform': 'cli' }, body: '{}' })
  return (await r.json())?.data?.availableCount
}

async function step(name, fn) {
  const t0 = Date.now()
  process.stdout.write(`\n▶ ${name}\n`)
  const entry = { name, status: 'running' }
  report.steps.push(entry)
  try {
    const result = await fn(entry)
    Object.assign(entry, { status: 'pass', seconds: Math.round((Date.now() - t0) / 1000), result })
    console.log(`  ✅ ${name} (${entry.seconds}s)`, result ? redact(JSON.stringify(result)).slice(0, 400) : '')
    save()
    return result
  } catch (err) {
    Object.assign(entry, { status: 'fail', seconds: Math.round((Date.now() - t0) / 1000), error: redact(err.message) })
    console.log(`  ❌ ${name}: ${entry.error}`)
    save()
    throw err
  }
}

async function waitTask(taskId, label, timeoutMs = 15 * 60_000) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeoutMs) {
    await sleep(5000)
    last = await api('GET', `/tasks/${taskId}`)
    if (last?.status === 'completed') return last
    if (last?.status === 'failed') throw new Error(`${label} task #${taskId} failed: ${last.error_msg || last.errorMsg || 'unknown'}`)
  }
  throw new Error(`${label} task #${taskId} timed out (last status ${last?.status})`)
}

let drama, episode, epId
const budgetState = { start: null }
// 断点续跑：--resume-episode <id> 复用已通过的 1-4 步（项目/集/剧本），从资产提取继续
const RESUME_EP = Number(arg('--resume-episode', 0))

try {
  await step('0. Preflight', async () => {
    const health = await fetch(API + '/health').then(r => r.json())
    budgetState.start = await wanCredits()
    const lang = await api('GET', '/settings/content-language')
    const cfgs = await api('GET', '/ai-configs')
    const text = cfgs.find(c => c.service_type === 'text' && c.is_active)
    if (!text) throw new Error('no active text config')
    return { health: health.status, wanCredits: budgetState.start, contentLanguage: lang.language, textConfig: `#${text.id} ${text.provider}`, textModelOverride: TEXT_MODEL }
  })

  if (RESUME_EP) {
    const all = await api('GET', '/dramas')
    const owner = all.items.find(d => (d.episodes || []).some(e => e.id === RESUME_EP))
    if (!owner) throw new Error(`resume episode ${RESUME_EP} not found`)
    const full = await api('GET', `/dramas/${owner.id}`)
    const ep = full.episodes.find(e => e.id === RESUME_EP)
    if (!(ep.script_content || '').trim()) throw new Error('resume episode has no script yet')
    drama = { id: owner.id, title: owner.title }
    episode = { id: ep.id }
    epId = ep.id
    report.ids = { drama: drama.id, episode: epId, resumed: true }
    console.log(`\n↻ resuming ${drama.title} / episode ${epId} (script ${ep.script_content.length} chars)`)
  }
  if (!RESUME_EP) {
  const cfg = await step('1. Wan Create configs (low priority, test-only lock)', async () => {
    const cfgs = await api('GET', '/ai-configs')
    const out = {}
    for (const type of ['image', 'video']) {
      let c = cfgs.find(x => x.provider === 'wancreate' && x.service_type === type)
      if (!c) {
        c = await api('POST', '/ai-configs', { service_type: type, provider: 'wancreate', name: `Wan Create ${type}`, base_url: WAN_BASE, api_key: WAN_KEY, model: type === 'image' ? ['wan2.7-flash'] : ['wan3.0'], priority: 1 })
      }
      out[type] = c.id
    }
    return out
  })
  report.ids.configs = cfg

  drama = await step('2. Create project', async () => {
    const d = await api('POST', '/dramas', { title: `[E2E] ร่มคันเดียว ${new Date().toISOString().slice(0, 16)}`, style: '3d', aspect_ratio: '9:16', description: 'บาริสต้าสาวคืนกระเป๋าสตางค์ให้ชายแปลกหน้ากลางฝน', genre: 'โรแมนติก / ฟีลกู๊ด' })
    return { id: d.id, title: d.title }
  })
  report.ids.drama = drama.id

  episode = await step('3. Create episode (locked to Wan) + save story', async () => {
    const ep = await api('POST', '/episodes', { drama_id: drama.id, title: 'ตอนที่ 1 ร่มคันเดียว', resolution: '720p', image_config_id: cfg.image, video_config_id: cfg.video })
    await api('PUT', `/episodes/${ep.id}`, { content: STORY })
    return { id: ep.id, number: ep.episode_number, imageConfig: ep.image_config_id, videoConfig: ep.video_config_id, storyChars: STORY.length }
  })
  epId = episode.id
  report.ids.episode = epId

  await step('4. AI script rewrite (script_rewriter agent)', async () => {
    const res = await api('POST', '/agent/script_rewriter/chat', { message: '请读取剧本并改写为格式化剧本，然后保存', drama_id: drama.id, episode_id: epId, model: TEXT_MODEL }, 10 * 60_000)
    const full = await api('GET', `/dramas/${drama.id}`)
    const ep = full.episodes.find(e => e.id === epId)
    const script = ep.script_content || ''
    if (script.trim().length < 100) throw new Error(`script_content too short (${script.length} chars); agent reply: ${redact(JSON.stringify(res)).slice(0, 300)}`)
    fs.writeFileSync(path.join(reportDir, `script-ep${epId}.txt`), script)
    return { scriptChars: script.length, thai: /[฀-๿]/.test(script), preview: script.slice(0, 160) }
  })
  }

  const assets = await step('5. Extract characters / scenes / props', async () => {
    if (RESUME_EP) {
      const [c0, s0] = await Promise.all(['characters', 'scenes'].map(k => api('GET', `/episodes/${epId}/${k}`)))
      if (c0.length && s0.length) return { reused: true, characters: c0.map(c => c.name), scenes: s0.map(x => x.location) }
    }
    for (const target of ['characters', 'scenes', 'props']) await api('POST', `/episodes/${epId}/extract`, { target, model: TEXT_MODEL })
    const t0 = Date.now()
    let st
    while (Date.now() - t0 < 10 * 60_000) {
      await sleep(5000)
      st = await api('GET', `/episodes/${epId}/extract-status`)
      const states = Object.values(st || {}).map(v => (typeof v === 'object' ? v?.status : v))
      if (states.length && states.every(s => s && s !== 'running' && s !== 'pending')) break
    }
    const [chars, scenes, props] = await Promise.all(['characters', 'scenes', 'props'].map(k => api('GET', `/episodes/${epId}/${k}`)))
    if (!chars.length || !scenes.length) throw new Error(`extraction incomplete: ${chars.length} chars / ${scenes.length} scenes; status ${JSON.stringify(st)}`)
    return { characters: chars.map(c => c.name), scenes: scenes.map(s => s.location), props: props.map(p => p.name), status: st }
  })

  await step('6. Generate asset images (Wan, with agent final prompts)', async () => {
    const [chars, scenes, props] = await Promise.all(['characters', 'scenes', 'props'].map(k => api('GET', `/episodes/${epId}/${k}`)))
    const jobs = [
      ...chars.map(c => ({ kind: 'characters', id: c.id, name: c.name })),
      ...scenes.map(s => ({ kind: 'scenes', id: s.id, name: s.location })),
      ...props.slice(0, 3).map(p => ({ kind: 'props', id: p.id, name: p.name })),
    ]
    const results = []
    const pending = jobs.filter(j => {
      const row = [...chars, ...scenes, ...props].find(x => x.id === j.id && (x.name === j.name || x.location === j.name))
      return !(row?.image_url || row?.imageUrl)
    })
    report.findings.push(`step 6: ${jobs.length - pending.length}/${jobs.length} assets already had images (reused)`)
    for (const j of pending) {
      const r = await api('POST', `/${j.kind}/${j.id}/generate-image`, { episode_id: epId, text_model: TEXT_MODEL }, 5 * 60_000)
      results.push({ ...j, taskId: r.image_generation_id })
    }
    const done = []
    for (const r of results) {
      const t = await waitTask(r.taskId, `${r.kind} ${r.name}`)
      done.push({ kind: r.kind, name: r.name, localPath: t.local_path || t.localPath })
    }
    return { images: done.length, credits: budgetState.start - (await wanCredits()), items: done }
  })

  const sbs = await step('7. Storyboard breakdown (storyboard_breaker agent)', async () => {
    const [chars, scenes, props] = await Promise.all(['characters', 'scenes', 'props'].map(k => api('GET', `/episodes/${epId}/${k}`)))
    const charList = chars.length ? chars.map(c => `${c.name}(ID:${c.id})`).join('、') : '（当前集还没有角色）'
    const sceneList = scenes.length ? scenes.map(s => `${s.location} · ${s.time || '未设时间'}(ID:${s.id})`).join('、') : '（当前集还没有场景）'
    const propList = props.length ? props.map(p => `${p.name}(ID:${p.id})`).join('、') : '（当前集还没有道具）'
    const message = `请基于当前集剧本拆分分镜，并为每个分镜段落同时生成 video_prompt（视频生成提示词）。
本次视频模型：Wan Create · wan3.0，请按该模型的特性与时长限制生成 video_prompt。

当前集已有角色：${charList}
当前集已有场景：${sceneList}
当前集已有道具：${propList}

绑定要求：
- 每个镜头必须根据剧本内容，从上述当前集已有角色中选出出场的角色绑定 character_ids（ID 必须来自上述列表；有角色出场就必须绑定，不要遗漏）
- 每个镜头尽量匹配上述已有场景填写 scene_id（ID 必须来自上述列表），不要凭空创造新场景
- 每个镜头出现关键道具（被使用、交接、特写或在画面中明显可见）时，从上述当前集已有道具中绑定 prop_ids（ID 必须来自上述列表）；没有道具出现可传空数组
- 只有纯环境空镜头才可以不绑定角色`
    const existing = await api('GET', `/episodes/${epId}/storyboards`)
    if (!(RESUME_EP && existing.length && existing.every(s => (s.video_prompt || '').trim())))
    await api('POST', '/agent/storyboard_breaker/chat', { message, drama_id: drama.id, episode_id: epId, model: TEXT_MODEL }, 15 * 60_000)
    let list = await api('GET', `/episodes/${epId}/storyboards`)
    if (!list?.length) throw new Error('no storyboards created')
    const missing = list.filter(s => !(s.video_prompt || '').trim())
    if (missing.length) {
      report.findings.push(`storyboard_breaker left ${missing.length}/${list.length} shots without video_prompt → batch fill`)
      await api('POST', `/episodes/${epId}/generate-video-prompts`, { model: TEXT_MODEL })
      for (let i = 0; i < 120; i++) {
        await sleep(5000)
        const st = await api('GET', `/episodes/${epId}/video-prompts-status`)
        if (st?.status !== 'running') break
      }
      list = await api('GET', `/episodes/${epId}/storyboards`)
    }
    const sample = list[0]
    report.storyboardSampleKeys = Object.keys(sample)
    return {
      shots: list.length,
      totalSeconds: list.reduce((s, x) => s + Number(x.duration || 0), 0),
      withPrompt: list.filter(s => (s.video_prompt || '').trim()).length,
      withScene: list.filter(s => s.scene_id).length,
      withChars: list.filter(s => (s.character_ids || s.characters || []).length).length,
    }
  })

  await step('8. Generate shot videos (Wan 3.0 Omni, budget-guarded)', async () => {
    const [list, chars, scenes, props] = await Promise.all([
      api('GET', `/episodes/${epId}/storyboards`),
      ...['characters', 'scenes', 'props'].map(k => api('GET', `/episodes/${epId}/${k}`)),
    ])
    const byId = (arr, id) => arr.find(x => Number(x.id) === Number(id))
    const idsOf = (sb, key, objKey) => (sb[key] || (sb[objKey] || []).map(o => o.id) || [])
    const shots = []
    for (const sb of list.slice(0, MAX_SHOTS)) {
      const spent = budgetState.start - (await wanCredits())
      if (spent >= BUDGET) { report.findings.push(`video budget reached (${spent} credits) — stopped before shot #${sb.storyboard_number || sb.id}`); break }
      // mirror getShotReferenceIndexMap / resolveVideoPromptRefs from the workbench
      const ordered = []
      const push = (name, url) => { if (url && !ordered.some(o => o.url === url) && ordered.length < 9) ordered.push({ name, url }) }
      const scene = byId(scenes, sb.scene_id)
      push(scene?.location || '', scene?.image_url)
      for (const cid of idsOf(sb, 'character_ids', 'characters')) { const c = byId(chars, cid); push(c?.name || '', c?.image_url) }
      for (const pid of idsOf(sb, 'prop_ids', 'props')) { const p = byId(props, pid); push(p?.name || '', p?.image_url) }
      const map = Object.fromEntries(ordered.map((o, i) => [o.name, i + 1]).filter(([n]) => n))
      const names = Object.keys(map).sort((a, b) => b.length - a.length)
      const prompt = String(sb.video_prompt || '').replace(/@([^\s@]+)/g, (m, raw) => { for (const n of names) if (raw.startsWith(n)) return `@图片${map[n]}${n}${raw.slice(n.length)}`; return m })
      const task = await api('POST', '/tasks', {
        type: 'video', storyboard_id: sb.id, drama_id: drama.id, prompt,
        duration: Number(sb.duration || 10), aspect_ratio: '9:16', generate_audio: true,
        reference_image_urls: ordered.map(o => o.url),
      })
      const t0 = Date.now()
      const done = await waitTask(task.id, `shot ${sb.id}`, 20 * 60_000)
      shots.push({ storyboard: sb.id, refs: ordered.length, seconds: Math.round((Date.now() - t0) / 1000), localPath: done.local_path || done.localPath, credits: budgetState.start - (await wanCredits()) })
      console.log(`    shot ${sb.id}: ok (${shots.at(-1).seconds}s, cumulative credits ${shots.at(-1).credits})`)
    }
    if (!shots.length) throw new Error('no shot videos generated')
    return { videos: shots.length, of: list.length, shots }
  })

  await step('9. Merge & export', async () => {
    const m = await api('POST', `/merge/episodes/${epId}/merge`, {})
    let st
    for (let i = 0; i < 120; i++) {
      await sleep(5000)
      st = await api('GET', `/merge/episodes/${epId}/merge`)
      if (st && st.status !== 'processing' && st.status !== 'pending') break
    }
    if (st?.status !== 'completed') throw new Error(`merge ended with ${JSON.stringify(st).slice(0, 300)}`)
    return { mergeId: m.merge_id, status: st.status, output: st.local_path || st.merged_url || st.output_path || st }
  })
} catch (err) {
  report.aborted = redact(err.message)
} finally {
  report.finishedAt = new Date().toISOString()
  try { report.wanCreditsUsed = budgetState.start - (await wanCredits()) } catch {}
  save()
  console.log(`\n=== report: ${reportFile}`)
  console.log(report.steps.map(s => `${s.status === 'pass' ? '✅' : '❌'} ${s.name} (${s.seconds ?? '-'}s)`).join('\n'))
  if (report.findings.length) console.log('findings:\n- ' + report.findings.join('\n- '))
  console.log('Wan credits used:', report.wanCreditsUsed)
}
