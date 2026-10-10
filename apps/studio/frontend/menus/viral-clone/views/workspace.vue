<template>
  <div class="wc-page page-enter">
    <!-- ===== Topbar ===== -->
    <header class="wc-topbar">
      <div class="wc-topbar-main">
        <button class="back-btn" type="button" :aria-label="t('viralClone.work.back')" @click="navigateTo('/viral-clone')">
          <ArrowLeft :size="15" :stroke-width="2.1" />
        </button>
        <div class="wc-identity">
          <p class="eyebrow">{{ t('viralClone.title') }}</p>
          <h1 class="wc-title truncate">{{ detail?.name || '…' }}</h1>
          <div class="wc-meta-row">
            <span v-if="detail" class="tag" :class="statusTagClass">
              <Loader2 v-if="projectBusy" :size="10" class="animate-spin" />
              {{ t(`viralClone.status.${detail.status}`) }}
            </span>
            <span v-if="detail" class="tag">{{ t(`viralClone.languages.${detail.language}`) }}</span>
            <span v-if="detail?.blueprint?.beats?.length" class="tag">{{ t('viralClone.list.beats', { n: detail.blueprint.beats.length }) }} · {{ totalSeconds }}s</span>
          </div>
        </div>
      </div>
      <div class="wc-topbar-actions">
        <!-- เอนจิน render ขั้นสุดท้าย (NAKA / Hypit) -->
        <div v-if="detail" class="wc-engine" :title="engineHint">
          <span class="wc-engine-label">{{ t('viralClone.variants.engineLabel') }}</span>
          <div class="seg wc-engine-seg" role="radiogroup" :aria-label="t('viralClone.variants.engineLabel')">
            <button
              type="button" role="radio" class="seg-item"
              :class="{ on: engine === 'naka' }" :aria-checked="engine === 'naka'"
              :disabled="savingEngine || anyVariantBusy"
              @click="changeEngine('naka')"
            >NAKA</button>
            <button
              type="button" role="radio" class="seg-item"
              :class="{ on: engine === 'hypit' }" :aria-checked="engine === 'hypit'"
              :disabled="savingEngine || anyVariantBusy || (hypit && !hypit.available && engine !== 'hypit')"
              @click="changeEngine('hypit')"
            >
              <span class="wc-dot" :class="hypit?.available ? 'ok' : 'off'" aria-hidden="true"></span>
              Hypit
            </button>
          </div>
        </div>
        <button class="btn btn-icon" type="button" :disabled="refreshing" :title="t('common.refresh')" :aria-label="t('common.refresh')" @click="refresh()">
          <RefreshCw :size="14" :stroke-width="2" :class="{ 'animate-spin': refreshing }" />
        </button>
      </div>
    </header>

    <div v-if="!detail && loadFailed" class="wc-empty">
      <p>{{ t('viralClone.work.loadFailed') }}</p>
    </div>

    <div v-else-if="detail" class="wc-body">
      <!-- ===== Stepper (ต้นแบบ → โครงคลิป → ตัวแปร → ผลลัพธ์) ===== -->
      <nav class="wc-steps" role="tablist" :aria-label="t('viralClone.work.tabsLabel')">
        <button
          v-for="(step, i) in STEPS" :key="step" type="button" role="tab"
          class="wc-step" :class="{ active: activeTab === step, done: stepDone(step) }"
          :aria-selected="activeTab === step"
          @click="activeTab = step"
        >
          <span class="wc-step-num">
            <Check v-if="stepDone(step) && activeTab !== step" :size="12" :stroke-width="2.6" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="wc-step-copy">
            <span class="wc-step-title">{{ t(`viralClone.steps.${step}`) }}</span>
            <span class="wc-step-sub">{{ stepSub(step) }}</span>
          </span>
        </button>
      </nav>

      <!-- ===== 1. Reference ===== -->
      <section v-if="activeTab === 'reference'" class="wc-panel wc-ref">
        <div class="wc-card wc-ref-video-card">
          <p class="wc-card-title">{{ t('viralClone.reference.videoTitle') }}</p>
          <video v-if="detail.referencePath" class="wc-ref-video" :src="detail.referencePath" controls preload="metadata" />
          <div v-else class="wc-ref-novideo">
            <Film :size="26" :stroke-width="1.4" />
            <span>{{ t('viralClone.reference.noVideo') }}</span>
          </div>
        </div>
        <div class="wc-card wc-ref-col">
          <p class="wc-card-title">{{ t('viralClone.reference.transcriptTitle') }}</p>
          <textarea v-model="transcriptDraft" class="input wc-transcript" rows="14" :lang="detail.language"></textarea>
          <div class="wc-ref-foot">
            <span class="wc-hint">{{ t('viralClone.reference.transcriptHint') }}</span>
            <button class="btn" type="button" :disabled="!transcriptDirty || savingRef" @click="saveReference">
              <Loader2 v-if="savingRef" :size="13" class="animate-spin" />
              {{ t('viralClone.reference.saveTranscript') }}
            </button>
            <button class="btn btn-primary" type="button" :disabled="analyzing || projectBusy || transcriptDirty" @click="analyzeAndGo">
              <Loader2 v-if="analyzing || projectBusy" :size="13" class="animate-spin" />
              <Sparkles v-else :size="13" :stroke-width="2" />
              {{ detail.blueprint ? t('viralClone.blueprint.reanalyze') : t('viralClone.blueprint.analyze') }}
            </button>
          </div>
        </div>
      </section>

      <!-- ===== 2. Blueprint ===== -->
      <section v-else-if="activeTab === 'blueprint'" class="wc-panel">
        <div v-if="!detail.blueprint" class="wc-analyze">
          <div class="wc-analyze-icon"><Sparkles :size="22" :stroke-width="1.6" /></div>
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
        <ViralCloneBlueprintEditor
          v-else
          :blueprint="detail.blueprint"
          :saving="savingBlueprint"
          :language="detail.language"
          @save="saveBlueprint"
        />
      </section>

      <!-- ===== 3. Variants ===== -->
      <section v-else-if="activeTab === 'variants'" class="wc-panel">
        <div v-if="!detail.blueprint" class="wc-analyze">
          <p class="wc-analyze-desc">{{ t('viralClone.variants.needBlueprint') }}</p>
        </div>
        <div v-else class="wc-variants">
          <div class="wc-card wc-matrix">
            <div class="wc-card-head">
              <div>
                <p class="wc-card-title">{{ t('viralClone.variants.matrixTitle') }}</p>
                <p class="wc-hint">{{ t('viralClone.variants.matrixHint') }}</p>
              </div>
            </div>
            <ViralCloneTimeline compact :beats="detail.blueprint.beats" :language="detail.language" />
            <ViralCloneMatrixBuilder
              :blueprint="detail.blueprint"
              :products="products"
              :avatars="avatars"
              :busy="creatingVariants"
              @create="createVariants"
            />
          </div>

          <div class="wc-queue">
            <div class="wc-queue-head">
              <p class="wc-card-title">{{ t('viralClone.variants.queueTitle') }}</p>
              <span class="wc-queue-stats">
                <span v-for="stat in variantStats" :key="stat.key" class="tag" :class="stat.cls">{{ stat.label }}</span>
              </span>
              <button
                v-if="variants.length"
                class="btn btn-primary btn-sm wc-render-all" type="button"
                :disabled="anyVariantBusy || renderingAll || !renderableCount"
                @click="renderAll"
              >
                <Loader2 v-if="renderingAll" :size="13" class="animate-spin" />
                <Clapperboard v-else :size="13" :stroke-width="2" />
                {{ t('viralClone.variants.renderAll') }}
              </button>
            </div>
            <p v-if="hypit && !hypit.available && engine === 'hypit'" class="wc-warn">
              <TriangleAlert :size="13" :stroke-width="2" />
              {{ t('viralClone.variants.engineHypitUnavailable', { reason: hypit.reason || '' }) }}
            </p>
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
            <div v-else class="wc-none-box">
              <Layers :size="22" :stroke-width="1.5" />
              <p>{{ t('viralClone.variants.noneYet') }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== 4. Results ===== -->
      <section v-else-if="activeTab === 'results'" class="wc-panel">
        <div v-if="completed.length" class="wc-results">
          <article v-for="v in completed" :key="v.id" class="wc-result">
            <video class="wc-result-video" :src="v.outputPath" controls preload="metadata" playsinline />
            <div class="wc-result-body">
              <p class="wc-result-label truncate" :title="v.label">{{ v.label }}</p>
              <div class="wc-result-foot">
                <span class="wc-hint mono">{{ v.durationSec ? `${Math.round(v.durationSec * 10) / 10}s` : '' }}</span>
                <a class="btn btn-ghost btn-sm" :href="v.outputPath" download>
                  <Download :size="12" :stroke-width="2" />
                  {{ t('viralClone.variants.download') }}
                </a>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="wc-none-box">
          <Clapperboard :size="22" :stroke-width="1.5" />
          <p>{{ t('viralClone.results.empty') }}</p>
          <button class="btn btn-sm" type="button" @click="activeTab = 'variants'">{{ t('viralClone.results.goVariants') }}</button>
        </div>
        <p class="wc-powered">{{ engine === 'hypit' ? t('viralClone.results.poweredHypit') : t('viralClone.results.poweredNaka') }}</p>
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
import { ArrowLeft, Check, Clapperboard, Download, Film, Layers, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { cloneAPI, studioAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { CLONE_POLL_INTERVAL_MS, beatsTotalSeconds, cloneErrorCodeOf, isCloneProjectBusy, isCloneVariantBusy } from '../utils/viralCloneFlow'

// ลำดับงานแบบ Hypit: ต้นแบบ → โครงคลิปที่ยึดกับคำพูด → ตัวแปร (matrix) → ผลลัพธ์
const STEPS = ['reference', 'blueprint', 'variants', 'results']

const { t, te } = useI18n()
const route = useRoute()
const projectId = Number(route.params.id)

const detail = ref(null)
const loadFailed = ref(false)
const refreshing = ref(false)
const activeTab = ref('blueprint')
const tabChosen = ref(false)

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
const completed = computed(() => variants.value.filter((v) => v.status === 'completed' && v.outputPath))
const renderableCount = computed(() => variants.value.filter((v) => v.status === 'draft' || v.status === 'failed').length)
const totalSeconds = computed(() => Math.round(beatsTotalSeconds(detail.value?.blueprint) * 10) / 10)
const engine = computed(() => detail.value?.renderEngine || 'naka')
const engineHint = computed(() => (engine.value === 'hypit' ? t('viralClone.variants.engineHypitHint') : t('viralClone.variants.engineNakaHint')))

const variantStats = computed(() => {
  const count = (pred) => variants.value.filter(pred).length
  const out = [{ key: 'all', cls: '', label: t('viralClone.variants.statAll', { n: variants.value.length }) }]
  const busy = count((v) => isCloneVariantBusy(v.status))
  const done = count((v) => v.status === 'completed')
  const failed = count((v) => v.status === 'failed')
  if (busy) out.push({ key: 'busy', cls: 'tag-info', label: t('viralClone.variants.statBusy', { n: busy }) })
  if (done) out.push({ key: 'done', cls: 'tag-success', label: t('viralClone.variants.statDone', { n: done }) })
  if (failed) out.push({ key: 'failed', cls: 'tag-error', label: t('viralClone.variants.statFailed', { n: failed }) })
  return out
})

function stepDone(step) {
  const d = detail.value
  if (!d) return false
  if (step === 'reference') return !!d.transcript
  if (step === 'blueprint') return !!d.blueprint
  if (step === 'variants') return variants.value.length > 0
  return completed.value.length > 0
}
function stepSub(step) {
  const d = detail.value
  if (!d) return ''
  if (step === 'reference') return d.referencePath ? t('viralClone.steps.referenceSubVideo') : t('viralClone.steps.referenceSub')
  if (step === 'blueprint') return d.blueprint ? t('viralClone.steps.blueprintSub', { n: d.blueprint.beats?.length || 0, s: totalSeconds.value }) : t(`viralClone.status.${d.status}`)
  if (step === 'variants') return t('viralClone.steps.variantsSub', { n: variants.value.length })
  return t('viralClone.steps.resultsSub', { n: completed.value.length })
}

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
    // เปิดหน้าครั้งแรก: ยังไม่มี Blueprint → เริ่มที่ต้นแบบ, มีตัวแปรเสร็จแล้ว → ตัวแปร
    if (!tabChosen.value && detail.value) {
      tabChosen.value = true
      activeTab.value = !detail.value.blueprint ? 'reference' : (detail.value.variants?.length ? 'variants' : 'blueprint')
    }
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

async function analyzeAndGo() {
  await analyze()
  activeTab.value = 'blueprint'
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
  padding: 22px 36px 40px;
  overflow-y: auto;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* === Topbar === */
.wc-topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.wc-topbar-main { display: flex; align-items: center; gap: 14px; min-width: 0; }
.back-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 12px;
  background: var(--surface-soft); color: var(--text-1); cursor: pointer;
  transition: border-color 0.15s var(--ease-out), background 0.15s var(--ease-out);
}
.back-btn:hover { border-color: var(--border-strong); background: var(--bg-hover); }
.wc-identity { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wc-identity .eyebrow { margin: 0; }
.wc-title { margin: 0; font-family: var(--font-display); font-size: 21px; font-weight: 800; letter-spacing: -0.01em; color: var(--text-0); }
.wc-meta-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.wc-meta-row .tag { display: inline-flex; align-items: center; gap: 4px; }
.wc-topbar-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.wc-engine { display: flex; align-items: center; gap: 8px; }
.wc-engine-label { font-size: 11.5px; font-weight: 600; color: var(--text-3); white-space: nowrap; }
.wc-engine-seg .seg-item { display: inline-flex; align-items: center; gap: 6px; padding-inline: 14px; }
.wc-engine-seg .seg-item:disabled { opacity: 0.45; cursor: not-allowed; }
.wc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
.wc-dot.ok { background: var(--success); box-shadow: 0 0 0 3px var(--success-bg); }
.wc-dot.off { background: var(--warning); }

/* === Stepper === */
.wc-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  margin-bottom: 18px;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface-soft);
}
.wc-step {
  display: flex; align-items: center; gap: 10px;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: background 0.15s var(--ease-out), border-color 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.wc-step:hover { background: var(--bg-hover); color: var(--text-0); }
.wc-step.active { background: var(--surface-raised); border-color: var(--border); color: var(--text-0); box-shadow: var(--shadow-xs); }
.wc-step:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.wc-step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  border-radius: 50%;
  background: var(--bg-2);
  font-size: 12px; font-weight: 800; color: var(--text-2);
}
.wc-step.done .wc-step-num { background: var(--success-bg); color: var(--success); }
.wc-step.active .wc-step-num { background: var(--accent-gradient); color: var(--on-accent); }
.wc-step-copy { display: flex; flex-direction: column; min-width: 0; }
.wc-step-title { font-size: 13px; font-weight: 700; line-height: 1.3; }
.wc-step-sub { font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* === Common === */
.wc-panel { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.wc-card {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  min-width: 0;
}
.wc-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.wc-card-title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-0); }
.wc-hint { margin: 2px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--text-3); }
.wc-analyze {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 44px 28px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  text-align: center;
}
.wc-analyze-icon {
  display: flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: 16px;
  background: var(--accent-bg); color: var(--accent-text);
}
.wc-analyze-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--text-0); }
.wc-analyze-desc { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--text-2); max-width: 520px; }
.wc-analyze-error { margin: 0; font-size: 12px; color: var(--error); }
.wc-empty { padding: 72px 24px; border: 1px dashed var(--border); border-radius: var(--radius-lg); color: var(--text-3); text-align: center; }
.wc-none-box {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 40px 20px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-3);
  text-align: center;
}
.wc-none-box p { margin: 0; font-size: 12.5px; }

