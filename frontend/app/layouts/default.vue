<template>
  <div class="shell">
    <!-- 左侧导航栏（参考 Topview Drama Studio 布局；剧集工作台使用独立的 studio 布局） -->
    <aside class="sidebar" :class="{ open: navOpen }" :aria-label="t('layout.nav.home')">
      <div class="side-top">
        <button class="brand" :title="t('app.title')" @click="go('/')">
          <span class="brand-mark">
            <img v-if="showBrandImage" :src="brandLogo" :alt="t('app.title')" class="brand-logo" @error="showBrandImage = false" />
            <span v-else class="brand-fallback">H</span>
          </span>
          <span class="brand-name side-label">{{ t('app.title') }}</span>
        </button>
        <button class="side-close" type="button" :aria-label="t('layout.nav.closeMenu')" @click="navOpen = false">
          <X :size="18" :stroke-width="1.8" />
        </button>
      </div>

      <nav class="side-nav">
        <NuxtLink to="/" class="side-link" :class="{ active: isStudioRoute }" :title="t('layout.nav.home')" @click="navOpen = false">
          <Clapperboard :size="17" :stroke-width="1.8" />
          <span class="side-label">{{ t('layout.nav.home') }}</span>
        </NuxtLink>
      </nav>

      <div class="side-divider"></div>

      <nav class="side-nav">
        <p class="side-group side-label">{{ t('layout.nav.setup') }}</p>
        <NuxtLink
          v-for="item in settingsItems"
          :key="item.tab"
          :to="`/settings?tab=${item.tab}`"
          class="side-link"
          :class="{ active: route.path === '/settings' && currentSettingsTab === item.tab }"
          :title="item.label"
          @click="navOpen = false"
        >
          <component :is="item.icon" :size="17" :stroke-width="1.8" />
          <span class="side-label">{{ item.label }}</span>
          <span v-if="item.tab === 'ai' && missingConfigLabels.length" class="side-dot" aria-hidden="true"></span>
        </NuxtLink>
      </nav>

      <div class="side-bottom">
        <div class="side-tools">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </div>
    </aside>
    <div v-if="navOpen" class="side-scrim" @click="navOpen = false"></div>

    <div class="main">
      <!-- 移动端顶栏 -->
      <header class="mobile-bar">
        <button class="menu-btn" type="button" :aria-label="t('layout.nav.openMenu')" @click="navOpen = true">
          <Menu :size="20" :stroke-width="1.8" />
        </button>
        <span class="brand-name">{{ t('app.title') }}</span>
      </header>

      <!-- AI 服务未配置引导横幅(缺任一类型即提示) -->
      <div v-if="missingConfigLabels.length" class="config-banner">
        <TriangleAlert :size="14" :stroke-width="1.8" />
        <span>{{ t('layout.banner.missing', { types: missingConfigLabels.join(t('common.listJoin')) }) }}</span>
        <NuxtLink to="/settings?tab=ai" class="config-banner-link">{{ t('layout.banner.goSettings') }}</NuxtLink>
      </div>

      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup>
