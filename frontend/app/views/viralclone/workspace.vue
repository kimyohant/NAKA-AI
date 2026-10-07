<template>
  <div class="wc-page page-enter">
    <!-- ===== Topbar ===== -->
    <header class="wc-topbar">
      <div class="wc-topbar-main">
        <button class="back-btn" type="button" @click="navigateTo('/viral-clone')">
          <ArrowLeft :size="15" :stroke-width="2.1" />
          {{ t('viralClone.work.back') }}
        </button>
        <div class="wc-identity">
          <h1 class="wc-title truncate">{{ detail?.name || '…' }}</h1>
          <div class="wc-meta-row">
            <span v-if="detail" class="tag" :class="statusTagClass">
              <Loader2 v-if="projectBusy" :size="10" class="animate-spin" />
              {{ t(`viralClone.status.${detail.status}`) }}
            </span>
            <span v-if="detail?.blueprint?.beats?.length" class="tag">{{ t('viralClone.list.beats', { n: detail.blueprint.beats.length }) }}</span>
          </div>
        </div>
      </div>
      <button class="btn" type="button" :disabled="refreshing" @click="refresh()">
        <RefreshCw :size="12" :stroke-width="2" :class="{ 'animate-spin': refreshing }" />
        {{ t('common.refresh') }}
      </button>
    </header>

    <div v-if="!detail && loadFailed" class="wc-empty">
      <p>{{ t('viralClone.work.loadFailed') }}</p>
    </div>

    <div v-else-if="detail" class="wc-body">
      <!-- ===== Tabs ===== -->
      <nav class="wc-tabs" :aria-label="t('viralClone.work.tabsLabel')">
        <button
          v-for="tab in TABS" :key="tab" type="button"
          class="wc-tab" :class="{ active: activeTab === tab }"
          :aria-selected="activeTab === tab" role="tab"
          @click="activeTab = tab"
        >
          {{ t(`viralClone.work.tab_${tab}`) }}
          <span v-if="tab === 'variants' && variants.length" class="wc-tab-count">{{ variants.length }}</span>
        </button>
      </nav>

      <!-- ===== Blueprint ===== -->
      <section v-if="activeTab === 'blueprint'" class="wc-panel">
        <div v-if="!detail.blueprint" class="wc-analyze">
          <p class="wc-analyze-title">{{ t('viralClone.blueprint.panelTitle') }}</p>
          <p class="wc-analyze-desc">{{ t('viralClone.blueprint.panelDesc') }}</p>
          <p v-if="projectError" class="wc-analyze-error">{{ projectError }}</p>
          <button v-if="!projectBusy" class="btn btn-primary" type="button" :disabled="analyzing" @click="analyze">
            <Sparkles :size="14" :stroke-width="2" />
            {{ t('viralClone.blueprint.analyze') }}
          </button>
          <span v-else class="tag tag-info">
            <Loader2 :size="10" class="animate-spin" />
            {{ t('viralClone.status.analyzing') }}
          </span>
        </div>
        <template v-else>
          <ViralCloneBlueprintEditor :blueprint="detail.blueprint" :saving="savingBlueprint" @save="saveBlueprint" />
        </template>
      </section>

      <!-- ===== Variants ===== -->
      <section v-else-if="activeTab === 'variants'" class="wc-panel">
        <div v-if="!detail.blueprint" class="wc-analyze">
          <p class="wc-analyze-desc">{{ t('viralClone.variants.needBlueprint') }}</p>
        </div>
        <template v-else>
          <div class="wc-variants-side">
            <ViralCloneMatrixBuilder
              :blueprint="detail.blueprint"
              :products="products"
              :avatars="avatars"
              :busy="creatingVariants"
              @create="createVariants"
            />
            <label class="wc-engine">
              <span class="wc-engine-label">{{ t('viralClone.variants.engineLabel') }}</span>
              <select
                class="input"
                :value="detail.renderEngine || 'naka'"
                :disabled="savingEngine || anyVariantBusy"
                @change="changeEngine($event.target.value)"
              >
                <option value="naka">{{ t('viralClone.variants.engineNaka') }}</option>
                <option value="hypit" :disabled="hypit && !hypit.available && detail.renderEngine !== 'hypit'">
                  {{ t('viralClone.variants.engineHypit') }}
                </option>
              </select>
              <span class="wc-engine-hint">
                {{ detail.renderEngine === 'hypit' ? t('viralClone.variants.engineHypitHint') : t('viralClone.variants.engineNakaHint') }}
              </span>
              <span v-if="hypit && !hypit.available" class="wc-engine-hint wc-engine-warn">
                {{ t('viralClone.variants.engineHypitUnavailable', { reason: hypit.reason || '' }) }}
              </span>
            </label>
            <button
              v-if="variants.length"
              class="btn btn-primary wc-render-all" type="button"
              :disabled="anyVariantBusy || renderingAll"
              @click="renderAll"
            >
              <Loader2 v-if="renderingAll" :size="13" class="animate-spin" />
              <Clapperboard v-else :size="13" :stroke-width="2" />
              {{ t('viralClone.variants.renderAll') }}
            </button>
          </div>

          <div v-if="variants.length" class="wc-variant-grid">
            <ViralCloneVariantCard
              v-for="v in variants"
              :key="v.id"
              :variant="v"
              :products="products"
              :avatars="avatars"
              @render="renderVariant"
              @del="askDelVariant"
            />
          </div>
          <p v-else class="wc-none">{{ t('viralClone.variants.noneYet') }}</p>
        </template>
      </section>

      <!-- ===== Reference ===== -->
      <section v-else-if="activeTab === 'reference'" class="wc-panel wc-ref">
        <div class="wc-ref-col">
          <label class="field">
            <span class="field-label">{{ t('viralClone.reference.transcriptTitle') }}</span>
            <textarea v-model="transcriptDraft" class="input wc-transcript" rows="12"></textarea>
            <span class="field-hint">{{ t('viralClone.reference.transcriptHint') }}</span>
          </label>
          <button class="btn" type="button" :disabled="!transcriptDirty || savingRef" @click="saveReference">
            <Loader2 v-if="savingRef" :size="13" class="animate-spin" />
            {{ t('viralClone.reference.saveTranscript') }}
          </button>
        </div>
        <div class="wc-ref-col">
          <p class="field-label">{{ t('viralClone.reference.videoTitle') }}</p>
          <video v-if="detail.referencePath" class="wc-ref-video" :src="detail.referencePath" controls preload="metadata" />
          <p v-else class="wc-none">{{ t('viralClone.reference.noVideo') }}</p>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="!!delTarget"
      :title="t('viralClone.variants.deleteTitle')"
      :message="t('viralClone.variants.deleteMessage', { label: delTarget?.label || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="deletingVariant"
      @confirm="confirmDelVariant"
      @cancel="delTarget = null"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ArrowLeft, Clapperboard, Loader2, RefreshCw, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { cloneAPI, studioAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { CLONE_POLL_INTERVAL_MS, cloneErrorCodeOf, isCloneProjectBusy, isCloneVariantBusy } from '~/utils/viralCloneFlow'

const TABS = ['blueprint', 'variants', 'reference']

const { t, te } = useI18n()
const route = useRoute()
const projectId = Number(route.params.id)

const detail = ref(null)
const loadFailed = ref(false)
const refreshing = ref(false)
const activeTab = ref('blueprint')

const analyzing = ref(false)
const savingBlueprint = ref(false)
const creatingVariants = ref(false)
const renderingAll = ref(false)
const savingRef = ref(false)
const savingEngine = ref(false)
const hypit = ref(null)
const deletingVariant = ref(false)
const delTarget = ref(null)

const products = ref([])
const avatars = ref([])

const variants = computed(() => detail.value?.variants || [])
const projectBusy = computed(() => !!detail.value && isCloneProjectBusy(detail.value.status))
const anyVariantBusy = computed(() => variants.value.some((v) => isCloneVariantBusy(v.status)))

const statusTagClass = computed(() => {
  if (!detail.value) return ''
  if (detail.value.status === 'error') return 'tag-error'
  if (detail.value.status === 'ready') return 'tag-success'
  if (projectBusy.value) return 'tag-info'
  return ''
})

// error ของ analyze (E_CODE: message) → แปลผ่าน errors.codes.*
const projectError = computed(() => {
  const d = detail.value
  if (!d || d.status !== 'error') return ''
  const code = d.errorCode || cloneErrorCodeOf(d.errorMsg || '')
  if (code && te(`errors.codes.${code}`)) return t(`errors.codes.${code}`)
  return d.errorMsg || ''
})

// transcript แก้ใน reference tab — sync จาก server เมื่อไม่ได้แก้ค้างอยู่
const transcriptDraft = ref('')
const transcriptDirty = ref(false)
watch(() => detail.value?.transcript, (v) => {
  if (!transcriptDirty.value) transcriptDraft.value = v || ''
})
watch(transcriptDraft, (v, old) => {
  if (old !== undefined && detail.value && v !== detail.value.transcript) transcriptDirty.value = true
})

// poll timer เดียว: วิ่งเมื่อ analyzing หรือมี variant queued/rendering เท่านั้น
let pollTimer = null
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = (projectBusy.value || anyVariantBusy.value)
    ? setTimeout(() => refresh(true), CLONE_POLL_INTERVAL_MS)
    : null
}

