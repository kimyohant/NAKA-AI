<template>
  <section class="qs">
    <!-- ===== Hero + composer (TopView "Your AI marketer, ready to work" ฉบับ NAKA-AI) ===== -->
    <div class="qs-hero">
      <MarketerMedia class="qs-hero-media" id="hero-2" play="visible" aria-hidden="true" />
      <p class="qs-eyebrow"><span class="qs-led" aria-hidden="true"></span>{{ t('marketer.quick.eyebrow') }}</p>
      <h2 class="qs-title">{{ t('marketer.quick.title') }}</h2>
      <p class="qs-sub">{{ t('marketer.quick.subtitle') }}</p>

      <form class="qs-composer" @submit.prevent="submitComposer">
        <textarea
          v-model="composerText"
          class="qs-composer-input"
          rows="3"
          maxlength="4000"
          :placeholder="t('marketer.quick.placeholder')"
          :aria-label="t('marketer.quick.placeholder')"
          @input="!composerText.trim() && (composerTemplate = null)"
        ></textarea>
        <p v-if="composerTemplate" class="qs-template-hint">{{ t('marketer.quick.templateHint', { title: t(`marketer.quick.templates.${composerTemplate}`) }) }}</p>
        <div class="qs-composer-bar">
          <BaseSelect v-model="composerExpert" class="qs-select" :options="expertOptions" :searchable="false" />
          <BaseSelect v-model="composerCategory" class="qs-select" :options="categoryOptions" :searchable="false" :placeholder="t('marketer.quick.allCategories')" />
          <button class="qs-send" type="submit" :disabled="sending || !composerText.trim()" :title="t('marketer.quick.send')" :aria-label="t('marketer.quick.send')">
            <Loader2 v-if="sending" :size="16" class="animate-spin" />
            <ArrowUp v-else :size="17" :stroke-width="2.4" />
          </button>
        </div>
      </form>

      <!-- chips 4 กลุ่ม — กดแล้วเติมแม่แบบที่มี [ช่องว่าง] ลงกล่องสั่งงาน -->
      <div v-if="catalog" class="qs-groups">
        <div v-for="g in catalog.groups" :key="g" class="qs-group">
          <p class="qs-group-label">{{ t(`marketer.quick.groups.${g}`) }}</p>
          <div class="qs-chips">
            <button
              v-for="tpl in catalog.templates.filter(x => x.group === g)"
              :key="tpl.id"
              type="button"
              class="qs-chip"
              :class="{ active: composerTemplate === tpl.id }"
              @click="useTemplate(tpl)"
            >
              <span class="qs-chip-icon">
                <component :is="ICONS[tpl.icon]" :size="15" :stroke-width="1.9" />
                <MarketerMedia class="qs-thumb" :id="`template-${tpl.id}`" play="none" />
              </span>
              {{ t(`marketer.quick.templates.${tpl.id}`) }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Popular Ways to Get Started — 4 การ์ด ===== -->
    <div class="qs-section-head">
      <h2 class="qs-h2">{{ t('marketer.quick.ways.title') }}</h2>
      <p class="qs-section-sub">{{ t('marketer.quick.ways.desc') }}</p>
    </div>
    <div class="qs-ways">
      <button v-for="w in WAYS" :key="w.key" type="button" class="qs-way" data-mm-hover @click="openWay(w.key)">
        <span class="qs-way-art" :class="`art-${w.key}`" aria-hidden="true">
          <component :is="w.icon" :size="34" :stroke-width="1.6" />
          <MarketerMedia class="qs-thumb" :id="`way-${w.key}`" />
        </span>
        <span class="qs-way-copy">
          <span class="qs-line-no">{{ w.no }}</span>
          <strong>{{ t(`marketer.quick.ways.${w.key}.title`) }}</strong>
          <small>{{ t(`marketer.quick.ways.${w.key}.desc`) }}</small>
        </span>
      </button>
    </div>

    <!-- ===== ผลงานตัวอย่าง + AI Influencer (ภาพ/คลิปที่ NAKA-AI สร้างเอง — แสดงเมื่อมีไฟล์) ===== -->
    <template v-if="showcase.length">
      <div class="qs-section-head">
        <h2 class="qs-h2">{{ t('marketer.quick.showcase.title') }}</h2>
        <p class="qs-section-sub">{{ t('marketer.quick.showcase.desc') }}</p>
      </div>
      <div class="qs-rail">
        <button v-for="id in showcase" :key="id" type="button" class="qs-reel" data-mm-hover @click="openWay('url')">
          <MarketerMedia class="qs-reel-media" :id="id" />
          <span class="qs-reel-cap">{{ t(`marketer.quick.showcase.items.${id.slice(9).replace('-', '_')}`) }}</span>
        </button>
      </div>
    </template>
    <template v-if="influencers.length">
      <div class="qs-section-head">
        <h2 class="qs-h2">{{ t('marketer.quick.influencers.title') }}</h2>
        <p class="qs-section-sub">{{ t('marketer.quick.influencers.desc') }}</p>
      </div>
      <div class="qs-rail">
        <figure v-for="id in influencers" :key="id" class="qs-reel qs-person">
          <MarketerMedia class="qs-reel-media" :id="id" play="none" />
          <figcaption class="qs-reel-cap">{{ t(`marketer.quick.influencers.items.i${id.slice(11)}`) }}</figcaption>
        </figure>
      </div>
    </template>

    <!-- ===== งานวิเคราะห์ของฉัน ===== -->
    <div v-if="insights.length" class="qs-insights">
      <div class="qs-section-head">
        <h2 class="qs-h2">{{ t('marketer.quick.insights.title') }}</h2>
      </div>
      <div class="qs-insight-list">
        <article v-for="ins in insights" :key="ins.id" class="qs-insight" tabindex="0" role="button" @click="openResult(ins)" @keydown.enter.self.prevent="openResult(ins)">
          <span class="qs-insight-icon">
            <Sparkles :size="14" :stroke-width="2" />
            <MarketerMedia class="qs-thumb" :id="`expert-${ins.expert || 'general'}`" play="none" />
          </span>
          <span class="qs-insight-copy">
            <strong class="truncate">{{ insightTitle(ins) }}</strong>
            <small>{{ fmtDate(ins.createdAt) }}</small>
          </span>
          <span class="tag" :class="ins.status === 'completed' ? 'tag-success' : ins.status === 'failed' ? 'tag-error' : 'tag-info'">
            <Loader2 v-if="ins.status === 'processing'" :size="10" class="animate-spin" />
            {{ t(`marketer.quick.insights.status.${ins.status}`) }}
          </span>
          <button class="qs-icon-btn" type="button" :title="t('marketer.quick.insights.delete')" :aria-label="t('marketer.quick.insights.delete')" @click.stop="removeInsight(ins)">
            <Trash2 :size="13" :stroke-width="2" />
          </button>
        </article>
      </div>
    </div>

    <!-- ===== 01 Marketing insight dialog ===== -->
    <div v-if="showInsight" class="overlay" @click.self="showInsight = false">
      <div class="dialog create-dialog qs-dialog" role="dialog" aria-modal="true" :aria-label="t('marketer.quick.insight.title')">
        <div class="dialog-head">
          <div class="qs-dialog-icon"><BarChart3 :size="18" :stroke-width="1.8" /></div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('marketer.quick.insight.title') }}</h2>
            <p class="dialog-desc">{{ t('marketer.quick.insight.desc') }}</p>
          </div>
        </div>
        <form class="create-form" @submit.prevent="submitInsightDialog">
          <div class="dialog-body">
            <div class="qs-suggest-head">
              <span class="field-label">{{ t('marketer.quick.insight.suggested') }}</span>
              <button type="button" class="btn btn-sm" @click="shuffle"><RefreshCw :size="12" :stroke-width="2" /> {{ t('marketer.quick.insight.shuffle') }}</button>
            </div>
            <div class="qs-suggest">
              <button v-for="tpl in suggestions" :key="tpl.id" type="button" class="qs-suggest-card" :class="{ active: dialogTemplate === tpl.id }" @click="pickSuggestion(tpl)">
                <span class="qs-suggest-art">
                  <component :is="ICONS[tpl.icon]" :size="16" :stroke-width="1.9" />
                  <MarketerMedia class="qs-thumb" :id="`template-${tpl.id}`" play="none" />
                </span>
                <span>{{ t(`marketer.quick.templates.${tpl.id}`) }}</span>
              </button>
            </div>
            <label class="qs-field">
              <span class="field-label">{{ t('marketer.quick.insight.prompt') }} <span class="mk-required">*</span></span>
              <textarea v-model="dialogPrompt" class="textarea" rows="5" maxlength="4000"></textarea>
            </label>
            <div class="qs-row">
              <div class="qs-field">
                <span class="field-label">{{ t('marketer.quick.expert') }}</span>
                <BaseSelect v-model="dialogExpert" :options="expertOptions" :searchable="false" />
              </div>
              <div class="qs-field">
                <span class="field-label">{{ t('marketer.quick.category') }}</span>
                <BaseSelect v-model="dialogCategory" :options="categoryOptions" :searchable="false" :placeholder="t('marketer.quick.allCategories')" />
              </div>
            </div>
            <label class="qs-field">
              <span class="field-label">{{ t('marketer.quick.insight.product') }}</span>
              <input v-model="dialogProduct" class="input" maxlength="160" :placeholder="t('marketer.quick.insight.productPlaceholder')" />
            </label>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" :disabled="sending" @click="showInsight = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="sending || !dialogPrompt.trim()">
              <Loader2 v-if="sending" :size="13" class="animate-spin" />
              {{ sending ? t('marketer.quick.insight.submitting') : t('marketer.quick.insight.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ===== Insight result ===== -->
    <div v-if="resultInsight" class="overlay" @click.self="closeResult">
      <div class="dialog qs-result" role="dialog" aria-modal="true" :aria-label="insightTitle(resultInsight)">
        <div class="dialog-head">
          <div class="qs-dialog-icon">
            <Sparkles :size="18" :stroke-width="1.8" />
            <MarketerMedia class="qs-thumb" :id="`expert-${resultInsight.expert || 'general'}`" play="none" />
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ insightTitle(resultInsight) }}</h2>
            <p class="dialog-desc">{{ resultInsight.expert ? t(`marketer.quick.experts.${resultInsight.expert}`) : '' }}</p>
          </div>
          <button class="qs-icon-btn qs-close" type="button" :aria-label="t('common.close')" @click="closeResult"><X :size="16" /></button>
        </div>
        <div class="dialog-body qs-result-body">
          <div v-if="resultInsight.status === 'processing'" class="qs-waiting">
            <MarketerMedia class="qs-waiting-art" id="empty-insights" play="none" />
            <Loader2 :size="22" class="animate-spin" />
            <p>{{ t('marketer.quick.result.waiting') }}</p>
          </div>
          <p v-else-if="resultInsight.status === 'failed'" class="qs-error">{{ failureText(resultInsight.errorMsg) }}</p>
          <!-- renderMarkdown escapes HTML first and only emits whitelisted tags -->
          <div v-else class="mk-md" v-html="renderMarkdown(resultInsight.result || '')" />
        </div>
        <div class="dialog-foot">
          <button v-if="resultInsight.status === 'completed'" type="button" class="btn" @click="copyResult">
            <Copy :size="13" :stroke-width="2" /> {{ copied ? t('marketer.quick.result.copied') : t('marketer.quick.result.copy') }}
          </button>
          <button type="button" class="btn btn-primary" @click="closeResult">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>

    <MarketerQuickCampaignDialog v-if="campaignMode" :mode="campaignMode" @close="campaignMode = null" />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowUp, BarChart3, CalendarDays, Clapperboard, Coins, Copy, FileText, Layers, Link2, Loader2, MessageSquare,
  RefreshCw, Repeat2, Search, Sparkles, Trash2, X,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { marketerQuickAPI, type MarketerInsight, type QuickCatalog, type QuickTemplate } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { renderMarkdown } from '../utils/marketerMarkdown'
import { mkGroup } from '../utils/marketerMedia'

/**
 * MarketerQuickStart — หัวหน้า "นักการตลาด AI" แบบ TopView (ย้ายจาก naka-ai studio 05):
 * กล่องสั่งงาน + ชิปแม่แบบ → วิเคราะห์ด่วน (marketing_insight), การ์ด 4 แบบ → แคมเปญ autopilot (ผลิตวิดีโอจริงด้วย pipeline เดิม)
 */

const ICONS = {
  chart: markRaw(BarChart3), search: markRaw(Search), doc: markRaw(FileText), chat: markRaw(MessageSquare),
  video: markRaw(Clapperboard), money: markRaw(Coins), calendar: markRaw(CalendarDays),
} as const
type WayKey = 'insight' | 'url' | 'recreate' | 'bulk'
const WAYS: { key: WayKey; no: string; icon: any }[] = [
  { key: 'insight', no: '01', icon: markRaw(BarChart3) },
  { key: 'url', no: '02', icon: markRaw(Link2) },
  { key: 'recreate', no: '03', icon: markRaw(Repeat2) },
  { key: 'bulk', no: '04', icon: markRaw(Layers) },
]
const POLL_MS = 3000
const showcase = mkGroup('showcase')
const influencers = mkGroup('influencer')

const { t, locale } = useI18n()

const catalog = ref<QuickCatalog | null>(null)
const insights = ref<MarketerInsight[]>([])
const sending = ref(false)

const composerText = ref('')
const composerTemplate = ref<string | null>(null)
const composerExpert = ref('general')
const composerCategory = ref('')

const showInsight = ref(false)
const suggestions = ref<QuickTemplate[]>([])
const dialogTemplate = ref<string | null>(null)
const dialogPrompt = ref('')
const dialogExpert = ref('general')
const dialogCategory = ref('')
const dialogProduct = ref('')

const resultInsight = ref<MarketerInsight | null>(null)
const copied = ref(false)
const campaignMode = ref<Exclude<WayKey, 'insight'> | null>(null)

const expertOptions = computed(() => (catalog.value?.experts || ['general']).map(e => ({ label: t(`marketer.quick.experts.${e}`), value: e })))
const categoryOptions = computed(() => [
  { label: t('marketer.quick.allCategories'), value: '' },
  ...(catalog.value?.categories || []).map(c => ({ label: t(`marketer.quick.categories.${c}`), value: c })),
])

function useTemplate(tpl: QuickTemplate) {
  composerText.value = tpl.prompt
  composerTemplate.value = tpl.id
}

function insightTitle(ins: MarketerInsight) {
  const heading = (ins.result || '').match(/^#\s+(.+)$/m)?.[1]
  if (heading) return heading.slice(0, 80)
  return ins.templateId ? t(`marketer.quick.templates.${ins.templateId}`) : ins.prompt.slice(0, 60)
}
function fmtDate(v?: string) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale.value === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}
function failureText(msg: string | null) {
  if (msg?.startsWith('E_NO_TEXT_MODEL')) return t('marketer.quick.result.noModel')
  if (msg?.startsWith('E_TASK_INTERRUPTED')) return t('marketer.quick.result.interrupted')
  return t('marketer.quick.result.failed')
}

async function startInsight(data: { prompt: string; templateId: string | null; expert: string; category: string; productName?: string }) {
  sending.value = true
  try {
    const created = await marketerQuickAPI.createInsight({ ...data, category: data.category || null, productName: data.productName || undefined })
    insights.value = [created, ...insights.value.filter(i => i.id !== created.id)]
    openResult(created)
    return true
  } catch (e) {
    toastError(e)
    return false
  } finally {
    sending.value = false
  }
}

async function submitComposer() {
  const prompt = composerText.value.trim()
  if (!prompt) return
  const ok = await startInsight({ prompt, templateId: composerTemplate.value, expert: composerExpert.value, category: composerCategory.value })
  if (ok) { composerText.value = ''; composerTemplate.value = null }
}

function shuffle() {
  suggestions.value = [...(catalog.value?.templates || [])].sort(() => Math.random() - 0.5).slice(0, 6)
}
function pickSuggestion(tpl: QuickTemplate) {
  dialogTemplate.value = tpl.id
  dialogPrompt.value = tpl.prompt
}
async function submitInsightDialog() {
  const ok = await startInsight({ prompt: dialogPrompt.value.trim(), templateId: dialogTemplate.value, expert: dialogExpert.value,
    category: dialogCategory.value, productName: dialogProduct.value.trim() })
  if (ok) showInsight.value = false
}

function openWay(key: WayKey) {
  if (key === 'insight') {
    shuffle()
    dialogTemplate.value = null
    dialogPrompt.value = ''
    dialogProduct.value = ''
    showInsight.value = true
    return
  }
  campaignMode.value = key
}

// ----- result polling -----
let pollTimer: ReturnType<typeof setTimeout> | null = null
function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null } }
async function poll(id: number) {
  try {
    const fresh = await marketerQuickAPI.getInsight(id)
    insights.value = insights.value.map(i => (i.id === id ? fresh : i))
    if (resultInsight.value?.id === id) resultInsight.value = fresh
    if (fresh.status === 'processing' && resultInsight.value?.id === id) pollTimer = setTimeout(() => poll(id), POLL_MS)
  } catch { pollTimer = setTimeout(() => poll(id), POLL_MS * 2) }
}
function openResult(ins: MarketerInsight) {
  stopPoll()
  copied.value = false
  resultInsight.value = ins
  if (ins.status === 'processing') pollTimer = setTimeout(() => poll(ins.id), POLL_MS)
}
function closeResult() {
  stopPoll()
  resultInsight.value = null
}
async function copyResult() {
  try {
    await navigator.clipboard.writeText(resultInsight.value?.result || '')
    copied.value = true
  } catch { toast.error(t('marketer.quick.result.copyFailed')) }
}
async function removeInsight(ins: MarketerInsight) {
  try {
    await marketerQuickAPI.deleteInsight(ins.id)
    insights.value = insights.value.filter(i => i.id !== ins.id)
  } catch (e) { toastError(e) }
}

