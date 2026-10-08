<template>
  <button
    type="button" class="sk-card" :class="{ wide }" :style="{ '--sk-tint': tint }"
    :aria-label="t('productStudio.library.useAria', { name: title })"
    @click="emit('use')"
    @mouseenter="startCycle" @mouseleave="stopCycle" @focus="startCycle" @blur="stopCycle"
  >
    <div class="sk-media" aria-hidden="true">
      <template v-if="showArt">
        <img
          v-for="k in loaded" :key="art[k]" :src="art[k]" alt="" loading="lazy" decoding="async"
          :class="['sk-art', { on: k === current }]" @error="artFailed = true"
        >
      </template>
      <div v-else class="sk-fallback">
        <component :is="icon" :size="34" :stroke-width="1.5" />
      </div>
      <span v-if="badge" class="sk-badge">{{ badge }}</span>
      <span v-if="duration" class="sk-duration mono">{{ duration }}</span>
      <div class="sk-shade"></div>
      <span class="sk-cta">
        <Wand2 :size="13" :stroke-width="2.2" />
        {{ t('productStudio.library.use') }}
      </span>
    </div>
    <div class="sk-body">
      <h3 class="sk-title">{{ title }}</h3>
      <p class="sk-desc">{{ description }}</p>
      <p v-if="tags.length" class="sk-tags">
        <span v-for="tag in tags" :key="tag" class="sk-tag">{{ tag }}</span>
      </p>
    </div>
  </button>
</template>

<script setup>
import { Sparkles, Wand2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

/** StudioSkillCard — การ์ดสกิลแนวตั้งใน Skills Library: ภาพตัวอย่าง (hover วนภาพ) + ชื่อ/คำอธิบาย/แท็ก + ปุ่ม "ใช้สกิลนี้" */
const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  /** preview images; hover/focus cycles them. Empty → gradient + icon */
  art: { type: Array, default: () => [] },
  artIndex: { type: Number, default: 0 },
  icon: { type: [Object, Function], default: () => Sparkles },
  tint: { type: String, default: 'var(--accent)' },
  badge: { type: String, default: '' },
  duration: { type: String, default: '' },
  tags: { type: Array, default: () => [] },
  /** landscape tile (featured row) instead of the portrait card */
  wide: { type: Boolean, default: false },
})
const emit = defineEmits(['use'])
const { t } = useI18n()

const artFailed = ref(false)
const showArt = computed(() => props.art.length > 0 && !artFailed.value)
const current = ref(0)
const loaded = ref([])
watch(() => props.art, (list) => {
  current.value = list.length ? ((props.artIndex % list.length) + list.length) % list.length : 0
  loaded.value = list.length ? [current.value] : []
  artFailed.value = false
}, { immediate: true })

// only images that have been shown are ever requested
let timer = null
function startCycle() {
  if (timer || props.art.length < 2 || !import.meta.client) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  timer = setInterval(() => {
    const next = (current.value + 1) % props.art.length
    if (!loaded.value.includes(next)) loaded.value = [...loaded.value, next]
    current.value = next
  }, 1100)
}
function stopCycle() { clearInterval(timer); timer = null }
onBeforeUnmount(stopCycle)
</script>

<style scoped>
.sk-card {
  display: flex; flex-direction: column; gap: 10px; text-align: left;
  padding: 0; border: none; background: transparent; cursor: pointer; font: inherit; color: inherit;
  animation: fadeUp 0.24s var(--ease-out) both;
}
.sk-card:focus-visible { outline: none; }
.sk-card:focus-visible .sk-media { box-shadow: 0 0 0 3px var(--button-focus); }
.sk-media {
  position: relative; aspect-ratio: 3 / 4; overflow: hidden;
  border-radius: var(--radius-xl); border: 1px solid var(--border);
  background: color-mix(in srgb, var(--sk-tint) 14%, var(--surface-soft));
  transition: transform 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out);
}
.sk-card.wide .sk-media { aspect-ratio: 16 / 9; }
.sk-card.wide .sk-art { object-position: 50% 50%; }
.sk-card:hover .sk-media { transform: translateY(-3px); box-shadow: var(--shadow-elevated); }
.sk-art {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; object-position: 50% 38%;
  opacity: 0; transition: opacity 0.45s var(--ease-out), transform 0.4s var(--ease-out);
}
.sk-art.on { opacity: 1; }
.sk-card:hover .sk-art.on { transform: scale(1.04); }
.sk-fallback {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: color-mix(in srgb, var(--sk-tint) 80%, var(--text-0));
  background:
    radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--sk-tint) 38%, transparent), transparent 60%),
    radial-gradient(circle at 80% 85%, color-mix(in srgb, var(--sk-tint) 22%, transparent), transparent 55%);
}
.sk-shade {
  position: absolute; inset: auto 0 0 0; height: 45%;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent);
  opacity: 0; transition: opacity 0.2s var(--ease-out);
}
.sk-badge, .sk-duration {
  position: absolute; top: 10px; z-index: 1;
  padding: 3px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; line-height: 1.4;
  background: rgba(0, 0, 0, 0.5); color: #fff;
  backdrop-filter: blur(6px);
}
.sk-badge { left: 10px; }
.sk-duration { right: 10px; }
.sk-cta {
  position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 1;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; border-radius: 999px;
  background: var(--accent-gradient); color: #fff;
  font-size: 13px; font-weight: 700;
  opacity: 0; transform: translateY(6px);
  transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out);
}
.sk-card:hover .sk-shade, .sk-card:focus-visible .sk-shade,
.sk-card:hover .sk-cta, .sk-card:focus-visible .sk-cta { opacity: 1; transform: none; }
.sk-body { display: flex; flex-direction: column; gap: 4px; padding: 0 2px; }
.sk-title { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text-0); }
.sk-desc {
  margin: 0; font-size: 12px; line-height: 1.5; color: var(--text-2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sk-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 4px 0 0; }
.sk-tag {
  padding: 2px 8px; border-radius: 999px;
  font-size: 10.5px; font-weight: 600; color: var(--text-2);
  background: var(--bg-hover);
}
@media (hover: none) {
  .sk-shade, .sk-cta { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .sk-art, .sk-media, .sk-cta { transition: none; }
  .sk-card:hover .sk-art.on, .sk-card.wide .sk-media { aspect-ratio: 16 / 9; }
.sk-card.wide .sk-art { object-position: 50% 50%; }
.sk-card:hover .sk-media { transform: none; }
}
</style>
