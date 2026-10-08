<template>
  <article class="mk-visual" :class="`vs-${visual.status}`">
    <!-- processing：骨架屏（不使用真实进度，sys_task 只有状态） -->
    <div v-if="visual.status === 'processing'" class="mk-visual-skeleton" role="status" :aria-label="t('marketer.visuals.processing')">
      <Loader2 :size="18" class="animate-spin" />
    </div>
    <figure v-else-if="visual.status === 'completed' && visual.imageUrl" class="mk-visual-figure">
      <img :src="visual.imageUrl" :alt="kindLabel" class="mk-visual-img" loading="lazy" />
    </figure>
    <div v-else-if="visual.status === 'failed'" class="mk-visual-failed">
      <CircleAlert :size="18" :stroke-width="1.8" />
      <p class="mk-visual-error">{{ visual.errorMsg || t('marketer.visuals.failedHint') }}</p>
    </div>

    <div class="mk-visual-meta">
      <div class="mk-visual-tags">
        <span class="tag tag-accent">{{ kindLabel }}</span>
        <span class="tag mk-status" :class="statusTagClass">{{ t(`marketer.visualStatus.${visual.status}`) }}</span>
        <span v-if="visual.promoted" class="tag tag-success">{{ t('marketer.visuals.promotedBadge') }}</span>
      </div>
      <p v-if="visual.instruction" class="mk-visual-instruction truncate">{{ visual.instruction }}</p>
    </div>

    <button type="button" class="mk-visual-toggle" :aria-expanded="promptOpen" @click="promptOpen = !promptOpen">
      <ChevronRight :size="13" :stroke-width="2" class="mk-visual-chevron" :class="{ open: promptOpen }" />
      {{ promptOpen ? t('marketer.visuals.hidePrompt') : t('marketer.visuals.viewPrompt') }}
    </button>
    <pre v-if="promptOpen" class="mk-visual-prompt">{{ visual.prompt }}</pre>

    <div class="mk-visual-actions">
      <button type="button" class="btn btn-sm btn-icon mk-del" :title="t('marketer.visuals.delete')" :aria-label="t('marketer.visuals.delete')" :disabled="disabled || busy" @click="remove">
        <Trash2 :size="13" :stroke-width="1.9" />
      </button>
      <button v-if="visual.status === 'failed'" type="button" class="btn btn-sm" :disabled="disabled || busy" @click="emit('retry', visual)">
        <RotateCcw :size="12" :stroke-width="2" />
        {{ t('marketer.visuals.retry') }}
      </button>
      <button v-if="visual.status === 'completed' && !visual.promoted" type="button" class="btn btn-sm btn-primary" :disabled="disabled || busy" @click="promote">
        <Loader2 v-if="promoting" :size="12" class="animate-spin" />
        <Check v-else :size="12" :stroke-width="2.4" />
        {{ t('marketer.visuals.promote') }}
      </button>
    </div>
  </article>
</template>

<script setup>
import { Check, ChevronRight, CircleAlert, Loader2, RotateCcw, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { marketerAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** MarketerVisualCard — 单张产品视觉：processing 骨架 / completed 可 promote / failed 可重试 */
const props = defineProps({
  campaignId: { type: Number, required: true },
  visual: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['updated', 'promoted', 'deleted', 'retry'])

const { t, te } = useI18n()

const promptOpen = ref(false)
const promoting = ref(false)
const deleting = ref(false)
const busy = computed(() => promoting.value || deleting.value)

const kindLabel = te(`marketer.visualKinds.${props.visual.kind}`) ? t(`marketer.visualKinds.${props.visual.kind}`) : (props.visual.kind || '')
const statusTagClass = computed(() => ({
  'tag-info': props.visual.status === 'processing',
  'tag-success': props.visual.status === 'completed',
  'tag-error': props.visual.status === 'failed',
}))

async function promote() {
  if (promoting.value) return
  promoting.value = true
  try {
    const campaign = await marketerAPI.promoteVisual(props.campaignId, props.visual.id)
    toast.success(t('marketer.visuals.promoted'))
    emit('promoted', { campaign, visual: props.visual })
  } catch (e) {
    toastError(e)
  } finally {
    promoting.value = false
  }
}

async function remove() {
  if (deleting.value) return
  deleting.value = true
  try {
    await marketerAPI.deleteVisual(props.campaignId, props.visual.id)
    toast.success(t('marketer.visuals.deleted'))
    emit('deleted', props.visual.id)
  } catch (e) {
    toastError(e)
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.mk-visual {
  display: flex; flex-direction: column; gap: 10px;
  padding: 12px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.28s var(--ease-out) both;
  transition: border-color 0.16s var(--ease-out);
}
.mk-visual:hover { border-color: var(--border-strong); }
.mk-visual.vs-completed { border-color: color-mix(in srgb, var(--success) 35%, var(--border)); }
.mk-visual-skeleton {
  aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius); color: var(--text-3);
  background: linear-gradient(100deg, var(--surface-soft) 40%, var(--bg-hover) 50%, var(--surface-soft) 60%);
  background-size: 200% 100%;
  animation: mk-visual-shimmer 1.4s linear infinite;
}
@keyframes mk-visual-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.mk-visual-figure { margin: 0; }
.mk-visual-img {
  display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover;
  border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-soft);
}
.mk-visual-failed {
  aspect-ratio: 1 / 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 12px; text-align: center;
  border-radius: var(--radius); border: 1px dashed var(--border-strong);
  color: var(--action-danger, #dc2626); background: var(--surface-soft);
}
.mk-visual-error { margin: 0; font-size: 11.5px; color: var(--text-2); line-height: 1.5; overflow-wrap: anywhere; }
.mk-visual-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mk-visual-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.mk-status { margin-left: auto; }
.mk-visual-instruction { margin: 0; font-size: 12px; color: var(--text-1); line-height: 1.5; overflow-wrap: anywhere; }
.mk-visual-toggle {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px 2px 2px; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-2); font: 600 11.5px var(--font-body); cursor: pointer;
}
.mk-visual-toggle:hover { color: var(--text-0); background: var(--bg-hover); }
.mk-visual-toggle:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-visual-chevron { transition: transform 0.18s var(--ease-out); }
.mk-visual-chevron.open { transform: rotate(90deg); }
.mk-visual-prompt {
  max-height: 220px; overflow: auto;
  margin: 0; padding: 10px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border);
  font: 11.5px/1.6 var(--font-mono); color: var(--text-1);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.mk-visual-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: auto; }
.mk-del { margin-right: auto; width: var(--button-height-sm); min-width: var(--button-height-sm); height: var(--button-height-sm); min-height: var(--button-height-sm); }
.mk-del:hover:not(:disabled) { background: var(--action-danger-bg); color: var(--action-danger); }
</style>
