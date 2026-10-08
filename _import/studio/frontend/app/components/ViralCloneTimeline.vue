<template>
  <div class="tl" :class="{ compact }">
    <div v-if="!compact" class="tl-ruler" aria-hidden="true">
      <span v-for="mark in marks" :key="mark" class="tl-mark" :style="{ left: `${(mark / total) * 100}%` }">{{ mark }}s</span>
    </div>
    <div class="tl-track" role="list" :aria-label="ariaLabel">
      <button
        v-for="(beat, i) in beats"
        :key="beat.id || i"
        type="button"
        role="listitem"
        class="tl-beat"
        :class="[`role-${beat.role}`, { on: i === selected }]"
        :style="{ flexGrow: Math.max(0.2, Number(beat.durationSec) || 0.2) }"
        :title="`${roleLabel(beat.role)} · ${beat.durationSec}s — ${beat.line}`"
        :tabindex="compact ? -1 : 0"
        @click="emit('select', i)"
      >
        <span class="tl-beat-head">
          <span class="tl-role">{{ roleLabel(beat.role) }}</span>
          <span v-if="!compact" class="tl-sec">{{ beat.durationSec }}s</span>
        </span>
        <span v-if="!compact" class="tl-words">
          <span v-for="(word, w) in words(beat.line)" :key="w" class="tl-word">{{ word }}</span>
        </span>
      </button>
      <span
        v-if="playhead != null && total > 0"
        class="tl-playhead"
        :style="{ left: `${Math.min(100, (playhead / total) * 100)}%` }"
        aria-hidden="true"
      ></span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  beats: { type: Array, default: () => [] },
  selected: { type: Number, default: -1 },
  playhead: { type: Number, default: null },
  compact: { type: Boolean, default: false },
  language: { type: String, default: 'th' },
})
const emit = defineEmits(['select'])
const { t, te } = useI18n()

const total = computed(() => props.beats.reduce((sum, b) => sum + (Number(b?.durationSec) || 0), 0))
const marks = computed(() => {
  const step = total.value > 40 ? 10 : 5
  const out = []
  for (let s = 0; s <= total.value; s += step) out.push(s)
  return out
})
const ariaLabel = computed(() => t('viralClone.timeline.aria', { n: props.beats.length, s: Math.round(total.value) }))

function roleLabel(role) {
  return te(`viralClone.roles.${role}`) ? t(`viralClone.roles.${role}`) : role
}

// แสดงคำที่ beat ยึดไว้ (แนวคิด Hypit: เหตุการณ์ผูกกับคำ ไม่ใช่วินาที) — ตัดคำไทยด้วย Intl.Segmenter
function words(line) {
  const text = typeof line === 'string' ? line.trim() : ''
  if (!text) return []
  try {
    return [...new Intl.Segmenter(props.language, { granularity: 'word' }).segment(text)]
      .filter((s) => s.isWordLike)
      .map((s) => s.segment)
  } catch {
    return text.split(/\s+/)
  }
}
</script>

<style scoped>
.tl { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tl-ruler { position: relative; height: 14px; margin: 0 2px; }
.tl-mark {
  position: absolute;
  transform: translateX(-50%);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}
.tl-mark:first-child { transform: none; }
.tl-track { position: relative; display: flex; gap: 4px; min-width: 0; }

.tl-beat {
  --role: var(--accent);
  --role-bg: var(--accent-bg);
  flex-basis: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 9px 9px;
  border: 1px solid transparent;
  border-top: 3px solid var(--role);
  border-radius: 10px;
  background: var(--role-bg);
  color: var(--text-0);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s var(--ease-out), transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
.tl-beat:hover { border-color: var(--role); }
.tl-beat.on { border-color: var(--role); box-shadow: 0 0 0 3px var(--button-focus); }
.tl-beat:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }

.tl-beat.role-hook { --role: var(--accent); --role-bg: var(--accent-bg); }
.tl-beat.role-demo { --role: var(--info); --role-bg: var(--info-bg); }
.tl-beat.role-proof { --role: var(--success); --role-bg: var(--success-bg); }
.tl-beat.role-offer { --role: var(--warning); --role-bg: var(--warning-bg); }
.tl-beat.role-cta { --role: var(--error); --role-bg: var(--error-bg); }

.tl-beat-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tl-role {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--role);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tl-sec { margin-left: auto; font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--text-3); }
.tl-words { display: flex; flex-wrap: wrap; gap: 3px; min-width: 0; max-height: 46px; overflow: hidden; }
.tl-word {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--surface-raised);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-1);
  white-space: nowrap;
}

.tl-playhead {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  margin-left: -1px;
  border-radius: 2px;
  background: var(--text-0);
  pointer-events: none;
  transition: left 0.1s linear;
}

.compact .tl-track { gap: 2px; }
.compact .tl-beat { padding: 0; height: 6px; border: none; border-radius: 3px; background: var(--role); cursor: default; }
.compact .tl-beat-head { display: none; }
</style>
