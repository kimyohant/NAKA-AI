/**
 * Hot endpoints stay within a query budget (the episode workbench polls them every few seconds).
 * On PostgreSQL every statement is a network round trip, so what matters is (a) a fixed number of statements
 * however many shots an episode has, and (b) never reading other members' rows to filter them in JS.
 * The fixture: one member's episode (40 shots) beside a much larger body of other members' data.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'

process.env.DATABASE_URL = 'pglite://memory'

const { rawExec, rawQuery, queryStats, resetQueryStats } = await import('../src/core/db/index.js')
const { default: episodes } = await import('../src/modules/drama/routes/episodes.js')
const { default: dramas } = await import('../src/modules/drama/routes/dramas.js')
const { default: characters } = await import('../src/modules/drama/routes/characters.js')
const { default: storyboards } = await import('../src/modules/drama/routes/storyboards.js')
const { runAsOwner } = await import('../src/core/auth/owner-context.js')
const { sourceSnapshotForShot } = await import('../src/core/production/source-freshness.js')

const SHOTS = 40
const OTHERS = 1500 // other members' characters / props / looks / shots each
const ts = '2026-10-01T00:00:00.000Z'

// ---- fixture -----------------------------------------------------------------------------------
await rawExec(`
  INSERT INTO ai_service_configs (id, service_type, provider, name, base_url, api_key, model, settings, is_active, created_at, updated_at)
  VALUES (1, 'video', 'unsloth', 'gpu', 'http://127.0.0.1:9', 'k', '["m"]', '{"max_concurrent":1}', true, '${ts}', '${ts}');

  -- my drama: one episode, ${SHOTS} shots, 8 characters (each with a look), 5 scenes, 5 props
  INSERT INTO dramas (id, title, owner_user_id, created_at, updated_at) VALUES (1, 'mine', 'me', '${ts}', '${ts}');
  -- 9 more of my dramas (the list page attaches counts per drama), each with an episode
  INSERT INTO dramas (id, title, owner_user_id, created_at, updated_at) SELECT 1 + g, 'mine' || g, 'me', '2026-09-01T00:00:00.000Z', '${ts}' FROM generate_series(1, 9) g;
  INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at) SELECT 1 + g, 1 + g, 1, 'ep', '${ts}', '${ts}' FROM generate_series(1, 9) g;
  INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at) VALUES (1, 1, 1, 'ep1', '${ts}', '${ts}');
  INSERT INTO characters (id, drama_id, name, image_url, created_at, updated_at)
    SELECT g, 1, 'c' || g, 'static/c.png', '${ts}', '${ts}' FROM generate_series(1, 8) g;
  INSERT INTO character_looks (id, character_id, name, image_url, created_at, updated_at)
    SELECT g, g, 'look' || g, 'static/l.png', '${ts}', '${ts}' FROM generate_series(1, 8) g;
  INSERT INTO scenes (id, drama_id, location, time, prompt, image_url, created_at, updated_at)
    SELECT g, 1, 'loc' || g, 'day', 'p', 'static/s.png', '${ts}', '${ts}' FROM generate_series(1, 5) g;
  INSERT INTO props (id, drama_id, name, image_url, created_at, updated_at)
    SELECT g, 1, 'p' || g, 'static/p.png', '${ts}', '${ts}' FROM generate_series(1, 5) g;
  INSERT INTO episode_characters (episode_id, character_id, created_at) SELECT 1, g, '${ts}' FROM generate_series(1, 8) g;
  INSERT INTO episode_scenes (episode_id, scene_id, created_at) SELECT 1, g, '${ts}' FROM generate_series(1, 5) g;
  INSERT INTO episode_props (episode_id, prop_id, created_at) SELECT 1, g, '${ts}' FROM generate_series(1, 5) g;
  INSERT INTO storyboards (id, episode_id, storyboard_number, scene_id, video_prompt, created_at, updated_at)
    SELECT g, 1, g, 1 + g % 5, 'shot ' || g, '${ts}', '${ts}' FROM generate_series(1, ${SHOTS}) g;
  INSERT INTO storyboard_characters (storyboard_id, character_id) SELECT g, 1 + g % 8 FROM generate_series(1, ${SHOTS}) g;
  INSERT INTO storyboard_characters (storyboard_id, character_id) SELECT g, 1 + (g + 3) % 8 FROM generate_series(1, ${SHOTS}) g;
  INSERT INTO storyboard_props (storyboard_id, prop_id) SELECT g, 1 + g % 5 FROM generate_series(1, ${SHOTS}) g;
  INSERT INTO storyboard_character_looks (storyboard_id, character_id, look_id) SELECT g, 1 + g % 8, 1 + g % 8 FROM generate_series(1, ${SHOTS}) g;
  -- a video per shot, all waiting in the GPU queue (queue positions are computed per task)
  INSERT INTO sys_task (type, storyboard_id, drama_id, provider, config_id, status, owner_user_id, created_at, updated_at)
    SELECT 'video', g, 1, 'unsloth', 1, 'queued', 'me', to_char(timestamp '2026-10-01' + g * interval '1 second', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'), '${ts}'
    FROM generate_series(1, ${SHOTS}) g;

  -- other members: their own dramas, ${OTHERS} characters / looks / props / shots with links
  INSERT INTO dramas (id, title, owner_user_id, created_at, updated_at) SELECT 100 + g, 'other' || g, 'u' || g, '${ts}', '${ts}' FROM generate_series(1, 10) g;
  INSERT INTO episodes (id, drama_id, episode_number, title, created_at, updated_at) SELECT 100 + g, 100 + g, 1, 'ep', '${ts}', '${ts}' FROM generate_series(1, 10) g;
  INSERT INTO characters (id, drama_id, name, created_at, updated_at) SELECT 1000 + g, 101 + g % 10, 'x', '${ts}', '${ts}' FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO character_looks (id, character_id, name, created_at, updated_at) SELECT 1000 + g, 1000 + g, 'x', '${ts}', '${ts}' FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO props (id, drama_id, name, created_at, updated_at) SELECT 1000 + g, 101 + g % 10, 'x', '${ts}', '${ts}' FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO scenes (id, drama_id, location, time, prompt, created_at, updated_at) SELECT 1000 + g, 101 + g % 10, 'x', 'day', 'p', '${ts}', '${ts}' FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO storyboards (id, episode_id, storyboard_number, created_at, updated_at) SELECT 1000 + g, 101 + g % 10, g, '${ts}', '${ts}' FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO storyboard_characters (storyboard_id, character_id) SELECT 1000 + g, 1000 + g FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO storyboard_props (storyboard_id, prop_id) SELECT 1000 + g, 1000 + g FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO storyboard_character_looks (storyboard_id, character_id, look_id) SELECT 1000 + g, 1000 + g, 1000 + g FROM generate_series(1, ${OTHERS}) g;
  INSERT INTO sys_task (type, storyboard_id, drama_id, status, owner_user_id, created_at, updated_at)
    SELECT 'image', 1000 + g, 101 + g % 10, 'completed', 'u1', '${ts}', '${ts}' FROM generate_series(1, ${OTHERS}) g;
`)
// identity sequences after explicit ids
for (const t of ['dramas', 'episodes', 'characters', 'character_looks', 'scenes', 'props', 'storyboards', 'ai_service_configs']) {
  await rawQuery(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT max(id) FROM ${t}))`)
}

const app = new Hono()
app.route('/episodes', episodes)
app.route('/dramas', dramas)
app.route('/characters', characters)
app.route('/storyboards', storyboards)

/** Call as the member 'me' and report what it cost. */
async function measure(path: string) {
  resetQueryStats()
  const res = await runAsOwner({ ownerId: 'me', admin: false }, () => app.request(path))
  const cost = queryStats()
  assert.equal(res.status, 200, `${path} → ${res.status}`)
  return { ...cost, body: (await res.json() as any).data }
}

