<template>
  <button type="button" :class="['ps-tpl', { selected }]" :aria-pressed="selected" @click="emit('select', template)">
    <div class="ps-tpl-visual" :class="`cat-${categoryClass}`" aria-hidden="true">
      <component :is="icon" :size="22" :stroke-width="1.6" />
      <span v-if="template.avatarMode === 'required'" class="ps-tpl-avatar-badge" :title="t('productStudio.templates.avatarRequired')">
        <UserRound :size="11" :stroke-width="2" />
      </span>
      <span v-else-if="template.avatarMode === 'hands'" class="ps-tpl-avatar-badge" :title="t('productStudio.templates.avatarHands')">
        <Hand :size="11" :stroke-width="2" />
      </span>
      <span v-if="!template.hasDialogue" class="ps-tpl-mute-badge" :title="t('productStudio.templates.noDialogue')">
        <VolumeX :size="11" :stroke-width="2" />
      </span>
    </div>

    <h3 class="ps-tpl-name">{{ t(`productStudio.templates.${template.id}.name`) }}</h3>
    <p class="ps-tpl-desc">{{ t(`productStudio.templates.${template.id}.description`) }}</p>

    <!-- timeline beat: แท่งสัดส่วนตามวินาที -->
    <div class="ps-tpl-timeline" role="img" :aria-label="timelineAria">
      <span
        v-for="(b, i) in bars"
        :key="i"
        class="ps-tpl-beat"
        :style="{ left: `${b.start}%`, width: `calc(${b.width}% - 2px)` }"
        :title="`${beatLabel(b.role)} · ${b.seconds}s`"
      >{{ i === 0 ? beatLabel(b.role) : '' }}</span>
    </div>
    <p class="ps-tpl-meta">
      <span class="tag">{{ categoryLabel }}</span>
      <span class="tag mono">{{ t('productStudio.templates.seconds', { n: totalSeconds }) }}</span>
    </p>
  </button>
</template>

<script setup>
import { Eye, Hand, Heart, Lightbulb, Package, PartyPopper, Scissors, SearchCheck, Shirt, Sparkles, UserRound, VolumeX, Wand2, Zap } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { beatBars } from '~/utils/studioFlow'

/** StudioTemplateCard — การ์ดเทมเพลตใน Creative Gallery: ชื่อ/คำอธิบายจาก i18n + timeline beat */
const props = defineProps({
  template: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
const emit = defineEmits(['select'])

const { t, te } = useI18n()

const CATEGORY_ICONS = {
  review: Heart,
  demo: Lightbulb,
  fashion_beauty: Shirt,
  showcase: Eye,
  promo: Zap,
}
const TEMPLATE_ICONS = {
  unboxing: Package,
  comparison: SearchCheck,
  try_on: Shirt,
  creator_story: Sparkles,
  lifestyle_showcase: Eye,
  asmr_closeup: Scissors,
  flash_deal: Zap,
  how_to_use: Wand2,
  problem_solution: Lightbulb,
  before_after: Wand2,
}

const icon = computed(() => TEMPLATE_ICONS[props.template.id] || CATEGORY_ICONS[props.template.category] || Sparkles)
const categoryClass = computed(() => String(props.template.category || '').replace(/[^a-z_]/gi, ''))
const categoryLabel = computed(() => {
  const key = `productStudio.categories.${categoryClass.value}`
  return te(key) ? t(key) : (props.template.category || '')
})
const bars = computed(() => beatBars(props.template))
const totalSeconds = computed(() => bars.value.reduce((s, b) => s + b.seconds, 0))
const timelineAria = computed(() => bars.value.map(b => `${beatLabel(b.role)} ${b.seconds}s`).join(', '))

function beatLabel(role) {
  const key = `productStudio.templates.${props.template.id}.beats.${role}`
  return te(key) ? t(key) : role
}
</script>

<style scoped>
.ps-tpl {
  display: flex; flex-direction: column; gap: 8px; text-align: left;
  padding: 14px; border-radius: var(--radius-lg);
  border: 2px solid var(--border); background: var(--surface-raised);
  cursor: pointer; font: inherit;
  transition: border-color 0.15s var(--ease-out), transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
  animation: fadeUp 0.24s var(--ease-out) both;
}
.ps-tpl:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-elevated); }
.ps-tpl:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.ps-tpl.selected { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.ps-tpl-visual {
  position: relative; height: 64px; border-radius: var(--radius);
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-soft); border: 1px solid var(--border);
  color: var(--accent-text);
}
.ps-tpl-visual.cat-review { background: color-mix(in srgb, var(--accent) 8%, var(--surface-soft)); }
.ps-tpl-visual.cat-demo { background: color-mix(in srgb, var(--info, #3b82f6) 8%, var(--surface-soft)); }
.ps-tpl-visual.cat-fashion_beauty { background: color-mix(in srgb, #ec4899 8%, var(--surface-soft)); }
.ps-tpl-visual.cat-showcase { background: color-mix(in srgb, var(--success, #22c55e) 8%, var(--surface-soft)); }
.ps-tpl-visual.cat-promo { background: color-mix(in srgb, #ef4444 8%, var(--surface-soft)); }
.ps-tpl-avatar-badge, .ps-tpl-mute-badge {
  position: absolute; top: 6px; width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--bg-2, var(--surface-raised));
  border: 1px solid var(--border); color: var(--text-1);
}
.ps-tpl-avatar-badge { right: 6px; }
.ps-tpl-mute-badge { left: 6px; }
.ps-tpl-name { margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--text-0); }
.ps-tpl-desc { margin: 0; font-size: 11.5px; color: var(--text-2); line-height: 1.5; flex: 1; }
.ps-tpl-timeline {
  position: relative; height: 16px; border-radius: 6px;
  background: var(--surface-soft); border: 1px solid var(--border);
  overflow: hidden;
}
.ps-tpl-beat {
  position: absolute; top: 0; bottom: 0;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  border-right: 1px solid var(--border);
  font: 600 8.5px/16px var(--font-body); color: var(--accent-text);
  padding-left: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ps-tpl-meta { display: flex; gap: 6px; align-items: center; }
</style>
