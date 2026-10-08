<template>
  <article class="trend-card" tabindex="0" role="button" :aria-label="t('marketer.trending.card.replicateAria', { title: entry.title })" @click="emit('replicate', entry)" @keydown.enter.prevent="emit('replicate', entry)" @keydown.space.prevent="emit('replicate', entry)">
    <!-- Cover: gradient ตามหมวด + hook text ใหญ่ (ไม่ใช้ thumbnail จากแพลตฟอร์ม — ไม่มีสิทธิ์) -->
    <div class="trend-cover" :class="`cover-${entry.industry}`">
      <div class="trend-cover-top">
        <span class="trend-chip">
          <component :is="platformIcon" :size="10" :stroke-width="2.2" />
          {{ t(`marketer.platforms.${entry.platform}`) }}
        </span>
        <span class="trend-chip th">TH</span>
      </div>
      <p class="trend-hook">“{{ entry.pattern.hook }}”</p>
      <div class="trend-metrics">
        <div class="trend-metric">
          <strong>{{ fmtViews(entry.views) }}</strong>
          <span>{{ t('marketer.trending.card.views') }}</span>
        </div>
        <div v-if="entry.estRevenueThb !== null" class="trend-metric">
          <strong>{{ fmtThb(entry.estRevenueThb) }}</strong>
          <span>{{ t('marketer.trending.card.revenue') }}</span>
        </div>
        <div v-else-if="entry.engagementRate !== null" class="trend-metric">
          <strong>{{ fmtPct(entry.engagementRate) }}</strong>
          <span>{{ t('marketer.trending.card.engagement') }}</span>
        </div>
      </div>
      <span class="trend-duration">{{ fmtDuration(entry.durationSec) }}</span>
    </div>

    <div class="trend-body">
      <h4 class="trend-title">{{ entry.title }}</h4>
      <div class="trend-tags">
        <span class="tag">{{ t(`marketer.trending.industries.${entry.industry}`) }}</span>
        <span class="tag tag-accent">{{ t(`marketer.trending.hookTypes.${entry.hookType}`) }}</span>
      </div>
      <p class="trend-why">{{ entry.summary }}</p>
      <button class="btn btn-sm btn-primary trend-cta" type="button" @click.stop="emit('replicate', entry)">
        <Copy :size="12" :stroke-width="2.2" />
        {{ t('marketer.trending.card.replicate') }}
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Instagram, Music2, Youtube } from 'lucide-vue-next'
import type { TrendVideo } from '~/composables/useApi'

/** MarketerTrendingCard — การ์ดคลังเทรนด์ไทย (docs/ai-marketer/TRENDING.md §3) */
const props = defineProps<{ entry: TrendVideo }>()
const emit = defineEmits<{ replicate: [entry: TrendVideo] }>()

const { t } = useI18n()

const platformIcon = computed(() => {
  if (props.entry.platform === 'reels') return Instagram
  if (props.entry.platform === 'youtube_shorts') return Youtube
  return Music2
})

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
function fmtViews(v: number) {
  return compact.format(v)
}
function fmtThb(v: number) {
  return '฿' + compact.format(v)
}
function fmtPct(v: number) {
  return (v * 100).toFixed(1) + '%'
}
function fmtDuration(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
}
</script>

<style scoped>
.trend-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
.trend-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}
.trend-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--button-focus);
}

/* === Cover === */
.trend-cover {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 10px;
  aspect-ratio: 9 / 10;
  padding: 12px;
  overflow: hidden;
}
.cover-beauty { background: linear-gradient(160deg, #4a2540 0%, #221026 70%); }
.cover-food { background: linear-gradient(160deg, #4d2c14 0%, #26140a 70%); }
.cover-fashion { background: linear-gradient(160deg, #322850 0%, #191230 70%); }
.cover-gadgets { background: linear-gradient(160deg, #16324f 0%, #0c1a2b 70%); }
.cover-home { background: linear-gradient(160deg, #16453f 0%, #0b211e 70%); }
.cover-health { background: linear-gradient(160deg, #1d4028 0%, #0e2015 70%); }
.cover-pets { background: linear-gradient(160deg, #4a3a15 0%, #241c0a 70%); }
.cover-other { background: linear-gradient(160deg, #2c3440 0%, #171c24 70%); }

.trend-cover-top {
  position: absolute;
  top: 10px;
  left: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.trend-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.92);
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}
.trend-hook {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  line-height: 1.45;
  color: #fff;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.4);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.trend-metrics {
  display: flex;
  gap: 16px;
}
.trend-metric { display: flex; flex-direction: column; }
.trend-metric strong { font-size: 15px; font-weight: 800; color: #fff; line-height: 1.2; }
.trend-metric span { font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255, 255, 255, 0.65); }
.trend-duration {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.45);
}

/* === Body === */
.trend-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  flex: 1;
}
.trend-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text-1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.trend-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.trend-why {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.trend-cta { margin-top: auto; align-self: stretch; justify-content: center; }
</style>
