<template>
  <div class="bp-editor">
    <!-- ===== Timeline (beat ยึดกับคำพูด) ===== -->
    <section class="bp-card bp-timeline">
      <div class="bp-card-head">
        <div>
          <h3 class="bp-card-title">{{ t('viralClone.timeline.title') }}</h3>
          <p class="bp-hint">{{ t('viralClone.timeline.hint') }}</p>
        </div>
        <span class="bp-total mono">{{ t('viralClone.blueprint.total', { n: totalSeconds }) }}</span>
      </div>
      <ViralCloneTimeline
        :beats="draft.beats"
        :selected="selected"
        :playhead="playhead"
        :language="language"
        @select="select"
      />
    </section>

    <div class="bp-grid">
      <!-- ===== ซ้าย: beats + hooks + ซับ ===== -->
      <div class="bp-main">
        <div class="bp-section-head">
          <h3 class="bp-section-title">{{ t('viralClone.blueprint.beats') }}</h3>
          <span class="bp-count">{{ draft.beats.length }}</span>
          <button class="btn btn-sm bp-add" type="button" @click="addBeat">
            <Plus :size="13" :stroke-width="2.1" />
            {{ t('viralClone.blueprint.addBeat') }}
          </button>
        </div>

        <div
          v-for="(beat, i) in draft.beats"
          :key="beat.id"
          :ref="(el) => { beatEls[i] = el }"
          class="bp-beat"
          :class="[`role-${beat.role}`, { on: i === selected }]"
          @focusin="selected = i"
          @click="selected = i"
        >
          <div class="bp-beat-head">
            <span class="bp-beat-num">{{ String(i + 1).padStart(2, '0') }}</span>
            <BaseSelect v-model="beat.role" class="bp-beat-role" :options="roleOptions" @update:model-value="touch" />
            <BaseSelect v-model="beat.visual" class="bp-beat-visual" :options="visualOptions" @update:model-value="touch" />
            <div class="bp-beat-sec-wrap">
              <input v-model.number="beat.durationSec" class="input bp-beat-sec" type="number" step="0.1" min="0.5" :aria-label="t('viralClone.blueprint.beatSeconds')" @input="touch" />
              <span class="bp-beat-sec-unit">s</span>
            </div>
            <button class="bp-icon-btn" type="button" :disabled="i === 0" :title="t('viralClone.blueprint.moveUp')" @click.stop="move(i, -1)">
              <ArrowUp :size="13" :stroke-width="2" />
            </button>
            <button class="bp-icon-btn" type="button" :disabled="i === draft.beats.length - 1" :title="t('viralClone.blueprint.moveDown')" @click.stop="move(i, 1)">
              <ArrowDown :size="13" :stroke-width="2" />
            </button>
            <button class="bp-icon-btn" type="button" :title="t('viralClone.blueprint.removeBeat')" @click.stop="removeBeat(i)">
              <X :size="13" :stroke-width="2" />
            </button>
          </div>
          <textarea v-model="beat.line" class="input bp-line" rows="2" :lang="language" :placeholder="t('viralClone.blueprint.beatLinePlaceholder')" @input="touch"></textarea>
          <input v-model="beat.visualHint" class="input bp-visual-hint" :placeholder="t('viralClone.blueprint.beatHintPlaceholder')" @input="touch" />
        </div>

        <!-- Hooks สำรอง -->
        <section class="bp-card">
          <div class="bp-card-head">
            <div>
              <h3 class="bp-card-title">{{ t('viralClone.blueprint.hooks') }}</h3>
              <p class="bp-hint">{{ t('viralClone.blueprint.hooksHint') }}</p>
            </div>
          </div>
          <div class="bp-hooks">
            <span v-for="(hook, i) in draft.hooks" :key="`${hook}-${i}`" class="bp-hook-chip">
              <span class="bp-hook-num">#{{ i + 1 }}</span>
              <span class="bp-hook-text">{{ hook }}</span>
              <button type="button" :title="t('viralClone.blueprint.removeHook')" @click="removeHook(i)">
                <X :size="11" :stroke-width="2.2" />
              </button>
            </span>
            <div class="bp-hook-add">
              <input v-model="hookInput" class="input" :placeholder="t('viralClone.blueprint.hookPlaceholder')" @keydown.enter.prevent="addHook" />
              <button class="btn btn-sm" type="button" :disabled="!hookInput.trim()" @click="addHook">{{ t('common.add') }}</button>
            </div>
          </div>
        </section>
      </div>

      <!-- ===== ขวา: พรีวิว 9:16 + สไตล์ซับ ===== -->
      <aside class="bp-side">
        <section class="bp-card bp-preview-card">
          <div class="bp-card-head">
            <h3 class="bp-card-title">{{ t('viralClone.preview.title') }}</h3>
          </div>
          <ViralClonePreview
            v-model:selected="selected"
            :beats="draft.beats"
            :caption-style="draft.captionStyle.style"
            :captions-on="draft.captionStyle.enabled"
            :language="language"
            @time="playhead = $event"
          />
          <div class="bp-caption-ctl">
            <div class="bp-caption-row">
              <span class="bp-label">{{ t('viralClone.captions.title') }}</span>
              <button
                class="switch" :class="{ on: draft.captionStyle.enabled }" type="button" role="switch"
                :aria-checked="draft.captionStyle.enabled" :aria-label="t('viralClone.captions.enabled')"
                @click="draft.captionStyle.enabled = !draft.captionStyle.enabled; touch()"
              ></button>
            </div>
            <div class="seg bp-seg" role="radiogroup" :aria-label="t('viralClone.captions.style')">
              <button
                v-for="s in CAPTION_STYLES" :key="s" type="button" role="radio"
                class="seg-item" :class="{ on: draft.captionStyle.style === s }"
                :aria-checked="draft.captionStyle.style === s"
                :disabled="!draft.captionStyle.enabled"
                @click="draft.captionStyle.style = s; touch()"
              >{{ t(`viralClone.captions.${s}`) }}</button>
            </div>
          </div>
        </section>
      </aside>
    </div>

    <!-- ===== Save bar ===== -->
    <div class="bp-foot" :class="{ dirty }">
      <span v-if="!valid" class="bp-invalid">{{ t('viralClone.blueprint.invalid') }}</span>
      <span v-else-if="dirty" class="bp-dirty">{{ t('viralClone.blueprint.unsaved') }}</span>
      <button class="btn btn-primary" type="button" :disabled="!dirty || !valid || saving" @click="save">
        <Loader2 v-if="saving" :size="13" class="animate-spin" />
        <Save v-else :size="13" :stroke-width="2" />
        {{ t('viralClone.blueprint.save') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Loader2, Plus, Save, X } from 'lucide-vue-next'
import { CLONE_BEAT_ROLES, CLONE_VISUALS, beatsTotalSeconds, cloneBeatDefaults, isValidBlueprint } from '../utils/viralCloneFlow'

const CAPTION_STYLES = ['bold', 'clean', 'boxed']

const props = defineProps({
  blueprint: { type: Object, default: null },
  saving: { type: Boolean, default: false },
  language: { type: String, default: 'th' },
})
const emit = defineEmits(['save'])
const { t } = useI18n()

// แก้ใน draft เสมอ — poll ระหว่าง render อัปเดต detail ข้างนอก ต้องไม่ทับสิ่งที่กำลังแก้ (dirty)
const draft = ref(normalize(props.blueprint))
const dirty = ref(false)
const hookInput = ref('')
const selected = ref(0)
const playhead = ref(null)
const beatEls = []

watch(() => props.blueprint, (bp) => {
  if (dirty.value) return
  draft.value = normalize(bp)
})

function normalize(bp) {
  const src = bp && typeof bp === 'object' ? bp : {}
  const beats = (Array.isArray(src.beats) ? src.beats : []).map((b, i) => ({
    id: typeof b?.id === 'string' && b.id ? b.id : `b${i + 1}`,
    role: b?.role || 'demo',
    line: typeof b?.line === 'string' ? b.line : '',
    visual: b?.visual || 'product',
    visualHint: typeof b?.visualHint === 'string' ? b.visualHint : null,
    durationSec: Number.isFinite(Number(b?.durationSec)) ? Number(b.durationSec) : 3,
  }))
  const hooks = Array.isArray(src.hooks) ? src.hooks.filter((h) => typeof h === 'string') : []
  const cs = src.captionStyle && typeof src.captionStyle === 'object' ? src.captionStyle : {}
  const captionStyle = {
    ...cs,
    style: CAPTION_STYLES.includes(cs.style) ? cs.style : 'bold',
    enabled: cs.enabled !== false,
  }
  return { title: typeof src.title === 'string' ? src.title : undefined, beats, hooks, captionStyle }
}

const roleOptions = computed(() => CLONE_BEAT_ROLES.map((r) => ({ label: t(`viralClone.roles.${r}`), value: r })))
const visualOptions = computed(() => CLONE_VISUALS.map((v) => ({ label: t(`viralClone.visuals.${v}`), value: v })))
const totalSeconds = computed(() => Math.round(beatsTotalSeconds(draft.value) * 10) / 10)
const valid = computed(() => isValidBlueprint(draft.value))

function touch() { dirty.value = true }
function select(i) {
  selected.value = i
  nextTick(() => beatEls[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
}
function addBeat() {
  draft.value.beats.push(cloneBeatDefaults(`b${Date.now()}`))
  touch()
  select(draft.value.beats.length - 1)
}
function removeBeat(i) {
  draft.value.beats.splice(i, 1)
  selected.value = Math.min(selected.value, Math.max(0, draft.value.beats.length - 1))
  touch()
}
function move(i, dir) {
  const j = i + dir
  const beats = draft.value.beats
  if (j < 0 || j >= beats.length) return
  ;[beats[i], beats[j]] = [beats[j], beats[i]]
  selected.value = j
  touch()
}
function addHook() {
  const text = hookInput.value.trim()
  if (!text) return
  if (!Array.isArray(draft.value.hooks)) draft.value.hooks = []
  draft.value.hooks.push(text)
  hookInput.value = ''
  touch()
}
function removeHook(i) {
  draft.value.hooks.splice(i, 1)
  touch()
}
function save() {
  if (!valid.value || !dirty.value) return
  dirty.value = false
  emit('save', JSON.parse(JSON.stringify(draft.value)))
}
</script>

<style scoped>
.bp-editor { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.bp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  min-width: 0;
}
.bp-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.bp-card-title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-0); }
.bp-hint { margin: 2px 0 0; font-size: 11.5px; line-height: 1.5; color: var(--text-3); }
.bp-total { font-size: 12px; color: var(--text-2); white-space: nowrap; }

.bp-grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.bp-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.bp-side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 16px; }

