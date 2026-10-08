<template>
  <div class="page page-enter">
    <!-- ===== Header ===== -->
    <header class="vc-head">
      <div class="vc-head-copy">
        <p class="eyebrow">{{ t('viralClone.eyebrow') }}</p>
        <h1 class="vc-title">{{ t('viralClone.title') }}</h1>
        <p class="vc-sub">{{ t('viralClone.subtitle') }}</p>
      </div>
      <button class="btn btn-primary" type="button" @click="openCreate()">
        <Plus :size="15" :stroke-width="2.2" />
        {{ t('viralClone.list.new') }}
      </button>
    </header>

    <!-- ===== สถิติรวม ===== -->
    <section class="vc-stats" :aria-label="t('viralClone.home.statsAria')">
      <div v-for="tile in statTiles" :key="tile.key" class="vc-stat">
        <span class="vc-stat-icon" :class="tile.tone"><component :is="tile.icon" :size="16" :stroke-width="1.9" /></span>
        <span class="vc-stat-copy">
          <span class="vc-stat-value">{{ tile.value }}</span>
          <span class="vc-stat-label">{{ tile.label }}</span>
        </span>
      </div>
    </section>

    <!-- ===== ลำดับงาน (แนวคิด Hypit: โคลนทั้ง workflow ไม่ใช่แค่สคริปต์) ===== -->
    <ol class="vc-flow" :aria-label="t('viralClone.flow.aria')">
      <li v-for="(step, i) in FLOW" :key="step.key" class="vc-flow-step">
        <span class="vc-flow-icon"><component :is="step.icon" :size="16" :stroke-width="1.9" /></span>
        <span class="vc-flow-copy">
          <span class="vc-flow-title"><span class="vc-flow-num">{{ i + 1 }}</span>{{ t(`viralClone.steps.${step.key}`) }}</span>
          <span class="vc-flow-desc">{{ t(`viralClone.flow.${step.key}`) }}</span>
        </span>
      </li>
    </ol>

    <!-- ===== เริ่มจากเทมเพลต ===== -->
    <section class="vc-section">
      <div class="vc-section-head">
        <h2 class="vc-section-title">{{ t('viralClone.home.templatesTitle') }}</h2>
        <p class="vc-section-sub">{{ t('viralClone.home.templatesSub') }}</p>
      </div>
      <div class="vc-templates">
        <button
          v-for="tpl in templates" :key="tpl.key" type="button"
          class="vc-tpl"
          @click="openCreate(tpl)"
        >
          <span class="vc-tpl-top">
            <span class="vc-tpl-icon"><component :is="tpl.icon" :size="17" :stroke-width="1.8" /></span>
            <span class="vc-tpl-dur mono">{{ tpl.total }}s</span>
          </span>
          <span class="vc-tpl-title">{{ t(`viralClone.templates.${tpl.key}.title`) }}</span>
          <span class="vc-tpl-desc">{{ t(`viralClone.templates.${tpl.key}.desc`) }}</span>
          <ViralCloneTimeline compact :beats="tpl.beats" />
          <span class="vc-tpl-cta">
            <Plus :size="12" :stroke-width="2.2" />
            {{ t('viralClone.home.useTemplate') }}
          </span>
        </button>
      </div>
    </section>

    <!-- ===== คลิปที่เรนเดอร์ล่าสุด ===== -->
    <section v-if="recent.length" class="vc-section">
      <div class="vc-section-head">
        <h2 class="vc-section-title">{{ t('viralClone.home.recentTitle') }}</h2>
        <p class="vc-section-sub">{{ t('viralClone.home.recentSub') }}</p>
      </div>
      <div class="vc-recent">
        <article v-for="r in recent" :key="r.id" class="vc-recent-item">
          <video class="vc-recent-video" :src="r.outputPath" controls muted preload="metadata" playsinline></video>
          <button class="vc-recent-meta" type="button" @click="navigateTo(`/viral-clone/${r.projectId}`)">
            <span class="vc-recent-project truncate">{{ r.projectName }}</span>
            <span class="vc-recent-label truncate">{{ r.label }}<template v-if="r.durationSec"> · {{ Math.round(r.durationSec) }}s</template></span>
          </button>
        </article>
      </div>
    </section>

    <!-- ===== Project grid ===== -->
    <div v-if="loading || projects.length" class="vc-section-head vc-projects-head">
      <h2 class="vc-section-title">{{ t('viralClone.home.projectsTitle') }}</h2>
      <span v-if="projects.length" class="vc-count">{{ projects.length }}</span>
    </div>
    <div v-if="loading" class="vc-grid" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="vc-card skeleton-card">
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-80"></div>
      </div>
    </div>

    <div v-else-if="projects.length" class="vc-grid">
      <article
        v-for="(p, i) in projects"
        :key="p.id"
        class="vc-card"
        :style="{ animationDelay: `${i * 0.04}s` }"
        tabindex="0"
        role="button"
        :aria-label="t('viralClone.list.openAria', { name: p.name })"
        @click="open(p)"
        @keydown.enter.self.prevent="open(p)"
        @keydown.space.self.prevent="open(p)"
      >
        <div class="vc-card-top">
          <div class="vc-thumb" aria-hidden="true">
            <video v-if="perProject[p.id]?.latestOutput || p.referencePath" :src="perProject[p.id]?.latestOutput || p.referencePath" muted preload="metadata" playsinline></video>
            <Copy v-else :size="16" :stroke-width="1.8" />
          </div>
          <div class="vc-card-heading">
            <h3 class="vc-card-title truncate">{{ p.name }}</h3>
            <p class="vc-card-lang">{{ t(`viralClone.languages.${p.language}`) }}</p>
          </div>
          <AppMenu :open="menuId === p.id" placement="bottom-end" :min-width="120" @update:open="(v) => { menuId = v ? p.id : null }">
            <template #trigger>
              <button class="vc-more" type="button" :title="t('common.more')" :aria-label="t('common.more')" @click.stop>
                <MoreHorizontal :size="16" :stroke-width="2" />
              </button>
            </template>
            <AppMenuItem danger @click="menuId = null; toDelete = p">{{ t('viralClone.list.delete') }}</AppMenuItem>
          </AppMenu>
        </div>
        <ViralCloneTimeline v-if="p.blueprint?.beats?.length" compact :beats="p.blueprint.beats" :language="p.language" />
        <div v-else class="vc-card-notl">{{ t('viralClone.list.noBlueprint') }}</div>
        <div class="vc-card-tags">
          <span class="tag" :class="statusTagClass(p.status)">
            <Loader2 v-if="isCloneProjectBusy(p.status)" :size="10" class="animate-spin" />
            {{ t(`viralClone.status.${p.status}`) }}
          </span>
          <span v-if="p.blueprint?.beats?.length" class="tag">{{ t('viralClone.list.beats', { n: p.blueprint.beats.length }) }}</span>
          <span class="tag" :class="p.renderEngine === 'hypit' ? 'tag-accent' : ''">{{ p.renderEngine === 'hypit' ? 'Hypit' : 'NAKA' }}</span>
        </div>
        <div v-if="perProject[p.id]?.total" class="vc-card-progress">
          <div class="vc-progress-bar" aria-hidden="true">
            <i :style="{ width: `${(perProject[p.id].completed / perProject[p.id].total) * 100}%` }"></i>
          </div>
          <span class="vc-progress-text">
            {{ t('viralClone.home.variantProgress', { done: perProject[p.id].completed, total: perProject[p.id].total }) }}
            <template v-if="perProject[p.id].busy"> · <Loader2 :size="10" class="animate-spin" /> {{ perProject[p.id].busy }}</template>
          </span>
        </div>
        <div class="vc-card-foot">
          <Clock :size="11" :stroke-width="1.8" />
          {{ fmtDate(p.updatedAt) }}
        </div>
      </article>
    </div>

    <div v-else class="vc-empty">
      <Copy :size="26" :stroke-width="1.5" />
      <p class="vc-empty-title">{{ t('viralClone.list.emptyTitle') }}</p>
      <p class="vc-empty-desc">{{ t('viralClone.list.emptyDesc') }}</p>
      <button class="btn btn-primary" type="button" @click="openCreate()">
        <Plus :size="15" :stroke-width="2.2" />
        {{ t('viralClone.list.new') }}
      </button>
    </div>

    <!-- ===== Create dialog ===== -->
    <div v-if="showCreate" class="overlay" @click.self="closeCreate">
      <div class="dialog create-dialog" role="dialog" aria-modal="true" :aria-label="t('viralClone.create.title')">
        <div class="dialog-head">
          <div class="vc-dialog-icon">
            <Copy :size="18" :stroke-width="1.8" />
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('viralClone.create.title') }}</h2>
            <p class="dialog-desc">{{ t('viralClone.create.desc') }}</p>
          </div>
        </div>
        <form class="create-form" @submit.prevent="create">
          <div class="dialog-body vc-create-body">
            <div class="vc-license">
              <TriangleAlert :size="13" :stroke-width="2" />
              <span>{{ t('viralClone.create.licenseNotice') }}</span>
            </div>
            <label class="field">
              <span class="field-label">{{ t('viralClone.create.name') }}</span>
              <input v-model="form.name" class="input" :placeholder="t('viralClone.create.namePlaceholder')" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('viralClone.create.transcript') }}</span>
              <textarea v-model="form.transcript" class="input vc-transcript" rows="6" :placeholder="t('viralClone.create.transcriptPlaceholder')"></textarea>
            </label>
            <div class="vc-create-row">
              <label class="field vc-lang-field">
                <span class="field-label">{{ t('viralClone.create.language') }}</span>
                <BaseSelect v-model="form.language" :options="languageOptions" />
              </label>
              <div class="field vc-ref-field">
                <span class="field-label">{{ t('viralClone.create.reference') }}</span>
                <div v-if="form.referencePath" class="vc-ref-done">
                  <Check :size="13" :stroke-width="2.2" />
                  <span class="truncate">{{ t('viralClone.create.referenceDone') }}</span>
                  <button type="button" class="vc-ref-x" :title="t('viralClone.create.referenceRemove')" @click="form.referencePath = null">
                    <X :size="11" :stroke-width="2.2" />
                  </button>
                </div>
                <button v-else class="btn" type="button" :disabled="uploading" @click="refInput?.click()">
                  <Loader2 v-if="uploading" :size="13" class="animate-spin" />
                  <Upload v-else :size="13" :stroke-width="2" />
                  {{ uploading ? t('viralClone.create.uploading') : t('viralClone.create.reference') }}
                </button>
                <input ref="refInput" class="vc-file-input" type="file" accept="video/*" @change="onRefFile" />
                <span class="field-hint">{{ t('viralClone.create.referenceHint') }}</span>
              </div>
            </div>
          </div>
          <div class="dialog-foot">
            <span v-if="!canCreate" class="vc-foot-hint">{{ t('viralClone.create.needTranscript') }}</span>
            <button type="button" class="btn" :disabled="creating" @click="closeCreate">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="creating || !canCreate">
              <Loader2 v-if="creating" :size="13" class="animate-spin" />
              {{ creating ? t('viralClone.create.creating') : t('viralClone.create.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <ConfirmDialog
      :open="!!toDelete"
      :title="t('viralClone.delete.title')"
      :message="t('viralClone.delete.message', { name: toDelete?.name || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="deleting"
      @confirm="remove"
      @cancel="toDelete = null"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Clapperboard, Clock, Copy, Cpu, FileText, Film, Layers, ListOrdered, Loader2, Mic, MoreHorizontal, Plus, ShoppingBag, TriangleAlert, Upload, Users, Waypoints, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { cloneAPI, uploadAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { CLONE_LANGUAGES, CLONE_POLL_INTERVAL_MS, CLONE_TEMPLATES, isCloneProjectBusy } from '../utils/viralCloneFlow'

const { t, locale } = useI18n()

const FLOW = [
  { key: 'reference', icon: FileText },
  { key: 'blueprint', icon: Waypoints },
  { key: 'variants', icon: Layers },
  { key: 'results', icon: Clapperboard },
]

const TEMPLATE_ICONS = { ugcReview: ShoppingBag, podcast: Mic, streetInterview: Users, ranking: ListOrdered }
const templates = CLONE_TEMPLATES.map((tpl) => ({
  key: tpl.key,
  icon: TEMPLATE_ICONS[tpl.key] || Film,
  beats: tpl.beats.map(([role, durationSec], i) => ({ id: `${tpl.key}-${i}`, role, durationSec, line: '' })),
  total: tpl.beats.reduce((sum, [, d]) => sum + d, 0),
}))

const projects = ref([])
const overview = ref(null)
const perProject = computed(() => overview.value?.perProject || {})
const recent = computed(() => overview.value?.recent || [])
const statTiles = computed(() => {
  const s = overview.value?.stats || { projects: projects.value.length, variants: 0, completed: 0, busy: 0, renderedSec: 0 }
  const hypit = overview.value?.hypit
  return [
    { key: 'projects', icon: Copy, tone: 'accent', value: s.projects, label: t('viralClone.home.statProjects') },
    { key: 'variants', icon: Layers, tone: 'info', value: s.variants, label: s.busy ? t('viralClone.home.statVariantsBusy', { n: s.busy }) : t('viralClone.home.statVariants') },
    { key: 'completed', icon: Clapperboard, tone: 'success', value: s.completed, label: t('viralClone.home.statCompleted', { d: fmtRendered(s.renderedSec || 0) }) },
    {
      key: 'engine', icon: Cpu, tone: hypit?.available ? 'success' : 'warning',
      value: hypit?.available ? t('viralClone.home.engineReady') : t('viralClone.home.engineNakaOnly'),
      label: hypit?.available ? t('viralClone.home.engineReadyHint') : t('viralClone.home.engineNakaOnlyHint'),
    },
  ]
})
const loading = ref(true)
const showCreate = ref(false)
const creating = ref(false)
const uploading = ref(false)
const toDelete = ref(null)
const deleting = ref(false)
const menuId = ref(null)
const refInput = ref(null)

const form = ref(blankForm())
const canCreate = computed(() => !!form.value.transcript.trim())

function blankForm() {
  return { name: '', transcript: '', language: 'th', referencePath: null }
}

function fmtRendered(sec) {
  if (sec < 60) return t('viralClone.home.seconds', { n: Math.round(sec) })
  return t('viralClone.home.minutes', { n: Math.round(sec / 6) / 10 })
}

function statusTagClass(status) {
  if (status === 'error') return 'tag-error'
  if (status === 'ready') return 'tag-success'
  if (isCloneProjectBusy(status)) return 'tag-info'
  return ''
}

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium' })
}

const languageOptions = computed(() => CLONE_LANGUAGES.map((l) => ({ label: t(`viralClone.languages.${l}`), value: l })))

function openCreate(tpl) {
  form.value = blankForm()
  if (tpl?.key) {
    form.value.name = t(`viralClone.templates.${tpl.key}.title`)
    form.value.transcript = t(`viralClone.templates.${tpl.key}.transcript`)
    form.value.language = locale.value === 'th' ? 'th' : 'en'
  }
  showCreate.value = true
}
function closeCreate() {
  if (!creating.value) showCreate.value = false
}

// อัปโหลดคลิปต้นแบบก่อน (uploadAPI.video) แล้วส่ง path ตอน create — ระบบไม่ดึงคลิปจากแพลตฟอร์มเอง
async function onRefFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file || uploading.value) return
  uploading.value = true
  try {
    const res = await uploadAPI.video(file)
    form.value.referencePath = res.path || res.url
  } catch (err) {
    toastError(err)
  } finally {
    uploading.value = false
  }
}

// รายการมีโปรเจกต์กำลังวิเคราะห์ → poll เบา ๆ ให้สถานะการ์ดวิ่งเอง
let pollTimer = null
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  const busy = projects.value.some((p) => isCloneProjectBusy(p.status)) || (overview.value?.stats?.busy ?? 0) > 0
  pollTimer = busy ? setTimeout(() => load(true), CLONE_POLL_INTERVAL_MS) : null
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const [list, ov] = await Promise.all([cloneAPI.list(), cloneAPI.overview().catch(() => null)])
    projects.value = list || []
    if (ov) overview.value = ov
  } catch (e) {
    if (!silent) toastError(e)
  } finally {
    loading.value = false
    schedulePoll()
  }
}

