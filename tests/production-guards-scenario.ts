import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/db/index.js'
import { budgetForDrama, quoteGeneration, validateBudgetQuote } from '../src/services/generation-cost.js'
import { generateVideo } from '../src/services/generation.js'
import { sourceSnapshotForShot, videoSourceStatus } from '../src/services/source-freshness.js'
import { episodeExportHealth } from '../src/services/export-health.js'
import tasksApp from '../src/routes/tasks.js'

const ts = new Date().toISOString()
const file = path.join(path.dirname(process.env.SQLITE_PATH!), 'invalid.mp4')
db.insert(schema.dramas).values({ title: 'Test drama', budgetThb: 5, createdAt: ts, updatedAt: ts }).run()
db.insert(schema.episodes).values({ dramaId: 1, episodeNumber: 1, title: 'Episode', scriptContent: 'Original script', createdAt: ts, updatedAt: ts }).run()
db.insert(schema.storyboards).values({ episodeId: 1, storyboardNumber: 1, videoPrompt: 'Original prompt', videoUrl: file, duration: 3, createdAt: ts, updatedAt: ts }).run()
db.insert(schema.aiServiceConfigs).values({ serviceType: 'video', provider: 'minimax', name: 'Offline test', baseUrl: 'http://127.0.0.1:9', apiKey: 'test-only', model: '["MiniMax-Hailuo-02"]', settings: '{"price_thb_per_video_second":2}', isActive: true, createdAt: ts, updatedAt: ts }).run()

const unanchored = await tasksApp.request('/preflight', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'video', storyboard_id: 1, prompt: 'Text only', duration: 3, config_id: 1 }),
})
assert.equal(unanchored.status, 400)
assert.match(await unanchored.text(), /reference image or first frame/i)
assert.equal(db.select().from(schema.sysTask).all().length, 0)

const quote = quoteGeneration(1, 1, 'video', 3)
assert.equal(quote.estimated_cost_thb, 6)
assert.equal(quote.within_budget, false)
assert.throws(() => validateBudgetQuote(quote), /budget exceeded/i)
await assert.rejects(generateVideo({ storyboardId: 1, dramaId: 1, prompt: 'No provider call', duration: 3, configId: 1 }), /budget exceeded/i)
assert.equal(db.select().from(schema.sysTask).all().length, 0)

const snapshot = sourceSnapshotForShot(1)
assert.ok(snapshot)
db.insert(schema.sysTask).values({ type: 'video', storyboardId: 1, dramaId: 1, status: 'completed', localPath: file, estimatedCostThb: 2, sourceSnapshot: JSON.stringify(snapshot), createdAt: ts, updatedAt: ts }).run()
assert.equal(videoSourceStatus(1, file).state, 'current')
db.update(schema.storyboards).set({ videoPrompt: 'Changed prompt' }).where(eq(schema.storyboards.id, 1)).run()
assert.deepEqual(videoSourceStatus(1, file), { state: 'stale', changed: ['shot'] })
assert.equal(budgetForDrama(1).remaining_thb, 3)
const missing = await episodeExportHealth(1, [1])
assert.equal(missing.ready, false)
assert.match(missing.clips[0].errors.join(' '), /missing/)
writeFileSync(file, 'bad file')
const invalid = await episodeExportHealth(1, [1])
assert.equal(invalid.ready, false)
assert.match(invalid.clips[0].errors.join(' '), /incomplete/)
console.log('production guards: passed')
