import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { buildCaptionCues, splitCaptionLines, toSrt, toAss, assertCaptionFontAvailable, aiLabelText } from '../src/core/production/captions.js'

// ตั้ง env ก่อน import services (db singleton) — ทำผ่าน dynamic import
const dir = mkdtempSync(path.join(tmpdir(), 'naka-studio2-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')

const { initSqliteSchema } = await import('../src/core/db/sqlite-schema.js')
const { db, schema } = await import('../src/core/db/index.js')
const { createProjectFromCampaign } = await import('../src/modules/product-studio/services/studio.js')
const { startAutoRender, runAutoRenderPipeline } = await import('../src/modules/product-studio/services/studio-autorender.js')
const { now } = await import('../src/core/http/response.js')

// seed: migration + configs (dummy) + campaign/creative + project/drama/episode/storyboards
{
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}
const ts = now()
{
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.prepare("INSERT INTO ai_service_configs (service_type, provider, name, base_url, api_key, model, is_active, is_default, priority, created_at, updated_at) VALUES ('image','openai','d','http://127.0.0.1:9','sk-dummy','[\"m\"]',1,1,10,?,?),('video','volcengine','d','http://127.0.0.1:9','sk-dummy','[\"m\"]',1,1,10,?,?)").run(ts, ts, ts, ts)
  sqlite.prepare("INSERT INTO campaigns (title, product_name, product_images, platforms, market, status, created_at, updated_at) VALUES ('Camp A', 'Serum S', '[\"/static/products/a.png\"]', '[\"tiktok\",\"shopee\"]', 'TH', 'draft', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO campaign_creatives (campaign_id, angle, hook, format, platform, duration_sec, cta, script, status, created_at, updated_at) VALUES (1, 'ugc angle', 'Dull skin? Watch this', 'ugc', 'tiktok', 30, 'Shop now', '## S1', 'approved', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO studio_projects (title, product_name, template_id, language, market, platform, aspect_ratio, duration_sec, status, created_at, updated_at) VALUES ('P1', 'Serum S', 'ugc_review', 'th', 'TH', 'tiktok', '9:16', 24, 'script_ready', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO dramas (title, status, created_at, updated_at) VALUES ('P1', 'draft', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO episodes (drama_id, episode_number, title, status, created_at, updated_at) VALUES (1, 1, 'P1', 'draft', ?, ?)").run(ts, ts)
  sqlite.prepare("UPDATE studio_projects SET drama_id=1, episode_id=1 WHERE id=1").run()
  // avatar (uploaded image) — ugc_review avatarMode: required
  sqlite.prepare("INSERT INTO studio_avatars (name, description, image_url, created_at, updated_at) VALUES ('Ploy', 'Thai woman, 25', '/static/avatars/ploy.png', ?, ?)").run(ts, ts)
  sqlite.prepare("UPDATE studio_projects SET avatar_id=1 WHERE id=1").run()
  // 2 shots: imagePrompt/videoPrompt ครบ (pipeline จะส่งงานจริงผ่าน generateImage/Video)
  for (let i = 1; i <= 2; i++) {
    sqlite.prepare("INSERT INTO storyboards (episode_id, storyboard_number, title, duration, description, image_prompt, video_prompt, status, created_at, updated_at) VALUES (1, ?, ?, 5, 'visual text', ?, ?, 'pending', ?, ?)").run(i, `role${i}`, `img ${i}`, `vid ${i}`, ts, ts)
    const sbId = sqlite.prepare("SELECT id FROM storyboards WHERE episode_id=1 AND storyboard_number=?").get(i).id
    sqlite.prepare("INSERT INTO studio_shots (storyboard_id, project_id, role, dialogue, on_screen_text) VALUES (?, 1, ?, 'บรรทัดพูดภาษาไทยช็อตที่ ' || ?, null)").run(sbId, i === 1 ? 'hook' : 'problem', i)
  }
  sqlite.close()
}

test('migration v11: คอลัมน์ captions/auto_render/source_campaign_id ครบ', () => {
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  const cols = sqlite.pragma('table_info(studio_projects)').map(r => r.name)
  for (const col of ['captions', 'caption_style', 'ai_label_burn_in', 'auto_render', 'source_campaign_id']) {
    assert.ok(cols.includes(col), `missing ${col}`)
  }
  const mergeCols = sqlite.pragma('table_info(video_merges)').map(r => r.name)
  assert.ok(mergeCols.includes('captioned') && mergeCols.includes('subtitle_url'))
  const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version)
  assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
  sqlite.close()
})