async function create() {
  if (!canCreate.value || creating.value) return
  creating.value = true
  try {
    const f = form.value
    const p = await cloneAPI.create({
      name: f.name.trim() || undefined,
      transcript: f.transcript.trim(),
      language: f.language,
      referencePath: f.referencePath,
    })
    toast.success(t('viralClone.create.created'))
    showCreate.value = false
    navigateTo(`/viral-clone/${p.id}`)
  } catch (e) {
    toastError(e)
  } finally {
    creating.value = false
  }
}

function open(p) {
  navigateTo(`/viral-clone/${p.id}`)
}

async function remove() {
  if (!toDelete.value) return
  deleting.value = true
  try {
    await cloneAPI.del(toDelete.value.id)
    toast.success(t('viralClone.list.deleted'))
    toDelete.value = null
    await load(true)
  } catch (e) {
    toastError(e)
  } finally {
    deleting.value = false
  }
}

onMounted(() => load())
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<style scoped>
.page {
  padding: 32px 40px 48px;
  overflow-y: auto;
  height: 100%;
}

/* === Header === */
.vc-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.eyebrow { margin-bottom: 6px; }
.vc-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-0);
}
.vc-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-2);
  max-width: 560px;
}

/* === Stats === */
.vc-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 14px; }
.vc-stat {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  min-width: 0;
}
.vc-stat-icon {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; flex-shrink: 0; border-radius: 11px;
  background: var(--accent-bg); color: var(--accent-text);
}
.vc-stat-icon.info { background: var(--info-bg); color: var(--tag-info-text, var(--info)); }
.vc-stat-icon.success { background: var(--success-bg); color: var(--tag-success-text, var(--success)); }
.vc-stat-icon.warning { background: var(--warning-bg); color: var(--tag-warning-text, var(--warning)); }
.vc-stat-copy { display: flex; flex-direction: column; min-width: 0; }
.vc-stat-value { font-family: var(--font-display); font-size: 20px; font-weight: 800; line-height: 1.2; color: var(--text-0); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-stat-label { font-size: 11.5px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* === Sections === */
.vc-section { display: flex; flex-direction: column; gap: 12px; margin-bottom: 26px; }
.vc-section-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.vc-projects-head { margin-bottom: 12px; align-items: center; }
.vc-section-title { margin: 0; font-size: 16px; font-weight: 800; color: var(--text-0); }
.vc-section-sub { margin: 0; font-size: 12px; color: var(--text-3); }
.vc-count {
  min-width: 22px; height: 22px; padding: 0 7px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; background: var(--bg-2); font-size: 11.5px; font-weight: 700; color: var(--text-2);
}

/* === Templates === */
.vc-templates { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.vc-tpl {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(120% 70% at 100% 0%, var(--accent-bg) 0%, transparent 60%),
    var(--surface-soft);
  color: var(--text-0);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s var(--ease-out), transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out);
}
.vc-tpl:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow-elevated); }
.vc-tpl:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.vc-tpl-top { display: flex; align-items: center; justify-content: space-between; }
.vc-tpl-icon {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 10px;
  background: var(--accent-gradient); color: var(--on-accent);
}
.vc-tpl-dur { font-size: 11px; color: var(--text-3); }
.vc-tpl-title { font-size: 14px; font-weight: 700; }
.vc-tpl-desc { font-size: 11.5px; line-height: 1.55; color: var(--text-2); flex: 1; }
.vc-tpl-cta { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--accent-text); }

