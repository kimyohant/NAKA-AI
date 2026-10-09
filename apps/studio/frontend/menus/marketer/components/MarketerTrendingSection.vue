<template>
  <section class="trend-section">
    <div class="trend-head">
      <div class="trend-head-copy">
        <h2 class="trend-title">{{ t('marketer.trending.title') }}</h2>
        <p class="trend-sub">{{ t('marketer.trending.subtitle') }}</p>
        <p class="trend-disclaimer">
          <Info :size="11" :stroke-width="2" />
          {{ t('marketer.trending.disclaimer', { date: curatedAt }) }}
        </p>
      </div>
    </div>

    <div class="trend-filters">
      <BaseSelect v-model="industryFilter" class="trend-filter-select" :options="industryOptions" :searchable="false" :placeholder="t('marketer.trending.filters.allIndustries')" />
      <BaseSelect v-model="sortBy" class="trend-filter-select" :options="sortOptions" :searchable="false" :placeholder="t('marketer.trending.filters.sortViews')" />
      <label class="trend-search">
        <Search :size="13" :stroke-width="2" />
        <input v-model="searchQ" type="search" :placeholder="t('marketer.trending.filters.searchPlaceholder')" />
      </label>
    </div>

    <div v-if="loading" class="trend-grid" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="trend-card skeleton-card">
        <div class="skeleton-cover"></div>
        <div class="trend-body">
          <div class="skeleton-line w-80"></div>
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
        </div>
      </div>
    </div>

    <div v-else-if="visibleEntries.length" class="trend-grid">
      <MarketerTrendingCard v-for="e in visibleEntries" :key="e.id" :entry="e" @replicate="openReplicate" />
    </div>

    <div v-else class="trend-empty">
      <MarketerMedia class="trend-empty-art" id="empty-trending" play="none">
        <Flame :size="22" :stroke-width="1.6" />
      </MarketerMedia>
      <p>{{ t('marketer.trending.filters.empty') }}</p>
    </div>

    <div v-if="!loading && entries.length > VISIBLE_COUNT" class="trend-more">
      <button class="btn btn-sm" type="button" @click="showAll = !showAll">
        <template v-if="!showAll">{{ t('marketer.trending.filters.showAll', { total: entries.length }) }}</template>
        <template v-else>{{ t('marketer.trending.filters.showLess') }}</template>
      </button>
    </div>

    <!-- ===== Replicate dialog — เลือกแคมเปญ → สร้าง AdReference จาก pattern (docs/ai-marketer/TRENDING.md §4) ===== -->
    <div v-if="replicateEntry" class="overlay" @click.self="closeReplicate">
      <div class="dialog create-dialog" role="dialog" aria-modal="true" :aria-label="t('marketer.trending.dialog.title', { title: replicateEntry.title })">
        <div class="dialog-head">
          <div class="trend-dialog-icon">
            <Copy :size="18" :stroke-width="1.8" />
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('marketer.trending.dialog.title', { title: truncate(replicateEntry.title, 60) }) }}</h2>
            <p class="dialog-desc">{{ t('marketer.trending.dialog.desc') }}</p>
          </div>
        </div>

        <div class="trend-pattern-box">
          <span class="trend-pattern-label">{{ t('marketer.trending.card.why') }}</span>
          <p class="trend-pattern-summary">{{ replicateEntry.summary }}</p>
          <div class="trend-pattern-beats">
            <div v-for="(b, i) in replicateEntry.pattern.beats" :key="i" class="trend-pattern-beat">
              <span class="trend-pattern-role" :class="`role-${b.role}`">{{ t(`marketer.trending.roles.${b.role}`) }}</span>
              <span class="trend-pattern-line">{{ b.line }}</span>
            </div>
          </div>
        </div>

        <form class="create-form" @submit.prevent="submitReplicate">
          <div class="dialog-body">
            <!-- mode: แคมเปญเดิม / สร้างใหม่ -->
            <div class="trend-mode-row">
              <button type="button" class="trend-mode" :class="{ active: mode === 'existing' }" :disabled="!campaigns.length" @click="mode = 'existing'">
                {{ t('marketer.trending.dialog.modeExisting') }}
              </button>
              <button type="button" class="trend-mode" :class="{ active: mode === 'new' }" @click="mode = 'new'">
                {{ t('marketer.trending.dialog.modeNew') }}
              </button>
            </div>

            <div v-if="mode === 'existing'" class="trend-field">
              <span class="field-label">{{ t('marketer.trending.dialog.campaign') }} <span class="mk-required">*</span></span>
              <BaseSelect v-model="selectedCampaignId" :options="campaignOptions" :searchable="true" :placeholder="t('marketer.trending.dialog.campaignPlaceholder')" />
              <span v-if="!campaigns.length && !loadingCampaigns" class="field-hint">{{ t('marketer.trending.dialog.noCampaign') }}</span>
            </div>

            <template v-else>
              <label class="trend-field">
                <span class="field-label">{{ t('marketer.form.productName') }} <span class="mk-required">*</span></span>
                <input v-model="newForm.productName" class="input" :placeholder="t('marketer.trending.dialog.productNamePlaceholder')" />
              </label>
              <label class="trend-field">
                <span class="field-label">{{ t('marketer.trending.dialog.campaignTitle') }}</span>
                <input v-model="newForm.title" class="input" :placeholder="newForm.productName || t('marketer.form.titlePlaceholder')" />
              </label>
            </template>

            <div class="trend-fixed-row">
              <span class="tag"><component :is="platformIcon(replicateEntry.platform)" :size="10" :stroke-width="2" /> {{ t(`marketer.platforms.${replicateEntry.platform}`) }}</span>
              <span class="tag">{{ t('marketer.markets.TH') }}</span>
              <span class="tag tag-accent">{{ t(`marketer.trending.industries.${replicateEntry.industry}`) }}</span>
            </div>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" :disabled="submitting" @click="closeReplicate">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="submitting || !canSubmit">
              <Loader2 v-if="submitting" :size="13" class="animate-spin" />
              {{ submitting ? t('marketer.trending.dialog.submitting') : t('marketer.trending.dialog.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Flame, Info, Instagram, Loader2, Music2, Search, Youtube } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { marketerAPI, trendingAPI, type Campaign, type Platform, type TrendIndustry, type TrendSort, type TrendVideo } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/**
 * MarketerTrendingSection — "Trending Videos, Ready to Replicate" ฉบับ NAKA-AI (ไทยเท่านั้น)
 * คลัง curated จาก backend; กดโคลน → สร้าง AdReference (pattern brief) ในแคมเปญ → ใช้ flow analyze/creatives เดิมต่อ
 */

const VISIBLE_COUNT = 8

const { t, locale } = useI18n()

const loading = ref(true)
const entries = ref<TrendVideo[]>([])
const industries = ref<string[]>([])
const curatedAt = ref('')

const industryFilter = ref<TrendIndustry | ''>('')
const sortBy = ref<TrendSort>('views')
const searchQ = ref('')
const showAll = ref(false)

const industryOptions = computed(() => industries.value.map(i => ({ label: t(`marketer.trending.industries.${i}`), value: i })))
const sortOptions = computed(() => (['views', 'revenue', 'engagement'] as const).map(s => ({ label: t(`marketer.trending.filters.sort${s[0].toUpperCase()}${s.slice(1)}`), value: s })))

const visibleEntries = computed(() => (showAll.value ? entries.value : entries.value.slice(0, VISIBLE_COUNT)))

function fmtCuratedDate(v: string) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'long' })
}
const curatedAtLabel = computed(() => fmtCuratedDate(curatedAt.value))

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch([industryFilter, sortBy], () => load(true))
watch(searchQ, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(true), 350)
})

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    const res = await trendingAPI.list({
      industry: industryFilter.value || undefined,
      sort: sortBy.value || undefined,
      q: searchQ.value.trim() || undefined,
    })
    entries.value = res.entries
    industries.value = res.industries
    curatedAt.value = res.curatedAt ? fmtCuratedDate(res.curatedAt) : ''
  } catch (e) {
    if (!silent) toastError(e)
  } finally {
    loading.value = false
  }
}

