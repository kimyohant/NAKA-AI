<template>
  <div class="page" v-if="drama">
    <!-- 顶栏（参考 Topview Project Board）：返回 + 项目名 + 过滤 Tab -->
    <header class="board-top">
      <div class="board-top-left">
        <button class="back-btn" :title="t('common.back')" :aria-label="t('common.back')" @click="navigateTo(`/drama/${dramaId}`)">
          <ArrowLeft :size="17" :stroke-width="2" />
        </button>
        <h1 class="board-title truncate" :title="drama.title">{{ drama.title }}</h1>
        <span class="board-badge">{{ t('board.title') }}</span>
      </div>
      <nav class="board-tabs" role="tablist" :aria-label="t('board.filterAria')">
        <button
          v-for="f in filters"
          :key="f.id"
          type="button"
          role="tab"
          :aria-selected="filter === f.id"
          :class="['board-tab', { on: filter === f.id }]"
          @click="filter = f.id"
        >
          {{ f.label }}
          <span class="board-tab-count">{{ f.count }}</span>
        </button>
      </nav>
    </header>

    <div class="board-body">
      <!-- 素材图（角色 / 场景 / 道具） -->
      <template v-if="filter !== 'videos'">
        <div v-if="!visibleAssets.length" class="empty-state">
          <p class="dim">{{ t('board.noAssets') }}</p>
        </div>
        <div v-else class="board-grid">
          <article v-for="m in visibleAssets" :key="m.kindKey + m.id" class="board-card">
            <button type="button" class="board-thumb" @click="viewer = { open: true, src: assetSrc(m), title: `${m.kind} · ${m.name}` }">
              <img v-if="matImage(m)" :src="assetSrc(m)" :alt="m.name" loading="lazy" />
              <span v-else class="board-thumb-empty">
                <Loader2 v-if="isPending(m)" :size="20" class="animate-spin" />
                <template v-else>{{ m.kindInitial }}</template>
              </span>
            </button>
            <div class="board-card-info">
              <span class="board-kind">{{ m.kind }}</span>
              <h3 class="board-name truncate">{{ m.name }}</h3>
            </div>
            <div class="board-card-actions">
              <button v-if="!matImage(m)" type="button" class="board-btn" :disabled="isPending(m) || !firstEpisodeId" @click="generateMaterial(m)">
                <Sparkles :size="12" :stroke-width="2" />
                {{ isPending(m) ? t('board.generating') : t('board.generate') }}
              </button>
            </div>
          </article>
        </div>
        <p v-if="!firstEpisodeId && visibleAssets.some(m => !matImage(m))" class="board-hint dim">{{ t('board.needEpisode') }}</p>
      </template>

      <!-- 分镜视频 + 整集合并视频 -->
      <template v-else>
        <section v-for="ep in episodeVideos" :key="ep.id" class="board-ep">
          <h2 class="board-ep-title">EP{{ ep.number }} · {{ ep.title }}</h2>
          <div v-if="ep.mergedUrl" class="board-video-merged">
            <video :src="assetUrl(ep.mergedUrl)" controls preload="metadata"></video>
            <span class="board-kind">{{ t('board.mergedEpisode') }}</span>
          </div>
          <div v-if="!ep.shots.length" class="empty-state">
            <p class="dim">{{ t('board.noVideos') }}</p>
          </div>
          <div v-else class="board-grid">
            <article v-for="shot in ep.shots" :key="shot.id" class="board-card">
              <div class="board-thumb board-video">
                <video v-if="shotVideo(shot)" :src="assetUrl(shotVideo(shot))" controls preload="metadata"></video>
                <span v-else class="board-thumb-empty dim">{{ t('board.noVideoYet') }}</span>
              </div>
              <div class="board-card-info">
                <span class="board-kind">Shot {{ shot.shot_number ?? shot.shotNumber }}</span>
                <h3 class="board-name clamp2">{{ shot.description || shot.title || '—' }}</h3>
              </div>
            </article>
          </div>
        </section>
        <div v-if="!episodeVideos.length" class="empty-state">
          <p class="dim">{{ t('board.noVideos') }}</p>
        </div>
      </template>
    </div>

    <!-- 图片灯箱 -->
    <div v-if="viewer.open" class="board-viewer" @click.self="viewer.open = false">
      <div class="board-viewer-inner">
        <button type="button" class="board-viewer-close" @click="viewer.open = false">
          <X :size="16" :stroke-width="2" />
        </button>
        <img :src="viewer.src" :alt="viewer.title" />
        <p class="board-viewer-title">{{ viewer.title }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Loader2, Sparkles, X } from 'lucide-vue-next'