test('captions: ตัดบรรทัดหลายภาษาด้วย Intl.Segmenter', () => {
  // th: ไม่มีช่องว่าง — segmenter แบ่งคำไทยได้ และควบรวมโดยไม่เติมช่องว่าง
  const th = splitCaptionLines('สวัสดีครับวันนี้จะมารีวิวเซรั่มตัวใหม่จากร้านเรา', 'th', 18)
  assert.ok(th.length >= 2)
  assert.ok(th.every(l => l.length <= 20))
  assert.equal(th.join(''), 'สวัสดีครับวันนี้จะมารีวิวเซรั่มตัวใหม่จากร้านเรา')
  // en: คงช่องว่าง
  const en = splitCaptionLines('This vitamin C serum makes your skin glow', 'en', 20)
  assert.ok(en.every(l => l.length <= 22))
  assert.equal(en.join(' '), 'This vitamin C serum makes your skin glow')
  // zh: ไม่มีช่องว่าง
  const zh = splitCaptionLines('这款维生素C精华液让你的皮肤焕发光彩', 'zh', 10)
  assert.equal(zh.join(''), '这款维生素C精华液让你的皮肤焕发光彩')
  // ar: ข้อความคงเดิมหลังตัดบรรทัด
  const ar = splitCaptionLines('هذا السيروم يمنح بشرتك إشراقة رائعة كل يوم', 'ar', 20)
  assert.equal(ar.join(' '), 'هذا السيروم يمنح بشرتك إشراقة رائعة كل يوم')
  // vi: มีวรรณยุกต์ซ้อน — ไม่สูญเสียตัวอักษร
  const vi = splitCaptionLines('Tinh chất này giúp da bạn sáng mịn mỗi ngày', 'vi', 18)
  assert.equal(vi.join(' '), 'Tinh chất này giúp da bạn sáng mịn mỗi ngày')
  // ja
  const ja = splitCaptionLines('このビタミンCセラムで肌が輝きます', 'ja', 10)
  assert.equal(ja.join(''), 'このビタミンCセラムで肌が輝きます')
})

test('captions: cue เวลาสะสมจากความยาวจริง (inject probe) + srt format', async () => {
  const cues = await buildCaptionCues([
    { text: 'บรรทัดแรกของซับ', clipPath: 'clip1.mp4' },
    { text: null, clipPath: 'clip2.mp4' },
    { text: 'ช็อตที่สามมีข้อความ', clipPath: 'clip3.mp4' },
  ], 'th', '9:16', {
    probe: async (clip) => (clip === 'clip1.mp4' ? 3 : clip === 'clip3.mp4' ? 2.5 : 0),
  })
  // ช็อต 2 ไม่มีข้อความ → ไม่มี cue แต่เวลายังสะสม
  assert.equal(cues.length, 2)
  assert.ok(Math.abs(cues[0].start - 0) < 1e-9)
  assert.ok(Math.abs(cues[0].end - 3) < 1e-9)
  // ช็อต 3 เริ่มที่ 3+0 (ช็อต 2 ยาว 0 เพราะไม่มีไฟล์)
  assert.ok(Math.abs(cues[1].start - 3) < 1e-9)
  assert.ok(Math.abs(cues[1].end - 5.5) < 1e-9)
  const srt = toSrt(cues)
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:03,000\n/)
  assert.match(srt, /00:00:03,000 --> 00:00:05,500/)
  // ass: สไตล์/margin 15%/ป้าย AI
  const ass = toAss(cues, { style: 'bold', language: 'th', aspectRatio: '9:16', aiLabelText: aiLabelText('th'), totalDurationSec: 5.5 })
  assert.match(ass, /PlayResX: 720/)
  assert.match(ass, /Style: Caption,Noto Sans Thai,/)
  assert.match(ass, /สร้างด้วย AI/)
  // boxed ใช้ BorderStyle 3
  const boxed = toAss(cues, { style: 'boxed', language: 'th', aspectRatio: '16:9', aiLabelText: null, totalDurationSec: 5.5 })
  assert.match(boxed, /PlayResX: 1280/)
  // font missing → E_CAPTION_FONT_MISSING (errorCode)
  const { AppError } = await import('../src/core/http/response.js')
  try {
    assertCaptionFontAvailable('th', path.join(dir, 'no-fonts'))
    assert.fail('should throw')
  } catch (err: any) {
    assert.ok(err instanceof AppError)
    assert.equal(err.errorCode, 'E_CAPTION_FONT_MISSING')
  }
})

