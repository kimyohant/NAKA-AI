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
    <div v-else-if="!loading && reconnectIds.size" class="sc-warn">
      <span>{{ t('social.reconnectBanner') }}</span>
      <button class="btn btn-sm btn-primary" type="button" :disabled="!canConnect?.can || connecting" @click="connect('facebook')">{{ t('social.reconnect') }}</button>
    </div>
    <div v-else-if="!loading && serverOnly" class="card sc-empty">
      <MessagesSquare :size="22" :stroke-width="1.7" />
      <div>
        <h3>{{ t('social.serverOnlyTitle') }}</h3>
        <p>{{ t('social.serverOnlyHint', { reason: canConnect?.reason || '' }) }}</p>
      </div>
    </div>
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
            <p v-if="actionError && busyId === c.id" class="sc-error">{{ t('social.actionFailed') }} <span class="mono">{{ actionError }}</span></p>
            <div v-if="isFailed(c)" class="sc-actions">
              <button v-if="c.replyText" class="btn btn-sm btn-primary" type="button" :disabled="busyId === c.id || sendOff(c)" @click="act(c.id, () => socialAPI.approveComment(c.id))">{{ t('social.sendAgain') }}</button>
              <button class="btn btn-sm" type="button" :disabled="busyId === c.id" @click="act(c.id, () => socialAPI.closeComment(c.id))">{{ t('social.doNotReply') }}</button>
            </div>
            <div v-if="c.status === 'draft'" class="sc-actions">
              <template v-if="!editing[c.id]">
                <button class="btn btn-sm btn-primary" type="button" :disabled="busyId === c.id || sendOff(c)" @click="act(c.id, () => socialAPI.approveComment(c.id))">{{ t('social.approve') }}</button>
                <button class="btn btn-sm" type="button" :disabled="busyId === c.id" @click="startEdit(c)">{{ t('social.edit') }}</button>
                <button class="btn btn-sm" type="button" :disabled="busyId === c.id" @click="act(c.id, () => socialAPI.rejectComment(c.id))">{{ t('social.reject') }}</button>
              </template>
              <template v-else>
                <textarea v-model="drafts[c.id]" class="input sc-editor" rows="2" />
                <button class="btn btn-sm btn-primary" type="button" :disabled="busyId === c.id || sendOff(c)" @click="act(c.id, () => socialAPI.sendComment(c.id, drafts[c.id] || ''))">{{ t('social.send') }}</button>
                <button class="btn btn-sm" type="button" @click="cancelEdit(c.id)">{{ t('social.cancel') }}</button>
              </template>
            </div>
            <div v-if="c.status === 'needs_human'" class="sc-actions sc-col-actions">
              <textarea v-model="drafts[c.id]" class="input sc-editor" rows="2" :placeholder="t('social.replyPlaceholder')" />
              <div class="sc-actions">
                <button class="btn btn-sm btn-primary" type="button" :disabled="busyId === c.id || sendOff(c)" @click="act(c.id, () => socialAPI.sendComment(c.id, drafts[c.id] || ''))">{{ t('social.send') }}</button>
                <button class="btn btn-sm" type="button" :disabled="busyId === c.id" @click="helpDraft(c)">{{ busyId === c.id && helping ? t('social.drafting') : t('social.helpDraft') }}</button>
                <button class="btn btn-sm" type="button" :disabled="busyId === c.id" @click="act(c.id, () => socialAPI.closeComment(c.id))">{{ t('social.doNotReply') }}</button>
              </div>
            </div>
            <div v-if="c.status === 'skipped'" class="sc-actions">
              <button class="btn btn-sm" type="button" :disabled="busyId === c.id" @click="act(c.id, () => socialAPI.bringBackComment(c.id))">{{ t('social.bringBack') }}</button>
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
import { socialAPI, type SocialAccount, type SocialBoardComment, type SocialCanConnect } from '~/composables/useApi'

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
const drafts = ref<Record<number, string>>({})
const editing = ref<Record<number, boolean>>({})
const busyId = ref<number | null>(null)
const helping = ref(false)
const actionError = ref('')
const canConnect = ref<SocialCanConnect | null>(null)
const connecting = ref(false)

/** server-only empty state: connect not possible and no account exists */
const serverOnly = computed(() => !!canConnect.value && !canConnect.value.can && !accounts.value.length)

/** Reconnect runs the same login flow as Connect; the browser leaves for the Platform */
async function connect(platform: string) {
  connecting.value = true
  actionError.value = ''
  try {
    const { url } = await socialAPI.startLogin(platform)
    window.location.href = url
  } catch (err: any) {
    actionError.value = err?.message || ''
    connecting.value = false
  }
}

/** a send failed but the card stays: show send-again / do-not-reply */
function isFailed(c: SocialBoardComment): boolean {
  return !!c.statusNote && c.statusNote.startsWith('send failed:')
}

/** send is off for drafts of a reconnect-needed account (ticket 08) */
const reconnectIds = computed(() => new Set(
  accounts.value.filter(a => a.status === 'reconnect_needed').map(a => a.id),
))
function sendOff(c: SocialBoardComment): boolean {
  return reconnectIds.value.has(c.accountId)
}

/** run a card action, then reload so the card moves to its new column */
async function act(id: number, fn: () => Promise<unknown>) {
  busyId.value = id
  actionError.value = ''
  helping.value = false
  try {
    await fn()
    delete drafts.value[id]
    delete editing.value[id]
    await reload()
  } catch (err: any) {
    actionError.value = err?.message || ''
  } finally {
    busyId.value = null
  }
}

function startEdit(c: SocialBoardComment) {
  drafts.value[c.id] = c.replyText || ''
  editing.value[c.id] = true
}

function cancelEdit(id: number) {
  delete drafts.value[id]
  delete editing.value[id]
}

/** "help me draft" fills the text box; it never publishes */
async function helpDraft(c: SocialBoardComment) {
  busyId.value = c.id
  actionError.value = ''
  helping.value = true
  try {
    const { text } = await socialAPI.helpDraft(c.id)
    drafts.value[c.id] = text
  } catch (err: any) {
    actionError.value = err?.message || ''
  } finally {
    busyId.value = null
    helping.value = false
  }
}

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
    const [cc, acc, list] = await Promise.all([
      socialAPI.canConnect('facebook').catch(() => null),
      socialAPI.accounts(),
      socialAPI.comments({
        account_id: accountId.value || undefined,
        fallback_only: fallbackOnly.value || undefined,
      }),
    ])
    if (cc) canConnect.value = cc
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
.sc-warn { margin: 0 0 12px; font-size: 12.5px; color: var(--warn, #f59e0b); padding: 10px 14px; border: 1px solid color-mix(in srgb, #f59e0b 40%, transparent); border-radius: var(--radius); background: color-mix(in srgb, #f59e0b 10%, transparent); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-warn .btn { margin-left: auto; }
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
.sc-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.sc-col-actions { flex-direction: column; align-items: stretch; }
.sc-col-actions .sc-actions { margin-top: 0; }
.sc-editor { width: 100%; min-height: 52px; resize: vertical; font-size: 12.5px; }
@media (max-width: 1180px) { .sc-board { grid-template-columns: repeat(2, minmax(220px, 1fr)); } }
@media (max-width: 760px) { .page { padding: 20px 16px 32px; } .sc-board { grid-template-columns: 1fr; } }
</style>
