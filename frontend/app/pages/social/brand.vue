<template>
  <div class="page page-enter">
    <header class="sc-head">
      <div>
        <p class="eyebrow">{{ t('social.eyebrow') }}</p>
        <h1 class="sc-title">{{ t('social.brandPage.title') }}</h1>
        <p class="sc-sub">{{ t('social.brandPage.subtitle') }}</p>
      </div>
      <div class="sc-head-actions">
        <NuxtLink to="/social" class="btn btn-sm">{{ t('social.title') }}</NuxtLink>
        <NuxtLink to="/social/accounts" class="btn btn-sm">{{ t('social.accounts') }}</NuxtLink>
      </div>
    </header>

    <div class="card sc-picker">
      <label class="field sc-flex">
        <span class="field-label">{{ t('social.brandPage.pickAccount') }}</span>
        <select v-model="accountId" class="input">
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.name || a.platform }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="sc-error">
      {{ t('social.brandPage.loadFailed') }} <span class="mono">{{ error }}</span>
      <button class="btn btn-sm" type="button" @click="reload">{{ t('social.brandPage.retry') }}</button>
    </p>
    <div v-else-if="serverOnly" class="card sc-empty">
      <div>
        <h3>{{ t('social.serverOnlyTitle') }}</h3>
        <p>{{ t('social.serverOnlyHint', { reason: canConnect?.reason || '' }) }}</p>
      </div>
    </div>
    <div v-else-if="accountId" class="card sc-form">
      <label class="field">
        <span class="field-label">{{ t('social.brandPage.about') }} ({{ form.about.length }}/500)</span>
        <textarea v-model="form.about" class="input" rows="3" maxlength="500" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('social.brandPage.tone') }} ({{ form.tone.length }}/200)</span>
        <textarea v-model="form.tone" class="input" rows="2" maxlength="200" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('social.brandPage.faq') }} ({{ form.faq.length }}/3000)</span>
        <textarea v-model="form.faq" class="input" rows="6" maxlength="3000" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('social.brandPage.forbidden') }} ({{ form.forbidden.length }}/500)</span>
        <textarea v-model="form.forbidden" class="input" rows="2" maxlength="500" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('social.brandPage.defaultLanguage') }}</span>
        <select v-model="form.defaultLanguage" class="input">
          <option value="th">ไทย</option>
          <option value="en">English</option>
        </select>
      </label>
      <div class="sc-actions">
        <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="save">
          {{ t('social.brandPage.save') }}
        </button>
        <span v-if="saved" class="sc-saved">{{ t('social.brandPage.saved') }}</span>
        <span v-if="saveError" class="sc-error">{{ t('social.brandPage.saveFailed') }} <span class="mono">{{ saveError }}</span></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { socialAPI, type SocialAccount, type SocialCanConnect } from '~/composables/useApi'

const { t } = useI18n()
const route = useRoute()

const accounts = ref<SocialAccount[]>([])
const accountId = ref(0)
const canConnect = ref<SocialCanConnect | null>(null)
const form = ref({ about: '', tone: '', faq: '', forbidden: '', defaultLanguage: 'th' })
const error = ref('')
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')

/** server-only empty state: connect not possible and no account exists */
const serverOnly = computed(() => !!canConnect.value && !canConnect.value.can && !accounts.value.length)

async function reload() {
  error.value = ''
  try {
    const [cc, res] = await Promise.all([
      socialAPI.canConnect('facebook').catch(() => null),
      socialAPI.accounts(),
    ])
    if (cc) canConnect.value = cc
    accounts.value = res.items
    const q = Number(route.query.account_id)
    accountId.value = res.items.some(a => a.id === q) ? q : (res.items[0]?.id ?? 0)
    if (accountId.value) await loadBrand(accountId.value)
  } catch (err: any) {
    error.value = err?.message || ''
  }
}

async function loadBrand(id: number) {
  error.value = ''
  saved.value = false
  try {
    const b = await socialAPI.brand(id)
    form.value = {
      about: b.about ?? '',
      tone: b.tone ?? '',
      faq: b.faq ?? '',
      forbidden: b.forbidden ?? '',
      defaultLanguage: b.defaultLanguage || 'th',
    }
  } catch (err: any) {
    error.value = err?.message || ''
  }
}

async function save() {
  if (!accountId.value || saving.value) return
  saving.value = true
  saved.value = false
  saveError.value = ''
  try {
    await socialAPI.updateBrand(accountId.value, {
      about: form.value.about,
      tone: form.value.tone,
      faq: form.value.faq,
      forbidden: form.value.forbidden,
      default_language: form.value.defaultLanguage,
    })
    saved.value = true
  } catch (err: any) {
    saveError.value = err?.message || ''
  } finally {
    saving.value = false
  }
}

watch(accountId, id => { if (id) loadBrand(id) })
onMounted(reload)
</script>

<style scoped>
.page { padding: 32px 40px 48px; overflow-y: auto; height: 100%; }
.sc-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.sc-title { margin: 2px 0 4px; font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--text-0); }
.sc-sub { margin: 0; font-size: 13px; color: var(--text-2); max-width: 640px; }
.sc-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-picker { padding: 12px 16px; margin-bottom: 14px; }
.sc-empty { display: flex; align-items: center; gap: 14px; padding: 16px 18px; margin-bottom: 14px; }
.sc-empty h3 { margin: 0 0 2px; font-size: 15px; }
.sc-empty p { margin: 0; font-size: 12.5px; color: var(--text-2); }
.sc-flex { flex: 1; min-width: 200px; }
.sc-error { margin: 0 0 12px; font-size: 12.5px; color: var(--danger, #ef4444); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sc-form { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; max-width: 720px; }
.sc-form .input { width: 100%; }
.sc-form textarea.input { resize: vertical; }
.sc-actions { display: flex; align-items: center; gap: 10px; }
.sc-saved { font-size: 12.5px; color: #22c55e; }
@media (max-width: 760px) { .page { padding: 20px 16px 32px; } }
</style>
