<template>
  <div class="page page-enter">
    <header class="sc-head">
      <div>
        <p class="eyebrow">{{ t('social.eyebrow') }}</p>
        <h1 class="sc-title">{{ t('social.title') }}</h1>
        <p class="sc-sub">{{ t('social.subtitle') }}</p>
      </div>
      <div class="sc-head-actions">
        <NuxtLink to="/social/accounts" class="btn btn-sm">{{ t('social.accounts') }}</NuxtLink>
        <NuxtLink to="/social/brand" class="btn btn-sm">{{ t('social.brand') }}</NuxtLink>
      </div>
    </header>

    <div class="card sc-filters">
      <label class="field sc-flex">
        <span class="field-label">{{ t('social.account') }}</span>
        <select v-model="accountId" class="input">
          <option :value="0">{{ t('social.allAccounts') }}</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name || a.platform }}</option>
        </select>
      </label>
      <label class="sc-check"><input v-model="fallbackOnly" type="checkbox" /> {{ t('social.fallbackOnly') }}</label>
    </div>

    <p v-if="error" class="sc-error">
      {{ t('social.loadFailed') }} <span class="mono">{{ error }}</span>
      <button class="btn btn-sm" type="button" @click="reload">{{ t('social.retry') }}</button>
    </p>
    <div v-else-if="!loading && !accounts.length" class="card sc-empty">
      <MessagesSquare :size="22" :stroke-width="1.7" />
      <div>
        <h3>{{ t('social.noAccountYet') }}</h3>
        <p>{{ t('social.noAccountHint') }}</p>
      </div>
      <NuxtLink to="/social/accounts" class="btn btn-primary">{{ t('social.goAccounts') }}</NuxtLink>
    </div>
    <div v-else-if="!loading && !visible.length" class="card sc-empty">
      <Inbox :size="22" :stroke-width="1.7" />
      <div>
        <h3>{{ t('social.noCommentsYet') }}</h3>
        <p>{{ t('social.noCommentsHint') }}</p>
      </div>
    </div>
    <div v-else class="sc-board">
      <section v-for="col in columns" :key="col.status" class="card sc-col" :aria-label="col.label">
        <h2 class="sc-col-title">{{ col.label }} <span class="tag">{{ byStatus(col.status).length }}</span></h2>
        <ul class="sc-cards">
          <li v-for="c in byStatus(col.status)" :key="c.id" class="sc-card">
            <div class="sc-card-top">
              <span class="tag">{{ c.platform }}</span>
              <span class="sc-author">{{ c.authorName || t('social.unknownAuthor') }}</span>
              <span class="sc-age">{{ age(c.commentedAt) }}</span>
            </div>
            <p class="sc-text">{{ c.text }}</p>
            <p v-if="c.replyText" class="sc-reply">{{ c.replyText }}</p>
            <div class="sc-card-foot">
              <span v-if="c.fallback" class="tag sc-tag-fallback">{{ t('social.fallbackBadge') }}</span>
              <span v-if="c.statusNote" class="sc-note">{{ c.statusNote }}</span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Inbox, MessagesSquare } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { socialAPI, type SocialAccount, type SocialBoardComment } from '~/composables/useApi'

const { t } = useI18n()

const STATUS_ORDER = ['needs_human', 'draft', 'queued', 'replied', 'skipped'] as const
const columns = computed(() => STATUS_ORDER.map(s => ({
  status: s,
  label: t(`social.column.${s === 'needs_human' ? 'needsHuman' : s}`),
})))

const accounts = ref<SocialAccount[]>([])
const comments = ref<SocialBoardComment[]>([])
const accountId = ref(0)
const fallbackOnly = ref(false)
const loading = ref(true)
const error = ref('')

/** comments in state `new` are not shown in any column (judged in later tickets) */
const visible = computed(() => comments.value.filter(c => c.status !== 'new'))
const byStatus = (status: string) => visible.value.filter(c => c.status === status)

function age(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return t('social.justNow')
  if (min < 60) return t('social.minutesAgo', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return t('social.hoursAgo', { n: h })
  return t('social.daysAgo', { n: Math.floor(h / 24) })
}

async function reload() {
  loading.value = true
  error.value = ''
  try {
    const [acc, list] = await Promise.all([
      socialAPI.accounts(),
      socialAPI.comments({
        account_id: accountId.value || undefined,
        fallback_only: fallbackOnly.value || undefined,
      }),
    ])
    accounts.value = acc.items
    comments.value = list.items
  } catch (err: any) {
    error.value = err?.message || ''
  } finally {
    loading.value = false
  }
}

watch([accountId, fallbackOnly], reload)
onMounted(reload)
</script>

<style scoped>
.page { padding: 32px 40px 48px; overflow-y: auto; height: 100%; }
.sc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.sc-title { margin: 2px 0 4px; font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--text-0); }
.sc-sub { margin: 0; font-size: 13px; color: var(--text-2); max-width: 640px; }
.sc-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-filters { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; padding: 12px 16px; margin-bottom: 14px; }
.sc-flex { flex: 1; min-width: 200px; }
.sc-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-1); padding-bottom: 10px; }
.sc-error { margin: 0 0 12px; font-size: 12.5px; color: var(--danger, #ef4444); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-empty { display: flex; align-items: center; gap: 14px; padding: 16px 18px; margin-bottom: 14px; }
.sc-empty h3 { margin: 0 0 2px; font-size: 15px; }
.sc-empty p { margin: 0; font-size: 12.5px; color: var(--text-2); }
.sc-empty .btn { margin-left: auto; }
.sc-board { display: grid; grid-template-columns: repeat(5, minmax(220px, 1fr)); gap: 12px; align-items: start; }
.sc-col { display: flex; flex-direction: column; gap: 8px; padding: 12px; min-height: 120px; }
.sc-col-title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-0); display: flex; align-items: center; gap: 6px; }
.sc-cards { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; max-height: 70vh; overflow-y: auto; }
.sc-card { padding: 10px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-soft); }
.sc-card-top { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.sc-author { font-size: 12px; font-weight: 700; color: var(--text-0); }
.sc-age { margin-left: auto; font-size: 11px; color: var(--text-3); }
.sc-card p { margin: 0 0 4px; font-size: 12.5px; line-height: 1.5; }
.sc-text { color: var(--text-1); }
.sc-reply { color: var(--text-0); padding-left: 10px; border-left: 2px solid var(--accent); }
.sc-card-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sc-tag-fallback { background: color-mix(in srgb, #f59e0b 18%, transparent); color: #f59e0b; border-color: color-mix(in srgb, #f59e0b 40%, transparent); }
.sc-note { font-size: 11.5px; color: var(--text-3); }
@media (max-width: 1180px) { .sc-board { grid-template-columns: repeat(2, minmax(220px, 1fr)); } }
@media (max-width: 760px) { .page { padding: 20px 16px 32px; } .sc-board { grid-template-columns: 1fr; } }
</style>