async function refresh(silent = false) {
  if (!silent) refreshing.value = true
  try {
    detail.value = await cloneAPI.get(projectId)
    loadFailed.value = false
  } catch (e) {
    if (!silent) {
      loadFailed.value = true
      toastError(e)
    }
  } finally {
    if (!silent) refreshing.value = false
    schedulePoll()
  }
}

async function loadMeta() {
  try {
    const [list, avs] = await Promise.all([studioAPI.list(), studioAPI.avatars()])
    products.value = list || []
    avatars.value = avs || []
  } catch {
    // meta สำหรับ matrix/ชิปชื่อ — พลาดแล้วโหลดซ้ำไม่บล็อกหน้า
  }
}

async function analyze() {
  if (analyzing.value || projectBusy.value) return
  analyzing.value = true
  try {
    await cloneAPI.analyze(projectId)
    toast.success(t('viralClone.blueprint.analyzeStarted'))
    await refresh(true)
  } catch (e) {
    toastError(e)
  } finally {
    analyzing.value = false
  }
}

async function saveBlueprint(bp) {
  savingBlueprint.value = true
  try {
    await cloneAPI.saveBlueprint(projectId, bp)
    toast.success(t('viralClone.blueprint.saved'))
    await refresh(true)
  } catch (e) {
    toastError(e)
  } finally {
    savingBlueprint.value = false
  }
}

