<template>
  <div class="page page-enter">
    <!-- ===== Header ===== -->
    <header class="mk-head">
      <div class="mk-head-copy">
        <p class="eyebrow">{{ t('marketer.eyebrow') }}</p>
        <h1 class="mk-title">{{ t('marketer.title') }}</h1>
        <p class="mk-sub">{{ t('marketer.subtitle') }}</p>
      </div>
      <div class="mk-head-actions">
        <button class="btn" type="button" @click="navigateTo('/marketer/gallery')">
          <Images :size="15" :stroke-width="2" />
          {{ t('marketer.list.gallery') }}
        </button>
        <button class="btn btn-primary" type="button" @click="openCreate">
          <Plus :size="15" :stroke-width="2.2" />
          {{ t('marketer.list.newCampaign') }}
        </button>
      </div>
    </header>

    <!-- ===== Trending Videos (Thailand) — Ready to Replicate (docs/ai-marketer/TRENDING.md) ===== -->
    <MarketerTrendingSection />

    <!-- ===== Campaign grid ===== -->
    <div v-if="loading" class="mk-grid" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="mk-card skeleton-card">
        <div class="skeleton-line w-60"></div>
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-80"></div>
      </div>
    </div>

    <div v-else-if="campaigns.length" class="mk-grid">
      <article
        v-for="(c, i) in campaigns"
        :key="c.id"
        class="mk-card"
        :style="{ animationDelay: `${i * 0.04}s` }"
        tabindex="0"
        role="button"
        :aria-label="t('marketer.list.openAria', { title: c.title })"
        @click="open(c)"
        @keydown.enter.self.prevent="open(c)"
        @keydown.space.self.prevent="open(c)"
      >
        <div class="mk-card-top">
          <div class="mk-thumb" aria-hidden="true">
            <img v-if="c.productImages?.[0]" :src="c.productImages[0]" alt="" loading="lazy" />
            <Package v-else :size="16" :stroke-width="1.8" />
          </div>
          <div class="mk-card-heading">
            <h3 class="mk-card-title truncate">{{ c.title }}</h3>
            <p v-if="c.productName && c.productName !== c.title" class="mk-card-product truncate">{{ c.productName }}</p>
          </div>
          <AppMenu :open="menuId === c.id" placement="bottom-end" :min-width="120" @update:open="(v) => { menuId = v ? c.id : null }">
            <template #trigger>
              <button class="mk-more" type="button" :title="t('common.more')" :aria-label="t('common.more')" @click.stop>
                <MoreHorizontal :size="16" :stroke-width="2" />
              </button>
            </template>
            <AppMenuItem danger @click="menuId = null; toDelete = c">{{ t('marketer.list.delete') }}</AppMenuItem>
          </AppMenu>
        </div>
        <p v-if="c.goal" class="mk-goal">{{ c.goal }}</p>
        <div class="mk-card-tags">
          <span class="tag" :class="statusTagClass(c.status)">
            <Loader2 v-if="isBusyStatus(c.status)" :size="10" class="animate-spin" />
            {{ t(`marketer.status.${c.status}`) }}
          </span>
          <span v-for="p in (c.platforms || []).slice(0, 3)" :key="p" class="tag">{{ t(`marketer.platforms.${p}`) }}</span>
          <span v-if="(c.platforms || []).length > 3" class="tag">+{{ c.platforms.length - 3 }}</span>
        </div>
        <div class="mk-card-foot">
          <Clock :size="11" :stroke-width="1.8" />
          {{ fmtDate(c.updatedAt) }}
        </div>
      </article>
    </div>

    <div v-else class="mk-empty">
      <Megaphone :size="26" :stroke-width="1.5" />
      <p class="mk-empty-title">{{ t('marketer.list.emptyTitle') }}</p>
      <p class="mk-empty-desc">{{ t('marketer.list.emptyDesc') }}</p>
      <button class="btn btn-primary" type="button" @click="openCreate">
        <Plus :size="15" :stroke-width="2.2" />
        {{ t('marketer.list.newCampaign') }}
      </button>
    </div>

    <!-- ===== Create dialog ===== -->
    <div v-if="showCreate" class="overlay" @click.self="closeCreate">
      <div class="dialog create-dialog" role="dialog" aria-modal="true" :aria-label="t('marketer.create.title')">
        <div class="dialog-head">
          <div class="mk-dialog-icon">
            <Megaphone :size="18" :stroke-width="1.8" />
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('marketer.create.title') }}</h2>
            <p class="dialog-desc">{{ t('marketer.create.desc') }}</p>
          </div>
        </div>
        <form class="create-form" @submit.prevent="create">
          <div class="dialog-body">
            <MarketerBriefForm v-model="form" :style-presets="stylePresets" />
          </div>
          <div class="dialog-foot">
            <span v-if="!canCreate" class="mk-foot-hint">{{ t('marketer.create.needProduct') }}</span>
            <button type="button" class="btn" :disabled="creating" @click="closeCreate">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="creating || !canCreate">
              <Loader2 v-if="creating" :size="13" class="animate-spin" />
              {{ creating ? t('marketer.create.creating') : t('marketer.create.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <ConfirmDialog
      :open="!!toDelete"
      :title="t('marketer.delete.title')"
      :message="t('marketer.delete.message', { title: toDelete?.title || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="deleting"
      @confirm="remove"
      @cancel="toDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, Images, Loader2, Megaphone, MoreHorizontal, Package, Plus } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { marketerAPI, stylePresetAPI, type Campaign, type CampaignStatus } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { isBusyStatus, POLL_INTERVAL_MS } from '../utils/marketerFlow'

const { t, locale } = useI18n()

const campaigns = ref<Campaign[]>([])
const loading = ref(true)
const showCreate = ref(false)
const creating = ref(false)
const toDelete = ref<Campaign | null>(null)
const deleting = ref(false)
const menuId = ref<number | null>(null)
const stylePresets = ref<any[]>([])

function blankForm() {
  return {
    title: '', productUrl: '', productName: '', productDescription: '', productImages: [] as string[],
    brandNotes: '', market: 'TH', platforms: ['tiktok'] as string[], audience: '', goal: '',
    style: stylePresets.value[0]?.value || '', aspectRatio: '9:16',
  }
}
const form = ref(blankForm())
const canCreate = computed(() => !!(form.value.productName.trim() || form.value.productUrl.trim()))

function statusTagClass(status: CampaignStatus) {
  if (status === 'failed') return 'tag-error'
  if (isBusyStatus(status)) return 'tag-info'
  if (status === 'creatives_ready') return 'tag-success'
  if (status === 'draft') return ''
  return 'tag-accent'
}

function fmtDate(v?: string) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium' })
}

function openCreate() {
  form.value = blankForm()
  showCreate.value = true
}
function closeCreate() {
  if (!creating.value) showCreate.value = false
}

// 列表里有异步任务进行中时轻量轮询，状态标签自动刷新
let pollTimer: ReturnType<typeof setTimeout> | null = null
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = campaigns.value.some(c => isBusyStatus(c.status)) ? setTimeout(() => load(true), POLL_INTERVAL_MS) : null
}

async function load(silent = false) {
  if (!silent) loading.value = true
  try {
    campaigns.value = await marketerAPI.list() || []
  } catch (e) {
    if (!silent) toastError(e)
  } finally {
    loading.value = false
    schedulePoll()
  }
}

async function loadPresets() {
  try {
    stylePresets.value = (await stylePresetAPI.list() as any[]) || []
    if (showCreate.value && !form.value.style && stylePresets.value.length) form.value.style = stylePresets.value[0].value
  } catch {
    // 风格预设缺失不阻塞：后端会落默认风格
  }
}

async function create() {
  if (!canCreate.value || creating.value) return
  creating.value = true
  try {
    const f = form.value
    const c = await marketerAPI.create({
      title: f.title.trim() || undefined,
      productUrl: f.productUrl.trim() || null,
      productName: f.productName.trim(),
      productDescription: f.productDescription.trim() || null,
      productImages: f.productImages,
      brandNotes: f.brandNotes.trim() || null,
      market: f.market,
      platforms: f.platforms as Campaign['platforms'],
      audience: f.audience.trim() || null,
      goal: f.goal.trim() || null,
      style: f.style || undefined,
      aspectRatio: f.aspectRatio as Campaign['aspectRatio'],
    })
    toast.success(t('marketer.create.created'))
    showCreate.value = false
    navigateTo(`/marketer/${c.id}`)
  } catch (e) {
    toastError(e)
  } finally {
    creating.value = false
  }
}

function open(c: Campaign) {
  navigateTo(`/marketer/${c.id}`)
}

async function remove() {
  if (!toDelete.value) return
  deleting.value = true
  try {
    await marketerAPI.del(toDelete.value.id)
    toast.success(t('marketer.delete.deleted'))
    toDelete.value = null
    await load(true)
  } catch (e) {
    toastError(e)
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  load()
  loadPresets()
})
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
.mk-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.mk-head-actions { display: flex; align-items: center; gap: 8px; }
.eyebrow { margin-bottom: 6px; }
.mk-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-0);
}
.mk-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-2);
  max-width: 560px;
}

