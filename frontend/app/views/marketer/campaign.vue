<template>
  <div v-if="detail" class="studio">
    <!-- ===== Topbar ===== -->
    <header class="mk-topbar">
      <div class="mk-topbar-main">
        <button class="back-btn" type="button" @click="navigateTo('/marketer')">
          <ArrowLeft :size="15" :stroke-width="2.1" />
          {{ t('marketer.work.back') }}
        </button>
        <div class="mk-identity">
          <h1 class="mk-c-title truncate">{{ detail.title }}</h1>
          <div class="mk-meta-row">
            <span class="tag mk-status-tag" :class="statusTagClass">
              <Loader2 v-if="busy" :size="10" class="animate-spin" />
              {{ t(`marketer.status.${detail.status}`) }}
            </span>
            <span v-if="detail.productName && detail.productName !== detail.title" class="mk-stage-inline truncate">{{ detail.productName }}</span>
          </div>
        </div>
      </div>
      <div class="mk-topbar-side">
        <NuxtLink v-if="detail.dramaId" :to="`/drama/${detail.dramaId}`" class="btn">
          <Clapperboard :size="13" :stroke-width="1.9" />
          {{ t('marketer.work.openDrama') }}
        </NuxtLink>
        <button class="btn" type="button" :disabled="refreshing" @click="refresh()">
          <RefreshCw :size="12" :stroke-width="2" :class="{ 'animate-spin': refreshing }" />
          {{ t('common.refresh') }}
        </button>
      </div>
    </header>

    <div class="studio-body">
      <!-- ===== LEFT SIDEBAR : step pipeline ===== -->
      <aside class="mk-sidebar">
        <nav class="mk-stages" :aria-label="t('marketer.work.steps')">
          <button
            v-for="(s, i) in steps"
            :key="s.id"
            type="button"
            :class="['mk-stage', { active: step === s.id, done: s.done }]"
            :aria-current="step === s.id ? 'step' : undefined"
            @click="goStep(s.id)"
          >
            <span class="mk-stage-state">
              <Loader2 v-if="busyStep(detail.status) === s.id" :size="11" class="animate-spin" />
              <Check v-else-if="s.done" :size="10" :stroke-width="2.6" />
              <span v-else class="mk-stage-num">{{ i + 1 }}</span>
            </span>
            <span class="mk-stage-copy">
              <span class="mk-stage-label">{{ s.label }}</span>
              <span class="mk-stage-sub">{{ s.sub }}</span>
            </span>
          </button>
        </nav>

        <div class="mk-rail">
          <div class="mk-rail-head">
            <span class="mk-rail-title">{{ steps[stepIdx]?.label }}</span>
            <span class="mk-rail-count">{{ stepIdx + 1 }}/{{ steps.length }}</span>
          </div>
          <div class="mk-rail-track">
            <button
              v-for="(s, i) in steps"
              :key="s.id"
              type="button"
              :class="['mk-rail-seg', { done: s.done, current: i === stepIdx }]"
              :title="s.label"
              :aria-label="s.label"
              @click="goStep(s.id)"
            ><span class="mk-rail-fill" /></button>
          </div>
        </div>
      </aside>

      <!-- ===== MAIN ===== -->
      <main class="mk-main">
        <!-- 失败横幅：契约只给 errorMsg，重试目标按 lastAction / 已有产物推断 -->
        <div v-if="detail.status === 'failed'" class="mk-alert" role="alert">
          <CircleAlert :size="16" :stroke-width="1.9" />
          <div class="mk-alert-copy">
            <strong>{{ t('marketer.work.failedTitle') }}</strong>
            <span>{{ failedText }}</span>
          </div>
          <button class="btn btn-sm" type="button" :disabled="starting" @click="retry">
            <RotateCcw :size="12" :stroke-width="2" />
            {{ t('marketer.work.retry', { step: t(`marketer.steps.${retryStep}`) }) }}
          </button>
        </div>

        <!-- 进行中横幅：任一步骤在跑时全局可见 -->
        <div v-if="busy" class="job-running" role="status">
          <Loader2 :size="16" class="animate-spin" />
          <span>{{ t(`marketer.job.running.${busyStep(detail.status)}`) }}</span>
          <button v-if="step !== busyStep(detail.status)" class="btn btn-sm" type="button" @click="goStep(busyStep(detail.status))">
            {{ t('marketer.job.view') }}
          </button>
        </div>

        <!-- ========== 1 BRIEF ========== -->
        <section v-if="step === 'brief'" class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('marketer.brief.title') }}</h2>
            <p class="panel-desc">{{ t('marketer.brief.desc') }}</p>
          </div>

          <MarketerBriefForm v-model="brief" :style-presets="stylePresets" :ratio-locked="!!detail.dramaId" />

          <label class="field mk-budget">
            <span class="field-label">{{ t('marketer.brief.budget') }}</span>
            <input v-model="brief.budgetThb" class="input" type="number" min="0" max="100000000" step="100" inputmode="decimal" :placeholder="t('marketer.brief.budgetPlaceholder')" />
            <span class="field-hint">{{ t('marketer.brief.budgetHint') }}</span>
          </label>

          <div class="stage-next split">
            <span class="mk-hint">{{ briefDirty ? t('marketer.brief.unsaved') : '' }}</span>
            <div class="mk-actions">
              <button class="btn" type="button" :disabled="saving || !briefDirty || !briefValid" @click="saveBrief()">
                <Loader2 v-if="saving" :size="13" class="animate-spin" />
                {{ t('common.save') }}
              </button>
              <button class="btn btn-primary" type="button" :disabled="saving || !briefValid" @click="briefNext">
                {{ t('marketer.brief.next') }}
                <ArrowRight :size="13" :stroke-width="2" />
              </button>
            </div>
          </div>
        </section>

        <!-- ========== 2 VISUALS (Phase 3 — optional，不阻塞其它步骤) ========== -->
        <section v-else-if="step === 'visuals'" class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('marketer.visuals.title') }}</h2>
            <p class="panel-desc">{{ t('marketer.visuals.desc') }}</p>
          </div>

          <template v-if="detail.productImages.length">
            <div class="mk-vis-gen">
              <span class="gen-label">{{ t('marketer.visuals.source') }}</span>
              <div class="mk-vis-src-grid" role="radiogroup" :aria-label="t('marketer.visuals.source')">
                <button
                  v-for="img in detail.productImages"
                  :key="img"
                  type="button"
                  role="radio"
                  :aria-checked="visSource === img"
                  :class="['mk-vis-src', { on: visSource === img }]"
                  @click="visSource = img"
                >
                  <img :src="img" :alt="t('marketer.visuals.source')" loading="lazy" />
                </button>
              </div>

              <span class="gen-label">{{ t('marketer.visuals.kind') }}</span>
              <div class="gen-chips">
                <button
                  v-for="k in VISUAL_KINDS"
                  :key="k"
                  type="button"
                  :class="['filter-chip', { on: visKind === k }]"
                  :aria-pressed="visKind === k"
                  @click="visKind = k"
                >{{ t(`marketer.visualKinds.${k}`) }}</button>
              </div>

              <div class="mk-vis-row">
                <label class="gen-count">
                  <span>{{ t('marketer.visuals.count') }}</span>
                  <input v-model.number="visCount" class="input" type="number" :min="VISUAL_COUNT_MIN" :max="VISUAL_COUNT_MAX" step="1" @blur="clampVisualCount()" />
                </label>
                <label class="field mk-vis-instruction">
                  <span class="field-label">{{ t('marketer.visuals.instruction') }}</span>
                  <input v-model="visInstruction" class="input" :placeholder="t(`marketer.visuals.instructionPlaceholder.${visKind}`)" />
                </label>
              </div>

              <div class="mk-run-row">
                <button class="btn btn-primary" type="button" :disabled="!visSource || generatingVisuals" @click="generateVisuals">
                  <Loader2 v-if="generatingVisuals" :size="13" class="animate-spin" />
                  <ImagePlus v-else :size="13" :stroke-width="2" />
                  {{ t('marketer.visuals.generate') }}
                </button>
                <span v-if="!visSource" class="empty-guard">{{ t('marketer.visuals.needSource') }}</span>
              </div>
              <p class="field-hint">{{ t('marketer.visuals.note') }}</p>
              <p class="field-hint">{{ t('marketer.visuals.costNote') }}</p>
            </div>

            <div v-if="visuals.length" class="mk-vis-grid">
              <MarketerVisualCard
                v-for="v in visuals"
                :key="v.id"
                :campaign-id="campaignId"
                :visual="v"
                @updated="onVisualUpdated"
                @promoted="onVisualPromoted"
                @deleted="onVisualDeleted"
                @retry="retryVisual"
              />
            </div>
            <p v-else class="mk-vis-empty">{{ t('marketer.visuals.empty') }}</p>
          </template>
          <div v-else class="step-empty compact">
            <p class="empty-note">{{ t('marketer.visuals.needBrief') }}</p>
            <button class="btn" type="button" @click="goStep('brief')">{{ t('marketer.visuals.toBrief') }}</button>
          </div>

          <div class="stage-next">
            <button class="btn btn-primary" type="button" @click="goStep('research')">
              {{ t('marketer.visuals.next') }}
              <ArrowRight :size="13" :stroke-width="2" />
            </button>
          </div>
        </section>

        <!-- ========== 3 RESEARCH ========== -->
        <section v-else-if="step === 'research'" class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('marketer.research.title') }}</h2>
            <p class="panel-desc">{{ t('marketer.research.desc') }}</p>
          </div>

          <label class="field">
            <span class="field-label">{{ t('marketer.research.notes') }}</span>
            <textarea v-model="researchNotes" class="textarea mk-notes" rows="5" :disabled="busy" :placeholder="t('marketer.research.notesPlaceholder')" />
            <span class="field-hint">{{ t('marketer.research.notesHint') }}</span>
          </label>
          <div class="mk-run-row">
            <button class="btn btn-primary" type="button" :disabled="busy || starting" @click="runResearch">
              <Loader2 v-if="starting || detail.status === 'researching'" :size="13" class="animate-spin" />
              <Sparkles v-else :size="13" :stroke-width="2" />
              {{ hasResearch ? t('marketer.research.rerun') : t('marketer.research.run') }}
            </button>
            <span v-if="hasResearch" class="mk-hint">{{ t('marketer.research.rerunHint') }}</span>
          </div>

          <div class="mk-doc-stack">
            <MarketerDocCard
              v-for="kind in RESEARCH_DOC_KINDS"
              :key="kind"
              :campaign-id="campaignId"
              :kind="kind"
              :doc="docMap[kind] || null"
              :disabled="busy"
              :empty-text="t('marketer.research.empty')"
              @updated="onDocUpdated"
            />
          </div>

          <div class="stage-next">
            <button class="btn btn-primary" type="button" :disabled="!hasResearch" @click="goStep('strategy')">
              {{ t('marketer.research.next') }}
              <ArrowRight :size="13" :stroke-width="2" />
            </button>
          </div>
        </section>

        <!-- ========== 4 STRATEGY (4 docs) ========== -->
        <section v-else-if="step === 'strategy'" class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('marketer.strategy.title') }}</h2>
            <p class="panel-desc">{{ t('marketer.strategy.desc') }}</p>
          </div>

          <div class="mk-run-row">
            <button class="btn btn-primary" type="button" :disabled="busy || starting || !hasResearch" @click="runStrategy">
              <Loader2 v-if="starting || detail.status === 'strategizing'" :size="13" class="animate-spin" />
              <Sparkles v-else :size="13" :stroke-width="2" />
              {{ hasStrategyAny ? t('marketer.strategy.rerun') : t('marketer.strategy.run') }}
            </button>
            <span v-if="!hasResearch" class="empty-guard">{{ t('marketer.strategy.needResearch') }}</span>
            <span v-else-if="hasStrategyAny" class="mk-hint">{{ t('marketer.strategy.rerunHint') }}</span>
          </div>

          <div class="doc-tabs" role="tablist" :aria-label="t('marketer.strategy.title')">
            <button
              v-for="kind in STRATEGY_DOC_KINDS"
              :key="kind"
              type="button"
              role="tab"
              :aria-selected="docTab === kind"
              :class="['doc-tab', { on: docTab === kind }]"
              @click="docTab = kind"
            >
              <span class="doc-tab-dot" :class="docMap[kind]?.status === 'approved' ? 'approved' : (docMap[kind] ? 'draft' : '')" />
              {{ t(`marketer.docKinds.${kind}`) }}
            </button>
          </div>
          <MarketerDocCard
            :campaign-id="campaignId"
            :kind="docTab"
            :doc="docMap[docTab] || null"
            :disabled="busy"
            :empty-text="t('marketer.strategy.empty')"
            @updated="onDocUpdated"
          />

          <div class="stage-next split">
            <span class="mk-hint">{{ t('marketer.strategy.approvedCount', { n: approvedStrategyCount, total: STRATEGY_DOC_KINDS.length }) }}</span>
            <button class="btn btn-primary" type="button" :disabled="!hasContentBrief" @click="goStep('creatives')">
              {{ t('marketer.strategy.next') }}
              <ArrowRight :size="13" :stroke-width="2" />
            </button>
          </div>
        </section>

        <!-- ========== 5 CREATIVES ========== -->
        <section v-else-if="step === 'creatives'" class="panel panel-wide">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('marketer.creatives.title') }}</h2>
            <p class="panel-desc">{{ t('marketer.creatives.desc') }}</p>
          </div>

          <!-- Phase 3: Recreate Viral Ad — 参考广告结构，重写给自己的产品 -->
          <MarketerReferencePanel
            :campaign-id="campaignId"
            :references="references"
            :disabled="busy"
            @updated="onReferenceUpdated"
            @refresh="refreshQuiet"
            @generate="presetReference"
          />

          <div class="gen-box">
            <div v-if="genReference" class="gen-ref-row">
              <span class="tag tag-info gen-ref-chip">
                <Wand2 :size="10" :stroke-width="2" />
                {{ t('marketer.creatives.presetReference', { title: genReference.title }) }}
                <button type="button" class="gen-ref-clear" :aria-label="t('common.cancel')" @click="clearPresetReference">
                  <X :size="11" :stroke-width="2" />
                </button>
              </span>
            </div>
            <div class="gen-row">
              <span class="gen-label">{{ t('marketer.creatives.formats') }}</span>
              <div class="gen-chips">
                <button
                  v-for="f in CREATIVE_FORMATS"
                  :key="f"
                  type="button"
                  :class="['filter-chip', { on: genFormats.includes(f) }]"
                  :aria-pressed="genFormats.includes(f)"
                  @click="toggle(genFormats, f)"
                >{{ t(`marketer.formats.${f}`) }}</button>
              </div>
            </div>
            <div class="gen-row">
              <span class="gen-label">{{ t('marketer.creatives.platforms') }}</span>
              <div class="gen-chips">
                <button
                  v-for="p in PLATFORMS"
                  :key="p"
                  type="button"
                  :class="['filter-chip', { on: genPlatforms.includes(p) }]"
                  :aria-pressed="genPlatforms.includes(p)"
                  @click="toggle(genPlatforms, p)"
                >{{ t(`marketer.platforms.${p}`) }}</button>
              </div>
            </div>
            <p class="field-hint">{{ t('marketer.creatives.anyHint') }}</p>
            <div class="gen-controls">
              <label class="gen-count">
                <span>{{ t('marketer.creatives.count') }}</span>
                <input v-model.number="genCount" class="input" type="number" min="1" max="10" step="1" @blur="genCount = clampCount(genCount)" />
              </label>
              <div class="mk-actions">
            <button
              v-if="creatives.length && !genReference"
              class="btn"
              type="button"
              :disabled="busy || starting || !hasContentBrief"
              :title="t('marketer.creatives.replaceHint')"
              @click="runCreatives('replace')"
            >
              <RotateCcw :size="13" :stroke-width="2" />
              {{ t('marketer.creatives.regenerate') }}
            </button>
            <button class="btn btn-primary" type="button" :disabled="busy || starting || !hasContentBrief" @click="runCreatives(creatives.length && !genReference ? 'append' : 'replace')">
                  <Loader2 v-if="starting || detail.status === 'writing'" :size="13" class="animate-spin" />
                  <Sparkles v-else :size="13" :stroke-width="2" />
                  {{ creatives.length ? t('marketer.creatives.generateMore') : t('marketer.creatives.generate') }}
                </button>
              </div>
            </div>
            <p v-if="!hasContentBrief" class="empty-guard">{{ t('marketer.creatives.needStrategy') }}</p>
          </div>

          <div v-if="creatives.length" class="creative-grid">
            <MarketerCreativeCard
              v-for="cr in creatives"
              :key="cr.id"
              :campaign-id="campaignId"
              :creative="cr"
              :drama-id="detail.dramaId"
              :disabled="busy"
              @updated="onCreativeUpdated"
              @delete="toDeleteCreative = $event"
            />
          </div>
          <div v-else class="step-empty">
            <Megaphone :size="24" :stroke-width="1.5" />
            <p class="empty-note">{{ t('marketer.creatives.empty') }}</p>
          </div>

          <div class="stage-next split">
            <span class="mk-hint">{{ t('marketer.creatives.approvedCount', { n: approvedCreatives.length }) }}</span>
            <button class="btn btn-primary" type="button" :disabled="!approvedCreatives.length && !inProduction.length" @click="goStep('production')">
              {{ t('marketer.creatives.next') }}
              <ArrowRight :size="13" :stroke-width="2" />
            </button>
          </div>
        </section>

        <!-- ========== 6 PRODUCTION ========== -->
        <section v-else class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('marketer.production.title') }}</h2>
            <p class="panel-desc">{{ t('marketer.production.desc') }}</p>
          </div>

          <h3 class="mk-subhead">{{ t('marketer.production.ready', { n: approvedCreatives.length }) }}</h3>
          <div v-if="approvedCreatives.length" class="prod-list">
            <div v-for="cr in approvedCreatives" :key="cr.id" class="prod-row">
              <div class="prod-copy">
                <div class="prod-tags">
                  <span class="tag tag-accent">{{ t(`marketer.formats.${cr.format}`) }}</span>
                  <span class="tag">{{ t(`marketer.platforms.${cr.platform}`) }}</span>
                  <span class="tag mono">{{ t('marketer.creatives.duration', { n: cr.durationSec }) }}</span>
                </div>
                <p class="prod-hook">{{ cr.hook }}</p>
              </div>
              <button class="btn btn-primary" type="button" :disabled="producingId !== null || busy" @click="produce(cr)">
                <Loader2 v-if="producingId === cr.id" :size="13" class="animate-spin" />
                <Film v-else :size="13" :stroke-width="2" />
                {{ t('marketer.production.produce') }}
              </button>
            </div>
          </div>
          <div v-else class="step-empty compact">
            <p class="empty-note">{{ t('marketer.production.noneApproved') }}</p>
            <button class="btn" type="button" @click="goStep('creatives')">{{ t('marketer.production.toCreatives') }}</button>
          </div>

          <template v-if="inProduction.length">
            <h3 class="mk-subhead">{{ t('marketer.production.inProduction', { n: inProduction.length }) }}</h3>
            <div class="prod-list">
              <div v-for="cr in inProduction" :key="cr.id" class="prod-row">
                <div class="prod-copy">
                  <div class="prod-tags">
                    <span class="tag tag-info">{{ t('marketer.creativeStatus.in_production') }}</span>
                    <span class="tag">{{ t(`marketer.platforms.${cr.platform}`) }}</span>
                  </div>
                  <p class="prod-hook">{{ cr.hook }}</p>
                </div>
                <NuxtLink v-if="detail.dramaId && cr.episodeNumber" :to="`/drama/${detail.dramaId}/episode/${cr.episodeNumber}`" class="btn">
                  <ExternalLink :size="13" :stroke-width="2" />
                  {{ t('marketer.production.openEpisode', { n: cr.episodeNumber }) }}
                </NuxtLink>
              </div>
            </div>
          </template>

          <div class="mk-export">
            <div>
              <p class="mk-export-title">{{ t('marketer.production.exportTitle') }}</p>
              <p class="field-hint">{{ t('marketer.production.exportHint') }}</p>
            </div>
            <button class="btn" type="button" :disabled="!detail.docs.length && !creatives.length" @click="copyPlan">
              <Copy :size="13" :stroke-width="2" />
              {{ t('marketer.production.copyPlan') }}
            </button>
          </div>
        </section>
      </main>
    </div>

    <ConfirmDialog
      :open="!!toDeleteCreative"
      :title="t('marketer.creatives.deleteTitle')"
      :message="t('marketer.creatives.deleteMessage', { hook: toDeleteCreative?.hook || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="creativeDeleting"
      @confirm="removeCreative"
      @cancel="toDeleteCreative = null"
    />
  </div>

  <!-- Campaign not found / still loading -->
  <div v-else class="studio mk-loading">
    <div v-if="loadFailed" class="step-empty">
      <CircleAlert :size="24" :stroke-width="1.5" />
      <p class="empty-note">{{ t('marketer.work.notFound') }}</p>
      <button class="btn" type="button" @click="navigateTo('/marketer')">{{ t('marketer.work.backToList') }}</button>
    </div>
    <Loader2 v-else :size="22" class="animate-spin" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import {
  ArrowLeft, ArrowRight, Check, CircleAlert, Clapperboard, Copy, ExternalLink, Film,
  ImagePlus, Loader2, Megaphone, RefreshCw, RotateCcw, Sparkles, Wand2, X,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import {
  marketerAPI, stylePresetAPI,
  type AdReference, type Campaign, type CampaignDetail, type CampaignDoc, type CampaignVisual,
  type Creative, type CreativeFormat, type Platform, type VisualKind,
} from '~/composables/useApi'
import { mapError, toastError } from '~/composables/useToast'
import {
  MARKETER_STEPS, RESEARCH_DOC_KINDS, STRATEGY_DOC_KINDS, PLATFORMS, CREATIVE_FORMATS, POLL_INTERVAL_MS,
  VISUALS_STEP, VISUAL_KINDS, VISUAL_POLL_INTERVAL_MS, VISUAL_COUNT_MIN, VISUAL_COUNT_MAX,
  isBusyStatus, busyStep, latestDocs, hasDocs, stepDone, suggestedStep, retryTarget, errorCodeOf, clampCount,
} from '~/utils/marketerFlow'

type StepId = 'brief' | typeof VISUALS_STEP | 'research' | 'strategy' | 'creatives' | 'production'
type JobStep = 'research' | 'strategy' | 'creatives'

const { t, te } = useI18n()
const route = useRoute()
const campaignId = Number(route.params.id)

// ===== data =====
const detail = ref<CampaignDetail | null>(null)
const loadFailed = ref(false)
const refreshing = ref(false)
const stylePresets = ref<any[]>([])

const busy = computed(() => isBusyStatus(detail.value?.status))
const docMap = computed<Record<string, CampaignDoc>>(() => latestDocs(detail.value?.docs))
const creatives = computed<Creative[]>(() => detail.value?.creatives || [])
const approvedCreatives = computed(() => creatives.value.filter(c => c.status === 'approved'))
const inProduction = computed(() => creatives.value.filter(c => c.status === 'in_production'))
const hasResearch = computed(() => hasDocs(detail.value?.docs, ['market_research']))
const hasContentBrief = computed(() => hasDocs(detail.value?.docs, ['content_brief']))
const hasStrategyAny = computed(() => STRATEGY_DOC_KINDS.some(k => !!docMap.value[k]))
const approvedStrategyCount = computed(() => STRATEGY_DOC_KINDS.filter(k => docMap.value[k]?.status === 'approved').length)

// ===== Phase 3 — references & visuals =====
const references = computed<AdReference[]>(() => detail.value?.references || [])
const visuals = computed<CampaignVisual[]>(() => detail.value?.visuals || [])
const referenceTitleMap = computed<Record<number, string>>(() =>
  Object.fromEntries(references.value.map(r => [r.id, r.title])))
const hasProcessingVisual = computed(() => visuals.value.some(v => v.status === 'processing'))

function onReferenceUpdated(refDoc: AdReference) {
  if (!detail.value || !refDoc) return
  detail.value = { ...detail.value, references: detail.value.references.map(r => r.id === refDoc.id ? refDoc : r) }
}

function refreshQuiet() {
  return refresh(true)
}

// ===== steps =====
const step = ref<StepId>('brief')
const steps = computed(() => MARKETER_STEPS.map((id: StepId) => ({
  id,
  label: t(`marketer.steps.${id}`),
  sub: t(`marketer.steps.${id}Sub`),
  done: stepDone(id, detail.value),
})))
const stepIdx = computed(() => Math.max(0, MARKETER_STEPS.indexOf(step.value)))
function goStep(id: StepId | null) {
  if (id) step.value = id
}

const statusTagClass = computed(() => {
  const s = detail.value?.status
  if (s === 'failed') return 'tag-error'
  if (busy.value) return 'tag-info'
  if (s === 'creatives_ready') return 'tag-success'
  if (s === 'draft') return ''
  return 'tag-accent'
})

// ===== brief form（字段同 Campaign，budgetThb 在表单里用字符串承载） =====
function briefFrom(c: Campaign) {
  return {
    title: c.title || '',
    productUrl: c.productUrl || '',
    productName: c.productName || '',
    productDescription: c.productDescription || '',
    productImages: [...(c.productImages || [])],
    brandNotes: c.brandNotes || '',
    market: c.market || 'TH',
    platforms: [...(c.platforms || [])] as string[],
    audience: c.audience || '',
    goal: c.goal || '',
    style: c.style || '',
    aspectRatio: c.aspectRatio || '9:16',
    budgetThb: c.budgetThb == null ? '' : String(c.budgetThb),
  }
}
const brief = ref(briefFrom({} as Campaign))
const briefSnapshot = ref('')
const briefDirty = computed(() => JSON.stringify(brief.value) !== briefSnapshot.value)
const briefValid = computed(() => !!brief.value.productName.trim())
const saving = ref(false)

function resetBrief(c: Campaign) {
  brief.value = briefFrom(c)
  briefSnapshot.value = JSON.stringify(brief.value)
}

function briefPayload(): Partial<Campaign> {
  const b = brief.value
  const budgetRaw = String(b.budgetThb ?? '').trim()
  return {
    title: b.title.trim() || b.productName.trim(),
    productUrl: b.productUrl.trim() || null,
    productName: b.productName.trim(),
    productDescription: b.productDescription.trim() || null,
    productImages: b.productImages,
    brandNotes: b.brandNotes.trim() || null,
    market: b.market,
    platforms: b.platforms as Platform[],
    audience: b.audience.trim() || null,
    goal: b.goal.trim() || null,
    ...(b.style ? { style: b.style } : {}),
    ...(detail.value?.dramaId ? {} : { aspectRatio: b.aspectRatio as Campaign['aspectRatio'] }),
    budgetThb: budgetRaw === '' ? null : Number(budgetRaw),
  }
}

async function saveBrief(silent = false): Promise<boolean> {
  if (!detail.value || saving.value) return false
  saving.value = true
  try {
    const updated = await marketerAPI.update(campaignId, briefPayload())
    detail.value = { ...detail.value, ...updated }
    resetBrief(updated)
    if (!silent) toast.success(t('marketer.brief.saved'))
    return true
  } catch (e) {
    toastError(e)
    return false
  } finally {
    saving.value = false
  }
}

async function briefNext() {
  if (briefDirty.value && !(await saveBrief(true))) return
  goStep('visuals')
}

// ===== async jobs（202 受理后轮询 GET /campaigns/:id，直到 status 不再以 -ing 结尾） =====
const researchNotes = ref('')
const starting = ref(false)
const lastAction = ref<JobStep | null>(null)

async function startJob(kind: JobStep, call: () => Promise<{ status: Campaign['status'] }>) {
  if (!detail.value || starting.value || busy.value) return
  // Brief 未保存的修改先落库，避免 agent 读到旧信息
  if (briefDirty.value && briefValid.value && !(await saveBrief(true))) return
  starting.value = true
  try {
    const res = await call()
    lastAction.value = kind
    detail.value = { ...detail.value, status: res?.status || detail.value.status, errorMsg: null }
    schedulePoll()
  } catch (e) {
    toastError(e)
  } finally {
    starting.value = false
  }
}

function runResearch() {
  return startJob('research', () => marketerAPI.research(campaignId, researchNotes.value.trim() || undefined))
}
function runStrategy() {
  return startJob('strategy', () => marketerAPI.strategy(campaignId))
}

const genCount = ref(3)
const genFormats = ref<CreativeFormat[]>([])
const genPlatforms = ref<Platform[]>([])
function toggle<T>(list: T[], v: T) {
  const i = list.indexOf(v)
  if (i >= 0) list.splice(i, 1)
  else list.push(v)
}
function runCreatives(mode: 'replace' | 'append') {
  genCount.value = clampCount(genCount.value)
  const referenceId = genReference.value?.id
  return startJob('creatives', () => marketerAPI.generateCreatives(campaignId, {
    count: genCount.value,
    ...(genFormats.value.length ? { formats: genFormats.value } : {}),
    ...(genPlatforms.value.length ? { platforms: genPlatforms.value } : {}),
    // preset จาก reference → force append เพื่อไม่ทับ creative เดิม
    mode: referenceId ? 'append' : mode,
    ...(referenceId ? { referenceId } : {}),
  }))
}

// ===== Phase 3 — Recreate Viral Ad: preset reference → generate form =====
const genReference = ref<AdReference | null>(null)
function presetReference(r: AdReference) {
  genReference.value = r
  toast.info(t('marketer.creatives.presetSet', { title: r.title }))
}
function clearPresetReference() {
  genReference.value = null
}

// ===== Phase 3 — Product Visuals：独立于 agent 任务的图片生成 =====
const visSource = ref('')
const visKind = ref<VisualKind>('packshot')
const visCount = ref(2)
const visInstruction = ref('')
const generatingVisuals = ref(false)

function clampVisualCount() {
  const v = Math.round(Number(visCount.value))
  visCount.value = Number.isFinite(v) ? Math.min(VISUAL_COUNT_MAX, Math.max(VISUAL_COUNT_MIN, v)) : 2
}

async function generateVisuals() {
  if (!detail.value || !visSource.value || generatingVisuals.value) return
  clampVisualCount()
  generatingVisuals.value = true
  try {
    const created = await marketerAPI.generateVisuals(campaignId, {
      kind: visKind.value,
      sourceImage: visSource.value,
      count: visCount.value,
      ...(visInstruction.value.trim() ? { instruction: visInstruction.value.trim() } : {}),
    })
    // 契约：GET /:id 的 visuals 新→旧，本地同样插到最前
    detail.value = { ...detail.value, visuals: [...created, ...detail.value.visuals] }
    toast.success(t('marketer.visuals.generated', { n: created.length }))
    schedulePoll()
  } catch (e) {
    toastError(e)
  } finally {
    generatingVisuals.value = false
  }
}

function retryVisual(v: CampaignVisual) {
  // 重试 = 用原参数再下一单（旧 failed 行保留，用户可自行删除）
  visKind.value = v.kind
  visInstruction.value = v.instruction || ''
  return marketerAPI.generateVisuals(campaignId, {
    kind: v.kind,
    sourceImage: v.sourceImage,
    count: 1,
    ...(v.instruction ? { instruction: v.instruction } : {}),
  }).then((created) => {
    detail.value = { ...detail.value!, visuals: [...created, ...detail.value!.visuals] }
    schedulePoll()
  }).catch((e) => { toastError(e) })
}

function onVisualUpdated(v: CampaignVisual) {
  if (!detail.value || !v) return
  detail.value = { ...detail.value, visuals: detail.value.visuals.map(x => x.id === v.id ? v : x) }
}

function onVisualDeleted(id: number) {
  if (!detail.value) return
  detail.value = { ...detail.value, visuals: detail.value.visuals.filter(x => x.id !== id) }
}

function onVisualPromoted({ campaign, visual }: { campaign: Campaign; visual: CampaignVisual }) {
  if (!detail.value) return
  detail.value = {
    ...detail.value,
    ...campaign,
    visuals: detail.value.visuals.map(x => x.id === visual.id ? { ...x, promoted: true } : x),
  }
}

const retryStep = computed<JobStep>(() => retryTarget(detail.value, lastAction.value))
const failedText = computed(() => {
  const msg = detail.value?.errorMsg || ''
  const code = errorCodeOf(msg)
  if (code && te(`errors.codes.${code}`)) return t(`errors.codes.${code}`)
  // 无错误码（上游/模型原文）：走全站统一映射，不直接展示原始技术信息
  return mapError(new Error(msg))
})
function retry() {
  goStep(retryStep.value)
  if (retryStep.value === 'research') return runResearch()
  if (retryStep.value === 'strategy') return runStrategy()
  return runCreatives(creatives.value.length ? 'append' : 'replace')
}

let pollTimer: ReturnType<typeof setTimeout> | null = null
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  // 定时器只有一个：agent 任务 2s 优先；有 visuals 生成中时退到 3s 兜底轮询（visuals 不改 campaign.status）
  if (busy.value) pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
  else if (hasProcessingVisual.value) pollTimer = setTimeout(poll, VISUAL_POLL_INTERVAL_MS)
  else pollTimer = null
}