async function createVariants(matrix) {
  creatingVariants.value = true
  try {
    const created = await cloneAPI.createVariants(projectId, matrix)
    toast.success(t('viralClone.variants.created', { n: created?.length || 0 }))
    await refresh(true)
  } catch (e) {
    toastError(e)
  } finally {
    creatingVariants.value = false
  }
}

async function loadHypitStatus() {
  try {
    hypit.value = await cloneAPI.hypitStatus()
  } catch {
    hypit.value = null
  }
}

async function changeEngine(engine) {
  if (!detail.value || engine === detail.value.renderEngine) return
  savingEngine.value = true
  try {
    await cloneAPI.update(projectId, { renderEngine: engine })
    await refresh(true)
  } catch (e) {
    toastError(e)
  } finally {
    savingEngine.value = false
  }
}

async function renderVariant(variantId) {
  try {
    await cloneAPI.renderVariant(variantId)
    await refresh(true)
  } catch (e) {
    toastError(e)
  }
}

async function renderAll() {
  if (renderingAll.value || anyVariantBusy.value) return
  renderingAll.value = true
  try {
    const res = await cloneAPI.renderAll(projectId)
    toast.success(t('viralClone.variants.renderAllQueued', { n: res?.queued ?? 0 }))
    await refresh(true)
  } catch (e) {
    toastError(e)
  } finally {
    renderingAll.value = false
  }
}