import { dramaAPI, episodeAPI, characterAPI, sceneAPI, propAPI, taskAPI } from '~/composables/useApi'
import { createTaskWatch } from '../utils/taskWatch.js'

// 全屏 studio 布局（与项目工作区一致）
definePageMeta({ layout: 'studio' })

const { t } = useI18n()
const route = useRoute()
const dramaId = Number(route.params.id)

const drama = ref(null)
const filter = ref('all')
const viewer = ref({ open: false, src: '', title: '' })
const pending = ref(new Set())

function assetUrl(path) {
  const p = String(path || '')
  return p.startsWith('/') ? p : `/${p}`
}
function shotVideo(shot) { return shot.video_url || shot.videoUrl || '' }

/* ===== 素材归类 ===== */
function matImage(m) { return m.image_url || m.imageUrl || m.localPath || m.local_path || '' }
function assetSrc(m) { return assetUrl(matImage(m)) }

const kindOf = {
  character: () => ({ kind: t('common.role'), kindInitial: 'C' }),
  scene: () => ({ kind: t('common.scene'), kindInitial: 'S' }),
  prop: () => ({ kind: t('common.prop'), kindInitial: 'P' }),
}
const materials = computed(() => {
  const d = drama.value || {}
  const build = (list, kindKey) => (list || []).map(x => ({ ...x, kindKey, ...kindOf[kindKey]() }))
  return [
    ...build(d.characters, 'character'),
    ...build(d.scenes, 'scene'),
    ...build(d.props, 'prop'),
  ]
})

/* ===== 分镜视频：按集加载 ===== */
const episodeVideos = ref([])
async function loadVideos() {
  const eps = [...(drama.value?.episodes || [])].sort((a, b) => (a.episode_number || a.episodeNumber) - (b.episode_number || b.episodeNumber))
  episodeVideos.value = await Promise.all(eps.map(async ep => {
    let shots = []
    try { shots = await episodeAPI.storyboards(ep.id) || [] } catch { /* 集无分镜时忽略 */ }
    return {
      id: ep.id,
      number: ep.episode_number || ep.episodeNumber,
      title: ep.title,
      mergedUrl: ep.video_url || ep.videoUrl || '',
      shots,
    }
  }))
}

const firstEpisodeId = computed(() => drama.value?.episodes?.[0]?.id || null)

const filters = computed(() => ([
  { id: 'all', label: t('index.status.all'), count: materials.value.length },
  { id: 'character', label: t('common.role'), count: materials.value.filter(m => m.kindKey === 'character').length },
  { id: 'scene', label: t('common.scene'), count: materials.value.filter(m => m.kindKey === 'scene').length },
  { id: 'prop', label: t('common.prop'), count: materials.value.filter(m => m.kindKey === 'prop').length },
  { id: 'videos', label: t('board.videos'), count: episodeVideos.value.reduce((s, e) => s + e.shots.length, 0) },
]))
const visibleAssets = computed(() => materials.value.filter(m => filter.value === 'all' || m.kindKey === filter.value))

/* ===== 生图（与项目页同一套接口；成功后轮询等待图片回写） ===== */
function pendingKey(m) { return `${m.kindKey}-${m.id}` }
function isPending(m) { return pending.value.has(pendingKey(m)) }

async function generateMaterial(m) {
  const epId = firstEpisodeId.value
  if (!epId) { toast.error(t('board.needEpisode')); return }
  const key = pendingKey(m)
  if (pending.value.has(key)) return
  pending.value = new Set(pending.value).add(key)
  try {
    const api = m.kindKey === 'character' ? characterAPI : m.kindKey === 'scene' ? sceneAPI : propAPI
    const res = await api.generateImage(m.id, epId)
    toast.success(t('board.generatingStarted', { name: m.name }))
    startedMaterials.set(key, m)
    materialWatch.track(res?.image_generation_id, key)
  } catch (e) {
    dropPending(key)
    toastError(e)
  }
}

