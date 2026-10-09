<template>
  <div class="gate">
    <form class="gate-card" @submit.prevent="submit">
      <div class="gate-brand">
        <img :src="brandLogo" alt="" class="gate-logo" />
        <div>
          <p class="gate-kicker">{{ t('admin.kicker') }}</p>
          <h1 class="gate-title">{{ t('admin.title') }}</h1>
        </div>
      </div>
      <p class="gate-desc">{{ t('admin.login.desc') }}</p>
      <label class="field">
        <span class="field-label">{{ t('admin.login.token') }}</span>
        <input v-model="token" class="input" type="password" autocomplete="current-password" :placeholder="t('admin.login.tokenPlaceholder')" autofocus />
      </label>
      <label class="gate-remember">
        <input v-model="remember" type="checkbox" />
        {{ t('admin.login.remember') }}
      </label>
      <p v-if="error" class="gate-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary gate-submit" type="submit" :disabled="busy || !token.trim()">
        <Loader2 v-if="busy" :size="14" class="animate-spin" />
        <LogIn v-else :size="14" :stroke-width="2" />
        {{ t('admin.login.submit') }}
      </button>
      <p class="field-hint">{{ t('admin.login.hint') }}</p>
      <p class="field-hint">{{ t('admin.login.ssoHint') }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
// Asks for the server's ADMIN_TOKEN when /settings is opened by someone the backend does not already treat
// as an admin (single-user mode with ADMIN_TOKEN set). naka-ai admins signed in through SSO never see it.
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LogIn, Loader2 } from 'lucide-vue-next'
import brandLogo from '~/assets/brand-logo.svg'
import { adminSessionAPI } from '~/composables/useApi'
import { saveAdminToken } from '~/composables/useAdminToken'

const emit = defineEmits<{ unlocked: [] }>()
const { t } = useI18n()
const token = ref('')
const remember = ref(false)
const busy = ref(false)
const error = ref('')

async function submit() {
  const value = token.value.trim()
  if (!value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await adminSessionAPI.check(value)
    saveAdminToken(value, remember.value)
    emit('unlocked')
  } catch (e: any) {
    error.value = e?.status === 401 ? t('admin.login.invalid') : t('admin.login.unreachable')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.gate { display: flex; justify-content: center; padding: 48px 16px; }
.gate-card {
  width: min(420px, 100%); display: flex; flex-direction: column; gap: 14px;
  padding: 28px; border-radius: var(--radius-xl); border: 1px solid var(--border);
  background: var(--surface-raised); box-shadow: var(--shadow-elevated);
}
.gate-brand { display: flex; align-items: center; gap: 12px; }
.gate-logo { width: 40px; height: 40px; }
.gate-kicker { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); }
.gate-title { margin: 0; font: 800 22px var(--font-display); color: var(--text-0); }
.gate-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-2); }
.gate-error { margin: 0; font-size: 12.5px; color: var(--error); }
.gate-remember { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-1); }
.gate-submit { justify-content: center; height: 42px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { margin: 0; font-size: 11px; line-height: 1.5; color: var(--text-3); }
</style>