onMounted(async () => {
  try {
    const [cat, list] = await Promise.all([marketerQuickAPI.catalog(), marketerQuickAPI.listInsights()])
    catalog.value = cat
    insights.value = list || []
  } catch (e) { toastError(e) }
})
onBeforeUnmount(stopPoll)
</script>

<style scoped>
.qs { margin-bottom: 36px; }
.qs-hero { position: relative; isolation: isolate; text-align: center; padding: 8px 0 4px; }
.qs-hero-media {
  position: absolute; z-index: -1; inset: -24px -16px auto; height: 300px; border-radius: 24px; opacity: .3;
  -webkit-mask-image: radial-gradient(ellipse at center, #000 20%, transparent 72%); mask-image: radial-gradient(ellipse at center, #000 20%, transparent 72%);
}
/* ภาพประกอบวางทับไอคอนเดิม — ถ้ายังไม่มีไฟล์ ไอคอนจะโชว์แทน */
.qs-thumb { position: absolute; inset: 0; border-radius: inherit; }
.qs-eyebrow { display: inline-flex; align-items: center; gap: 8px; margin: 0 0 12px; padding: 5px 12px 5px 10px; border: 1px solid var(--border); border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--text-2); background: var(--surface-soft); }
.qs-led { width: 7px; height: 7px; border-radius: 50%; background: var(--success, #12b07a); box-shadow: 0 0 0 3px rgba(18, 176, 122, .18); }
.qs-title { margin: 0; font-family: var(--font-display); font-size: clamp(26px, 3.4vw, 38px); font-weight: 800; letter-spacing: -0.03em; color: var(--text-0); }
.qs-sub { margin: 8px auto 0; max-width: 620px; font-size: 13px; color: var(--text-2); }

.qs-composer { max-width: 760px; margin: 22px auto 0; text-align: left; padding: 14px 14px 10px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface-soft); box-shadow: var(--shadow-elevated); transition: border-color .15s var(--ease-out); }
.qs-composer:focus-within { border-color: var(--accent); }
.qs-composer-input { width: 100%; min-height: 76px; padding: 4px 6px; border: 0; outline: none; resize: none; background: transparent; color: var(--text-0); font: inherit; font-size: 15px; }
.qs-composer-input::placeholder { color: var(--text-3); }
.qs-template-hint { margin: 2px 6px 6px; font-size: 11px; color: var(--accent-text); }
.qs-composer-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.qs-select { width: 210px; max-width: 100%; }
.qs-send { margin-left: auto; width: 40px; height: 40px; border: 0; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #fff; cursor: pointer; transition: transform .15s var(--ease-out), opacity .15s; }
.qs-send:hover:not(:disabled) { transform: translateY(-1px); }
.qs-send:disabled { opacity: .45; cursor: not-allowed; }

.qs-groups { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 0; margin: 18px auto 0; max-width: 1100px; }
.qs-group { padding: 4px 16px; }
.qs-group + .qs-group { border-left: 1px solid var(--border); }
.qs-group-label { margin: 0 0 6px; font-size: 11px; color: var(--text-3); }
.qs-chips { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; }
.qs-chip { display: inline-flex; flex-direction: column; align-items: center; gap: 5px; width: 92px; padding: 8px 4px; border: 0; border-radius: 12px; background: transparent; color: var(--text-1); font-size: 11px; line-height: 1.35; cursor: pointer; }
.qs-chip:hover, .qs-chip.active { background: var(--surface-soft); }
.qs-chip-icon { position: relative; overflow: hidden; width: 46px; height: 46px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 12px; color: var(--text-1); }
.qs-chip:hover .qs-chip-icon { border-color: var(--border-strong); }
.qs-chip.active .qs-chip-icon { border-color: var(--accent); color: var(--accent-text); }

.qs-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 30px 0 12px; }
.qs-h2 { margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-0); }
.qs-section-sub { margin: 0; font-size: 12px; color: var(--text-2); }

