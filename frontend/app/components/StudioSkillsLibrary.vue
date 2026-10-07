<template>
  <div class="sl">
    <!-- ===== Hero ===== -->
    <section class="sl-hero">
      <p class="sl-kicker">
        <Sparkles :size="13" :stroke-width="2" />
        {{ t('productStudio.library.kicker') }}
      </p>
      <h1 class="sl-title">{{ t('productStudio.library.title') }}</h1>
      <p class="sl-sub">{{ t('productStudio.library.subtitle') }}</p>
      <label class="sl-search">
        <Search :size="16" :stroke-width="2" aria-hidden="true" />
        <input v-model="query" type="search" :placeholder="t('productStudio.library.searchPlaceholder')" :aria-label="t('productStudio.library.searchPlaceholder')" />
        <button v-if="query" type="button" class="sl-search-clear" :aria-label="t('productStudio.library.clearSearch')" @click="query = ''">
          <X :size="14" :stroke-width="2" />
        </button>
      </label>
    </section>

    <!-- ===== Category chips ===== -->
    <div class="sl-chips" role="group" :aria-label="t('productStudio.library.categoriesAria')">
      <button
        v-for="c in chips" :key="c.id" type="button"
        :class="['sl-chip', { on: category === c.id }]" :aria-pressed="category === c.id"
        @click="category = c.id"
      >
        <component :is="c.icon" :size="13" :stroke-width="2" />
        {{ c.label }}
        <span class="sl-chip-count">{{ c.count }}</span>
      </button>
    </div>

    <!-- ===== Featured: NAKA workflows ===== -->
    <section v-if="filteredWorkflows.length" class="sl-section">
      <div class="sl-section-head">
        <h2 class="sl-section-title">{{ t('productStudio.library.featuredTitle') }}</h2>
        <p class="sl-section-desc">{{ t('productStudio.library.featuredDesc') }}</p>
      </div>
      <div class="sl-grid sl-grid-wide">
        <StudioSkillCard
          v-for="(w, i) in filteredWorkflows" :key="w.id" wide
          :title="w.title" :description="w.description" :art="w.art" :icon="w.icon" :tint="w.tint"
          :badge="t('productStudio.library.badgeWorkflow')" :tags="w.tags"
          :style="{ animationDelay: `${Math.min(i, 8) * 0.03}s` }"
          @use="useWorkflow(w)"
        />
      </div>
    </section>

    <!-- ===== Product video skills (templates) ===== -->
    <section v-if="filteredTemplates.length" class="sl-section">
      <div class="sl-section-head">
        <h2 class="sl-section-title">{{ t('productStudio.library.productTitle') }}</h2>
        <p class="sl-section-desc">{{ t('productStudio.library.productDesc') }}</p>
      </div>
      <div class="sl-grid">
        <StudioSkillCard
          v-for="(tpl, i) in filteredTemplates" :key="tpl.id"
          :title="templateTitle(tpl)" :description="templateDesc(tpl)"
          :art="templateArt(tpl.id)" :art-index="templates.indexOf(tpl)" :icon="ShoppingBag"
          :badge="categoryLabel(tpl.category)" :duration="t('productStudio.templates.seconds', { n: totalSeconds(tpl) })"
          :tags="templateTags(tpl)"
          :style="{ animationDelay: `${Math.min(i, 8) * 0.03}s` }"
          @use="emit('use-template', tpl)"
        />
      </div>
    </section>

    <div v-if="loading && !templates.length" class="sl-grid" aria-hidden="true">
      <div v-for="i in 4" :key="i" class="sl-skeleton"></div>
    </div>

    <div v-else-if="!filteredWorkflows.length && !filteredTemplates.length" class="sl-empty">
      <SearchX :size="26" :stroke-width="1.5" />
      <p class="sl-empty-title">{{ t('productStudio.library.emptyTitle') }}</p>
      <p class="sl-empty-desc">{{ t('productStudio.library.emptyDesc') }}</p>
      <button type="button" class="btn" @click="query = ''; category = 'all'">{{ t('productStudio.library.reset') }}</button>
    </div>
  </div>
</template>

<script setup>
import { Clapperboard, Copy, Eye, Heart, LayoutGrid, Lightbulb, Megaphone, Radio, Search, SearchX, Shirt, ShoppingBag, Sparkles, Store, UserRound, Workflow, X, Zap } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { coverArt, templateArt } from '~/utils/studioArt'
import { beatBars } from '~/utils/studioFlow'

