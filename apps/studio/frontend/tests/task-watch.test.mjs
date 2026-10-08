// The pages' single generation-status watcher (menus/drama/utils/taskWatch.js), used for videos and images:
// a fake server and fake timers stand in for the page, so each tick is driven by hand and every request is
// counted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTaskWatch } from '../menus/drama/utils/taskWatch.js'

function page({ maxMs } = {}) {
  const server = new Map() // task id → { id, storyboard, status, error_msg }
  const videos = new Set() // storyboards that have a video
  const state = { pending: [], calls: { tasks: 0, shots: 0 }, finished: [], expired: [], clock: 0, timer: null }
  const watch = createTaskWatch({
    maxMs,
    now: () => state.clock,
    timers: {
      setInterval: fn => (state.timer = fn, 1),
      clearInterval: () => { state.timer = null },
    },
    pendingKeys: () => state.pending,
    // like the page's loadGenTasks: one request, rebuilds "generating" from the server
    loadTasks: async () => {
      state.calls.tasks++
      state.pending = [...server.values()].filter(t => ['queued', 'processing'].includes(t.status)).map(t => t.storyboard)
      return [...server.values()]
    },
    reload: async () => { state.calls.shots++ },
    isDone: id => videos.has(id),
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

test('images: keys of any shape, and a regenerated image is followed by its task, not by the old picture', async () => {
  const p = page()
  p.videos.add('character:3') // the character already has a picture: regenerating it
  p.submit(7, 'character:3')
  await p.watch.tick()
  assert.deepEqual(p.state.finished, [], 'still making the new picture')
  p.finish(7, 'failed', 'provider down')
  await p.watch.tick()
  assert.deepEqual(p.state.finished, [['character:3', 'failed']], 'a failed image is reported, not left spinning')
  assert.equal(p.watch.has('character:3'), false)
  assert.equal(p.watch.running, false)
})

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('the episode page uses the watcher: no per-shot loop, no whole-page reload while waiting', () => {
  const page = read('../menus/drama/views/episode.vue')
  assert.doesNotMatch(page, /pollVideoGeneration/)
  assert.match(page, /videoWatch\.track\(generation\?\.id, sb\.id\)/)
  assert.match(page, /onBeforeUnmount\(\(\) => \{[^}]*videoWatch\.stop\(\)/)
  assert.match(page, /if \(pending\.size\) videoWatch\.start\(\)/)
  const batch = page.slice(page.indexOf('function confirmBatchVideos'), page.indexOf('function pruneStaleModel'))
  assert.doesNotMatch(batch, /watchAsyncResult/)
})

test('character / scene / prop images: one watcher per page, no loop per image', () => {
  const episode = read('../menus/drama/views/episode.vue')
  assert.doesNotMatch(episode, /watchAsyncResult/, 'the per-image loop that reloaded the whole page every 2.5 s')
  assert.match(episode, /const imageWatch = createTaskWatch\(/)
  assert.match(episode, /imageWatch\.track\(res\?\.image_generation_id, imageKey\(kind, id\)\)/)
  assert.match(episode, /resumeImageTasks\(genTasks\.value\)/, 'images still being made are followed after a reload')
  assert.match(episode, /onBeforeUnmount\(\(\) => \{[^}]*imageWatch\.stop\(\)/)
  for (const file of ['detail', 'board']) {
    const view = read(`../menus/drama/views/${file}.vue`)
    assert.doesNotMatch(view, /pollMaterial|sleep\(2500\)/, `${file}.vue: no loop per image`)
    assert.match(view, /loadTasks: \(\) => taskAPI\.list\(\{ type: 'image', drama_id: dramaId \}\)/)
    assert.match(view, /materialWatch\.track\(res\?\.image_generation_id, key\)/)
    assert.match(view, /onBeforeUnmount\(\(\) => materialWatch\.stop\(\)\)/)
  }
})
