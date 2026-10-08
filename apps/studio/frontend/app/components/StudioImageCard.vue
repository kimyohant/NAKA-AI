<template>
  <article class="ps-img" :class="`st-${image.status}`">
    <div v-if="image.status === 'processing'" class="ps-img-skeleton" role="status" :aria-label="t('productStudio.mediaStatus.processing')">
      <Loader2 :size="18" class="animate-spin" />
    </div>
    <figure v-else-if="image.status === 'completed' && image.imageUrl" class="ps-img-figure">
      <img :src="image.imageUrl" :alt="kindLabel" loading="lazy" />
    </figure>
    <div v-else class="ps-img-failed" role="alert">
      <CircleAlert :size="18" :stroke-width="1.8" />
      <p>{{ image.errorMsg || t('productStudio.productImages.failedHint') }}</p>
    </div>

    <div class="ps-img-tags">
      <span class="tag tag-accent">{{ kindLabel }}</span>
      <span v-if="image.platform" class="tag">{{ t(`productStudio.platforms.${image.platform}`) }}</span>
      <span v-if="image.promoted" class="tag tag-success">{{ t('productStudio.productImages.promotedBadge') }}</span>
      <span v-else-if="image.status === 'completed'" class="tag mk-status" :class="'tag-success'">{{ t('productStudio.mediaStatus.completed') }}</span>
    </div>

    <button type="button" class="ps-img-toggle" :aria-expanded="promptOpen" @click="promptOpen = !promptOpen">
      <ChevronRight :size="12" :stroke-width="2" class="ps-img-chevron" :class="{ open: promptOpen }" />
      {{ promptOpen ? t('productStudio.productImages.hidePrompt') : t('productStudio.productImages.viewPrompt') }}
    </button>
    <pre v-if="promptOpen" class="ps-img-prompt">{{ image.prompt }}</pre>

    <div class="ps-img-actions">
      <button type="button" class="btn btn-sm btn-icon ps-del" :title="t('productStudio.productImages.delete')" :aria-label="t('productStudio.productImages.delete')" :disabled="disabled || busy" @click="remove">
        <Trash2 :size="13" :stroke-width="1.9" />
      </button>
      <button v-if="image.status === 'completed' && !image.promoted" type="button" class="btn btn-sm btn-primary" :disabled="disabled || busy" @click="promote">
        <Loader2 v-if="promoting" :size="12" class="animate-spin" />
        <Check v-else :size="12" :stroke-width="2.4" />
        {{ t('productStudio.productImages.promote') }}
      </button>
    </div>
  </article>
</template>

<script setup>
import { Check, ChevronRight, CircleAlert, Loader2, Trash2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { studioAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** StudioImageCard — ภาพสินค้าของโปรเจกต์ (packshot/lifestyle/on_model/banner): promote → productImages */
const props = defineProps({
  projectId: { type: Number, required: true },
  image: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['promoted', 'deleted'])

const { t, te } = useI18n()

const promptOpen = ref(false)
const promoting = ref(false)
const deleting = ref(false)
const busy = computed(() => promoting.value || deleting.value)

const kindLabel = te(`productStudio.imageKinds.${props.image.kind}`) ? t(`productStudio.imageKinds.${props.image.kind}`) : (props.image.kind || '')

async function promote() {
  if (promoting.value) return
  promoting.value = true
  try {
    const project = await studioAPI.promoteImage(props.projectId, props.image.id)
    toast.success(t('productStudio.productImages.promoted'))
    emit('promoted', { project, image: props.image })
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
    await studioAPI.deleteImage(props.projectId, props.image.id)
    toast.success(t('productStudio.productImages.deleted'))
    emit('deleted', props.image.id)
  } catch (e) {
    toastError(e)
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.ps-img {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.24s var(--ease-out) both;
  transition: border-color 0.16s var(--ease-out);
}
.ps-img:hover { border-color: var(--border-strong); }
.ps-img.st-completed { border-color: color-mix(in srgb, var(--success, #22c55e) 35%, var(--border)); }
.ps-img-skeleton {
  aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius); color: var(--text-3);
  background: linear-gradient(100deg, var(--surface-soft) 40%, var(--bg-hover) 50%, var(--surface-soft) 60%);
  background-size: 200% 100%;
  animation: ps-img-shimmer 1.4s linear infinite;
}
@keyframes ps-img-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.ps-img-figure { margin: 0; }
.ps-img-figure img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-soft); }
.ps-img-failed {
  aspect-ratio: 1 / 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 12px; text-align: center;
  border-radius: var(--radius); border: 1px dashed var(--border-strong);
  color: var(--action-danger, #dc2626); background: var(--surface-soft);
}
.ps-img-failed p { margin: 0; font-size: 11px; color: var(--text-2); line-height: 1.5; overflow-wrap: anywhere; }
.ps-img-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.ps-img-tags .mk-status { margin-left: auto; }
.ps-img-toggle {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px 2px 2px; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-2); font: 600 11.5px var(--font-body); cursor: pointer;
}
.ps-img-toggle:hover { color: var(--text-0); background: var(--bg-hover); }
.ps-img-toggle:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.ps-img-chevron { transition: transform 0.18s var(--ease-out); }
.ps-img-chevron.open { transform: rotate(90deg); }
.ps-img-prompt {
  max-height: 200px; overflow: auto; margin: 0;
  padding: 10px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border);
  font: 11px/1.6 var(--font-mono); color: var(--text-1);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.ps-img-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: auto; }
.ps-del { margin-right: auto; width: var(--button-height-sm); min-width: var(--button-height-sm); height: var(--button-height-sm); min-height: var(--button-height-sm); }
.ps-del:hover:not(:disabled) { background: var(--action-danger-bg); color: var(--action-danger); }
</style>