function askDelVariant(v) {
  delTarget.value = v
}

async function confirmDelVariant() {
  if (!delTarget.value) return
  deletingVariant.value = true
  try {
    await cloneAPI.delVariant(delTarget.value.id)
    toast.success(t('viralClone.variants.deleted'))
    delTarget.value = null
    await refresh(true)
  } catch (e) {
    toastError(e)
  } finally {
    deletingVariant.value = false
  }
}

async function saveReference() {
  if (!transcriptDirty.value || savingRef.value) return
  savingRef.value = true
  try {
    await cloneAPI.update(projectId, { transcript: transcriptDraft.value.trim() })
    transcriptDirty.value = false
    toast.success(t('viralClone.reference.saved'))
    await refresh(true)
  } catch (e) {
    toastError(e)
  } finally {
    savingRef.value = false
  }
}

onMounted(() => {
  refresh()
  loadMeta()
  loadHypitStatus()
})
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<style scoped>
.wc-page {
  padding: 24px 40px 48px;
  overflow-y: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* === Topbar === */
.wc-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.wc-topbar-main { display: flex; align-items: center; gap: 14px; min-width: 0; }
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-soft);
  font-size: 12.5px;
  color: var(--text-1);
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.15s var(--ease-out);
}
.back-btn:hover { border-color: var(--border-strong); }
.wc-identity { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.wc-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.wc-meta-row { display: flex; flex-wrap: wrap; gap: 6px; }
.wc-meta-row .tag { display: inline-flex; align-items: center; gap: 4px; }

/* === Tabs === */
.wc-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-soft);
  width: fit-content;
  margin-bottom: 18px;
}
.wc-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 16px;
  border: none;
  border-radius: 9px;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.wc-tab:hover { color: var(--text-0); }
.wc-tab.active { background: var(--bg-hover); color: var(--text-0); }
.wc-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 10.5px;
  font-weight: 700;
}

/* === Panels === */
.wc-panel { display: flex; flex-direction: column; gap: 16px; max-width: 880px; }
.wc-analyze {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 28px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  text-align: left;
}
.wc-analyze-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--text-0); }
.wc-analyze-desc { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--text-2); max-width: 520px; }
.wc-analyze-error { margin: 0; font-size: 12px; color: var(--danger, #e5484d); }
.wc-empty {
  padding: 72px 24px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-3);
  text-align: center;
}

/* === Variants === */
.wc-variants-side { display: flex; flex-direction: column; gap: 14px; }
.wc-render-all { align-self: flex-start; }
.wc-engine { display: flex; flex-direction: column; gap: 6px; max-width: 360px; }
.wc-engine-label { font-size: 12px; font-weight: 600; color: var(--text-2); }
.wc-engine-hint { font-size: 11.5px; line-height: 1.5; color: var(--text-3); }
.wc-engine-warn { color: var(--warning, #d69e2e); }
.wc-variant-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}
.wc-none { margin: 0; font-size: 12.5px; color: var(--text-3); }

/* === Reference === */
.wc-ref { flex-direction: row; gap: 24px; }
.wc-ref-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.wc-transcript { resize: vertical; line-height: 1.7; }
.wc-ref-col .btn { align-self: flex-start; }
.wc-ref-video { width: 100%; max-width: 300px; aspect-ratio: 9 / 16; border-radius: 12px; background: var(--bg-2); object-fit: contain; }

@media (max-width: 860px) {
  .wc-page { padding: 16px 16px 32px; }
  .wc-topbar { flex-direction: column; align-items: stretch; }
  .wc-ref { flex-direction: column; }
}
</style>