async function poll() {
  const prev = detail.value?.status
  await refresh(true)
  const now = detail.value?.status
  if (isBusyStatus(prev) && !isBusyStatus(now)) {
    const kind = busyStep(prev) as JobStep
    // 任务可能在别处/上次会话发起：以实际在跑的步骤作为重试目标
    lastAction.value = kind
    if (kind === 'creatives') genReference.value = null
    if (now === 'failed') {
      toast.error(t('marketer.job.failed', { step: t(`marketer.steps.${kind}`) }))
    } else {
      toast.success(t(`marketer.job.done.${kind}`))
      if (kind === 'strategy') docTab.value = STRATEGY_DOC_KINDS[0]
    }
  }
}

// ===== load =====
async function refresh(silent = false) {
  if (!silent) refreshing.value = true
  try {
    const d = await marketerAPI.get(campaignId)
    const first = !detail.value
    detail.value = d
    if (first) {
      resetBrief(d)
      researchNotes.value = d.researchNotes || ''
      genPlatforms.value = [...(d.platforms || [])]
      step.value = suggestedStep(d)
      if (busyStep(d.status)) lastAction.value = busyStep(d.status) as JobStep
    } else if (!briefDirty.value) {
      resetBrief(d)
    }
    loadFailed.value = false
  } catch (e: any) {
    if (!detail.value) loadFailed.value = true
    else if (!silent) toastError(e)
  } finally {
    refreshing.value = false
    schedulePoll()
  }
}