const BUDGETS: Array<[string, number, number]> = [
  // path, max statements, max rows read — measured 2026-10: before the fix the shot endpoints read every
  // member's rows (storyboards 6,186 rows; readiness 4,528) and generation-tasks ran 88 statements
  ['/dramas', 4, 40],
  ['/dramas/1', 5, 25],
  ['/episodes/1/characters', 2, 20],
  ['/episodes/1/scenes', 2, 15],
  ['/episodes/1/props', 2, 15],
  ['/episodes/1/storyboards', 7, 200],
  ['/episodes/1/character-looks', 3, 100],
  ['/episodes/1/generation-tasks', 10, 160],
  ['/characters/looks?drama_id=1', 2, 20],
  ['/storyboards/1/readiness', 10, 20],
]

test('the episode workbench endpoints run a fixed number of statements and read only this member\'s rows', async () => {
  const report: string[] = []
  const over: string[] = []
  for (const [path, maxQueries, maxRows] of BUDGETS) {
    const { queries, rows } = await measure(path)
    report.push(`${path.padEnd(32)} ${String(queries).padStart(4)} statements ${String(rows).padStart(6)} rows`)
    if (queries > maxQueries || rows > maxRows) over.push(`${path}: ${queries} statements (max ${maxQueries}), ${rows} rows (max ${maxRows})`)
  }
  console.log(report.join('\n'))
  assert.deepEqual(over, [])
})

