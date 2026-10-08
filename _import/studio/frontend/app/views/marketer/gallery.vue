<template>
  <div class="page page-enter">
    <!-- ===== Header ===== -->
    <header class="ga-head">
      <div class="ga-head-copy">
        <button class="btn btn-sm" type="button" @click="navigateTo('/marketer')">
          <ArrowLeft :size="13" :stroke-width="2" />
          {{ t('marketer.gallery.backToCampaigns') }}
        </button>
        <h1 class="ga-title">{{ t('marketer.gallery.title') }}</h1>
        <p class="ga-sub">{{ t('marketer.gallery.subtitle') }}</p>
      </div>
    </header>

    <!-- ===== Summary ===== -->
    <div v-if="!loading" class="ga-summary">
      <div class="ga-stat">
        <strong>{{ summary.total }}</strong>
        <span>{{ t('marketer.gallery.summary.total') }}</span>
      </div>
      <div class="ga-stat">
        <strong>{{ summary.produced }}</strong>
        <span>{{ t('marketer.gallery.summary.produced') }}</span>
      </div>
      <div class="ga-stat">
        <strong>{{ summary.withResults }}</strong>
        <span>{{ t('marketer.gallery.summary.withResults') }}</span>
      </div>
      <div class="ga-stat">
        <strong>{{ fmtCompact(summary.totalViews) }}</strong>
        <span>{{ t('marketer.gallery.summary.totalViews') }}</span>
      </div>
      <div class="ga-stat">
        <strong>{{ fmtThb(summary.totalSalesThb) }}</strong>
        <span>{{ t('marketer.gallery.summary.totalSales') }}</span>
      </div>
    </div>

    <!-- ===== Filter chips ===== -->
    <div class="ga-filters">
      <button
        v-for="f in filterDefs" :key="f.id" type="button"
        class="ga-chip" :class="{ active: filter === f.id }" @click="filter = f.id"
      >
        {{ t(f.label, f.params ? f.params() : {}) }}
        <span class="ga-chip-count">{{ f.count() }}</span>
      </button>
    </div>

    <!-- ===== Entries ===== -->
    <div v-if="loading" class="ga-list" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="ga-row skeleton-card">
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-30"></div>
      </div>
    </div>

    <div v-else-if="visibleEntries.length" class="ga-list">
      <article v-for="e in visibleEntries" :key="e.creativeId" class="ga-row" :style="{ animationDelay: `${(visibleEntries.indexOf(e) % 10) * 0.03}s` }">
        <div class="ga-thumb" aria-hidden="true">
          <img v-if="e.productImage" :src="e.productImage" alt="" loading="lazy" />
          <Package v-else :size="16" :stroke-width="1.8" />
        </div>
        <div class="ga-main">
          <h3 class="ga-row-title truncate">{{ e.angle || e.hook }}</h3>
          <p class="ga-row-sub truncate">{{ e.campaignTitle }} · {{ e.productName }}</p>
          <div class="ga-row-tags">
            <span class="tag" :class="e.status === 'in_production' ? 'tag-success' : 'tag-accent'">
              {{ t(`marketer.gallery.status.${e.status}`) }}
            </span>
            <span class="tag">{{ t(`marketer.formats.${e.format}`) }}</span>
            <span class="tag">{{ t(`marketer.platforms.${e.platform}`) }}</span>
          </div>
        </div>
        <div class="ga-metrics" :class="{ empty: !e.result }">
          <template v-if="e.result">
            <div class="ga-metric">
              <strong>{{ fmtCompact(e.result.views) }}</strong>
              <span>{{ t('marketer.gallery.fields.views') }}</span>
            </div>
            <div class="ga-metric">
              <strong>{{ fmtPct(e.result.engagementRate) }}</strong>
              <span>{{ t('marketer.gallery.fields.engagement') }}</span>
            </div>
            <div class="ga-metric">
              <strong>{{ fmtThb(e.result.salesThb) }}</strong>
              <span>{{ t('marketer.gallery.fields.sales') }}</span>
            </div>
          </template>
          <span v-else class="ga-no-result">{{ t('marketer.gallery.noResult') }}</span>
        </div>
        <div class="ga-actions">
          <button v-if="e.episodeId && e.dramaId" class="btn btn-sm" type="button" @click="navigateTo(`/drama/${e.dramaId}/episode/${e.episodeNumber}`)">
            <Clapperboard :size="12" :stroke-width="2" />
            {{ t('marketer.gallery.openEpisode', { n: e.episodeNumber }) }}
          </button>
          <button class="btn btn-sm btn-primary" type="button" @click="openResult(e)">
            <ClipboardPen :size="12" :stroke-width="2" />
            {{ e.result ? t('marketer.gallery.editResult') : t('marketer.gallery.addResult') }}
          </button>
        </div>
      </article>
    </div>

    <div v-else class="ga-empty">
      <Images :size="26" :stroke-width="1.5" />
      <p class="ga-empty-title">{{ t('marketer.gallery.emptyTitle') }}</p>
      <p class="ga-empty-desc">{{ t('marketer.gallery.emptyDesc') }}</p>
    </div>

    <!-- ===== Result dialog ===== -->
    <div v-if="editEntry" class="overlay" @click.self="closeResult">
      <div class="dialog result-dialog" role="dialog" aria-modal="true" :aria-label="t('marketer.gallery.dialog.title', { title: editEntry.angle || editEntry.hook })">
        <div class="dialog-head">
          <div class="ga-dialog-icon">
            <ClipboardPen :size="18" :stroke-width="1.8" />
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('marketer.gallery.dialog.title', { title: truncate(editEntry.angle || editEntry.hook, 60) }) }}</h2>
            <p class="dialog-desc">{{ t('marketer.gallery.dialog.desc') }}</p>
          </div>
        </div>
        <form class="create-form" @submit.prevent="save">
          <div class="dialog-body">
            <p class="ga-dialog-note">{{ t('marketer.gallery.dialog.manualNote') }}</p>
            <div class="ga-grid-4">
              <label class="field">
                <span class="field-label">{{ t('marketer.gallery.fields.views') }}</span>
                <input v-model.number="form.views" class="input" type="number" min="0" inputmode="numeric" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('marketer.gallery.fields.likes') }}</span>
                <input v-model.number="form.likes" class="input" type="number" min="0" inputmode="numeric" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('marketer.gallery.fields.comments') }}</span>
                <input v-model.number="form.comments" class="input" type="number" min="0" inputmode="numeric" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('marketer.gallery.fields.shares') }}</span>
                <input v-model.number="form.shares" class="input" type="number" min="0" inputmode="numeric" />
              </label>
            </div>
            <div class="ga-grid-2">
              <label class="field">
                <span class="field-label">{{ t('marketer.gallery.fields.sales') }}</span>
                <input v-model="form.salesThb" class="input" type="number" min="0" step="0.01" inputmode="decimal" :placeholder="t('marketer.gallery.dialog.salesPlaceholder')" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('marketer.gallery.fields.postedAt') }}</span>
                <input v-model="form.postedAt" class="input" type="date" />
              </label>
            </div>
            <label class="field">
              <span class="field-label">{{ t('marketer.gallery.fields.postedUrl') }}</span>
              <input v-model="form.postedUrl" class="input" type="url" :placeholder="t('marketer.gallery.dialog.urlPlaceholder')" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('marketer.gallery.fields.note') }}</span>
              <textarea v-model="form.note" class="textarea" rows="2" :placeholder="t('marketer.gallery.dialog.notePlaceholder')" />
            </label>
          </div>
          <div class="dialog-foot">
            <button v-if="editEntry.result" type="button" class="btn btn-danger" :disabled="saving || deleting" @click="remove">
              <Loader2 v-if="deleting" :size="13" class="animate-spin" />
              {{ t('common.delete') }}
            </button>
            <button type="button" class="btn" :disabled="saving" @click="closeResult">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Loader2 v-if="saving" :size="13" class="animate-spin" />
              {{ saving ? t('marketer.gallery.dialog.saving') : t('marketer.gallery.dialog.save') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ClipboardPen, Clapperboard, Images, Loader2, Package } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { galleryAPI, type GalleryEntry, type GallerySummary } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/**
 * Marketer Gallery — คลังผลงาน + ผลตอบรับจริง (docs/ai-marketer/GALLERY.md)
 * ครึ่งหลังของวงจร: ผลิตแล้ว → โพสต์ → กรอกผลจริงจาก TikTok Analytics ต้นทาง → research รอบหน้าใช้เป็น Evidence
 */

const { t } = useI18n()

const loading = ref(true)
const entries = ref<GalleryEntry[]>([])
const summary = ref<GallerySummary>({ total: 0, produced: 0, withResults: 0, totalViews: 0, totalLikes: 0, totalSalesThb: 0 })
const filter = ref<'all' | 'produced' | 'approved' | 'with_results'>('all')

type FilterId = 'all' | 'produced' | 'approved' | 'with_results'
const filterDefs = computed(() => [
  { id: 'all' as FilterId, label: 'marketer.gallery.filters.all', params: null, count: () => summary.value.total },
  { id: 'produced' as FilterId, label: 'marketer.gallery.filters.produced', params: null, count: () => summary.value.produced },
  { id: 'approved' as FilterId, label: 'marketer.gallery.filters.approved', params: null, count: () => summary.value.total - summary.value.produced },
  { id: 'with_results' as FilterId, label: 'marketer.gallery.filters.withResults', params: null, count: () => summary.value.withResults },
])

const visibleEntries = computed(() => {
  if (filter.value === 'produced') return entries.value.filter(e => e.status === 'in_production')
  if (filter.value === 'approved') return entries.value.filter(e => e.status === 'approved')
  if (filter.value === 'with_results') return entries.value.filter(e => !!e.result)
  return entries.value
})

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
function fmtCompact(v: number | null | undefined) {
  if (v === null || v === undefined) return '–'
  return compact.format(v)
}
function fmtThb(v: number | null | undefined) {
  if (v === null || v === undefined) return '–'
  return '฿' + compact.format(v)
}
function fmtPct(v: number | null | undefined) {
  if (v === null || v === undefined) return '–'
  return (v * 100).toFixed(1) + '%'
}
function truncate(v: string, n: number) {
  return v.length > n ? v.slice(0, n - 1) + '…' : v
}

// ===== Result dialog =====
const editEntry = ref<GalleryEntry | null>(null)
const saving = ref(false)
const deleting = ref(false)
const form = ref({ views: '', likes: '', comments: '', shares: '', salesThb: '', postedUrl: '', postedAt: '', note: '' })

function openResult(e: GalleryEntry) {
  editEntry.value = e
  form.value = {
    views: e.result?.views?.toString() ?? '',
    likes: e.result?.likes?.toString() ?? '',
    comments: e.result?.comments?.toString() ?? '',
    shares: e.result?.shares?.toString() ?? '',
    salesThb: e.result?.salesThb?.toString() ?? '',
    postedUrl: e.result?.postedUrl ?? '',
    postedAt: e.result?.postedAt?.slice(0, 10) ?? '',
    note: e.result?.note ?? '',
  }
}
function closeResult() {
  if (!saving.value && !deleting.value) editEntry.value = null
}

async function save() {
  const e = editEntry.value
  if (!e || saving.value) return
  saving.value = true
  try {
    const f = form.value
    const result = await galleryAPI.saveResult(e.creativeId, {
      ...(f.views !== '' ? { views: Number(f.views) } : {}),
      ...(f.likes !== '' ? { likes: Number(f.likes) } : {}),
      ...(f.comments !== '' ? { comments: Number(f.comments) } : {}),
      ...(f.shares !== '' ? { shares: Number(f.shares) } : {}),
      ...(f.salesThb !== '' ? { salesThb: Number(f.salesThb) } : {}),
      ...(f.postedUrl.trim() ? { postedUrl: f.postedUrl.trim() } : {}),
      ...(f.postedAt ? { postedAt: f.postedAt } : {}),
      ...(f.note.trim() ? { note: f.note.trim() } : {}),
    })
    // อัปเดต row ในหน้าเดียว ไม่ต้อง refetch ทั้งหมด
    entries.value = entries.value.map(x => x.creativeId === e.creativeId ? { ...x, result } : x)
    summary.value = {
      ...summary.value,
      withResults: entries.value.filter(x => x.result).length,
      totalViews: entries.value.reduce((s, x) => s + (x.result?.views ?? 0), 0),
      totalLikes: entries.value.reduce((s, x) => s + (x.result?.likes ?? 0), 0),
      totalSalesThb: entries.value.reduce((s, x) => s + (x.result?.salesThb ?? 0), 0),
    }
    toast.success(t('marketer.gallery.dialog.saved'))
    editEntry.value = null
  } catch (err) {
    toastError(err)
  } finally {
    saving.value = false
  }
}

async function remove() {
  const e = editEntry.value
  if (!e || deleting.value) return
  deleting.value = true
  try {
    await galleryAPI.deleteResult(e.creativeId)
    entries.value = entries.value.map(x => x.creativeId === e.creativeId ? { ...x, result: null } : x)
    summary.value = {
      ...summary.value,
      withResults: Math.max(0, summary.value.withResults - 1),
      totalViews: entries.value.reduce((s, x) => s + (x.result?.views ?? 0), 0),
      totalLikes: entries.value.reduce((s, x) => s + (x.result?.likes ?? 0), 0),
      totalSalesThb: entries.value.reduce((s, x) => s + (x.result?.salesThb ?? 0), 0),
    }
    toast.success(t('marketer.gallery.dialog.deleted'))
    editEntry.value = null
  } catch (err) {
    toastError(err)
  } finally {
    deleting.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const res = await galleryAPI.list()
    entries.value = res.entries
    summary.value = res.summary
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page {
  padding: 32px 40px 48px;
  overflow-y: auto;
  height: 100%;
}

/* === Header === */
.ga-head { margin-bottom: 20px; }
.ga-head-copy .btn { margin-bottom: 12px; }
.ga-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-0);
}
.ga-sub { margin: 6px 0 0; font-size: 13px; color: var(--text-2); max-width: 620px; }

/* === Summary === */
.ga-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}
.ga-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
}
.ga-stat strong { font-size: 18px; font-weight: 800; color: var(--text-0); }
.ga-stat span { font-size: 11px; font-weight: 600; color: var(--text-3); }