// Images are made in the background: one watcher follows every image started here by its task id. One
// task-list request (this project's image tasks) every 3 s for all of them, and the project reloads only when
// one finished — instead of a loop per image that reloaded the project every 2.5 s. A regenerated image is
// not "done" just because the old one is still there, and a failed one says so (../utils/taskWatch.js).
const startedMaterials = new Map() // key → the material, for the messages
function dropPending(key) {
  startedMaterials.delete(key)
  pending.value = new Set([...pending.value].filter(k => k !== key))
}
const materialWatch = createTaskWatch({
  intervalMs: 3000,
  maxMs: 15 * 60 * 1000,
  pendingKeys: () => [...pending.value],
  loadTasks: () => taskAPI.list({ type: 'image', drama_id: dramaId }),
  reload: () => dramaAPI.get(dramaId).then(d => { drama.value = d }),
  isDone: key => !!materials.value.find(x => pendingKey(x) === key && matImage(x)),
  onExpired: key => {
    const m = startedMaterials.get(key)
    dropPending(key)
    if (m) toast.info(t('board.genTimeout', { name: m.name }))
  },
  onFinished: (key, task) => {
    dropPending(key)
    if (task.status !== 'completed') toastError(task.error_msg || task.errorMsg, { fallback: 'episode.image.genFailed' })
  },
})
onBeforeUnmount(() => materialWatch.stop())

async function load() {
  try {
    drama.value = await dramaAPI.get(dramaId)
    await loadVideos()
  } catch (e) {
    toastError(e)
  }
}
onMounted(load)
</script>

<style scoped>
.page {
  padding: 0 0 48px;
  height: 100%;
  overflow-y: auto;
  animation: fadeUp 0.35s var(--ease-out) both;
}
.board-top {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 12px 24px; border-bottom: 1px solid var(--border);
  background: var(--bg-base, var(--bg));
}
.board-top-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.back-btn {
  width: 30px; height: 30px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%;
  background: var(--overlay-track); color: var(--text-1);
  cursor: pointer;
}
.back-btn:hover { background: var(--bg-active); color: var(--text-0); }
.board-title { margin: 0; font: 700 16px var(--font-body); color: var(--text-0); }
.board-badge {
  flex-shrink: 0; border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px;
  color: var(--text-2); font: 600 11.5px var(--font-body);
}
.board-tabs { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
.board-tab {
  border: none; border-radius: 999px; padding: 6px 12px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 600 12.5px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.board-tab.on { background: var(--bg-active); color: var(--text-0); box-shadow: inset 0 0 0 1px var(--border-strong); }
.board-tab-count { opacity: 0.65; margin-left: 4px; font-size: 11px; }
.board-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 20px; }
.board-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px;
}
.board-card {
  border: 1px solid var(--border); border-radius: 14px; overflow: hidden;
  background: var(--bg-card, var(--bg));
  display: flex; flex-direction: column;
}
.board-thumb {
  display: flex; align-items: center; justify-content: center;
  aspect-ratio: 1 / 1; width: 100%; padding: 0; border: none; cursor: zoom-in;
  background: var(--bg-hover); color: var(--text-3); font: 700 22px var(--font-body);
  overflow: hidden;
}
.board-thumb img { width: 100%; height: 100%; object-fit: cover; }
.board-thumb-empty { display: flex; align-items: center; justify-content: center; }
.board-video { cursor: default; }
.board-video video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.board-card-info { padding: 10px 12px 4px; display: flex; flex-direction: column; gap: 3px; }
.board-kind { font: 600 10.5px var(--font-body); color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.board-name { margin: 0; font: 600 13px var(--font-body); color: var(--text-0); }
.clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.board-card-actions { padding: 8px 12px 12px; }
.board-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 600 11.5px var(--font-body);
}
.board-btn:hover { color: var(--text-0); border-color: var(--border-strong); background: var(--bg-hover); }
.board-btn:disabled { opacity: 0.5; cursor: default; }
.board-hint { margin: 0; padding: 0 4px; font-size: 12px; }
.board-ep { display: flex; flex-direction: column; gap: 12px; }
.board-ep-title { margin: 0; font: 700 14px var(--font-body); color: var(--text-0); }
.board-video-merged { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; max-width: 480px; }
.board-video-merged video { display: block; width: 100%; background: #000; }
.board-video-merged .board-kind { padding: 8px 12px; display: block; }
.empty-state { padding: 32px 12px; text-align: center; color: var(--text-3); font-size: 13px; }
.board-viewer {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.72); padding: 32px;
}
.board-viewer-inner { position: relative; max-width: min(860px, 92vw); }
.board-viewer-inner img { max-width: 100%; max-height: 78vh; border-radius: 12px; display: block; }
.board-viewer-close {
  position: absolute; top: -14px; right: -14px; width: 30px; height: 30px; border-radius: 50%;
  border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
  background: var(--bg-active); color: var(--text-0);
}
.board-viewer-title { margin: 10px 0 0; text-align: center; color: #fff; font: 500 13px var(--font-body); }
@media (max-width: 760px) {
  .board-tabs { margin-left: 0; width: 100%; }
}
</style>