/* === Reference === */
.wc-ref { display: grid; grid-template-columns: 280px minmax(0, 1fr); align-items: start; }
.wc-ref-video { width: 100%; aspect-ratio: 9 / 16; border-radius: 14px; background: #000; object-fit: contain; }
.wc-ref-novideo {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  aspect-ratio: 9 / 16; border: 1px dashed var(--border); border-radius: 14px;
  color: var(--text-3); font-size: 12px; text-align: center; padding: 16px;
}
.wc-ref-col { gap: 10px; }
.wc-transcript { resize: vertical; line-height: 1.75; font-size: 14px; }
.wc-ref-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wc-ref-foot .wc-hint { margin: 0 auto 0 0; }

/* === Variants === */
.wc-variants { display: grid; grid-template-columns: minmax(300px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
.wc-matrix { position: sticky; top: 0; }
.wc-queue { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.wc-queue-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wc-queue-stats { display: flex; gap: 6px; flex-wrap: wrap; }
.wc-render-all { margin-left: auto; }
.wc-warn {
  display: flex; align-items: center; gap: 8px; margin: 0;
  padding: 9px 12px; border: 1px solid var(--warn-border, var(--warning)); border-radius: 10px;
  background: var(--warning-bg); color: var(--tag-warning-text, var(--warning)); font-size: 12px;
}
.wc-variant-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }

/* === Results === */
.wc-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
.wc-result {
  display: flex; flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  overflow: hidden;
}
.wc-result-video { width: 100%; aspect-ratio: 9 / 16; background: #000; object-fit: contain; display: block; }
.wc-result-body { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px; }
.wc-result-label { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--text-0); }
.wc-result-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.wc-result-foot .wc-hint { margin: 0; }
.wc-powered { margin: 4px 0 0; font-size: 11px; color: var(--text-3); text-align: right; }

@media (max-width: 1100px) {
  .wc-variants { grid-template-columns: minmax(0, 1fr); }
  .wc-matrix { position: static; }
}
@media (max-width: 860px) {
  .wc-page { padding: 16px 16px 32px; }
  .wc-topbar { flex-direction: column; align-items: stretch; }
  .wc-topbar-actions { justify-content: space-between; }
  .wc-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wc-ref { grid-template-columns: minmax(0, 1fr); }
  .wc-ref-video-card { width: 100%; max-width: 300px; justify-self: center; } /* 9:16 stays a phone-sized card, centred instead of hugging the left */
}
</style>