async function loadPresets() {
  try {
    stylePresets.value = (await stylePresetAPI.list() as any[]) || []
  } catch {
    // 无风格预设时下拉为空，不阻塞
  }
}

// ===== docs / creatives 局部更新 =====
const docTab = ref<string>(STRATEGY_DOC_KINDS[0])
function onDocUpdated(doc: CampaignDoc) {
  if (!detail.value || !doc) return
  const docs = detail.value.docs.filter(d => d.id !== doc.id)
  detail.value = { ...detail.value, docs: [...docs, doc] }
}
function onCreativeUpdated(cr: Creative) {
  if (!detail.value || !cr) return
  detail.value = { ...detail.value, creatives: detail.value.creatives.map(c => c.id === cr.id ? cr : c) }
}

const toDeleteCreative = ref<Creative | null>(null)
const creativeDeleting = ref(false)
async function removeCreative() {
  const cr = toDeleteCreative.value
  if (!cr || !detail.value) return
  creativeDeleting.value = true
  try {
    await marketerAPI.deleteCreative(campaignId, cr.id)
    detail.value = { ...detail.value, creatives: detail.value.creatives.filter(c => c.id !== cr.id) }
    toDeleteCreative.value = null
    toast.success(t('marketer.creatives.deleted'))
  } catch (e) {
    toastError(e)
  } finally {
    creativeDeleting.value = false
  }
}