test('from-campaign: map platform/market/images + notes จาก creative + guard', async () => {
  const project = await createProjectFromCampaign({ campaignId: 1, creativeId: 1, templateId: 'ugc_review' })
  assert.equal(project.sourceCampaignId, 1)
  assert.equal(project.productName, 'Serum S')
  assert.deepEqual(project.productImages, ['/static/products/a.png'])
  assert.equal(project.platform, 'tiktok') // platform แรกของ campaign ที่ map ได้
  assert.equal(project.market, 'TH')
  assert.equal(project.language, 'th') // default ตาม market
  assert.match(project.notes ?? '', /Hook: Dull skin\? Watch this/)
  assert.match(project.notes ?? '', /Angle: ugc angle/)
  assert.match(project.notes ?? '', /CTA: Shop now/)
  // creative ไม่ใช่ของ campaign ⇒ E_STUDIO_CAMPAIGN_NOT_FOUND
  await assert.rejects(
    createProjectFromCampaign({ campaignId: 1, creativeId: 999, templateId: 'ugc_review' }),
    (err: any) => err.errorCode === 'E_STUDIO_CAMPAIGN_NOT_FOUND',
  )
  // campaign soft delete ⇒ E_STUDIO_CAMPAIGN_NOT_FOUND
  {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
    sqlite.prepare("UPDATE campaigns SET deleted_at='2026-01-02' WHERE id=1").run()
    sqlite.close()
  }
  await assert.rejects(
    createProjectFromCampaign({ campaignId: 1, templateId: 'ugc_review' }),
    (err: any) => err.errorCode === 'E_STUDIO_CAMPAIGN_NOT_FOUND',
  )
})

test('auto-render: stage เดินครบ ช็อตล้มไม่หยุด + loop หยุดจริง (dummy model)', async () => {
  // pipeline ต้อง fail ที่ videos stage (keyframes ล้มหมดเพราะ endpoint ปลอม) — พิสูจน์ว่า
  // ช็อตล้มไม่หยุด pipeline (keyframes → videos) และ loop จบ (stage failed + finishedAt)
  // pipeline_tasks row: startAutoRender สร้างให้จริง — test เรียก runAutoRenderPipeline ตรงจึง seed เอง
  {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
    sqlite.prepare("INSERT INTO pipeline_tasks (kind, key, status, created_at, updated_at) VALUES ('studio_render','studio_render:1','running',datetime('now'),datetime('now'))").run()
    sqlite.close()
  }
  await runAutoRenderPipeline(1, 'studio_render:1', { pollMs: 50 })
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  const row = sqlite.prepare('SELECT auto_render FROM studio_projects WHERE id=1').get()
  const state = JSON.parse(row.auto_render)
  assert.equal(state.stage, 'failed')
  assert.match(state.errorMsg ?? '', /E_STUDIO_NEEDS_KEYFRAMES/)
  assert.ok(state.finishedAt)
  // sys_task ถูกสร้างจริงใน keyframes stage (ส่งงานผ่าน generateImage)
  const taskCount = sqlite.prepare("SELECT COUNT(*) c FROM sys_task WHERE type='image'").get().c
  assert.equal(taskCount, 2)
  // loop หยุดจริง: รอ 300ms แล้ว auto_render ไม่เปลี่ยน
  const before = JSON.stringify(row.auto_render)
  await new Promise(r => setTimeout(r, 300))
  const after = JSON.stringify(sqlite.prepare('SELECT auto_render FROM studio_projects WHERE id=1').get().auto_render)
  assert.equal(after, before)
  // pipeline_tasks row จบสถานะ
  const pt = sqlite.prepare("SELECT status, error_msg FROM pipeline_tasks WHERE kind='studio_render'").get()
  assert.equal(pt.status, 'error')
  assert.match(pt.error_msg ?? '', /E_STUDIO_NEEDS_KEYFRAMES/)
  sqlite.close()
})