/* === Recent renders === */
.vc-recent { display: grid; grid-auto-flow: column; grid-auto-columns: 150px; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
.vc-recent-item { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-raised); overflow: hidden; }
.vc-recent-video { display: block; width: 100%; aspect-ratio: 9 / 16; background: #000; object-fit: cover; }
.vc-recent-meta {
  display: flex; flex-direction: column; gap: 1px; padding: 8px 10px;
  border: none; background: transparent; text-align: left; cursor: pointer; min-width: 0;
}
.vc-recent-meta:hover .vc-recent-project { color: var(--accent-text); }
.vc-recent-project { font-size: 12px; font-weight: 700; color: var(--text-0); }
.vc-recent-label { font-size: 11px; color: var(--text-3); }

/* === Project progress === */
.vc-card-progress { display: flex; align-items: center; gap: 8px; }
.vc-progress-bar { flex: 1; height: 4px; border-radius: 2px; background: var(--bg-3); overflow: hidden; }
.vc-progress-bar i { display: block; height: 100%; background: var(--success); border-radius: 2px; }
.vc-progress-text { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-3); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* === Flow strip (บาง ๆ มีลูกศรเชื่อม — แยกจากการ์ดสถิติ) === */
.vc-flow {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin: 0 0 26px;
  padding: 10px 6px;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.vc-flow-step { position: relative; display: flex; align-items: center; gap: 10px; padding: 0 22px 0 10px; min-width: 0; }
.vc-flow-step:not(:last-child)::after {
  content: '';
  position: absolute;
  right: 6px;
  top: 50%;
  width: 7px;
  height: 7px;
  border-top: 1.5px solid var(--text-3);
  border-right: 1.5px solid var(--text-3);
  transform: translateY(-50%) rotate(45deg);
}
.vc-flow-icon {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; flex-shrink: 0;
  border-radius: 50%; background: var(--accent-bg); color: var(--accent-text);
}
.vc-flow-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.vc-flow-title { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: var(--text-0); }
.vc-flow-num { font-size: 10.5px; font-weight: 800; color: var(--text-3); font-variant-numeric: tabular-nums; }
.vc-flow-desc { font-size: 11px; line-height: 1.45; color: var(--text-3); }
.vc-card-notl {
  height: 6px; border-radius: 3px;
  background: repeating-linear-gradient(90deg, var(--bg-3) 0 10px, transparent 10px 14px);
  font-size: 0;
}

/* === Grid & cards === */
.vc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.vc-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
  animation: fadeUp 0.24s var(--ease-out) both;
}
.vc-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}
.vc-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--button-focus);
}
.vc-card-top { display: flex; align-items: center; gap: 10px; }
.vc-thumb {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-3);
}
.vc-thumb img, .vc-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.vc-card-heading { flex: 1; min-width: 0; }
.vc-card-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text-0);
}
.vc-card-product { margin: 2px 0 0; font-size: 11.5px; color: var(--text-3); }
.vc-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.vc-more:hover { background: var(--bg-hover); color: var(--text-0); }
.vc-more:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.vc-card-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.vc-card-tags .tag { display: inline-flex; align-items: center; gap: 4px; }
.vc-card-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: auto;
  font-size: 11px;
  color: var(--text-3);
}

