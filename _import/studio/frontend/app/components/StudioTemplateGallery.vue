<template>
  <div class="ps-gallery">
    <div class="ps-gallery-filters">
      <div class="ps-filter-group" role="group" :aria-label="t('productStudio.templates.filterCategory')">
        <button
          v-for="c in categories"
          :key="c"
          type="button"
          :class="['filter-chip', { on: category === c }]"
          :aria-pressed="category === c"
          @click="category = category === c ? '' : c"
        >{{ t(`productStudio.categories.${c}`) }}</button>
      </div>
      <div class="ps-filter-group" role="group" :aria-label="t('productStudio.templates.filterPlatform')">
        <button
          v-for="p in platformOptions"
          :key="p"
          type="button"
          :class="['filter-chip', { on: platform === p }]"
          :aria-pressed="platform === p"
          @click="platform = platform === p ? '' : p"
        >{{ t(`productStudio.platforms.${p}`) }}</button>
      </div>
      <button type="button" :class="['filter-chip', { on: needAvatar }]" :aria-pressed="needAvatar" @click="needAvatar = !needAvatar">
        <UserRound :size="11" :stroke-width="2" />
        {{ t('productStudio.templates.filterAvatar') }}
      </button>
    </div>

    <!-- banner for the chosen category (hidden if its image is missing) -->
    <div v-if="categoryCover && !coverFailed" class="ps-gallery-cover" aria-hidden="true">
      <img :src="categoryCover" alt="" decoding="async" @error="coverFailed = true">
      <span>{{ t(`productStudio.categories.${category}`) }}</span>
    </div>

    <div v-if="filtered.length" class="ps-gallery-grid">
      <StudioTemplateCard
        v-for="(tpl, i) in filtered"
        :key="tpl.id"
        :template="tpl"
        :art-index="templates.indexOf(tpl)"
        :selected="tpl.id === selectedId"
        :style="{ animationDelay: `${Math.min(i, 8) * 0.03}s` }"
        @select="emit('select', $event)"
      />
    </div>
    <p v-else class="ps-gallery-empty">{{ t('productStudio.templates.emptyFilter') }}</p>
  </div>
</template>

<script setup>
import { UserRound } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { coverArt } from '~/utils/studioArt'

/** StudioTemplateGallery — Creative Gallery: grid เทมเพลต + ตัวกรองหมวด/แพลตฟอร์ม/ต้องใช้ avatar */
const props = defineProps({
  templates: { type: Array, default: () => [] },
  selectedId: { type: String, default: '' },
  platformOptions: { type: Array, default: () => [] },
})
const emit = defineEmits(['select'])

const { t } = useI18n()

const category = ref('')
const platform = ref('')
const needAvatar = ref(false)

const categories = computed(() => [...new Set(props.templates.map(tpl => tpl.category).filter(Boolean))])
const categoryCover = computed(() => (category.value ? coverArt('template-category', category.value) : ''))
const coverFailed = ref(false)
watch(category, () => { coverFailed.value = false })
const filtered = computed(() => props.templates.filter((tpl) => {
  if (category.value && tpl.category !== category.value) return false
  if (platform.value && !(tpl.platforms || []).includes(platform.value)) return false
  if (needAvatar.value && tpl.avatarMode === 'none') return false
  return true
}))
</script>

<style scoped>
.ps-gallery { display: flex; flex-direction: column; gap: 12px; }
.ps-gallery-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ps-filter-group { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-gallery-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}
.ps-gallery-cover {
  position: relative; height: 150px; overflow: hidden;
  border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface-soft);
}
.ps-gallery-cover img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 50%; display: block; }
.ps-gallery-cover span {
  position: absolute; left: 14px; bottom: 12px; padding: 4px 10px; border-radius: 999px;
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent); color: var(--text-0);
  font: 700 13px/1.4 var(--font-display);
}
.ps-gallery-empty { margin: 0; font-size: 12.5px; color: var(--text-3); }
</style>