// ===== production：approved creative → drama + episode，然后进入剧集工作台 =====
const producingId = ref<number | null>(null)
async function produce(cr: Creative) {
  if (producingId.value !== null) return
  producingId.value = cr.id
  try {
    const res = await marketerAPI.produceCreative(campaignId, cr.id)
    toast.success(t('marketer.production.produced', { n: res.episodeNumber }))
    navigateTo(`/drama/${res.dramaId}/episode/${res.episodeNumber}`)
  } catch (e) {
    toastError(e)
    refresh(true)
  } finally {
    producingId.value = null
  }
}

// ===== 导出：整份营销方案 → Markdown =====
function buildMarkdown() {
  const d = detail.value
  if (!d) return ''
  const lines: string[] = [`# ${t('marketer.production.exportHeading', { title: d.title })}`, '']
  for (const kind of [...RESEARCH_DOC_KINDS, ...STRATEGY_DOC_KINDS]) {
    const doc = docMap.value[kind]
    if (!doc?.content?.trim()) continue
    lines.push(`## ${t(`marketer.docKinds.${kind}`)}`, '', doc.content.trim(), '')
  }
  const list = creatives.value.filter(c => c.status !== 'draft')
  const export_ = list.length ? list : creatives.value
  if (export_.length) {
    lines.push(`## ${t('marketer.creatives.title')}`, '')
    export_.forEach((c, i) => {
      lines.push(`### ${i + 1}. ${c.hook}`, '')
      lines.push(`- ${t('marketer.creatives.angle')}: ${c.angle || '-'}`)
      lines.push(`- ${t(`marketer.formats.${c.format}`)} · ${t(`marketer.platforms.${c.platform}`)} · ${t('marketer.creatives.duration', { n: c.durationSec })}`)
      if (c.cta) lines.push(`- ${t('marketer.creatives.cta')}: ${c.cta}`)
      lines.push('', '```', c.script.trim(), '```', '')
    })
  }
  return lines.join('\n')
}