import { TriangleAlert, Clapperboard, Cpu, Palette, Bot, HardDrive, SlidersHorizontal, Info, Menu, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { aiConfigAPI } from '~/composables/useApi'
import brandLogo from '~/assets/brand-logo.svg'

const { t, locale } = useI18n()
const route = useRoute()
const showBrandImage = ref(true)
const navOpen = ref(false)

const isStudioRoute = computed(() => route.path === '/' || route.path.startsWith('/drama/'))
const currentSettingsTab = computed(() => String(route.query.tab || 'ai'))

const settingsItems = computed(() => [
  { tab: 'ai', label: t('settings.tabs.ai'), icon: Cpu },
  { tab: 'styles', label: t('settings.tabs.styles'), icon: Palette },
  { tab: 'agents', label: t('settings.tabs.agents'), icon: Bot },
  { tab: 'general', label: t('settings.tabs.general'), icon: SlidersHorizontal },
  { tab: 'storage', label: t('settings.tabs.storage'), icon: HardDrive },
  { tab: 'about', label: t('settings.tabs.about'), icon: Info },
])

function go(path) {
  navOpen.value = false
  navigateTo(path)
}

// 渲染时求值，语言切换即时生效（不能模块级常量固化）
const SERVICE_TYPE_LABELS = computed(() => ({
  text: t('common.serviceType.text'),
  image: t('common.serviceType.image'),
  video: t('common.serviceType.video'),
}))
const missingConfigLabels = ref([])

async function checkAiConfigs() {
  try {
    const configs = await aiConfigAPI.list()
    const labels = SERVICE_TYPE_LABELS.value
    missingConfigLabels.value = Object.entries(labels)
      .filter(([type]) => !configs.some(c => c.service_type === type && c.is_active))
      .map(([, label]) => label)
  } catch { /* 配置检查失败不阻塞页面 */ }
}

onMounted(checkAiConfigs)
// 设置页保存配置后返回时重新检查(布局跨页面复用,onMounted 只触发一次)
watch(() => route.fullPath, checkAiConfigs)
// 切换界面语言时横幅中已拼接的类型文案需要重算
watch(locale, checkAiConfigs)
</script>

<style scoped>
.shell {
  display: flex;
  height: 100vh; overflow: hidden;
  background: var(--bg-base);
}

/* === Sidebar === */
.sidebar {
  width: 240px; flex-shrink: 0;
  display: flex; flex-direction: column;
  padding: 16px 12px;
  background: var(--surface-soft);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  z-index: 20;
  transition: width 0.2s var(--ease-out);
}
.side-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.brand {
  display: flex; align-items: center; gap: 10px;
  background: transparent; border: none; cursor: pointer;
  padding: 4px; border-radius: var(--radius);
  min-width: 0;
}
.brand:focus-visible, .side-link:focus-visible, .menu-btn:focus-visible, .side-close:focus-visible {
  outline: none; box-shadow: 0 0 0 3.5px var(--button-focus);
}
.brand-mark {
  width: 32px; height: 32px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 9px; overflow: hidden;
}
.brand-logo { width: 28px; height: 28px; object-fit: contain; display: block; }
.brand-fallback { font-size: 15px; font-weight: 700; color: var(--text-0); line-height: 1; }
.brand-name {
  font-family: var(--font-display);
  font-size: 16px; font-weight: 700;
  background: var(--accent-gradient);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  white-space: nowrap;
}
.side-close { display: none; }

.side-nav { display: flex; flex-direction: column; gap: 2px; }
.side-group {
  margin: 0 0 6px; padding: 0 12px;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em;
  color: var(--text-3);
}
.side-link {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  min-height: 40px; padding: 0 12px;
  border-radius: 10px;
  font-size: 14px; font-weight: 500;
  color: var(--text-1); text-decoration: none;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.side-link svg { color: var(--text-2); flex-shrink: 0; }
.side-link:hover { background: var(--bg-hover); color: var(--text-0); }
.side-link.active {
  background: var(--bg-active);
  color: var(--text-0);
  box-shadow: inset 0 0 0 1px var(--border);
}
.side-link.active svg { color: var(--text-0); }
.side-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.side-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--warning); margin-left: auto; }
.side-divider { height: 1px; background: var(--border); margin: 14px 8px; }

.side-bottom { margin-top: auto; padding-top: 16px; }
.side-tools {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 6px; border-radius: 12px;
  border: 1px solid var(--border);
}

/* === Main === */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.mobile-bar { display: none; }

/* Config banner — AI 服务未配置引导 */
.config-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 24px; flex-shrink: 0;
  font-size: 12.5px; color: var(--warn-text);
  background: var(--warn-bg);
  border-bottom: 1px solid var(--warn-border);
}
.config-banner-link {
  margin-left: auto;
  font-size: 12.5px; font-weight: 600;
  color: var(--warn-link); text-decoration: none;
  padding: 2px 10px; border-radius: var(--radius-pill);
  border: 1px solid var(--warn-border);
  line-height: 1.6; white-space: nowrap;
}
.config-banner-link:hover { background: var(--warn-link-hover-bg); color: var(--warn-text); }

.content { flex: 1; overflow: hidden; display: flex; flex-direction: column; }

/* === Mobile: 侧栏变抽屉 === */
@media (max-width: 860px) {
  .sidebar {
    position: fixed; inset: 0 auto 0 0; width: 264px; padding: 16px 12px;
    transform: translateX(-100%); transition: transform 0.22s var(--ease-out);
    box-shadow: var(--shadow-xl);
  }
  .sidebar.open { transform: none; }
  .side-close {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border: none; border-radius: 10px;
    background: transparent; color: var(--text-2); cursor: pointer;
  }
  .side-scrim { position: fixed; inset: 0; z-index: 15; background: var(--scrim); }
  .mobile-bar {
    display: flex; align-items: center; gap: 10px;
    height: 52px; padding: 0 12px; flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    background: var(--header-bg);
  }
  .menu-btn {
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border: none; border-radius: 10px;
    background: transparent; color: var(--text-0); cursor: pointer;
  }
  .config-banner { padding: 8px 14px; }
}
</style>
