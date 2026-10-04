<template>
  <div class="bp-editor">
    <!-- ===== Beats ===== -->
    <div class="bp-section-head">
      <h3 class="bp-section-title">{{ t('viralClone.blueprint.beats') }}</h3>
      <button class="btn btn-sm" type="button" @click="addBeat">
        <Plus :size="13" :stroke-width="2.1" />
        {{ t('viralClone.blueprint.addBeat') }}
      </button>
    </div>

    <div v-for="(beat, i) in draft.beats" :key="beat.id" class="bp-beat">
      <div class="bp-beat-head">
        <span class="bp-beat-num">{{ String(i + 1).padStart(2, '0') }}</span>
        <BaseSelect v-model="beat.role" class="bp-beat-role" :options="roleOptions" />
        <input v-model.number="beat.durationSec" class="input bp-beat-sec" type="number" step="0.1" min="0.5" :aria-label="t('viralClone.blueprint.beatSeconds')" />
        <span class="bp-beat-sec-unit">s</span>
        <button class="bp-beat-del" type="button" :title="t('viralClone.blueprint.removeBeat')" @click="removeBeat(i)">
          <X :size="13" :stroke-width="2" />
        </button>
      </div>
      <input v-model="beat.line" class="input" :placeholder="t('viralClone.blueprint.beatLinePlaceholder')" />
      <div class="bp-beat-row2">
        <BaseSelect v-model="beat.visual" class="bp-beat-visual" :options="visualOptions" />
        <input v-model="beat.visualHint" class="input" :placeholder="t('viralClone.blueprint.beatHintPlaceholder')" />
      </div>
    </div>

    <!-- ===== Hooks สำรอง ===== -->
    <div class="bp-section-head bp-hooks-head">
      <h3 class="bp-section-title">{{ t('viralClone.blueprint.hooks') }}</h3>
      <p class="bp-hint">{{ t('viralClone.blueprint.hooksHint') }}</p>
    </div>
    <div class="bp-hooks">
      <span v-for="(hook, i) in draft.hooks" :key="`${hook}-${i}`" class="bp-hook-chip">
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

    <!-- ===== Foot ===== -->
    <div class="bp-foot">
      <span class="bp-total">{{ t('viralClone.blueprint.total', { n: totalSeconds }) }}</span>
      <span v-if="!valid" class="bp-invalid">{{ t('viralClone.blueprint.invalid') }}</span>
      <button class="btn btn-primary" type="button" :disabled="!dirty || !valid || saving" @click="save">
        <Loader2 v-if="saving" :size="13" class="animate-spin" />
        {{ t('viralClone.blueprint.save') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Plus, X } from 'lucide-vue-next'
import { CLONE_BEAT_ROLES, CLONE_VISUALS, beatsTotalSeconds, cloneBeatDefaults, isValidBlueprint } from '~/utils/viralCloneFlow'

const props = defineProps({
  blueprint: { type: Object, default: null },
  saving: { type: Boolean, default: false },
})
const emit = defineEmits(['save'])
const { t } = useI18n()

// แก้ใน draft เสมอ — poll ระหว่าง render อัปเดต detail ข้างนอก ต้องไม่ทับสิ่งที่กำลังแก้ (dirty)
const draft = ref(normalize(props.blueprint))
const dirty = ref(false)
const hookInput = ref('')

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
  return { title: typeof src.title === 'string' ? src.title : undefined, beats, hooks }
}

const roleOptions = computed(() => CLONE_BEAT_ROLES.map((r) => ({ label: t(`viralClone.roles.${r}`), value: r })))
const visualOptions = computed(() => CLONE_VISUALS.map((v) => ({ label: t(`viralClone.visuals.${v}`), value: v })))
const totalSeconds = computed(() => Math.round(beatsTotalSeconds(draft.value) * 10) / 10)
const valid = computed(() => isValidBlueprint(draft.value))

function touch() { dirty.value = true }
function addBeat() {
  draft.value.beats.push(cloneBeatDefaults(`b${Date.now()}`))
  touch()
}
function removeBeat(i) {
  draft.value.beats.splice(i, 1)
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
.bp-editor { display: flex; flex-direction: column; gap: 12px; }
.bp-section-head { display: flex; align-items: center; gap: 10px; }
.bp-section-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--text-0); }
.bp-hint { margin: 0; font-size: 11.5px; color: var(--text-3); }
.bp-hooks-head { align-items: baseline; }

.bp-beat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
}
.bp-beat-head { display: flex; align-items: center; gap: 8px; }
.bp-beat-num { font-size: 11px; font-weight: 700; color: var(--text-3); width: 20px; flex-shrink: 0; }
.bp-beat-role { width: 130px; flex-shrink: 0; }
.bp-beat-sec { width: 74px; flex-shrink: 0; }
.bp-beat-sec-unit { font-size: 11px; color: var(--text-3); margin-left: -4px; }
.bp-beat-del {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0; margin-left: auto;
  border: none; border-radius: 8px; background: transparent; color: var(--text-3); cursor: pointer;
}
.bp-beat-del:hover { background: var(--bg-hover); color: var(--text-0); }
.bp-beat-row2 { display: flex; gap: 8px; }
.bp-beat-visual { width: 150px; flex-shrink: 0; }

.bp-hooks { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.bp-hook-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 8px 4px 10px;
  border: 1px solid var(--border); border-radius: 999px;
  background: var(--surface-soft); font-size: 12px; color: var(--text-1);
  max-width: 100%;
}
.bp-hook-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-hook-chip button {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border: none; border-radius: 50%;
  background: transparent; color: var(--text-3); cursor: pointer; flex-shrink: 0;
}
.bp-hook-chip button:hover { background: var(--bg-hover); color: var(--text-0); }
.bp-hook-add { display: flex; gap: 6px; flex: 1; min-width: 220px; }

.bp-foot {
  display: flex; align-items: center; gap: 12px;
  padding-top: 4px; margin-top: auto;
}
.bp-total { font-size: 12px; color: var(--text-2); }
.bp-invalid { font-size: 11.5px; color: var(--danger, #e5484d); }
.bp-foot .btn { margin-left: auto; }

@media (max-width: 720px) {
  .bp-beat-row2 { flex-direction: column; }
  .bp-beat-visual { width: 100%; }
}
</style>