.bp-section-head { display: flex; align-items: center; gap: 8px; }
.bp-section-title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-0); }
.bp-count {
  min-width: 20px; height: 20px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px; background: var(--bg-2); font-size: 11px; font-weight: 700; color: var(--text-2);
}
.bp-add { margin-left: auto; }

.bp-beat {
  --role: var(--accent);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 12px 12px 14px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--role);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
.bp-beat.role-demo { --role: var(--info); }
.bp-beat.role-proof { --role: var(--success); }
.bp-beat.role-offer { --role: var(--warning); }
.bp-beat.role-cta { --role: var(--error); }
.bp-beat.on { border-color: var(--role); box-shadow: 0 0 0 3px var(--button-focus); }

.bp-beat-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.bp-beat-num { font-size: 11px; font-weight: 800; color: var(--role); width: 20px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
.bp-beat-role { width: 124px; flex-shrink: 0; }
.bp-beat-visual { width: 124px; flex-shrink: 0; }
.bp-beat-sec-wrap { display: inline-flex; align-items: center; gap: 4px; margin-right: auto; }
.bp-beat-sec { width: 70px; }
.bp-beat-sec-unit { font-size: 11px; color: var(--text-3); }
.bp-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  border: none; border-radius: 8px; background: transparent; color: var(--text-3); cursor: pointer;
}
.bp-icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-0); }
.bp-icon-btn:disabled { opacity: 0.35; cursor: default; }
.bp-line { resize: vertical; line-height: 1.6; font-size: 14px; font-weight: 600; }
.bp-visual-hint { font-size: 12.5px; }

