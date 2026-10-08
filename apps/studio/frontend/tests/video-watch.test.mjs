// The episode page's single video-status watcher (menus/drama/utils/videoWatch.js): a fake server and fake
// timers stand in for the page, so each tick is driven by hand and every request is counted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createVideoWatch } from '../menus/drama/utils/videoWatch.js'

function page({ maxMs } = {}) {
  const server = new Map() // task id → { id, storyboard, status, error_msg }
  const videos = new Set() // storyboards that have a video
  const state = { pending: [], calls: { tasks: 0, shots: 0 }, finished: [], expired: [], clock: 0, timer: null }
  const watch = createVideoWatch({
    maxMs,
    now: () => state.clock,
    timers: {
      setInterval: fn => (state.timer = fn, 1),
      clearInterval: () => { state.timer = null },
    },
    pendingIds: () => state.pending,
    // like the page's loadGenTasks: one request, rebuilds "generating" from the server
    loadTasks: async () => {
      state.calls.tasks++
      state.pending = [...server.values()].filter(t => ['queued', 'processing'].includes(t.status)).map(t => t.storyboard)
      return [...server.values()]
    },
    reloadShots: async () => { state.calls.shots++ },
    hasVideo: id => videos.has(id),
    onExpired: id => state.expired.push(id),
    onFinished: (id, task) => state.finished.push([id, task.status]),
  })
  const submit = (taskId, storyboard) => {
    server.set(taskId, { id: taskId, storyboard, status: 'queued' })
    state.pending = [...state.pending, storyboard]
    watch.track(taskId, storyboard)
  }
  const finish = (taskId, status, error_msg) => {
    const task = server.get(taskId)
    Object.assign(task, { status, error_msg })
    if (status === 'completed') videos.add(task.storyboard)
  }
  return { watch, server, videos, state, submit, finish }
}

test('ten shots: one task-list request per tick, shots reloaded only when a video finished', async () => {
  const p = page()
  for (let i = 1; i <= 10; i++) p.submit(100 + i, i)
  assert.equal(p.watch.running, true)
  for (let n = 0; n < 5; n++) await p.watch.tick()
  assert.deepEqual(p.state.calls, { tasks: 5, shots: 0 }, 'nothing finished: no shot reloads')
  p.finish(101, 'completed')
  p.finish(102, 'completed')
  await p.watch.tick()
  assert.deepEqual(p.state.calls, { tasks: 6, shots: 1 }, 'two videos done: one reload')
  assert.deepEqual(p.state.finished, [[1, 'completed'], [2, 'completed']])
  assert.equal(p.watch.watching, 8)
})

test('every submitted shot gets its own outcome; the watcher stops when nothing is left', async () => {
  const p = page()
  p.submit(1, 11); p.submit(2, 12); p.submit(3, 13)
  p.finish(1, 'completed'); p.finish(2, 'failed', 'moderation'); p.finish(3, 'unknown')
  await p.watch.tick()
  assert.deepEqual(p.state.finished, [[11, 'completed'], [12, 'failed'], [13, 'unknown']])
  assert.equal(p.watch.running, false)
  await p.watch.tick()
  assert.equal(p.state.finished.length, 3, 'no second toast for the same task')
})

test('shots still generating after a reload are watched again, silently, until they leave "generating"', async () => {
  const p = page()
  p.server.set(7, { id: 7, storyboard: 70, status: 'processing' })
  p.state.pending = [70]
  p.watch.start() // what loadGenTasks does when it finds generating shots on open
  await p.watch.tick()
  assert.equal(p.state.calls.shots, 0)
  p.finish(7, 'completed')
  await p.watch.tick()
  assert.equal(p.state.calls.shots, 1, 'the video shows up without a manual refresh')
  assert.deepEqual(p.state.finished, [], 'not submitted from this page: no toast')
  assert.equal(p.watch.running, false)
})

test('a submit without a task id finishes when the shot has its video', async () => {
  const p = page()
  p.state.pending = [5]
  p.watch.track(null, 5)
  await p.watch.tick()
  assert.deepEqual(p.state.finished, [])
  p.videos.add(5)
  await p.watch.tick()
  assert.deepEqual(p.state.finished, [[5, 'completed']])
})

test('gives up after maxMs like the old loop did, and a slow tick is never doubled', async () => {
  const p = page({ maxMs: 60_000 })
  p.submit(9, 90)
  p.state.clock = 61_000
  await p.watch.tick()
  assert.deepEqual(p.state.expired, [90])
  assert.equal(p.watch.watching, 0)

  const q = page()
  q.submit(1, 1)
  const first = q.watch.tick()
  await q.watch.tick() // while the first is still waiting on the server
  await first
  assert.equal(q.state.calls.tasks, 1)
})

test('the episode page uses the watcher: no per-shot loop, no whole-page reload while waiting', () => {
  const page = readFileSync(new URL('../menus/drama/views/episode.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /pollVideoGeneration/)
  assert.match(page, /videoWatch\.track\(generation\?\.id, sb\.id\)/)
  assert.match(page, /onBeforeUnmount\(\(\) => \{[^}]*videoWatch\.stop\(\)/)
  assert.match(page, /if \(pending\.size\) videoWatch\.start\(\)/)
  const batch = page.slice(page.indexOf('function confirmBatchVideos'), page.indexOf('function pruneStaleModel'))
  assert.doesNotMatch(batch, /watchAsyncResult/)
})