/**
 * StudioSkillsLibrary — หน้า "คลังสกิล" (แนว Skills Library): hero + ค้นหา + ชิปหมวด
 * + แถว workflow ของ NAKA (ไปยังโมดูลอื่น) + การ์ดสกิลวิดีโอสินค้า (= เทมเพลต Product Studio)
 * เลือกสกิลเทมเพลต → emit use-template ให้หน้าแม่พาไป AI นักขาย (สร้างโพสต์ + ทำวิดีโอด้วยสกิลนั้น)
 */
const props = defineProps({
  templates: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['use-template', 'go-tab'])
const { t, te } = useI18n()

const query = ref('')
const category = ref('all')

const CATEGORY_ICONS = { review: Heart, demo: Lightbulb, fashion_beauty: Shirt, showcase: Eye, promo: Zap }

// workflow ของแต่ละโมดูลใน NAKA — route = ไปหน้าอื่น, tab = สลับแท็บในหน้านี้
const workflows = computed(() => [
  { id: 'seller', route: '/seller', icon: Store, tint: '#ee4d2d', art: coverArt('template-category', 'demo') },
  { id: 'drama', route: '/', icon: Clapperboard, tint: '#8b5cf6', art: coverArt('agent', 'storyboard_breaker') },
  { id: 'marketer', route: '/marketer', icon: Megaphone, tint: '#f97316', art: coverArt('template-category', 'promo') },
  { id: 'viralClone', route: '/viral-clone', icon: Copy, tint: '#ec4899', art: coverArt('skill-category', 'cinematography') },
  { id: 'live', route: '/live', icon: Radio, tint: '#ef4444', art: coverArt('template-category', 'showcase') },
  { id: 'avatar', tab: 'avatars', icon: UserRound, tint: '#0ea5e9', art: coverArt('template-category', 'fashion_beauty') },
  { id: 'influencer', tab: 'influencers', icon: Sparkles, tint: '#22c55e', art: coverArt('template-category', 'review') },
].map(w => ({
  ...w,
  art: w.art ? [w.art] : [],
  title: t(`productStudio.library.workflows.${w.id}.name`),
  description: t(`productStudio.library.workflows.${w.id}.description`),
  tags: [t(`productStudio.library.workflows.${w.id}.tag`)],
})))

const templateCategories = computed(() => [...new Set(props.templates.map(tpl => tpl.category).filter(Boolean))])

function categoryLabel(c) {
  const key = `productStudio.categories.${c}`
  return te(key) ? t(key) : c
}
const templateTitle = tpl => t(`productStudio.templates.${tpl.id}.name`)
const templateDesc = tpl => t(`productStudio.templates.${tpl.id}.description`)
const totalSeconds = tpl => beatBars(tpl).reduce((s, b) => s + b.seconds, 0)
function templateTags(tpl) {
  const tags = []
  if (tpl.avatarMode === 'required') tags.push(t('productStudio.library.tagAvatar'))
  else if (tpl.avatarMode === 'hands') tags.push(t('productStudio.library.tagHands'))
  tags.push(tpl.hasDialogue ? t('productStudio.library.tagVoice') : t('productStudio.library.tagNoVoice'))
  return tags
}

const q = computed(() => query.value.trim().toLowerCase())
const matches = (...texts) => !q.value || texts.some(s => String(s || '').toLowerCase().includes(q.value))

const searchedWorkflows = computed(() => workflows.value.filter(w => matches(w.title, w.description, ...w.tags)))
const searchedTemplates = computed(() => props.templates.filter(tpl =>
  matches(templateTitle(tpl), templateDesc(tpl), categoryLabel(tpl.category), ...templateTags(tpl))))

const filteredWorkflows = computed(() => (category.value === 'all' || category.value === 'workflow') ? searchedWorkflows.value : [])
const filteredTemplates = computed(() => {
  if (category.value === 'workflow') return []
  if (category.value === 'all') return searchedTemplates.value
  return searchedTemplates.value.filter(tpl => tpl.category === category.value)
})

const chips = computed(() => [
  { id: 'all', label: t('productStudio.library.all'), icon: LayoutGrid, count: searchedWorkflows.value.length + searchedTemplates.value.length },
  { id: 'workflow', label: t('productStudio.library.workflowChip'), icon: Workflow, count: searchedWorkflows.value.length },
  ...templateCategories.value.map(c => ({
    id: c, label: categoryLabel(c), icon: CATEGORY_ICONS[c] || ShoppingBag,
    count: searchedTemplates.value.filter(tpl => tpl.category === c).length,
  })),
])

function useWorkflow(w) {
  if (w.tab) emit('go-tab', w.tab)
  else navigateTo(w.route)
}
</script>

<style scoped>
.sl { display: flex; flex-direction: column; gap: 22px; }

/* === Hero === */
.sl-hero {
  position: relative; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px;
  padding: 44px 24px 36px;
  border-radius: var(--radius-xl); border: 1px solid var(--border);
  background:
    radial-gradient(ellipse at 15% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 55%),
    radial-gradient(ellipse at 90% 100%, color-mix(in srgb, #8b5cf6 18%, transparent), transparent 55%),
    var(--surface-soft);
}
.sl-kicker {
  display: inline-flex; align-items: center; gap: 6px; margin: 0;
  padding: 4px 12px; border-radius: 999px;
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  background: var(--accent-bg); color: var(--accent-text);
}
.sl-title {
  margin: 0;
  font-family: var(--font-display); font-size: clamp(28px, 4.5vw, 44px); font-weight: 800;
  letter-spacing: -0.02em; line-height: 1.15;
  background: var(--accent-gradient); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.sl-sub { margin: 0; max-width: 560px; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.sl-search {
  display: flex; align-items: center; gap: 8px;
  width: min(520px, 100%); height: 46px; margin-top: 8px; padding: 0 8px 0 16px;
  border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface-raised); color: var(--text-3);
  box-shadow: var(--shadow-sm, none);
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
.sl-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.sl-search input {
  flex: 1; min-width: 0; height: 100%;
  border: none; outline: none; background: transparent;
  font: 500 14px var(--font-body); color: var(--text-0);
}
.sl-search input::placeholder { color: var(--text-3); }
.sl-search input::-webkit-search-cancel-button { display: none; }
.sl-search-clear {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: none; border-radius: 50%;
  background: transparent; color: var(--text-3); cursor: pointer;
}
.sl-search-clear:hover { background: var(--bg-hover); color: var(--text-0); }

/* === Chips === */
.sl-chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px; scrollbar-width: none; }
.sl-chips::-webkit-scrollbar { display: none; }
.sl-chip {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; padding: 0 14px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-raised);
  font: 600 13px var(--font-body); color: var(--text-1); cursor: pointer;
  transition: border-color 0.15s var(--ease-out), background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.sl-chip:hover { border-color: var(--border-strong); color: var(--text-0); }
.sl-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.sl-chip.on { border-color: transparent; background: var(--text-0); color: var(--bg-base); }
.sl-chip-count {
  min-width: 20px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; line-height: 18px; text-align: center;
  background: var(--bg-hover); color: var(--text-2);
}
.sl-chip.on .sl-chip-count { background: color-mix(in srgb, var(--bg-base) 22%, transparent); color: var(--bg-base); }

/* === Sections === */
.sl-section { display: flex; flex-direction: column; gap: 14px; }
.sl-section-head { display: flex; flex-direction: column; gap: 2px; }
.sl-section-title { margin: 0; font-family: var(--font-display); font-size: 19px; font-weight: 800; color: var(--text-0); }
.sl-section-desc { margin: 0; font-size: 12.5px; color: var(--text-2); }
.sl-grid {
  display: grid; gap: 22px 16px;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
.sl-grid-wide { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.sl-skeleton {
  aspect-ratio: 3 / 4; border-radius: var(--radius-xl);
  background: var(--bg-hover);
  animation: sl-pulse 1.4s ease-in-out infinite;
}
@keyframes sl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

/* === Empty === */
.sl-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 56px 24px; border: 1px dashed var(--border); border-radius: var(--radius-lg);
  color: var(--text-3); text-align: center;
}
.sl-empty-title { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--text-1); }
.sl-empty-desc { margin: 0 0 12px; font-size: 12.5px; }

@media (max-width: 860px) {
  .sl-hero { padding: 32px 16px 26px; }
  .sl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; }
  .sl-grid-wide { grid-template-columns: 1fr; }
}
</style>
