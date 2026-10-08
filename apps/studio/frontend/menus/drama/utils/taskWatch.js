/**
 * One status watcher per page for generation tasks (videos and images).
 *
 * Before: every submitted video or image ran its own loop that reloaded the page's data (up to ≈10 requests)
 * every 2.5–4 s, so a few items meant dozens of requests every few seconds from one browser. Now one tick
 * loads the task list once for everything being made, and the page's data reloads only when one finished.
 *
 * Items are keys the page chooses (a storyboard id, or 'character:12'). The page supplies how to read and
 * change its state:
 *   pendingKeys()       keys shown as "generating" (the page may rebuild these from the server's task list)
 *   loadTasks()         load the tasks; resolves to the task list ({ id, status, error_msg })
 *   reload()            reload the data that a finished task changes (new video / image URLs)
 *   isDone(key)         whether the item has its result now (for a submit that returned no task id)
 *   onFinished(key, t)  an item this page submitted ended: t.status is completed | failed | unknown
 *   onExpired(key)      gave up waiting (maxMs)
 */
export function createTaskWatch(deps) {
  const intervalMs = deps.intervalMs ?? 4000
  const maxMs = deps.maxMs ?? 60 * 60 * 1000
  const now = deps.now ?? (() => Date.now())
  const timers = deps.timers ?? { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: id => clearInterval(id) }
  /** items this page submitted: key → { taskId, since } — the ones that get onFinished */
  const watched = new Map()
  let timer = null
  let busy = false

  function start() {
    if (timer === null) timer = timers.setInterval(tick, intervalMs)
  }
  function stop() {
    if (timer !== null) { timers.clearInterval(timer); timer = null }
  }
  function track(taskId, key) {
    watched.set(key, { taskId: taskId || null, since: now() })
    start()
  }

  async function tick() {
    if (busy) return // the previous tick is still waiting on the server
    busy = true
    try {
      const before = new Set(deps.pendingKeys())
      const tasks = await deps.loadTasks()
      const byId = new Map((tasks || []).map(task => [task.id, task]))
      const finished = []
      // an item left "generating" (also ones restored after a reload): its result may be there now
      let reload = [...before].some(key => !deps.pendingKeys().includes(key))
      for (const [key, watch] of watched) {
        const task = watch.taskId ? byId.get(watch.taskId) : null
        if (task && ['completed', 'failed', 'unknown'].includes(task.status)) {
          finished.push([key, task])
          if (task.status === 'completed') reload = true
        } else if (!watch.taskId) {
          reload = true // no task id came back from the submit: done when the item has its result
        } else if (now() - watch.since > maxMs) {
          watched.delete(key)
          deps.onExpired?.(key)
        }
      }
      if (reload) await deps.reload()
      for (const [key, watch] of watched) {
        if (!watch.taskId && deps.isDone(key)) finished.push([key, { status: 'completed' }])
      }
      for (const [key, task] of finished) {
        watched.delete(key)
        deps.onFinished(key, task)
      }
      if (!watched.size && !deps.pendingKeys().length) stop()
    } finally {
      busy = false
    }
  }

  return {
    track,
    start,
    stop,
    tick,
    /** whether this key is being followed (submitted here, or resumed from the task list) */
    has: key => watched.has(key),
    get running() { return timer !== null },
    get watching() { return watched.size },
  }
}