/* === Grid & cards === */
.mk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.mk-card {
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
.mk-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}
.mk-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--button-focus);
}
.mk-card-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mk-thumb {
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
.mk-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mk-card-heading { flex: 1; min-width: 0; }
.mk-card-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--text-0);
}
.mk-card-product { margin: 2px 0 0; font-size: 11.5px; color: var(--text-3); }
.mk-more {
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
.mk-more:hover { background: var(--bg-hover); color: var(--text-0); }
.mk-more:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-goal {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mk-card-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.mk-card-tags .tag { display: inline-flex; align-items: center; gap: 4px; }
.mk-card-foot {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: auto;
  font-size: 11px;
  color: var(--text-3);
}

/* === Empty === */
.mk-empty {
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
.mk-empty-title { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--text-1); }
.mk-empty-desc { margin: 0 0 14px; font-size: 12.5px; max-width: 380px; }

/* === Create dialog === */
.create-dialog { width: 680px; max-width: calc(100vw - 32px); }
.create-form { display: flex; flex-direction: column; min-height: 0; }
.mk-dialog-icon {
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
.mk-foot-hint { margin-right: auto; align-self: center; font-size: 11.5px; color: var(--text-3); }

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
  .mk-head { flex-direction: column; align-items: stretch; }
}
</style>