// ===== Replicate flow =====
const replicateEntry = ref<TrendVideo | null>(null)
const campaigns = ref<Campaign[]>([])
const loadingCampaigns = ref(false)
const mode = ref<'existing' | 'new'>('existing')
const selectedCampaignId = ref<number | ''>('')
const newForm = ref({ title: '', productName: '' })
const submitting = ref(false)

const campaignOptions = computed(() => campaigns.value.map(c => ({ label: c.title, value: c.id })))

function platformIcon(p: Platform) {
  if (p === 'reels') return Instagram
  if (p === 'youtube_shorts') return Youtube
  return Music2
}

function truncate(v: string, n: number) {
  return v.length > n ? v.slice(0, n - 1) + '…' : v
}

const canSubmit = computed(() => {
  if (!replicateEntry.value) return false
  if (mode.value === 'existing') return typeof selectedCampaignId.value === 'number' && selectedCampaignId.value !== ''
  return !!newForm.value.productName.trim()
})

async function openReplicate(entry: TrendVideo) {
  replicateEntry.value = entry
  mode.value = 'existing'
  selectedCampaignId.value = ''
  newForm.value = { title: '', productName: '' }
  if (!campaigns.value.length) {
    loadingCampaigns.value = true
    try {
      campaigns.value = await marketerAPI.list() || []
    } catch (e) {
      toastError(e)
    } finally {
      loadingCampaigns.value = false
    }
  }
  // ไม่มีแคมเปญเลย → เปิดโหมดสร้างใหม่ให้เลย
  if (!campaigns.value.length) mode.value = 'new'
}

