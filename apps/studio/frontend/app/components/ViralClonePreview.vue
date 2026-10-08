<template>
  <div class="pv">
    <div class="pv-frame" :class="`role-${current?.role || 'hook'}`">
      <div class="pv-stage" aria-hidden="true">
        <component :is="visualIcon" :size="34" :stroke-width="1.4" />
        <span class="pv-visual">{{ visualLabel }}</span>
        <span v-if="current?.visualHint" class="pv-hint">{{ current.visualHint }}</span>
      </div>
      <span v-if="current" class="pv-chip">{{ roleLabel(current.role) }} · {{ index + 1 }}/{{ beats.length }}</span>
      <p
        v-if="captionsOn && current?.line"
        class="pv-caption"
        :class="`cap-${captionStyle}`"
        :lang="language"
      >
        <span>{{ current.line }}</span>
      </p>
      <div class="pv-progress" aria-hidden="true"><i :style="{ width: `${progress * 100}%` }"></i></div>
    </div>

    <div class="pv-controls">
      <button class="btn btn-icon pv-step" type="button" :disabled="!beats.length" :aria-label="t('viralClone.preview.prev')" @click="step(-1)">
        <SkipBack :size="14" :stroke-width="2" />
      </button>
      <button class="btn btn-primary pv-play" type="button" :disabled="!beats.length" @click="toggle">
        <Pause v-if="playing" :size="14" :stroke-width="2.2" />
        <Play v-else :size="14" :stroke-width="2.2" />
        {{ playing ? t('viralClone.preview.pause') : t('viralClone.preview.play') }}
      </button>
      <button class="btn btn-icon pv-step" type="button" :disabled="!beats.length" :aria-label="t('viralClone.preview.next')" @click="step(1)">
        <SkipForward :size="14" :stroke-width="2" />
      </button>
      <span class="pv-time mono">{{ fmt(time) }} / {{ fmt(total) }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clapperboard, Package, Pause, Play, SkipBack, SkipForward, Type, UserRound } from 'lucide-vue-next'

const props = defineProps({
  beats: { type: Array, default: () => [] },
  selected: { type: Number, default: 0 },
  captionStyle: { type: String, default: 'bold' },
  captionsOn: { type: Boolean, default: true },
  language: { type: String, default: 'th' },
})
const emit = defineEmits(['update:selected', 'time'])
const { t, te } = useI18n()

const playing = ref(false)
const time = ref(0)
let raf = 0
let last = 0

const durations = computed(() => props.beats.map((b) => Math.max(0.1, Number(b?.durationSec) || 0)))
const starts = computed(() => {
  let acc = 0
  return durations.value.map((d) => { const s = acc; acc += d; return s })
})
const total = computed(() => durations.value.reduce((a, b) => a + b, 0))
const index = computed(() => {
  if (!props.beats.length) return 0
  return Math.min(Math.max(props.selected, 0), props.beats.length - 1)
})
const current = computed(() => props.beats[index.value] || null)
const progress = computed(() => (total.value ? time.value / total.value : 0))

const VISUAL_ICONS = { product: Package, avatar: UserRound, broll: Clapperboard, text: Type }
const visualIcon = computed(() => VISUAL_ICONS[current.value?.visual] || Clapperboard)
const visualLabel = computed(() => {
  const v = current.value?.visual
  return v && te(`viralClone.visuals.${v}`) ? t(`viralClone.visuals.${v}`) : ''
})

function roleLabel(role) {
  return te(`viralClone.roles.${role}`) ? t(`viralClone.roles.${role}`) : role
}
function fmt(sec) {
  const s = Math.max(0, sec)
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

function seekTo(i) {
  time.value = starts.value[i] ?? 0
  emit('time', time.value)
}

// เลือก beat จากภายนอก (timeline/editor) → กระโดดไปต้น beat นั้น (ยกเว้นตอนกำลังเล่นผ่าน)
watch(() => props.selected, (i) => {
  if (playing.value) return
  seekTo(Math.min(Math.max(i, 0), Math.max(0, props.beats.length - 1)))
}, { immediate: true })
watch(() => props.beats.length, () => { if (!playing.value) seekTo(index.value) })

function tick(now) {
  const dt = (now - last) / 1000
  last = now
  time.value += dt
  if (time.value >= total.value) {
    time.value = total.value
    stop()
    emit('time', time.value)
    return
  }
  let i = 0
  while (i < starts.value.length - 1 && time.value >= starts.value[i + 1]) i++
  if (i !== props.selected) emit('update:selected', i)
  emit('time', time.value)
  raf = requestAnimationFrame(tick)
}
function play() {
  if (!props.beats.length) return
  if (time.value >= total.value - 0.05) { time.value = 0; emit('update:selected', 0) }
  playing.value = true
  last = performance.now()
  raf = requestAnimationFrame(tick)
}
function stop() {
  playing.value = false
  cancelAnimationFrame(raf)
}
function toggle() { playing.value ? stop() : play() }
function step(dir) {
  stop()
  const next = Math.min(Math.max(index.value + dir, 0), props.beats.length - 1)
  emit('update:selected', next)
  seekTo(next)
}

onBeforeUnmount(stop)
</script>

<style scoped>
.pv { display: flex; flex-direction: column; align-items: center; gap: 12px; }

.pv-frame {
  --role: var(--accent);
  position: relative;
  width: 100%;
  max-width: 260px;
  aspect-ratio: 9 / 16;
  border-radius: 22px;
  overflow: hidden;
  background:
    radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--role) 28%, transparent) 0%, transparent 60%),
    linear-gradient(180deg, #1b1b1f 0%, #0d0d0f 100%);
  box-shadow: 0 0 0 6px var(--bg-2), var(--shadow-lg);
  isolation: isolate;
}
.pv-frame.role-demo { --role: var(--info); }
.pv-frame.role-proof { --role: var(--success); }
.pv-frame.role-offer { --role: var(--warning); }
.pv-frame.role-cta { --role: var(--error); }

.pv-stage {
  position: absolute;
  inset: 12% 10% 38%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.55);
  text-align: center;
}
.pv-visual { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: rgba(255, 255, 255, 0.75); }
.pv-hint {
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.5);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pv-chip {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  backdrop-filter: blur(6px);
}

/* ซับเลียนแบบผล render ของ Hypit (clean / bold / boxed — ตรงกับ hypit-render.ts) */
.pv-caption {
  position: absolute;
  left: 7%;
  right: 7%;
  bottom: 18%;
  margin: 0;
  text-align: center;
  font-family: var(--font-body);
  font-weight: 700;
  line-height: 1.3;
  color: #fff;
  word-break: keep-all;
  line-break: strict;
}
.cap-bold { font-size: 17px; -webkit-text-stroke: 4px #000; paint-order: stroke fill; }
.cap-clean { font-size: 15px; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.85); }
.cap-boxed { font-size: 14.5px; }
.cap-boxed span {
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.7);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.pv-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255, 255, 255, 0.12); }
.pv-progress i { display: block; height: 100%; background: var(--role); }

.pv-controls { display: flex; align-items: center; gap: 8px; }
.pv-step { width: 32px; min-width: 32px; height: 32px; min-height: 32px; }
.pv-time { font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
</style>
