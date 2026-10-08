/**
 * One status watcher for every video the episode page is generating.
 *
 * Before: each shot ran its own loop that reloaded the whole page (≈10 requests) every 4 s for up to an hour,
 * so 10 shots meant ~100 requests every 4 s from one browser. Now one tick loads the task list once for all
 * shots and the shots reload only when a video finished.
 *
 * The page supplies how to read and change its state:
 *   pendingIds()        storyboard ids shown as "generating" (rebuilt by loadTasks from the server)
 *   loadTasks()         load the episode's tasks; resolves to the task list ({ id, status, error_msg })
 *   reloadShots()       reload the storyboards (new video URLs)
 *   hasVideo(id)        whether the shot has its video now
 *   onFinished(id, t)   a shot this page submitted ended: t.status is completed | failed | unknown
 *   onExpired(id)       gave up waiting (maxMs)
 */
export function createVideoWatch(deps) {
  const intervalMs = deps.intervalMs ?? 4000
  const maxMs = deps.maxMs ?? 60 * 60 * 1000
  const now = deps.now ?? (() => Date.now())
  const timers = deps.timers ?? { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id) }
  /** shots this page submitted: storyboard id → { taskId, since } — the ones that get onFinished */
  const watched = new Map()
  let timer = null
  let busy = false

  function start() {
    if (timer === null) timer = timers.setInterval(tick, intervalMs)
  }
  function stop() {
    if (timer !== null) { timers.clearInterval(timer); timer = null }
  }
  function track(taskId, storyboardId) {
    watched.set(storyboardId, { taskId: taskId || null, since: now() })
    start()
  }

  async function tick() {
    if (busy) return // the previous tick is still waiting on the server
    busy = true
    try {
      const before = new Set(deps.pendingIds())
      const tasks = await deps.loadTasks()
      const byId = new Map((tasks || []).map(task => [task.id, task]))
      const finished = []
      // a shot left "generating" (also ones restored after a reload): its video may be there now
      let reload = [...before].some(id => !deps.pendingIds().includes(id))
      for (const [storyboardId, watch] of watched) {
        const task = watch.taskId ? byId.get(watch.taskId) : null
        if (task && ['completed', 'failed', 'unknown'].includes(task.status)) {
          finished.push([storyboardId, task])
          if (task.status === 'completed') reload = true
        } else if (!watch.taskId) {
          reload = true // no task id came back from the submit: done when the shot has its video
        } else if (now() - watch.since > maxMs) {
          watched.delete(storyboardId)
          deps.onExpired?.(storyboardId)
        }
      }
      if (reload) await deps.reloadShots()
      for (const [storyboardId, watch] of watched) {
        if (!watch.taskId && deps.hasVideo(storyboardId)) finished.push([storyboardId, { status: 'completed' }])
      }
      for (const [storyboardId, task] of finished) {
        watched.delete(storyboardId)
        deps.onFinished(storyboardId, task)
      }
      if (!watched.size && !deps.pendingIds().length) stop()
    } finally {
      busy = false
    }
  }

  return {
    track,
    start,
    stop,
    tick,
    get running() { return timer !== null },
    get watching() { return watched.size },
  }
}
