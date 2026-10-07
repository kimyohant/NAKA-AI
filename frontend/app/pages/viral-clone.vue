<template>
  <div class="page page-enter">
    <!-- ===== Header ===== -->
    <header class="vc-head">
      <div class="vc-head-copy">
        <p class="eyebrow">{{ t('viralClone.eyebrow') }}</p>
        <h1 class="vc-title">{{ t('viralClone.title') }}</h1>
        <p class="vc-sub">{{ t('viralClone.subtitle') }}</p>
      </div>
      <button class="btn btn-primary" type="button" @click="openCreate">
        <Plus :size="15" :stroke-width="2.2" />
        {{ t('viralClone.list.new') }}
      </button>
    </header>

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

    <!-- ===== Project grid ===== -->
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
            <video v-if="p.referencePath" :src="p.referencePath" muted preload="metadata" playsinline></video>
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
      <button class="btn btn-primary" type="button" @click="openCreate">
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
import { Check, Clapperboard, Clock, Copy, FileText, Layers, Loader2, MoreHorizontal, Plus, TriangleAlert, Upload, Waypoints, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { cloneAPI, uploadAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { CLONE_LANGUAGES, CLONE_POLL_INTERVAL_MS, isCloneProjectBusy } from '~/utils/viralCloneFlow'

const { t, locale } = useI18n()

const FLOW = [
  { key: 'reference', icon: FileText },
  { key: 'blueprint', icon: Waypoints },
  { key: 'variants', icon: Layers },
  { key: 'results', icon: Clapperboard },
]

const projects = ref([])
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

function openCreate() {
  form.value = blankForm()
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
  pollTimer = projects.value.some((p) => isCloneProjectBusy(p.status)) ? setTimeout(() => load(true), CLONE_POLL_INTERVAL_MS) : null
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    projects.value = await cloneAPI.list() || []
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

/* === Flow strip === */
.vc-flow {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 0 0 22px;
  padding: 0;
}
.vc-flow-step {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  min-width: 0;
}
.vc-flow-icon {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex-shrink: 0;
  border-radius: 10px; background: var(--accent-bg); color: var(--accent-text);
}
.vc-flow-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.vc-flow-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--text-0); }
.vc-flow-num { font-size: 11px; font-weight: 800; color: var(--text-3); font-variant-numeric: tabular-nums; }
.vc-flow-desc { font-size: 11.5px; line-height: 1.5; color: var(--text-3); }
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

@media (max-width: 860px) {
  .page { padding: 20px 16px 32px; }
  .vc-head { flex-direction: column; align-items: stretch; }
  .vc-create-row { flex-direction: column; }
  .vc-lang-field { width: 100%; }
  .vc-flow { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
