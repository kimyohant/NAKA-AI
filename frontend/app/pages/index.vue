<template>
  <div class="page">
    <!-- ===== Hero：大标题 + 输入框（参考 Topview Drama Studio） ===== -->
    <section class="hero" aria-labelledby="studio-title">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-rings" aria-hidden="true"></div>
      <div class="hero-inner">
        <h1 id="studio-title" class="hero-title">
          <span>{{ t('index.studio.titleLine1') }}</span>
          <span>{{ t('index.studio.titleLine2') }}</span>
        </h1>

        <form class="composer" :class="{ dragging }" @submit.prevent="startFromStory"
          @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="onDrop">
          <textarea
            v-model="story"
            class="composer-input"
            :placeholder="t('index.studio.placeholder')"
            :aria-label="t('index.studio.placeholder')"
            rows="4"
            @keydown.ctrl.enter.prevent="startFromStory"
            @keydown.meta.enter.prevent="startFromStory"
          ></textarea>
          <div class="composer-bar">
            <label class="chip chip-upload">
              <Paperclip :size="14" :stroke-width="1.8" />
              <span class="truncate">{{ uploadedName || t('index.studio.upload') }}</span>
              <input type="file" accept=".txt,.md,text/plain,text/markdown" hidden @change="onFile" />
            </label>
            <span v-if="story" class="composer-count">{{ t('index.studio.charCount', { n: story.length.toLocaleString() }) }}</span>

            <div class="composer-right">
              <div class="chip chip-select">
                <span class="chip-label">{{ t('index.studio.style') }}</span>
                <select v-model="studioStyle" :aria-label="t('index.studio.style')">
                  <option v-for="p in stylePresets" :key="p.value" :value="p.value">{{ styleLabel(p.value) }}</option>
                </select>
                <ChevronDown :size="14" :stroke-width="1.8" />
              </div>
              <div class="seg" role="radiogroup" :aria-label="t('index.createDialog.aspectRatio')">
                <button type="button" role="radio" :aria-checked="studioRatio === '9:16'" :class="{ on: studioRatio === '9:16' }" @click="studioRatio = '9:16'">
                  {{ t('index.studio.portrait') }}
                </button>
                <button type="button" role="radio" :aria-checked="studioRatio === '16:9'" :class="{ on: studioRatio === '16:9' }" @click="studioRatio = '16:9'">
                  {{ t('index.studio.landscape') }}
                </button>
              </div>
              <button type="submit" class="send-btn" :disabled="creatingStory" :title="t('index.studio.submit')" :aria-label="t('index.studio.submit')">
                <Loader2 v-if="creatingStory" :size="17" :stroke-width="2" class="spin" />
                <ArrowUp v-else :size="17" :stroke-width="2.2" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>

    <!-- ===== 视觉风格：全部卡片网格展示，不横向滚动（点选即用于上方输入框） ===== -->
    <section v-if="stylePresets.length" class="block" aria-labelledby="styles-title">
      <div class="block-head">
        <div>
          <h2 id="styles-title" class="block-title">{{ t('index.studio.stylesTitle') }}</h2>
          <p class="block-sub">{{ t('index.studio.stylesSub') }}</p>
        </div>
      </div>
      <div class="style-rail-wrap">
        <div class="style-rail">
          <button
            v-for="p in stylePresets"
            :key="p.value"
            type="button"
            class="style-card"
            :class="{ on: studioStyle === p.value }"
            :aria-pressed="studioStyle === p.value"
            @click="studioStyle = p.value"
          >
            <span class="style-art" :style="{ background: styleArt(p.value) }">
              <!-- example image of this style (public/studio-art/styles); the gradient + glyph stay for custom styles -->
              <img
                v-if="styleExample(p.value) && styleImg[p.value] !== 'error'"
                class="style-photo" :src="styleExample(p.value)" alt="" loading="lazy" decoding="async"
                @load="styleImg[p.value] = 'ok'" @error="styleImg[p.value] = 'error'"
              >
              <span v-if="styleImg[p.value] !== 'ok'" class="style-glyph">{{ styleGlyph(p.value) }}</span>
              <span v-if="studioStyle === p.value" class="style-badge">{{ t('index.studio.selected') }}</span>
            </span>
            <span class="style-name">{{ styleLabel(p.value) }}</span>
            <span class="style-desc">{{ styleDesc(p) }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- ===== 我的项目 ===== -->
    <section class="block" aria-labelledby="projects-title">
      <div class="block-head projects-head">
        <h2 id="projects-title" class="block-title">{{ t('index.studio.myProjects') }}</h2>
        <button class="btn-white" type="button" @click="showCreate = true">
          <Plus :size="15" :stroke-width="2.2" />
          {{ t('index.studio.createNew') }}
        </button>
        <button class="btn btn-icon tour-help-btn" :title="t('tour.helpTitle')" @click="startTour('index', INDEX_TOUR, t)">
          <CircleHelp :size="15" :stroke-width="1.8" />
        </button>
        <div class="sort-wrap">
          <span class="sort-label">{{ t('index.studio.sort') }}</span>
          <div class="sort-select-wrap">
            <BaseSelect v-model="sortMode" :options="sortOptions" :searchable="false" />
          </div>
        </div>
      </div>

      <div v-if="dramas.length" class="toolbar">
        <label class="search-box">
          <Search :size="15" :stroke-width="1.8" />
          <input v-model.trim="searchKeyword" class="input" :placeholder="t('index.searchPlaceholder')" />
        </label>
        <div class="chip-row">
          <button
            v-for="f in filters"
            :key="f.value"
            type="button"
            class="filter-chip"
            :class="{ on: statusFilter === f.value }"
            @click="statusFilter = f.value"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <!-- 加载骨架 -->
      <div v-if="loading" class="project-grid">
        <div v-for="i in 4" :key="i" class="project-card skeleton-card">
          <div class="skeleton-cover"></div>
          <div class="skeleton-body">
            <div class="skeleton-line w-60"></div>
            <div class="skeleton-line w-40"></div>
          </div>
        </div>
      </div>

      <!-- 项目卡片网格 -->
      <div v-else-if="filteredDramas.length" class="project-grid">
        <article
          v-for="(d, i) in filteredDramas"
          :key="d.id"
          class="project-card"
          :style="{ animationDelay: `${i * 0.04}s` }"
          tabindex="0"
          role="button"
          :aria-label="t('index.openProjectAria', { title: d.title })"
          @click="openDrama(d)"
          @keydown.enter.prevent="openDrama(d)"
          @keydown.space.prevent="openDrama(d)"
        >
          <div class="project-cover" :style="{ background: styleArt(d.style) }">
            <span class="cover-initial">{{ coverInitial(d) }}</span>
            <span v-if="d.aspect_ratio && d.aspect_ratio !== 'adaptive'" class="cover-ratio">{{ d.aspect_ratio }}</span>
            <div class="status-wrap" @click.stop>
              <AppMenu
                :open="statusMenuId === d.id"
                placement="bottom-start"
                :min-width="120"
                @update:open="(v) => { statusMenuId = v ? d.id : null }"
              >
                <template #trigger>
                  <button type="button" class="status-badge" :class="`st-${currentStatus(d)}`" :title="t('index.statusBadgeTitle')">
                    {{ projectStatus(d) }}
                  </button>
                </template>
                <AppMenuItem
                  v-for="s in statusOptions"
                  :key="s.value"
                  :selected="currentStatus(d) === s.value"
                  @click="setDramaStatus(d, s.value)"
                >{{ s.label }}</AppMenuItem>
              </AppMenu>
            </div>
            <div class="more-wrap" @click.stop>
              <AppMenu
                :open="activeMenuId === d.id"
                placement="bottom-end"
                :min-width="140"
                @update:open="(v) => { activeMenuId = v ? d.id : null }"
              >
                <template #trigger>
                  <button class="cover-more" type="button" :title="t('common.more')" :aria-label="t('common.more')">
                    <MoreHorizontal :size="16" :stroke-width="2" />
                  </button>
                </template>
                <AppMenuItem @click="activeMenuId = null; openDrama(d)">{{ t('index.openProject') }}</AppMenuItem>
                <AppMenuItem danger @click="activeMenuId = null; dramaToDelete = d">{{ t('index.deleteProject') }}</AppMenuItem>
              </AppMenu>
            </div>
            <span class="cover-play" aria-hidden="true"><Play :size="18" :stroke-width="2" /></span>
          </div>
          <div class="project-body">
            <h3 class="project-name truncate">{{ d.title }}</h3>
            <div class="project-meta">
              <span v-if="d.style" class="meta-style">{{ styleLabel(d.style) }}</span>
              <span>{{ t('index.projectMeta', { chars: d.characters?.length || 0, scenes: d.scenes?.length || 0, eps: d.episodes?.length || 0 }) }}</span>
            </div>
            <div class="project-foot">
              <Clock :size="11" :stroke-width="1.8" />
              {{ fmtDate(d.updated_at || d.updatedAt) }}
            </div>
          </div>
        </article>
      </div>

      <div v-else class="empty-state">
        <p class="empty-title">{{ dramas.length ? t('index.emptyFilteredTitle') : t('index.emptyTitle') }}</p>
        <p class="empty-desc">{{ dramas.length ? t('index.emptyFilteredDesc') : t('index.emptyDesc') }}</p>
      </div>
    </section>

    <!-- 新建项目弹窗（原有流程保留） -->
    <div v-if="showCreate" class="overlay" @click.self="showCreate = false">
      <div class="dialog create-dialog">
        <div class="dialog-head">
          <div class="modal-icon">
            <Plus :size="18" :stroke-width="1.8" />
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('index.createDialog.title') }}</h2>
            <p class="dialog-desc">{{ t('index.createDialog.desc') }}</p>
          </div>
        </div>
        <form @submit.prevent="create" class="dialog-form">
          <div class="dialog-body">
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.name') }} <span class="required">*</span></span>
              <input v-model="form.title" class="input" :placeholder="t('index.createDialog.namePlaceholder')" required autofocus />
            </label>
            <div class="field">
              <span class="field-label">{{ t('index.createDialog.genreOptional') }}</span>
              <div class="tag-cloud">
                <button
                  v-for="tag in GENRE_TAGS"
                  :key="tag"
                  type="button"
                  :class="['tag-chip', { on: formGenres.includes(tag) }]"
                  :aria-pressed="formGenres.includes(tag)"
                  @click="toggleGenre(tag)"
                >{{ tag }}</button>
              </div>
            </div>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.style') }}</span>
              <BaseSelect v-model="form.style" :options="styleSelectOptions" :placeholder="t('index.createDialog.stylePlaceholder')" searchable />
              <span v-if="selectedStyleDesc" class="field-hint">{{ selectedStyleDesc }}</span>
            </label>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.aspectRatio') }}</span>
              <BaseSelect v-model="form.aspect_ratio" :options="aspectRatioOptions" :placeholder="t('index.createDialog.aspectRatioPlaceholder')" />
              <span class="field-hint">{{ t('index.createDialog.aspectRatioHint') }}</span>
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" @click="showCreate = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary">
              <Plus :size="13" :stroke-width="2.2" />
              {{ t('index.createDialog.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>
    <ConfirmDialog
      :open="!!dramaToDelete"
      :title="t('index.deleteDialog.title')"
      :message="t('index.deleteDialog.message', { title: dramaToDelete?.title })"
      :loading="deletingDrama"
      @confirm="confirmDelDrama"
      @cancel="dramaToDelete = null"
    />
  </div>
</template>

<script setup>
import { openAdmin } from '~/composables/useAdminUrl'
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { Clock, CircleHelp, Paperclip, ArrowUp, ChevronDown, Plus, Search, MoreHorizontal, Play, Loader2 } from 'lucide-vue-next'
import { dramaAPI, episodeAPI, stylePresetAPI, aiConfigAPI } from '~/composables/useApi'
import { GENRE_TAGS } from '~/composables/useCreativeTags'
import BaseSelect from '~/components/BaseSelect.vue'
import { styleExample } from '~/utils/studioArt'
import { startTour, autoTour } from '~/composables/useTour'

const { t, te, locale } = useI18n()

const dramas = ref([])
const loading = ref(false)
const showCreate = ref(false)
const searchKeyword = ref('')
const statusFilter = ref('all')
const sortMode = ref('updated')
const sortOptions = computed(() => ([
  { label: t('index.sortUpdated'), value: 'updated' },
  { label: t('index.sortTitle'), value: 'title' },
]))
const activeMenuId = ref(null)
const dramaToDelete = ref(null)
const deletingDrama = ref(false)
const form = ref({ title: '', style: '', aspect_ratio: '16:9' })
// แนวเรื่อง (ไม่บังคับ)：ส่งเข้า dramas.metadata.genres ให้เอเจนต์ใช้เป็นทิศทาง
const formGenres = ref([])
function toggleGenre(tag) {
  const i = formGenres.value.indexOf(tag)
  if (i >= 0) formGenres.value.splice(i, 1)
  else formGenres.value.push(tag)
}
const stylePresets = ref([])
const styleSelectOptions = computed(() => stylePresets.value.map(p => ({ label: styleLabel(p.value), value: p.value })))
const selectedStyleDesc = computed(() => {
  const p = stylePresets.value.find(p => p.value === form.value.style)
  return p ? styleDesc(p) : ''
})
// 常量数组 label 渲染时求值（语言切换即时生效），value 为逻辑值
const aspectRatioOptions = computed(() => ([
  { label: t('index.ratio.landscape'), value: '16:9' },
  { label: t('index.ratio.portrait'), value: '9:16' },
  { label: t('index.ratio.square'), value: '1:1' },
  { label: t('index.ratio.adaptive'), value: 'adaptive' },
]))
const filters = computed(() => ([
  { label: t('index.status.all'), value: 'all' },
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
// 项目状态由用户手动标记（持久化到 dramas.status），不再按内容自动推算
const statusOptions = computed(() => ([
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
const statusMenuId = ref(null)

function currentStatus(d) { return d.status || 'draft' }
function projectStatus(d) { return statusOptions.value.find(s => s.value === currentStatus(d))?.label || t('index.status.draft') }

async function setDramaStatus(d, status) {
  statusMenuId.value = null
  if (currentStatus(d) === status) return
  const prev = d.status
  d.status = status
  try {
    await dramaAPI.update(d.id, { status })
  } catch (e) {
    d.status = prev
    toastError(e)
  }
}

// 内置风格的名称/描述按界面语言显示；用户自建风格直接用数据库里的名字
function styleLabel(key) {
  if (key && te(`index.styleNames.${key}`)) return t(`index.styleNames.${key}`)
  return stylePresets.value.find(p => p.value === key)?.name || key || ''
}
function styleDesc(p) {
  return te(`index.styleDescs.${p.value}`) ? t(`index.styleDescs.${p.value}`) : (p.description || '')
}

// 风格卡片/项目封面的配色（无素材图时用渐变表现风格气质）
const STYLE_ART = {
  '3d': 'radial-gradient(120% 90% at 20% 10%, #6d5dfc 0%, #2a1d6b 45%, #0e0b1f 100%)',
  anime: 'radial-gradient(120% 90% at 80% 0%, #ff7eb6 0%, #7a3cff 50%, #150c2e 100%)',
  ghibli: 'radial-gradient(120% 90% at 30% 0%, #9be38b 0%, #2f7d5b 50%, #0c1f18 100%)',
  watercolor: 'radial-gradient(120% 90% at 70% 10%, #9fd3ff 0%, #c7a4ff 45%, #2b2140 100%)',
  comic: 'radial-gradient(120% 90% at 20% 0%, #ffd23f 0%, #e63946 50%, #1d0a0d 100%)',
  guofeng: 'radial-gradient(120% 90% at 50% 0%, #f2c14e 0%, #b3261e 50%, #1a0706 100%)',
  webtoon: 'radial-gradient(120% 90% at 80% 20%, #7ee8fa 0%, #5b6cff 50%, #0d1030 100%)',
  noir: 'radial-gradient(120% 90% at 30% 10%, #e5e5e5 0%, #555 45%, #0a0a0a 100%)',
}
const FALLBACK_ART = [
  'radial-gradient(120% 90% at 20% 0%, #8b5cf6 0%, #3b1f7a 50%, #120a24 100%)',
  'radial-gradient(120% 90% at 80% 0%, #f472b6 0%, #7c2d5a 50%, #1f0a16 100%)',
  'radial-gradient(120% 90% at 50% 0%, #38bdf8 0%, #1e3a8a 50%, #0a1024 100%)',
]
// per-style example image state: 'ok' once loaded (glyph hidden), 'error' when missing (gradient only)
const styleImg = reactive({})
function styleArt(key) {
  if (STYLE_ART[key]) return STYLE_ART[key]
  const s = String(key || '')
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK_ART[h % FALLBACK_ART.length]
}

const STYLE_GLYPH = { '3d': '3D', anime: 'AN', ghibli: 'GH', watercolor: 'WC', comic: 'CM', guofeng: 'GF', webtoon: 'WT', noir: 'NR' }
function styleGlyph(key) {
  return STYLE_GLYPH[key] || String(key || '?').slice(0, 2).toUpperCase()
}

function coverInitial(d) {
  return String(d.title || '?').trim().slice(0, 1).toUpperCase() || '?'
}

const filteredDramas = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase()
  const items = dramas.value.filter((d) => {
    const text = [d.title, d.style, styleLabel(d.style), projectStatus(d)].filter(Boolean).join(' ').toLowerCase()
    const matchesSearch = !keyword || text.includes(keyword)
    const matchesStatus = statusFilter.value === 'all' || currentStatus(d) === statusFilter.value
    return matchesSearch && matchesStatus
  })

  return [...items].sort((a, b) => {
    if (sortMode.value === 'title') return String(a.title || '').localeCompare(String(b.title || ''), locale.value === 'th' ? 'th' : 'en')
    return new Date(b.updated_at || b.updatedAt || 0).getTime() - new Date(a.updated_at || a.updatedAt || 0).getTime()
  })
})

async function load() {
  loading.value = true
  try {
    const [res, presets] = await Promise.all([dramaAPI.list(), stylePresetAPI.list()])
    dramas.value = res.items || []
    stylePresets.value = presets || []
    if (!form.value.style && stylePresets.value.length) form.value.style = stylePresets.value[0].value
    if (!studioStyle.value && stylePresets.value.length) studioStyle.value = stylePresets.value[0].value
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!form.value.title?.trim()) return
  try {
    const payload = { ...form.value }
    if (formGenres.value.length) payload.metadata = { genres: [...formGenres.value] }
    const d = await dramaAPI.create(payload)
    formGenres.value = []
    showCreate.value = false
    navigateTo(`/drama/${d.id}`)
  } catch (e) {
    toastError(e)
  }
}

async function confirmDelDrama() {
  const d = dramaToDelete.value
  if (!d) return
  try {
    deletingDrama.value = true
    await dramaAPI.del(d.id)
    toast.success(t('index.deleted'))
    dramaToDelete.value = null
    load()
  } catch (e) {
    toastError(e)
  } finally {
    deletingDrama.value = false
  }
}

function openDrama(d) {
  activeMenuId.value = null
  navigateTo(`/drama/${d.id}`)
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return t('index.time.justNow')
  if (diff < 3600000) return t('index.time.minutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('index.time.hoursAgo', { n: Math.floor(diff / 3600000) })
  if (diff < 604800000) return t('index.time.daysAgo', { n: Math.floor(diff / 86400000) })
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { month: 'short', day: 'numeric' })
}

// ===== Hero 输入框：故事 → 新项目 + 第 1 集（原文写入 content）→ 进入工作台 =====
const story = ref('')
const studioStyle = ref('')
const studioRatio = ref('9:16')
const creatingStory = ref(false)
const uploadedName = ref('')
const dragging = ref(false)
const MAX_FILE = 2 * 1024 * 1024

async function readStoryFile(file) {
  if (!file) return
  if (file.size > MAX_FILE) { toast.error(t('index.studio.fileTooBig')); return }
  if (!/\.(txt|md)$/i.test(file.name) && !/^text\//.test(file.type)) { toast.error(t('index.studio.fileRead')); return }
  try {
    story.value = (await file.text()).trim()
    uploadedName.value = file.name
  } catch {
    toast.error(t('index.studio.fileRead'))
  }
}
function onFile(e) {
  readStoryFile(e.target.files?.[0])
  e.target.value = ''
}
function onDrop(e) {
  dragging.value = false
  readStoryFile(e.dataTransfer?.files?.[0])
}

// 标题取第一行有内容的文字（去掉 Markdown 标记），过长截断
function deriveTitle(text) {
  const line = text.split(/\r?\n/).map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || ''
  const base = uploadedName.value ? uploadedName.value.replace(/\.(txt|md)$/i, '') : line
  return (base.length > 40 ? base.slice(0, 40) + '…' : base) || t('index.studio.untitled')
}

async function startFromStory() {
  const text = story.value.trim()
  if (!text) { toast.error(t('index.studio.storyRequired')); return }
  if (creatingStory.value) return
  creatingStory.value = true
  try {
    // 创建集需要启用中的图片与视频配置（后端锁定到集上）；先检查，避免建出空项目
    const configs = await aiConfigAPI.list()
    const hasActive = type => configs.some(c => c.service_type === type && c.is_active)
    if (!hasActive('image') || !hasActive('video')) {
      toast.error(t('index.studio.needConfig'), {
        action: { label: t('layout.banner.goSettings'), onClick: () => openAdmin() },
      })
      return
    }
    const d = await dramaAPI.create({ title: deriveTitle(text), style: studioStyle.value, aspect_ratio: studioRatio.value })
    const ep = await episodeAPI.create({ drama_id: d.id, resolution: '720p' })
    await episodeAPI.update(ep.id, { content: text })
    toast.success(t('index.studio.created'))
    story.value = ''
    uploadedName.value = ''
    navigateTo(`/drama/${d.id}/episode/${ep.episode_number || 1}`)
  } catch (e) {
    toastError(e)
  } finally {
    creatingStory.value = false
  }
}

onMounted(load)

// ===== 应用内引导（首页）：3 步 — 欢迎 / AI 配置 / 新建项目 =====
const INDEX_TOUR = [
  { element: '#__nuxt', titleKey: 'tour.index.welcome.title', descKey: 'tour.index.welcome.desc' },
  { element: '.composer', titleKey: 'tour.index.create.title', descKey: 'tour.index.create.desc', popoverSide: 'bottom' },
]
onMounted(() => setTimeout(() => autoTour('index', INDEX_TOUR, t), 600))
</script>

<style scoped>
.tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; }
.tag-chip {
  border: 1px solid var(--border); border-radius: 999px; padding: 4px 11px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 500 12px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.tag-chip:hover { color: var(--text-0); background: var(--bg-hover); }
.tag-chip.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent-text); }
.page {
  height: 100%;
  overflow-y: auto;
  padding: 0 32px 64px;
  background: var(--surface-base);
  animation: fadeUp 0.35s var(--ease-out) both;
}

/* ===== Hero ===== */
.hero {
  position: relative;
  margin: 0 -32px;
  padding: 88px 32px 72px;
  overflow: hidden;
  isolation: isolate;
}
.hero-glow {
  position: absolute; inset: 0; z-index: -2;
  background:
    radial-gradient(60% 70% at 50% 18%, rgba(190, 40, 60, 0.42) 0%, rgba(120, 20, 60, 0.18) 38%, transparent 70%),
    radial-gradient(40% 50% at 78% 70%, rgba(124, 58, 237, 0.22) 0%, transparent 70%),
    linear-gradient(180deg, #0b0b0d 0%, var(--surface-base) 100%);
}
/* 同心圆纹理：呼应「法阵」氛围，但不用任何外部素材 */
.hero-rings {
  position: absolute; z-index: -1;
  left: 50%; top: -10%;
  width: 900px; height: 900px; transform: translateX(-50%);
  border-radius: 50%;
  background: repeating-radial-gradient(circle, rgba(255, 90, 90, 0.10) 0 1px, transparent 1px 46px);
  mask-image: radial-gradient(circle, #000 0%, transparent 62%);
  -webkit-mask-image: radial-gradient(circle, #000 0%, transparent 62%);
  animation: ring-spin 120s linear infinite;
}
@keyframes ring-spin { to { transform: translateX(-50%) rotate(360deg); } }
:root[data-theme="light"] .hero-glow {
  background:
    radial-gradient(60% 70% at 50% 18%, rgba(190, 40, 60, 0.16) 0%, transparent 70%),
    radial-gradient(40% 50% at 78% 70%, rgba(124, 58, 237, 0.12) 0%, transparent 70%);
}
.hero-inner { max-width: 960px; margin: 0 auto; }
.hero-title {
  display: flex; flex-direction: column; align-items: center;
  margin: 0 0 36px;
  font-family: var(--font-display);
  font-size: clamp(30px, 4.4vw, 52px);
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0;
  text-align: center;
  text-transform: uppercase;
  color: var(--text-0);
  text-shadow: 0 4px 30px rgba(0, 0, 0, 0.55);
  text-wrap: balance;
}

/* 输入框 */
.composer {
  border-radius: 20px;
  background: rgba(24, 24, 27, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.10);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  padding: 16px 16px 12px;
  transition: border-color 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out);
}
:root[data-theme="light"] .composer { background: rgba(255, 255, 255, 0.92); border-color: var(--border); box-shadow: var(--shadow-lg); }
.composer:focus-within, .composer.dragging { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus), 0 24px 60px rgba(0, 0, 0, 0.45); }
.composer-input {
  width: 100%; min-height: 96px; max-height: 320px;
  resize: vertical;
  border: none; outline: none; background: transparent;
  color: var(--text-0);
  font: 400 15px/1.65 var(--font-body);
}
.composer-input::placeholder { color: var(--text-3); }
.composer-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.composer-count { font-size: 12px; color: var(--text-3); }
.composer-right { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.chip {
  display: inline-flex; align-items: center; gap: 7px;
  height: 36px; padding: 0 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-1);
  font-size: 13px; font-weight: 500;
}
.chip-upload { cursor: pointer; max-width: 260px; }
.chip-upload:hover { background: var(--bg-active); color: var(--text-0); }
.chip-upload:focus-within { box-shadow: 0 0 0 3px var(--button-focus); }
.chip-select { position: relative; padding-right: 30px; }
.chip-select select {
  appearance: none; border: none; outline: none; background: transparent;
  color: var(--text-0); font: 600 13px var(--font-body); cursor: pointer;
  max-width: 170px;
}
.chip-select select option { background: var(--surface-raised); color: var(--text-0); }
.chip-select svg { position: absolute; right: 10px; color: var(--text-3); pointer-events: none; }
.chip-select:focus-within { box-shadow: 0 0 0 3px var(--button-focus); }
.chip-label { color: var(--text-3); }

.seg {
  display: inline-flex; padding: 3px; gap: 2px;
  border-radius: 10px; background: var(--bg-hover); border: 1px solid var(--border);
}
.seg button {
  height: 28px; padding: 0 12px; border: none; border-radius: 8px;
  background: transparent; color: var(--text-2);
  font: 600 13px var(--font-body); cursor: pointer;
}
.seg button:hover { color: var(--text-0); }
.seg button.on { background: var(--seg-active-bg); color: var(--text-0); }
.seg button:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }

.send-btn {
  width: 38px; height: 38px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 10px;
  background: var(--inverse-surface); color: var(--on-inverse);
  cursor: pointer; transition: transform 0.12s var(--ease-out), opacity 0.12s;
}
.send-btn:hover { transform: translateY(-1px); }
.send-btn:disabled { opacity: 0.6; cursor: progress; transform: none; }
.send-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== 区块 ===== */
.block { max-width: 1320px; margin: 0 auto; padding-top: 40px; }
.block-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; flex-wrap: wrap; }
.block-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px; font-weight: 700; letter-spacing: 0;
  color: var(--text-0);
}
.block-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-3); }

/* 风格卡片：网格换行，一次展示全部风格（无横向滚动条） */
.style-rail-wrap { position: relative; }
.style-rail {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
.style-card {
  display: flex; flex-direction: column; text-align: left;
  padding: 0 0 14px; border-radius: 16px; overflow: hidden;
  border: 1px solid var(--border); background: var(--surface-raised);
  color: var(--text-0); cursor: pointer;
  transition: border-color 0.16s var(--ease-out), transform 0.16s var(--ease-out);
}
.style-card:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.style-card.on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.style-card:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.style-art {
  position: relative; display: flex; align-items: center; justify-content: center;
  aspect-ratio: 16 / 9; margin-bottom: 12px;
}
.style-art { overflow: hidden; }
.style-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.style-badge { z-index: 1; }
.style-glyph {
  font-family: var(--font-display); font-size: 40px; font-weight: 800;
  color: rgba(255, 255, 255, 0.9); text-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
}
.style-badge {
  position: absolute; top: 10px; left: 10px;
  padding: 2px 9px; border-radius: 6px;
  background: #facc15; color: #1a1400;
  font-size: 11.5px; font-weight: 700;
}
.style-name { padding: 0 14px; font-size: 15px; font-weight: 600; }
.style-desc {
  padding: 2px 14px 0; font-size: 12.5px; line-height: 1.5; color: var(--text-3);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* 我的项目 */
.projects-head .block-title { margin-right: 4px; }
.btn-white {
  display: inline-flex; align-items: center; gap: 7px;
  height: 36px; padding: 0 14px; border-radius: 10px;
  border: 1px solid var(--inverse-surface);
  background: var(--inverse-surface); color: var(--on-inverse);
  font: 600 13px var(--font-body); cursor: pointer;
  transition: transform 0.12s var(--ease-out);
}
.btn-white:hover { transform: translateY(-1px); }
.btn-white:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.sort-wrap { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.sort-label { font-size: 13px; color: var(--text-3); }
.sort-select-wrap { width: 150px; }

.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.search-box { position: relative; width: 260px; }
.search-box svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-3); pointer-events: none; }
.search-box .input { padding-left: 34px; border-radius: 10px; background: var(--bg-hover); }
.chip-row { display: flex; gap: 6px; overflow-x: auto; }
.filter-chip {
  appearance: none; cursor: pointer;
  height: 32px; padding: 0 14px; border: none; border-radius: 9px;
  background: var(--overlay-track); color: var(--text-2);
  font: 600 12.5px var(--font-body); white-space: nowrap;
}
.filter-chip:hover { color: var(--text-0); background: var(--bg-active); }
.filter-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.filter-chip.on { background: var(--inverse-surface); color: var(--on-inverse); }

.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
.project-card {
  position: relative; overflow: hidden; cursor: pointer;
  border-radius: 16px; border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.32s var(--ease-out) both;
  transition: border-color 0.16s var(--ease-out), transform 0.16s var(--ease-out);
}
.project-card:hover { border-color: var(--border-strong); transform: translateY(-2px); }
.project-card:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.project-cover { position: relative; aspect-ratio: 16 / 10; display: flex; align-items: center; justify-content: center; }
.cover-initial {
  font-family: var(--font-display); font-size: 44px; font-weight: 800;
  color: rgba(255, 255, 255, 0.85); text-shadow: 0 6px 24px rgba(0, 0, 0, 0.45); user-select: none;
}
.cover-play {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(0.9);
  width: 44px; height: 44px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55); color: #fff; opacity: 0;
  transition: opacity 0.16s var(--ease-out), transform 0.16s var(--ease-out);
}
.project-card:hover .cover-play { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.cover-ratio {
  position: absolute; right: 10px; bottom: 8px;
  padding: 1px 7px; border-radius: 5px;
  background: rgba(0, 0, 0, 0.5); color: #fff;
  font: 500 10.5px var(--font-mono);
}
.status-wrap { position: absolute; top: 10px; left: 10px; }
.status-badge {
  padding: 2px 9px; border: none; border-radius: 6px; cursor: pointer;
  font: 700 11.5px var(--font-body);
  background: rgba(0, 0, 0, 0.55); color: #fff;
}
.status-badge.st-active { background: #facc15; color: #1a1400; }
.status-badge.st-completed { background: #4ade80; color: #062010; }
.more-wrap { position: absolute; top: 8px; right: 8px; }
.cover-more {
  width: 30px; height: 30px; border: none; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.55); color: #fff; cursor: pointer;
  opacity: 0; transition: opacity 0.15s var(--ease-out);
}
.project-card:hover .cover-more, .more-wrap:focus-within .cover-more, .cover-more:focus-visible { opacity: 1; }
.project-body { padding: 12px 14px 14px; }
.project-name { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-0); }
.project-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--text-3); flex-wrap: wrap; }
.meta-style { color: var(--accent-text); font-weight: 600; }
.project-foot { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-size: 11.5px; color: var(--text-3); }

.skeleton-card { cursor: default; }
.skeleton-cover { aspect-ratio: 16 / 10; background: var(--bg-2); animation: skeleton-pulse 1.4s ease-in-out infinite alternate; }
.skeleton-body { padding: 12px 14px 14px; display: grid; gap: 10px; }
.skeleton-line { height: 12px; border-radius: 99px; background: var(--bg-2); animation: skeleton-pulse 1.4s ease-in-out infinite alternate; }
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-40 { width: 40%; }
@keyframes skeleton-pulse { to { opacity: 0.55; } }

.empty-state {
  min-height: 180px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  border: 1px dashed var(--border-strong); border-radius: 16px;
  text-align: center; padding: 24px;
}
.empty-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
.empty-desc { font-size: 13px; color: var(--text-3); max-width: 320px; line-height: 1.6; }

.create-dialog { width: 460px; max-width: calc(100vw - 32px); }
.dialog-head-copy { display: flex; flex-direction: column; gap: 2px; }
.dialog-desc { font-size: 12.5px; color: var(--text-3); }
.modal-icon {
  width: 40px; height: 40px; flex: 0 0 auto; border-radius: var(--radius);
  background: var(--accent-bg); color: var(--accent);
  display: flex; align-items: center; justify-content: center;
}
.dialog-form { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.dialog-body { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.required { color: var(--error); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }

@media (max-width: 760px) {
  .page { padding: 0 16px 48px; }
  .hero { margin: 0 -16px; padding: 48px 16px 40px; }
  .composer-right { margin-left: 0; width: 100%; }
  .send-btn { margin-left: auto; }
  .chip-upload { max-width: 100%; }
  .style-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .sort-wrap { margin-left: 0; }
  .search-box { width: 100%; }
  .project-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .dialog-foot { flex-direction: column-reverse; }
  .dialog-foot .btn { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-rings { animation: none; }
}
</style>