test('the answers stay the same', async () => {
  const sbs = (await measure('/episodes/1/storyboards')).body
  assert.equal(sbs.length, SHOTS)
  assert.deepEqual(sbs[0].character_ids.sort(), [2, 5])
  assert.deepEqual(sbs[0].characters.map((c: any) => c.id).sort(), [2, 5])
  assert.deepEqual(sbs[0].props.map((p: any) => p.id), [2])
  assert.equal((await measure('/episodes/1/characters')).body.length, 8)
  assert.equal((await measure('/episodes/1/scenes')).body.length, 5)
  assert.equal((await measure('/episodes/1/props')).body.length, 5)
  const looks = (await measure('/episodes/1/character-looks')).body
  assert.equal(looks.length, SHOTS)
  assert.deepEqual(looks.find((l: any) => l.storyboard_id === 1), { storyboard_id: 1, character_id: 2, look_id: 2, look_name: 'look2', image_url: 'static/l.png' })
  assert.equal((await measure('/characters/looks?drama_id=1')).body.length, 8)
  const tasks = (await measure('/episodes/1/generation-tasks')).body.tasks
  assert.equal(tasks.length, SHOTS)
  // oldest queued first: shot 1 is first in line, shot 40 last
  assert.equal(tasks.find((t: any) => t.storyboard_id === 1).queue_position, 1)
  assert.equal(tasks.find((t: any) => t.storyboard_id === SHOTS).queue_position, SHOTS)
  const list = (await measure('/dramas')).body.items
  assert.equal(list.length, 10)
  const first = list.find((d: any) => d.id === 1)
  assert.deepEqual([first.total_episodes, first.episodes.length, first.characters.length, first.scenes.length], [1, 1, 8, 5])
  assert.ok(list.filter((d: any) => d.id !== 1).every((d: any) => d.total_episodes === 1 && d.characters.length === 0))
  const detail = (await measure('/dramas/1')).body
  assert.deepEqual([detail.episodes.length, detail.characters.length, detail.scenes.length, detail.props.length], [1, 8, 5, 5])
  const ready = (await measure('/storyboards/1/readiness')).body
  assert.deepEqual(ready.blockers, [])
  const snapshot = await sourceSnapshotForShot(1)
  assert.ok(snapshot)
})

test('the hot filter columns are indexed (migrations/pg/0002_hot_indexes.sql)', async () => {
  const rows = await rawQuery(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()`)
  const names = new Set(rows.map(r => String(r.indexname)))
  for (const name of ['idx_storyboards_episode', 'idx_episodes_drama', 'idx_characters_drama', 'idx_scenes_drama', 'idx_props_drama',
    'idx_video_merges_episode', 'idx_sys_task_config_status', 'idx_sys_task_live', 'idx_pipeline_tasks_status', 'idx_clone_variants_status']) {
    assert.ok(names.has(name), `missing index ${name}`)
  }
})
