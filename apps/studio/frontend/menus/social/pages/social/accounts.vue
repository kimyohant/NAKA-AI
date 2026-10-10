<template>
  <div class="page page-enter">
    <header class="sc-head">
      <div>
        <p class="eyebrow">{{ t('social.eyebrow') }}</p>
        <h1 class="sc-title">{{ t('social.accountsPage.title') }}</h1>
        <p class="sc-sub">{{ t('social.accountsPage.subtitle') }}</p>
      </div>
      <div class="sc-head-actions">
        <NuxtLink to="/social" class="btn btn-sm">{{ t('social.title') }}</NuxtLink>
        <NuxtLink to="/social/brand" class="btn btn-sm">{{ t('social.brand') }}</NuxtLink>
      </div>
    </header>

    <p v-if="error" class="sc-error">
      {{ t('social.loadFailed') }} <span class="mono">{{ error }}</span>
      <button class="btn btn-sm" type="button" @click="reload">{{ t('social.retry') }}</button>
    </p>
    <div v-else-if="!loading && serverOnly" class="card sc-empty">
      <MessagesSquare :size="22" :stroke-width="1.7" />
      <div>
        <h3>{{ t('social.serverOnlyTitle') }}</h3>
        <p>{{ t('social.serverOnlyHint', { reason: canConnect?.reason || '' }) }}</p>
      </div>
    </div>
    <div v-else-if="!loading && !accounts.length && !pending.items.length" class="card sc-empty">
      <MessagesSquare :size="22" :stroke-width="1.7" />
      <div>
        <h3>{{ t('social.accountsPage.empty') }}</h3>
        <p>{{ t('social.accountsPage.emptyHint') }}</p>
      </div>
    </div>
    <div v-else>
    <section class="card sc-connect">
      <div>
        <h3>{{ t('social.connect') }}</h3>
        <p v-if="canConnect?.can" class="sc-meta">{{ t('social.pendingHint') }}</p>
        <p v-else-if="canConnect" class="sc-meta">{{ t('social.connectUnavailable', { reason: canConnect.reason || '' }) }}</p>
      </div>
      <button class="btn btn-sm btn-primary" type="button" :disabled="!canConnect?.can || connecting" @click="connect('facebook')">
        {{ connecting ? t('social.connectStarted') : t('social.connect') }}
      </button>
      <p v-if="connectError" class="sc-error">{{ t('social.connectFailed') }} <span class="mono">{{ connectError }}</span></p>
    </section>

    <section v-if="pending.items.length" class="card sc-pending">
      <h3>{{ t('social.pendingTitle') }}</h3>
      <p class="sc-meta">{{ t('social.pendingHint') }}</p>
      <label v-for="p in pending.items" :key="p.platformAccountId" class="sc-check">
        <input v-model="ticked" type="checkbox" :value="p.platformAccountId" />
        <img v-if="p.avatarUrl" :src="p.avatarUrl" class="sc-avatar" alt="" />
        {{ p.name }}
      </label>
      <div class="sc-actions">
        <button class="btn btn-sm btn-primary" type="button" :disabled="!ticked.length || savingPending" @click="savePending">
          {{ t('social.savePages') }}
        </button>
      </div>
      <p v-if="pendingError" class="sc-error">{{ pendingError }}</p>
    </section>

    <div v-if="accounts.length" class="sc-grid">
      <section v-for="a in accounts" :key="a.id" class="card sc-card">
        <div class="sc-card-top">
          <img v-if="a.avatarUrl" :src="a.avatarUrl" class="sc-avatar" alt="" />
          <strong class="sc-name">{{ a.name || a.platform }}</strong>
          <span class="tag">{{ a.platform }}</span>
          <span class="tag" :class="a.status === 'connected' ? 'sc-tag-ok' : 'sc-tag-warn'">
            {{ a.status === 'connected' ? t('social.accountsPage.statusConnected') : t('social.accountsPage.statusReconnect') }}
          </span>
        </div>
        <div class="sc-rows">
          <label class="field">
            <span class="field-label">{{ t('social.accountsPage.replyMode') }}</span>
            <select class="input" :value="a.replyMode" @change="save(a, { reply_mode: ($event.target as HTMLSelectElement).value as 'draft' | 'auto' })">
              <option value="draft">{{ t('social.accountsPage.modeDraft') }}</option>
              <option value="auto">{{ t('social.accountsPage.modeAuto') }}</option>
            </select>
          </label>
          <p v-if="a.replyMode === 'auto'" class="sc-note">{{ t('social.accountsPage.autoNote') }}</p>
          <label class="sc-check">
            <input type="checkbox" :checked="a.watching" @change="save(a, { watching: ($event.target as HTMLInputElement).checked })" />
            {{ t('social.accountsPage.watching') }}
          </label>
          <label class="field">
            <span class="field-label">{{ t('social.accountsPage.watchDays') }}</span>
            <input class="input" type="number" min="1" max="30" :value="a.watchDays" @change="save(a, { watch_days: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label class="sc-check">
            <input type="checkbox" :checked="a.replyToPraise" @change="save(a, { reply_to_praise: ($event.target as HTMLInputElement).checked })" />
            {{ t('social.accountsPage.replyToPraise') }}
          </label>
        </div>
        <div class="sc-card-foot">
          <NuxtLink :to="`/social/brand?account_id=${a.id}`" class="btn btn-sm">{{ t('social.accountsPage.toBrand') }}</NuxtLink>
          <button v-if="a.status === 'reconnect_needed'" class="btn btn-sm btn-primary" type="button" :disabled="!canConnect?.can || connecting" @click="connect('facebook')">{{ t('social.reconnect') }}</button>
          <button class="btn btn-sm" type="button" @click="disconnect(a)">{{ t('social.disconnect') }}</button>
          <span class="sc-meta">{{ checkedText(a) }}</span>
          <span v-if="isPaused(a)" class="sc-meta">{{ t('social.accountsPage.pausedUntil', { t: shortTime(a.pausedUntil) }) }}</span>
        </div>
        <p v-if="saveError[a.id]" class="sc-error">{{ t('social.accountsPage.saveFailed') }} <span class="mono">{{ saveError[a.id] }}</span></p>
      </section>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MessagesSquare } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { socialAPI, type SocialAccount, type SocialCanConnect, type SocialPendingPage, type SocialSettingsInput } from '~/composables/useApi'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const accounts = ref<SocialAccount[]>([])