test('auto-render: cancel หยุดก่อนส่งงาน stage ถัดไป (deterministic: cancel ก่อนเริ่ม)', async () => {
  {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
    // reset โปรเจกต์ 1 เป็น script_ready + สร้าง pipeline row พร้อม cancel_requested=1 ก่อนเริ่ม
    sqlite.prepare("UPDATE studio_projects SET status='script_ready', auto_render=NULL WHERE id=1").run()
    sqlite.prepare("INSERT INTO pipeline_tasks (kind, key, status, created_at, updated_at) VALUES ('studio_render','studio_render:1b','running',datetime('now'),datetime('now'))").run()
    sqlite.prepare("UPDATE pipeline_tasks SET cancel_requested=1 WHERE key='studio_render:1b'").run()
    sqlite.close()
  }
  await runAutoRenderPipeline(1, 'studio_render:1b', { pollMs: 50 })
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  const row = sqlite.prepare('SELECT auto_render FROM studio_projects WHERE id=1').get()
  const state = JSON.parse(row.auto_render)
  assert.equal(state.stage, 'cancelled')
  assert.ok(state.finishedAt)
  const pt = sqlite.prepare("SELECT status FROM pipeline_tasks WHERE key='studio_render:1b'").get()
  assert.equal(pt.status, 'cancelled')
  sqlite.close()
})

test('captions: ข้อความยาวแบ่ง cue ขนาดใกล้เคียงกัน — ไม่มี cue เศษคำเดียวที่ขึ้นจอเสี้ยววินาที', async () => {
  // เดิม: 37 ตัวอักษรใน 9:16 → cue แรกเต็ม 2 บรรทัด + cue "ใหม่" ยาว 0.21s จากช็อต 2s
  const cues = await buildCaptionCues(
    [{ text: 'สวัสดีครับวันนี้จะมารีวิวเซรั่มตัวใหม่', clipPath: 'c1' }],
    'th', '9:16', { probe: async () => 2 },
  )
  assert.equal(cues.length, 2)
  for (const c of cues) assert.ok(c.end - c.start >= 0.8, `cue ${JSON.stringify(c.lines)} สั้นเกิน: ${(c.end - c.start).toFixed(2)}s`)
  // ข้อความครบ ไม่หาย/ไม่ซ้ำ
  assert.equal(cues.flatMap(c => c.lines).join(''), 'สวัสดีครับวันนี้จะมารีวิวเซรั่มตัวใหม่')
})