async function copyPlan() {
  try {
    await navigator.clipboard.writeText(buildMarkdown())
    toast.success(t('marketer.production.copied'))
  } catch (e) {
    toastError(e)
  }
}

onMounted(() => {
  refresh(true)
  loadPresets()
})
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<style scoped>
.studio {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.mk-loading {
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}

/* === Topbar === */
.mk-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--header-bg);
  flex-shrink: 0;
}
.mk-topbar-main { display: flex; align-items: center; gap: 14px; min-width: 0; }
.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 8px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.back-btn:hover { background: var(--bg-hover); color: var(--text-0); }
.back-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-identity { min-width: 0; }
.mk-c-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.mk-meta-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; min-width: 0; }
.mk-status-tag { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
.mk-stage-inline { font-size: 11.5px; color: var(--text-3); min-width: 0; }
.mk-topbar-side { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* === Body & sidebar === */
.studio-body { flex: 1; display: flex; min-height: 0; }
.mk-sidebar {
  width: 236px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 12px;
  border-right: 1px solid var(--border);
  background: var(--surface-soft);
  overflow-y: auto;
}
.mk-stages { display: flex; flex-direction: column; gap: 4px; }
.mk-stage {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.mk-stage:hover { background: var(--bg-hover); }
.mk-stage:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-stage.active {
  background: var(--bg-active);
  border-color: var(--border);
  box-shadow: inset 0 0 0 1px var(--border);
}
.mk-stage-state {
  width: 18px;
  height: 18px;
  margin-top: 1px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-3);
  background: var(--overlay-track);
}
.mk-stage.done .mk-stage-state { background: var(--success-bg); color: var(--success); }
.mk-stage.active .mk-stage-state { background: var(--accent-bg); color: var(--accent-text); }
.mk-stage-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.mk-stage-label { font-size: 13px; font-weight: 600; color: var(--text-0); }
.mk-stage-sub {
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Progress rail（同 episode.vue .sidebar-progress） */
.mk-rail { margin-top: auto; display: flex; flex-direction: column; gap: 7px; padding: 2px 2px 4px; }
.mk-rail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.mk-rail-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-1);
}
.mk-rail-count { flex-shrink: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-3); }
.mk-rail-track { display: flex; gap: 4px; }
.mk-rail-seg {
  position: relative;
  flex: 1;
  height: 5px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--overlay-track);
  cursor: pointer;
  overflow: hidden;
  transition: background 0.2s var(--ease-out), transform 0.15s var(--ease-out);
}
.mk-rail-seg:hover { transform: scaleY(1.6); }
.mk-rail-seg:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-rail-seg.done { background: var(--success); }
.mk-rail-seg.current { background: var(--accent-bg); }
.mk-rail-seg.current .mk-rail-fill {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    var(--accent) 0%,
    color-mix(in srgb, var(--accent) 30%, #fff 70%) 50%,
    var(--accent) 100%);
  background-size: 220% 100%;
  animation: mk-seg-marquee 1.5s linear infinite;
}
.mk-rail-seg:not(.current) .mk-rail-fill { display: none; }
@keyframes mk-seg-marquee {
  from { background-position: 220% 0; }
  to { background-position: -220% 0; }
}