.bp-hooks { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bp-hook-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 6px;
  border: 1px solid var(--border); border-radius: 999px;
  background: var(--surface-soft); font-size: 12px; color: var(--text-1);
  max-width: 100%;
}
.bp-hook-num { padding: 1px 6px; border-radius: 999px; background: var(--accent-bg); color: var(--accent-text); font-size: 10.5px; font-weight: 700; }
.bp-hook-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-hook-chip button {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border: none; border-radius: 50%;
  background: transparent; color: var(--text-3); cursor: pointer; flex-shrink: 0;
}
.bp-hook-chip button:hover { background: var(--bg-hover); color: var(--text-0); }
.bp-hook-add { display: flex; gap: 6px; flex: 1; min-width: 220px; }

.bp-preview-card { align-items: stretch; }
.bp-caption-ctl { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border); }
.bp-caption-row { display: flex; align-items: center; justify-content: space-between; }
.bp-label { font-size: 12px; font-weight: 600; color: var(--text-2); }
.bp-seg { width: 100%; }
.bp-seg .seg-item { flex: 1; }
.bp-seg .seg-item:disabled { opacity: 0.45; cursor: not-allowed; }

.bp-foot {
  position: static;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  backdrop-filter: blur(10px);
}
.bp-foot.dirty { position: sticky; bottom: 0; border-color: var(--accent); box-shadow: var(--shadow-lg); }
.bp-foot .btn { margin-left: auto; }
.bp-invalid { font-size: 11.5px; color: var(--error); }
.bp-dirty { font-size: 12px; color: var(--accent-text); font-weight: 600; }

@media (max-width: 1100px) {
  .bp-grid { grid-template-columns: minmax(0, 1fr); }
  .bp-side { position: static; }
}
</style>