.qs-ways { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.qs-way { display: flex; flex-direction: column; gap: 0; padding: 7px; text-align: left; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-soft); color: inherit; cursor: pointer; transition: border-color .15s var(--ease-out), transform .15s var(--ease-out), box-shadow .15s var(--ease-out); }
.qs-way:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-elevated); }
.qs-way-art { position: relative; overflow: hidden; aspect-ratio: 16 / 9; border-radius: 12px; display: grid; place-items: center; color: #fff; }
.art-insight { background: linear-gradient(135deg, #1f2b55, #3d6cf0); }
.art-url { background: linear-gradient(135deg, #3a1f55, #a855f7); }
.art-recreate { background: linear-gradient(135deg, #55301f, #f97316); }
.art-bulk { background: linear-gradient(135deg, #1f5540, #14b3a0); }
.qs-way-copy { display: grid; gap: 3px; padding: 10px 6px 6px; }
.qs-way-copy strong { font-size: 14px; color: var(--text-0); }
.qs-way-copy small { font-size: 11px; color: var(--text-2); line-height: 1.5; }
.qs-line-no { justify-self: start; padding: 1px 6px; border-radius: 5px; background: var(--text-0); color: var(--bg-0, #fff); font: 700 10px/1.6 ui-monospace, Consolas, monospace; }

.qs-insight-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
.qs-insight { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-soft); cursor: pointer; }
.qs-insight:hover { border-color: var(--border-strong); }
.qs-insight-icon { position: relative; overflow: hidden; width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 8px; background: var(--accent-bg); color: var(--accent-text); }
.qs-insight-copy { min-width: 0; flex: 1; display: grid; }
.qs-insight-copy strong { font-size: 12px; color: var(--text-0); }
.qs-insight-copy small { font-size: 10px; color: var(--text-3); }
.qs-icon-btn { width: 28px; height: 28px; flex: none; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--text-3); cursor: pointer; }
.qs-icon-btn:hover { background: var(--surface-hover, rgba(127, 127, 127, .12)); color: var(--text-0); }

.qs-dialog { width: min(640px, calc(100vw - 32px)); }
.qs-dialog-icon { position: relative; overflow: hidden; width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 10px; background: var(--accent-bg); color: var(--accent-text); }
.qs-suggest-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.qs-suggest { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.qs-suggest-card { display: grid; gap: 8px; align-content: start; min-height: 78px; padding: 10px; text-align: left; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-1); font-size: 12px; font-weight: 600; cursor: pointer; }
.qs-suggest-art { position: relative; overflow: hidden; width: 100%; aspect-ratio: 16 / 9; display: grid; place-items: center; border-radius: 8px; background: var(--surface-soft); }
.qs-suggest-card.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); }
.qs-field { display: grid; gap: 6px; margin-bottom: 12px; }
.qs-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }

.qs-result { width: min(820px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; }
.qs-result .dialog-head { position: relative; }
.qs-close { position: absolute; top: 0; right: 0; }
.qs-result-body { overflow-y: auto; }
.qs-waiting { display: grid; justify-items: center; gap: 10px; padding: 40px 0; color: var(--text-2); font-size: 13px; }
.qs-waiting-art { width: 132px; aspect-ratio: 1; border-radius: 20px; }

.qs-rail { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x proximity; scrollbar-width: thin; }
.qs-reel { position: relative; flex: none; width: 148px; aspect-ratio: 9 / 16; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface-soft); color: #fff; text-align: left; cursor: pointer; scroll-snap-align: start; transition: transform .15s var(--ease-out), border-color .15s var(--ease-out); }
.qs-reel:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.qs-person { cursor: default; }
.qs-reel-media { position: absolute; inset: 0; }
.qs-reel-cap { position: absolute; inset: auto 0 0; z-index: 1; padding: 22px 10px 9px; font-size: 11.5px; font-weight: 700; line-height: 1.35; background: linear-gradient(transparent, rgba(0, 0, 0, .78)); }
.qs-error { color: var(--danger, #e5484d); font-size: 13px; }

@media (max-width: 1100px) { .qs-ways { grid-template-columns: repeat(2, minmax(0, 1fr)); } .qs-group + .qs-group { border-left: 0; } }
@media (max-width: 640px) {
  .qs-ways { grid-template-columns: 1fr; } .qs-suggest { grid-template-columns: 1fr 1fr; } .qs-row { grid-template-columns: 1fr; }
  .qs-select { width: 100%; } .qs-chip { width: 78px; }
}
</style>