/* === Filters === */
.ga-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.ga-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--button-bg);
  font-size: 11.5px;
  font-weight: 600;
  font-family: var(--font-body);
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s var(--ease-out);
}
.ga-chip:hover { border-color: var(--border-strong); color: var(--text-0); }
.ga-chip.active { border-color: var(--action-primary); color: var(--action-primary); background: var(--accent-bg); }
.ga-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.ga-chip-count {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  background: var(--bg-hover);
  color: var(--text-2);
}

/* === Rows === */
.ga-list { display: flex; flex-direction: column; gap: 8px; }
.ga-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  animation: fadeUp 0.24s var(--ease-out) both;
}
.ga-row:hover { border-color: var(--border-strong); }
.ga-thumb {
  width: 44px;
  height: 44px;
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
.ga-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ga-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ga-row-title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-0); }
.ga-row-sub { margin: 0; font-size: 11.5px; color: var(--text-3); }
.ga-row-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.ga-row-tags .tag { display: inline-flex; align-items: center; gap: 4px; }
.ga-metrics { display: flex; gap: 18px; flex-shrink: 0; }
.ga-metrics.empty { min-width: 140px; justify-content: center; }
.ga-metric { display: flex; flex-direction: column; align-items: flex-end; }
.ga-metric strong { font-size: 14px; font-weight: 800; color: var(--text-0); line-height: 1.2; }
.ga-metric span { font-size: 10px; color: var(--text-3); }
.ga-no-result { font-size: 11.5px; color: var(--text-3); }
.ga-actions { display: flex; gap: 6px; flex-shrink: 0; }

/* === Empty === */
.ga-empty {
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
.ga-empty-title { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--text-1); }
.ga-empty-desc { margin: 0; font-size: 12.5px; max-width: 380px; }

/* === Dialog === */
.result-dialog { width: 560px; max-width: calc(100vw - 32px); }
.ga-dialog-icon {
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
.ga-dialog-note {
  margin: 0 0 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-3);
}
.ga-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 10px; }
.ga-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }

/* === Skeleton === */
.skeleton-card { display: flex; flex-direction: column; gap: 8px; }
.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: var(--bg-hover);
  animation: ga-skeleton 1.4s ease-in-out infinite;
}
.skeleton-line.w-30 { width: 30%; }
.skeleton-line.w-40 { width: 40%; }
.skeleton-line.w-60 { width: 60%; }
@keyframes ga-skeleton {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (max-width: 900px) {
  .page { padding: 20px 16px 32px; }
  .ga-row { flex-wrap: wrap; }
  .ga-metrics { width: 100%; justify-content: flex-start; }
  .ga-metric { align-items: flex-start; }
  .ga-grid-4 { grid-template-columns: repeat(2, 1fr); }
}
</style>
