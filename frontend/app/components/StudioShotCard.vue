<template>
  <article class="ps-shot">
    <header class="ps-shot-head">
      <span class="ps-shot-num mono">{{ shot.number }}</span>
      <h3 class="ps-shot-role">{{ roleLabel }}</h3>
      <span class="tag mono">{{ t('productStudio.shots.durationSec', { n: shot.durationSec }) }}</span>
      <span v-if="mode === 'script' && !hasCaption" class="tag" :title="t('productStudio.captions.noCaptionHint')">
        {{ t('productStudio.captions.noCaptionBadge') }}
      </span>
    </header>

    <!-- แก้บท: บทพูด (นับเวลาพูดเทียบความยาวช็อต) / ภาพ / ข้อความบนจอ -->
    <template v-if="mode === 'script'">
      <label class="field">
        <span class="field-label">{{ t('productStudio.shots.dialogue') }}</span>
        <textarea v-model="draft.dialogue" class="textarea ps-shot-dialogue" rows="3" :placeholder="t('productStudio.shots.dialogueNone')" />
        <span class="field-hint" :class="{ 'ps-shot-warn': tooLong }">
          {{ speechHint }}
        </span>
      </label>
      <label class="field">
        <span class="field-label">{{ t('productStudio.shots.visual') }}</span>
        <textarea v-model="draft.visual" class="textarea" rows="2" required />
      </label>
      <label class="field">
        <span class="field-label">{{ t('productStudio.shots.onScreenText') }}</span>
        <input v-model="draft.onScreenText" class="input" :placeholder="t('productStudio.shots.onScreenTextNone')" />
      </label>
      <div class="ps-shot-foot">
        <label class="ps-shot-duration">
          <span>{{ t('productStudio.shots.durationLabel') }}</span>
          <input v-model.number="draft.durationSec" class="input" type="number" min="3" max="60" step="1" />
        </label>
        <button
          v-if="dirty"
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="saving || !draft.visual.trim()"
          @click="save"
        >
          <Loader2 v-if="saving" :size="12" class="animate-spin" />
          {{ t('common.save') }}
        </button>
      </div>
    </template>

    <!-- สร้าง: keyframe + video ของช็อตนี้ -->
    <template v-else>
      <div class="ps-shot-media-grid">
        <div class="ps-shot-media">
          <p class="ps-shot-media-label">{{ t('productStudio.render.keyframe') }}</p>
          <div class="ps-shot-frame">
            <img v-if="shot.keyframeStatus === 'completed' && shot.keyframeUrl" :src="shot.keyframeUrl" alt="" loading="lazy" />
            <div v-else-if="shot.keyframeStatus === 'processing'" class="ps-shot-skeleton" role="status">
              <Loader2 :size="16" class="animate-spin" />
            </div>
            <div v-else-if="shot.keyframeStatus === 'failed'" class="ps-shot-failed" role="alert">
              <p>{{ shot.keyframeError || t('productStudio.mediaStatus.failed') }}</p>
            </div>
            <div v-else class="ps-shot-none"><ImageIcon :size="18" :stroke-width="1.5" /></div>
          </div>
          <button
            v-if="shot.keyframeStatus === 'failed' || shot.keyframeStatus === 'completed'"
            type="button" class="btn btn-sm" :disabled="disabled"
            @click="emit('render', { shotId: shot.id, stage: 'keyframes' })"
          >
            <RotateCcw :size="11" :stroke-width="2" />
            {{ t('productStudio.render.regenerateShot') }}
          </button>
        </div>
        <div class="ps-shot-media">
          <p class="ps-shot-media-label">{{ t('productStudio.render.video') }}</p>
          <div class="ps-shot-frame">
            <video v-if="shot.videoStatus === 'completed' && shot.videoUrl" :src="shot.videoUrl" controls preload="metadata" class="ps-shot-video" />
            <div v-else-if="shot.videoStatus === 'processing'" class="ps-shot-skeleton" role="status">
              <Loader2 :size="16" class="animate-spin" />
            </div>
            <div v-else-if="shot.videoStatus === 'failed'" class="ps-shot-failed" role="alert">
              <p>{{ shot.videoError || t('productStudio.mediaStatus.failed') }}</p>
            </div>
            <div v-else class="ps-shot-none"><Film :size="18" :stroke-width="1.5" /></div>
          </div>
          <button
            v-if="shot.videoStatus === 'failed' || shot.videoStatus === 'completed'"
            type="button" class="btn btn-sm" :disabled="disabled || shot.keyframeStatus !== 'completed'"
            :title="shot.keyframeStatus !== 'completed' ? t('productStudio.render.needKeyframe') : undefined"
            @click="emit('render', { shotId: shot.id, stage: 'videos' })"
          >
            <RotateCcw :size="11" :stroke-width="2" />
            {{ t('productStudio.render.regenerateShot') }}
          </button>
        </div>
      </div>
    </template>
  </article>