test('auto-render resume ที่ videos: ไม่ส่ง keyframe ซ้ำ และงานที่จบครบระหว่าง server ดับเดินต่อได้', async () => {
  let videoTaskIds: number[]
  {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
    sqlite.prepare("UPDATE studio_projects SET auto_render=NULL WHERE id=1").run()
    sqlite.prepare("INSERT INTO pipeline_tasks (kind, key, status, created_at, updated_at) VALUES ('studio_render','studio_render:1c','running',datetime('now'),datetime('now'))").run()
    // งานวิดีโอของ stage ที่ค้าง จบไปแล้ว (failed) ระหว่างที่ server ดับ — ไม่มี in-flight เหลือ
    const ins = sqlite.prepare("INSERT INTO sys_task (type, status, created_at, updated_at) VALUES ('video', 'failed', ?, ?)")
    videoTaskIds = [Number(ins.run(ts, ts).lastInsertRowid), Number(ins.run(ts, ts).lastInsertRowid)]
    sqlite.close()
  }
  const countImages = () => {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
    const c = sqlite.prepare("SELECT COUNT(*) c FROM sys_task WHERE type='image'").get().c
    sqlite.close()
    return c
  }
  const imagesBefore = countImages()
  await runAutoRenderPipeline(1, 'studio_render:1c', { pollMs: 50, resumeStage: 'videos', resumeTaskIds: videoTaskIds })
  // keyframe ที่เคยล้ม (จาก test ก่อนหน้า) ต้องไม่ถูกส่งใหม่ — resume ห้ามย้อน stage
  assert.equal(countImages(), imagesBefore)
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  const state = JSON.parse(sqlite.prepare('SELECT auto_render FROM studio_projects WHERE id=1').get().auto_render)
  // เดินต่อไปถึง merge (ไม่มีวิดีโอ → E_STUDIO_NO_VIDEOS) — ไม่ใช่ล้มทันทีด้วย E_TASK_INTERRUPTED
  assert.equal(state.stage, 'failed')
  assert.doesNotMatch(state.errorMsg ?? '', /E_TASK_INTERRUPTED/)
  assert.match(state.errorMsg ?? '', /E_STUDIO_NO_VIDEOS/)
  sqlite.close()
})

test('auto-render resume: sys_task หายจริง ⇒ E_TASK_INTERRUPTED', async () => {
  {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
    sqlite.prepare("UPDATE studio_projects SET auto_render=NULL WHERE id=1").run()
    sqlite.prepare("INSERT INTO pipeline_tasks (kind, key, status, created_at, updated_at) VALUES ('studio_render','studio_render:1d','running',datetime('now'),datetime('now'))").run()
    sqlite.close()
  }
  await runAutoRenderPipeline(1, 'studio_render:1d', { pollMs: 50, resumeStage: 'videos', resumeTaskIds: [987654] })
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  const state = JSON.parse(sqlite.prepare('SELECT auto_render FROM studio_projects WHERE id=1').get().auto_render)
  assert.equal(state.stage, 'failed')
  assert.match(state.errorMsg ?? '', /E_TASK_INTERRUPTED/)
  sqlite.close()
})

test('boot: failStaleRunningTasks ไม่แตะ studio_render — ปล่อยให้ resumeStaleAutoRenders รับช่วง', async () => {
  const { failStaleRunningTasks } = await import('../src/core/tasks/pipeline-tasks.js')
  {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
    sqlite.prepare("INSERT INTO pipeline_tasks (kind, key, status, created_at, updated_at) VALUES ('studio_render','studio_render:boot','running',datetime('now'),datetime('now'))").run()
    sqlite.prepare("INSERT INTO pipeline_tasks (kind, key, status, created_at, updated_at) VALUES ('extract','extract:boot','running',datetime('now'),datetime('now'))").run()
    sqlite.close()
  }
  await failStaleRunningTasks()
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  const status = (key: string) => sqlite.prepare('SELECT status FROM pipeline_tasks WHERE key=?').get(key).status
  assert.equal(status('extract:boot'), 'error')         // kind ปกติยังถูกเคลียร์เหมือนเดิม
  assert.equal(status('studio_render:boot'), 'running') // resume รับช่วงต่อ
  sqlite.close()
})

test('drama merge เดิมไม่ถูกเปลี่ยน (mergeEpisodeVideos ยังไม่ผูก captions)', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/core/production/ffmpeg-merge.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /captions|subtitle/i)
  // เส้นทาง merge ของ drama ปกติ (routes/merge.ts) ยังเรียก mergeEpisodeVideos ตรง ๆ ไม่ผ่าน studio
  const mergeRoute = readFileSync(new URL('../src/modules/drama/routes/merge.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(mergeRoute, /studio|caption/i)
})