/* === Main & panels === */
.mk-main { flex: 1; min-width: 0; overflow-y: auto; padding: 24px 28px 48px; }
.panel { max-width: 860px; }
.panel-wide { max-width: 1120px; }
.panel-head { margin-bottom: 18px; }
.panel-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.panel-desc { margin: 5px 0 0; font-size: 12.5px; color: var(--text-2); }

.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.field-hint { margin: 0; font-size: 11px; color: var(--text-3); line-height: 1.5; }
.mk-budget { max-width: 320px; margin-top: 22px; }
.mk-notes { resize: vertical; min-height: 96px; }
.mk-hint { font-size: 11.5px; color: var(--text-3); }
.mk-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mk-run-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 14px 0 18px; }
.mk-doc-stack { display: flex; flex-direction: column; gap: 14px; }
.mk-subhead { margin: 22px 0 10px; font-size: 13px; font-weight: 700; color: var(--text-1); }
.mk-subhead:first-of-type { margin-top: 0; }

/* Alerts */
.mk-alert {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
  border: 1px solid color-mix(in srgb, var(--error) 35%, var(--border));
  border-radius: var(--radius-lg);
  background: var(--error-bg);
  color: var(--error);
}
.mk-alert-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; }
.mk-alert-copy strong { font-size: 13px; }
.mk-alert-copy span { color: var(--text-1); overflow-wrap: anywhere; }
.job-running {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--accent-bg);
  color: var(--accent-text);
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 16px;
}
.job-running .btn { margin-left: auto; }