function closeReplicate() {
  if (!submitting.value) replicateEntry.value = null
}

/** โครงคลิป → transcript ของ AdReference (รูปแบบตาม TRENDING.md §5 — ภาษาไทยตามคลัง) */
function patternBrief(entry: TrendVideo) {
  const lines: string[] = []
  lines.push('[โครงคลิปจากคลังเทรนด์ไทย NAKA-AI — pattern สำหรับนำไปสร้างใหม่ ไม่ใช่ถ้อยคำต้นฉบับ]')
  lines.push(`หมวด: ${t(`marketer.trending.industries.${entry.industry}`)} · แพลตฟอร์ม: ${t(`marketer.platforms.${entry.platform}`)} · ความยาวอ้างอิง: ${entry.durationSec}s`)
  lines.push('')
  let cursor = 0
  const first = entry.pattern.beats.find(b => b.role === 'hook')
  const hookEnd = first ? first.durationSec : 3
  lines.push(`[Hook 0-${hookEnd}s] ${entry.pattern.hook}`)
  cursor += hookEnd
  for (const b of entry.pattern.beats) {
    if (b.role === 'hook') continue
    lines.push(`[${cursor}-${cursor + b.durationSec}s | ${b.role}] ${b.line}`)
    cursor += b.durationSec
  }
  lines.push(`[CTA ${cursor}-${entry.durationSec}s] ${entry.pattern.cta}`)
  return lines.join('\n')
}

function notesFor(entry: TrendVideo) {
  const tags = entry.hashtags.map(h => `#${h}`).join(' ')
  return tags ? `${entry.summary}\n${tags}` : entry.summary
}

async function submitReplicate() {
  const entry = replicateEntry.value
  if (!entry || submitting.value || !canSubmit.value) return
  submitting.value = true
  try {
    let campaignId: number
    if (mode.value === 'new') {
      const created = await marketerAPI.create({
        title: newForm.value.title.trim() || undefined,
        productName: newForm.value.productName.trim(),
        market: 'TH',
        platforms: [entry.platform],
        goal: truncate(entry.summary, 300),
      })
      campaignId = created.id
    } else {
      campaignId = selectedCampaignId.value as number
    }
    await marketerAPI.addReference(campaignId, {
      title: truncate(entry.title, 120),
      transcript: patternBrief(entry),
      notes: notesFor(entry),
      ...(entry.sourceUrl ? { sourceUrl: entry.sourceUrl } : {}),
    })
    toast.success(t('marketer.trending.dialog.created'))
    replicateEntry.value = null
    navigateTo(`/marketer/${campaignId}`)
  } catch (e) {
    toastError(e)
  } finally {
    submitting.value = false
  }
}

