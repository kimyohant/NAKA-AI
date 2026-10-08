import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { initSqliteSchema } from '../src/core/db/sqlite-schema.js'

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  return address.port
}

test('server masks saved keys and resumes provider polling without a new submission', { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-server-test-'))
  const dbPath = path.join(directory, 'test.sqlite3')
  const requests: string[] = []
  const provider = createServer((req, res) => {
    requests.push(req.url || '')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ success: false, errorCode: '9006' }))
  })
  const providerPort = await listen(provider)
  const portHolder = createServer()
  const appPort = await listen(portHolder)
  await new Promise<void>(resolve => portHolder.close(() => resolve()))
  const sqlite = new Database(dbPath)
  initSqliteSchema(sqlite)
  const ts = new Date().toISOString()
  sqlite.prepare("INSERT INTO ai_service_configs (service_type, provider, name, base_url, api_key, model, is_active, created_at, updated_at) VALUES ('video', 'wancreate', 'Mock Wan', ?, 'synthetic-test-secret', '[\"wan2.7\"]', 1, ?, ?)")
    .run(`http://127.0.0.1:${providerPort}`, ts, ts)
  sqlite.prepare("INSERT INTO sys_task (type, provider, config_id, prompt, status, created_at, updated_at) VALUES ('video', 'wancreate', 1, 'test', 'submitting', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO sys_task (type, provider, config_id, prompt, status, task_id, created_at, updated_at) VALUES ('video', 'wancreate', 1, 'test', 'processing', 'provider-123', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO storyboards (episode_id, storyboard_number, video_prompt, created_at, updated_at) VALUES (1, 1, 'test shot', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO characters (drama_id, name, image_url, created_at, updated_at) VALUES (1, 'Actor', 'static/images/base.png', ?, ?)").run(ts, ts)
  sqlite.exec('INSERT INTO storyboard_characters (storyboard_id, character_id) VALUES (1, 1)')
  sqlite.prepare("INSERT INTO character_looks (character_id, name, created_at, updated_at) VALUES (1, 'Blue coat', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO sys_task (type, storyboard_id, status, local_path, params, created_at, updated_at) VALUES ('image', 1, 'completed', 'static/images/candidate.png', '{}', ?, ?)").run(ts, ts)
  sqlite.close()

  const backendDir = path.resolve(import.meta.dirname, '..')
  const child = spawn(process.execPath, [path.join(backendDir, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], {
    cwd: backendDir,
    env: { ...process.env, SQLITE_PATH: dbPath, PORT: String(appPort), NAKA_HOST: '127.0.0.1', NAKA_AUTH_USER: 'test-user', NAKA_AUTH_PASSWORD: 'test-password' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', chunk => { output += String(chunk) })
  child.stderr?.on('data', chunk => { output += String(chunk) })
  const origin = `http://127.0.0.1:${appPort}`
  const auth = { Authorization: `Basic ${Buffer.from('test-user:test-password').toString('base64')}` }
  try {
    let healthy = false
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) break
      try {
        const response = await fetch(`${origin}/api/v1/health`)
        if (response.ok) { healthy = true; break }
      } catch { /* still starting */ }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.ok(healthy, `Backend did not become healthy: ${output.slice(-600)}`)
    assert.equal((await fetch(`${origin}/api/v1/ai-configs`)).status, 401)
    const configsResponse = await fetch(`${origin}/api/v1/ai-configs`, { headers: auth })
    assert.equal(configsResponse.status, 200)
    const configsText = await configsResponse.text()
    assert.ok(!configsText.includes('synthetic-test-secret'))
    assert.match(configsText, /"has_api_key":true/)
    assert.equal((await fetch(`${origin}/static/test`, { redirect: 'manual' })).status, 401)

    const readinessUrl = `${origin}/api/v1/storyboards/1/readiness`
    const readiness = async () => (await (await fetch(readinessUrl, { headers: auth })).json()).data
    assert.ok((await readiness()).blockers.some((item: any) => item.code === 'select_image_candidate'))
    const selected = await fetch(`${origin}/api/v1/storyboards/1/select-media`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ task_id: 3, slot: 'composed' }),
    })
    assert.equal(selected.status, 200)
    assert.equal((await readiness()).ready_for_video, true)
    const assign = await fetch(`${origin}/api/v1/storyboards/1/character-looks/1`, {
      method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ look_id: 1 }),
    })
    assert.equal(assign.status, 200)
    assert.ok((await readiness()).blockers.some((item: any) => item.code === 'missing_look_image'))
    const updateLook = await fetch(`${origin}/api/v1/characters/1/looks/1`, {
      method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ image_url: 'static/uploads/blue-coat.png' }),
    })
    assert.equal(updateLook.status, 200)
    assert.equal((await readiness()).ready_for_video, true)

    let first: any, second: any
    for (let i = 0; i < 30; i++) {
      first = await (await fetch(`${origin}/api/v1/tasks/1`, { headers: auth })).json()
      second = await (await fetch(`${origin}/api/v1/tasks/2`, { headers: auth })).json()
      if (second?.data?.status === 'failed') break
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    assert.equal(first?.data?.status, 'unknown')
    assert.equal(second?.data?.status, 'failed')
    assert.equal(second?.data?.errorCode, '9006')
    assert.deepEqual(requests, ['/wanx/api/common/v2/taskResult'])

    const submission = await fetch(`${origin}/api/v1/tasks`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'video', prompt: 'A test shot', duration: 5 }),
    })
    assert.equal(submission.status, 201)
    const newTaskId = (await submission.json()).data.id
    let submitted: any
    for (let i = 0; i < 20; i++) {
      submitted = await (await fetch(`${origin}/api/v1/tasks/${newTaskId}`, { headers: auth })).json()
      if (submitted?.data?.status === 'failed') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(submitted?.data?.status, 'failed')
    assert.equal(submitted?.data?.errorCode, '9006')
    assert.equal(requests.filter(url => url.endsWith('/imageGen')).length, 1)
  } finally {
    child.kill()
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => child.once('exit', () => resolve()))
    }
    await new Promise<void>(resolve => provider.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