/* Empty state */
.step-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 24px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-3);
  text-align: center;
}
.step-empty.compact { padding: 24px; }
.empty-note { margin: 4px 0 10px; font-size: 13px; color: var(--text-2); }
.empty-guard { margin: 0; font-size: 12px; color: var(--warn-text); }

/* Stage next */
.stage-next { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 22px; }
.stage-next.split { justify-content: space-between; }

/* Strategy tabs */
.doc-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.doc-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  color: var(--text-2);
  font: 600 12.5px var(--font-body);
  cursor: pointer;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.doc-tab:hover { color: var(--text-0); border-color: var(--border-strong); }
.doc-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.doc-tab.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent-text); }
.doc-tab-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--overlay-track); }
.doc-tab-dot.draft { background: var(--warning); }
.doc-tab-dot.approved { background: var(--success); }

/* Creatives */
.gen-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  margin-bottom: 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
}
.gen-row { display: flex; align-items: baseline; gap: 12px; }
.gen-label { width: 72px; flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--text-1); }
.gen-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.filter-chip {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--button-bg);
  color: var(--text-2);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.filter-chip:hover { border-color: var(--border-hover); color: var(--text-0); }
.filter-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.filter-chip.on {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent-text);
}
.gen-controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.gen-count { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--text-1); }
.gen-count .input { width: 72px; }
.creative-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
  align-items: start;
}