onMounted(() => load())
</script>

<style scoped>
.trend-section {
  margin-bottom: 32px;
  padding-bottom: 28px;
  border-bottom: 1px solid var(--border);
}
.trend-head-copy { margin-bottom: 14px; }
.trend-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.trend-sub { margin: 4px 0 0; font-size: 12.5px; color: var(--text-2); }
.trend-disclaimer {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-3);
}

/* === Filters === */
.trend-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.trend-filter-select { width: auto; min-width: 150px; max-width: 210px; }
.trend-search {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: var(--button-height);
  padding: 0 12px;
  flex: 1;
  min-width: 180px;
  max-width: 320px;
  border: 1px solid var(--button-border);
  border-radius: var(--button-radius);
  background: var(--button-bg);
  color: var(--text-3);
  transition: border-color 0.18s var(--ease-out);
}
.trend-search:focus-within { border-color: var(--action-primary); box-shadow: 0 0 0 3px var(--button-focus); }
.trend-search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  font-family: var(--font-body);
  color: var(--text-0);
}
.trend-search input::placeholder { color: var(--text-3); }

/* === Grid === */
.trend-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
  gap: 12px;
}
.trend-more { display: flex; justify-content: center; margin-top: 14px; }
.trend-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 16px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  color: var(--text-3);
  font-size: 12.5px;
  text-align: center;
}
.trend-empty p { margin: 0; }
.trend-empty-art { width: 120px; aspect-ratio: 1; display: grid; place-items: center; border-radius: 18px; }

/* === Dialog === */
.create-dialog { width: 640px; max-width: calc(100vw - 32px); }
.trend-dialog-icon {
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
.trend-pattern-box {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-2);
}
.trend-pattern-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-3);
}
.trend-pattern-summary { margin: 4px 0 10px; font-size: 12.5px; line-height: 1.6; color: var(--text-1); }
.trend-pattern-beats { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow-y: auto; }
.trend-pattern-beat { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.trend-pattern-role {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-2);
  background: var(--bg-hover);
}
.trend-pattern-role.role-hook { color: var(--accent-text); background: var(--accent-bg); }
.trend-pattern-line { color: var(--text-2); line-height: 1.55; }

.trend-mode-row { display: flex; gap: 6px; margin-bottom: 12px; }
.trend-mode {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--button-radius);
  background: var(--button-bg);
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-body);
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s var(--ease-out);
}
.trend-mode:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-0); }
.trend-mode.active { border-color: var(--action-primary); color: var(--action-primary); background: var(--accent-bg); }
.trend-mode:disabled { opacity: 0.45; cursor: not-allowed; }
.trend-mode:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }

.trend-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.mk-required { color: var(--accent-text); }
.trend-fixed-row { display: flex; flex-wrap: wrap; gap: 6px; }
.trend-fixed-row .tag { display: inline-flex; align-items: center; gap: 4px; }

/* === Skeleton === */
.skeleton-card { cursor: default; }
.skeleton-cover {
  aspect-ratio: 9 / 10;
  background: var(--bg-hover);
  animation: trend-skeleton 1.4s ease-in-out infinite;
}
.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: var(--bg-hover);
  animation: trend-skeleton 1.4s ease-in-out infinite;
}
.skeleton-line.w-40 { width: 40%; }
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-80 { width: 80%; }
@keyframes trend-skeleton {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (max-width: 860px) {
  .trend-filter-select { min-width: 130px; }
  .trend-search { max-width: none; }
}
</style>