/* === Empty === */
.vc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 72px 24px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-3);
  text-align: center;
}
.vc-empty-title { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--text-1); }
.vc-empty-desc { margin: 0 0 14px; font-size: 12.5px; max-width: 380px; }

/* === Create dialog === */
.create-dialog { width: 640px; max-width: calc(100vw - 32px); }
.create-form { display: flex; flex-direction: column; min-height: 0; }
.vc-dialog-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: var(--accent-bg);
  color: var(--accent-text);
}
.vc-create-body { display: flex; flex-direction: column; gap: 12px; }
.vc-license {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-2);
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-2);
}
.vc-license svg { flex-shrink: 0; margin-top: 1px; color: var(--text-3); }
.vc-transcript { resize: vertical; min-height: 110px; line-height: 1.6; }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; line-height: 1.5; color: var(--text-3); }
.vc-ref-field .btn { align-self: flex-start; }
.vc-create-row { display: flex; gap: 12px; }
.vc-lang-field { width: 180px; flex-shrink: 0; }
.vc-ref-field { flex: 1; }
.vc-ref-done {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border); border-radius: 8px;
  font-size: 12px; color: var(--text-1);
  background: var(--bg-2);
}
.vc-ref-done svg { color: var(--success, #30a46c); flex-shrink: 0; }
.vc-ref-done span { flex: 1; min-width: 0; }
.vc-ref-x {
  display: flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; flex-shrink: 0;
  border: none; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer;
}
.vc-ref-x:hover { background: var(--bg-hover); color: var(--text-0); }
.vc-file-input { display: none; }
.vc-foot-hint { margin-right: auto; align-self: center; font-size: 11.5px; color: var(--text-3); }

/* === Skeleton === */
.skeleton-card { cursor: default; animation: none; }
.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: var(--bg-hover);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.skeleton-line.w-40 { width: 40%; }
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-80 { width: 80%; }
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (max-width: 1180px) {
  .vc-templates { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .page { padding: 20px 16px 32px; }
  .vc-head { flex-direction: column; align-items: stretch; }
  .vc-create-row { flex-direction: column; }
  .vc-lang-field { width: 100%; }
  .vc-flow, .vc-stats, .vc-templates { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