/* Production */
.prod-list { display: flex; flex-direction: column; gap: 8px; }
.prod-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}
.prod-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.prod-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.prod-hook { margin: 0; font-size: 13.5px; font-weight: 600; color: var(--text-0); line-height: 1.5; overflow-wrap: anywhere; }
.mk-export {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 28px;
  padding: 14px 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
}
.mk-export-title { margin: 0 0 2px; font-size: 13px; font-weight: 700; color: var(--text-1); }

/* === Phase 3 — visuals & reference preset === */
.gen-ref-row { display: flex; }
.gen-ref-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; }
.gen-ref-clear {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; padding: 0;
  border: none; border-radius: 50%;
  background: transparent; color: inherit; cursor: pointer; flex-shrink: 0;
}
.gen-ref-clear:hover { background: var(--bg-hover); }
.gen-ref-clear:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--button-focus); }
.mk-vis-gen { display: flex; flex-direction: column; gap: 8px; }
.mk-vis-src-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}
.mk-vis-src {
  padding: 0; border: 2px solid var(--border); border-radius: var(--radius);
  background: var(--surface-soft); cursor: pointer; overflow: hidden;
  aspect-ratio: 1 / 1;
  transition: border-color 0.15s var(--ease-out), transform 0.15s var(--ease-out);
}
.mk-vis-src:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.mk-vis-src.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.mk-vis-src:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-vis-src img { display: block; width: 100%; height: 100%; object-fit: cover; }
.mk-vis-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.mk-vis-instruction { flex: 1; min-width: 220px; }
.mk-vis-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px; margin-top: 4px;
}
.mk-vis-empty { margin: 0; font-size: 12.5px; color: var(--text-3); }
.mk-vis-gen .gen-count { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-1); }
.mk-vis-gen .gen-count .input { width: 76px; }

@media (max-width: 860px) {
  .mk-topbar { flex-wrap: wrap; padding: 10px 14px; }
  .studio-body { flex-direction: column; }
  .mk-sidebar { width: 100%; flex-direction: row; align-items: center; border-right: none; border-bottom: 1px solid var(--border); padding: 8px; }
  .mk-stages { flex-direction: row; overflow-x: auto; flex: 1; }
  .mk-stage { flex-shrink: 0; }
  .mk-stage-sub { display: none; }
  .mk-rail { display: none; }
  .mk-main { padding: 18px 14px 36px; }
  .gen-row { flex-direction: column; gap: 6px; }
  .prod-row { flex-direction: column; align-items: stretch; }
  .mk-export { flex-direction: column; align-items: stretch; }
  .creative-grid { grid-template-columns: 1fr; }
  .mk-vis-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .mk-vis-row { flex-direction: column; align-items: stretch; }
  .mk-vis-instruction { min-width: 0; }
}
</style>
