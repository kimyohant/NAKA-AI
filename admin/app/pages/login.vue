<template>
  <div class="login">
    <form class="login-card" @submit.prevent="submit">
      <div class="login-brand">
        <img :src="brandLogo" alt="" class="login-logo" />
        <div>
          <p class="login-kicker">{{ t('admin.kicker') }}</p>
          <h1 class="login-title">{{ t('admin.title') }}</h1>
        </div>
      </div>
      <p class="login-desc">{{ t('admin.login.desc') }}</p>
      <template v-if="sso">
        <a :href="ssoLoginUrl()" class="btn btn-primary login-submit">
          <LogIn :size="14" :stroke-width="2" />
          {{ t('admin.login.sso') }}
        </a>
        <p class="field-hint">{{ t('admin.login.ssoHint') }}</p>
        <p class="login-or"><span>{{ t('admin.login.or') }}</span></p>
      </template>
      <p v-if="route.query.expired" class="login-warn" role="alert">{{ t('admin.login.expired') }}</p>
      <label class="field">
        <span class="field-label">{{ t('admin.login.token') }}</span>
        <input v-model="token" class="input" type="password" autocomplete="current-password" :placeholder="t('admin.login.tokenPlaceholder')" autofocus />
      </label>
      <label class="login-remember">
        <input v-model="remember" type="checkbox" />
        {{ t('admin.login.remember') }}
      </label>
      <p v-if="error" class="login-error" role="alert">{{ error }}</p>
      <button class="btn btn-primary login-submit" type="submit" :disabled="busy || !token.trim()">
        <Loader2 v-if="busy" :size="14" class="animate-spin" />
        <LogIn v-else :size="14" :stroke-width="2" />
        {{ t('admin.login.submit') }}
      </button>
      <p class="field-hint">{{ t('admin.login.hint') }}</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LogIn, Loader2 } from 'lucide-vue-next'
import brandLogo from '~/assets/brand-logo.svg'
import { adminAPI, ssoLoginUrl, ssoStatus } from '~/composables/useApi'
import { guardOff, saveAdminToken, signedIn } from '~/composables/useAdminAuth'

definePageMeta({ layout: false })

const { t } = useI18n()
const route = useRoute()
const token = ref('')
const remember = ref(false)
const busy = ref(false)
const error = ref('')
const sso = ref(false)

// naka-ai SSO on → admins sign in with their naka-ai account; already signed in as admin → straight in
onMounted(async () => {
  try {
    const s = await ssoStatus()
    sso.value = s.sso
    if (s.admin) {
      const session = await adminAPI.session('')
      guardOff.value = !session.guard
      signedIn.value = true
      navigateTo('/')
    }
  } catch { /* backend unreachable → token form still works */ }
})

async function submit() {
  const value = token.value.trim()
  if (!value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const s = await adminAPI.session(value)
    saveAdminToken(value, remember.value)
    guardOff.value = !s.guard
    signedIn.value = true
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/'
    navigateTo(next)
  } catch (e: any) {
    error.value = e?.status === 401 ? t('admin.login.invalid') : t('admin.login.unreachable')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.login {
  min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px;
  background:
    radial-gradient(ellipse at 15% 0%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 55%),
    var(--bg-base);
}
.login-card {
  width: min(420px, 100%); display: flex; flex-direction: column; gap: 14px;
  padding: 28px; border-radius: var(--radius-xl); border: 1px solid var(--border);
  background: var(--surface-raised); box-shadow: var(--shadow-elevated);
}
.login-brand { display: flex; align-items: center; gap: 12px; }
.login-logo { width: 40px; height: 40px; }
.login-kicker { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); }
.login-title { margin: 0; font: 800 22px var(--font-display); color: var(--text-0); }
.login-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-2); }
.login-warn { margin: 0; padding: 8px 12px; border-radius: 10px; font-size: 12.5px; background: var(--warn-bg); color: var(--warn-text); }
.login-error { margin: 0; font-size: 12.5px; color: var(--error); }
.login-remember { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-1); }
.login-submit { justify-content: center; height: 42px; text-decoration: none; }
.login-or { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 11.5px; color: var(--text-3); }
.login-or::before, .login-or::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { margin: 0; font-size: 11px; line-height: 1.5; color: var(--text-3); }
</style>