const loading = ref(true)
const error = ref('')
const saveError = ref<Record<number, string>>({})
const canConnect = ref<SocialCanConnect | null>(null)
const connecting = ref(false)
const connectError = ref('')
const pending = ref<{ login: string; platform: string; items: SocialPendingPage[] }>({ login: '', platform: '', items: [] })
const ticked = ref<string[]>([])
const savingPending = ref(false)
const pendingError = ref('')

/** server-only empty state: connect not possible and no account exists */
const serverOnly = computed(() => !!canConnect.value && !canConnect.value.can && !accounts.value.length)

function checkedText(a: SocialAccount): string {
  if (!a.lastPolledAt) return t('social.accountsPage.checkedNever')
  const ms = Date.now() - Date.parse(a.lastPolledAt)
  if (!Number.isFinite(ms) || ms < 0) return t('social.accountsPage.checkedNever')
  const min = Math.floor(ms / 60000)
  if (min < 1) return t('social.accountsPage.checkedJustNow')
  return t('social.accountsPage.checkedAgo', { n: min })
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** show "paused until" only while the pause is still in effect */
function isPaused(a: SocialAccount): boolean {
  if (!a.pausedUntil) return false
  const t = Date.parse(a.pausedUntil)
  return Number.isFinite(t) && t > Date.now()
}

async function reload() {
  loading.value = true
  error.value = ''
  try {
    const [cc, res] = await Promise.all([
      socialAPI.canConnect('facebook').catch(() => ({ can: false, reason: '' }) as SocialCanConnect),
      socialAPI.accounts(),
    ])
    canConnect.value = cc
    accounts.value = res.items
    await loadPending()
  } catch (err: any) {
    error.value = err?.message || ''
  } finally {
    loading.value = false
  }
}

/** after the OAuth callback lands back here (?login=&platform=), fetch the tick-list */
async function loadPending() {
  pendingError.value = ''
  const login = String(route.query.login || '')
  const platform = String(route.query.platform || '')
  if (!login || !platform) {
    pending.value = { login: '', platform: '', items: [] }
    ticked.value = []
    return
  }
  try {
    const res = await socialAPI.pendingPages(platform, login)
    pending.value = { login, platform, items: res.items }
    ticked.value = res.items.map(p => p.platformAccountId)
  } catch (err: any) {
    pending.value = { login, platform, items: [] }
    pendingError.value = t('social.pendingExpired')
  }
}

async function savePending() {
  if (!ticked.value.length || savingPending.value) return
  savingPending.value = true
  pendingError.value = ''
  try {
    await socialAPI.savePages(pending.value.platform, pending.value.login, ticked.value)
    await router.replace({ path: '/social/accounts' })
    pending.value = { login: '', platform: '', items: [] }
    ticked.value = []
    await reload()
  } catch (err: any) {
    pendingError.value = `${t('social.saveFailed')} ${err?.message || ''}`
  } finally {
    savingPending.value = false
  }
}

/** Connect and Reconnect run the same login flow; the browser leaves for the Platform */
async function connect(platform: string) {
  connecting.value = true
  connectError.value = ''
  try {
    const { url } = await socialAPI.startLogin(platform)
    window.location.href = url
  } catch (err: any) {
    connectError.value = err?.message || ''
    connecting.value = false
  }
}

async function disconnect(a: SocialAccount) {
  if (!window.confirm(t('social.disconnectConfirm'))) return
  delete saveError.value[a.id]
  try {
    await socialAPI.disconnect(a.id)
    await reload()
  } catch (err: any) {
    saveError.value[a.id] = `${t('social.disconnectFailed')} ${err?.message || ''}`
  }
}

async function save(a: SocialAccount, patch: SocialSettingsInput) {
  delete saveError.value[a.id]
  const prev = { ...a }
  Object.assign(a, {
    replyMode: patch.reply_mode ?? a.replyMode,
    watching: patch.watching ?? a.watching,
    watchDays: patch.watch_days ?? a.watchDays,
    replyToPraise: patch.reply_to_praise ?? a.replyToPraise,
  })
  try {
    const updated = await socialAPI.updateSettings(a.id, patch)
    Object.assign(a, updated)
  } catch (err: any) {
    Object.assign(a, prev)
    saveError.value[a.id] = err?.message || ''
  }
}

onMounted(reload)
</script>

<style scoped>
.page { padding: 32px 40px 48px; overflow-y: auto; height: 100%; }
.sc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.sc-title { margin: 2px 0 4px; font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--text-0); }
.sc-sub { margin: 0; font-size: 13px; color: var(--text-2); max-width: 640px; }
.sc-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-error { margin: 0 0 12px; font-size: 12.5px; color: var(--danger, #ef4444); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-empty { display: flex; align-items: center; gap: 14px; padding: 16px 18px; margin-bottom: 14px; }
.sc-empty h3 { margin: 0 0 2px; font-size: 15px; }
.sc-empty p { margin: 0; font-size: 12.5px; color: var(--text-2); }
.sc-grid { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 12px; align-items: start; }
.sc-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
.sc-card-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
.sc-name { font-size: 14px; color: var(--text-0); }
.sc-tag-ok { background: color-mix(in srgb, #22c55e 18%, transparent); color: #22c55e; border-color: color-mix(in srgb, #22c55e 40%, transparent); }
.sc-tag-warn { background: color-mix(in srgb, #f59e0b 18%, transparent); color: #f59e0b; border-color: color-mix(in srgb, #f59e0b 40%, transparent); }
.sc-rows { display: flex; flex-direction: column; gap: 8px; }
.sc-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-1); }
.sc-note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--text-2); padding-left: 10px; border-left: 2px solid var(--accent); }
.sc-card-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-connect { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 16px; margin-bottom: 12px; }
.sc-connect h3 { margin: 0 0 2px; font-size: 14px; }
.sc-connect .sc-meta { margin: 0; }
.sc-connect .btn { margin-left: auto; }
.sc-pending { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; margin-bottom: 12px; }
.sc-pending h3 { margin: 0; font-size: 14px; }
.sc-pending .sc-meta { margin: 0; }
.sc-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
.sc-meta { font-size: 11.5px; color: var(--text-3); }
@media (max-width: 900px) { .sc-grid { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .page { padding: 20px 16px 32px; } }
</style>