</template>

<script setup>
import { Film, ImageIcon, Loader2, RotateCcw } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { studioAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { captionSourceOf, dialogueTooLong, speechSeconds } from '~/utils/studioFlow'

/** StudioShotCard — ช็อตเดียว: โหมด script (แก้บทพูด/ภาพ/ข้อความบนจอ) หรือโหมด render (keyframe/video) */
const props = defineProps({
  projectId: { type: Number, required: true },
  shot: { type: Object, required: true },
  language: { type: String, default: 'th' },
  roleLabel: { type: String, default: '' },
  mode: { type: String, default: 'script' },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['updated', 'render'])

const { t } = useI18n()

const saving = ref(false)
const draft = reactive({ dialogue: '', visual: '', onScreenText: '', durationSec: 10 })

watch(() => props.shot, (s) => {
  Object.assign(draft, {
    dialogue: s.dialogue || '',
    visual: s.visual || '',
    onScreenText: s.onScreenText || '',
    durationSec: s.durationSec || 10,
  })
}, { immediate: true })

const dirty = computed(() =>
  (draft.dialogue || '') !== (props.shot.dialogue || '')
  || (draft.visual || '') !== (props.shot.visual || '')
  || (draft.onScreenText || '') !== (props.shot.onScreenText || '')
  || Number(draft.durationSec) !== Number(props.shot.durationSec))

const hasCaption = computed(() => !!captionSourceOf(props.shot))
const estSeconds = computed(() => speechSeconds(draft.dialogue, props.language))
const tooLong = computed(() => dialogueTooLong(draft.dialogue, props.language, draft.durationSec))
const speechHint = computed(() => {
  if (!(draft.dialogue || '').trim()) return t('productStudio.shots.dialogueHint')
  return t('productStudio.shots.speechEstimate', { est: estSeconds.value.toFixed(1), limit: draft.durationSec })
})

async function save() {
  if (saving.value || !dirty.value) return
  saving.value = true
  try {
    const updated = await studioAPI.updateShot(props.projectId, props.shot.id, {
      dialogue: draft.dialogue.trim() || null,
      visual: draft.visual.trim(),
      onScreenText: draft.onScreenText.trim() || null,
      durationSec: Math.min(60, Math.max(3, Math.round(Number(draft.durationSec) || props.shot.durationSec))),
    })
    toast.success(t('productStudio.shots.saved'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.ps-shot {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.24s var(--ease-out) both;
}
.ps-shot-head { display: flex; align-items: center; gap: 8px; }
.ps-shot-num {
  width: 22px; height: 22px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 7px; background: var(--accent-bg); color: var(--accent-text);
  font-size: 11px; font-weight: 700;
}
.ps-shot-role { margin: 0; flex: 1; min-width: 0; font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--text-0); }
.ps-shot-dialogue { min-height: 64px; resize: vertical; }
.ps-shot-warn { color: var(--warning, #d97706); font-weight: 500; }
.ps-shot-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ps-shot-duration { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-2); }
.ps-shot-duration .input { width: 72px; }
.ps-shot-media-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ps-shot-media { display: flex; flex-direction: column; gap: 6px; }
.ps-shot-media-label { margin: 0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-3); }
.ps-shot-media .btn { align-self: flex-start; }
.ps-shot-frame {
  aspect-ratio: 9 / 16; max-height: 220px; margin: 0 auto; width: 100%;
  border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--surface-soft); overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.ps-shot-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-shot-video { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-shot-skeleton { color: var(--text-3); }
.ps-shot-failed { padding: 10px; text-align: center; color: var(--action-danger, #dc2626); }
.ps-shot-failed p { margin: 0; font-size: 10.5px; line-height: 1.45; overflow-wrap: anywhere; }
.ps-shot-none { color: var(--text-3); }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field-label { font-size: 11px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 10.5px; color: var(--text-3); line-height: 1.45; }
.ps-shot .textarea { resize: vertical; font-size: 12px; }

@media (max-width: 640px) {
  .ps-shot-media-grid { grid-template-columns: 1fr; }
}
</style>
