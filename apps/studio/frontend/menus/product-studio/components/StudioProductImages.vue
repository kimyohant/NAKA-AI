<template>
  <div class="ps-pimages">
    <h3 class="mk-subhead">{{ t('productStudio.productImages.title') }}</h3>
    <div class="ps-pimages-form">
      <div class="ps-filter-group" role="group" :aria-label="t('productStudio.productImages.kind')">
        <button
          v-for="k in STUDIO_IMAGE_KINDS"
          :key="k"
          type="button"
          :class="['filter-chip', { on: kind === k }]"
          :aria-pressed="kind === k"
          @click="kind = k"
        >{{ t(`productStudio.imageKinds.${k}`) }}</button>
      </div>
      <div class="ps-url-row">
        <label class="field ps-url-field">
          <span class="field-label">{{ t('productStudio.productImages.source') }}</span>
          <select v-model="source" class="input">
            <option v-for="img in productImages" :key="img" :value="img">{{ fileNameOf(img) }}</option>
          </select>
        </label>
        <label v-if="kind === 'banner'" class="field ps-url-field">
          <span class="field-label">{{ t('productStudio.productImages.platform') }}</span>
          <select v-model="platform" class="input">
            <option v-for="p in platformOptions" :key="p.id" :value="p.id">{{ t(`productStudio.platforms.${p.id}`) }}</option>
          </select>
        </label>
        <label class="ps-shot-duration">
          <span>{{ t('productStudio.productImages.count') }}</span>
          <input v-model.number="count" class="input" type="number" min="1" max="4" step="1" @blur="clampCount()" />
        </label>
      </div>
      <input v-model="instruction" class="input" :placeholder="t('productStudio.productImages.instructionPlaceholder')" />
      <div>
        <button class="btn btn-primary" type="button" :disabled="generating || !source" @click="generate">
          <Loader2 v-if="generating" :size="13" class="animate-spin" />
          <ImagePlus v-else :size="13" :stroke-width="2" />
          {{ t('productStudio.productImages.generate') }}
        </button>
      </div>
    </div>
    <div v-if="images.length" class="ps-pimages-grid">
      <StudioImageCard
        v-for="im in images"
        :key="im.id"
        :project-id="projectId"
        :image="im"
        @promoted="(e) => emit('promoted', e)"
        @deleted="(id) => emit('deleted', id)"
      />
    </div>
    <p v-else class="ps-hint">{{ t('productStudio.productImages.empty') }}</p>
  </div>
</template>

<script setup>
import { ImagePlus, Loader2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { studioAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { STUDIO_IMAGE_KINDS } from '../utils/studioFlow'

/** StudioProductImages — แผงรอง: สร้างภาพสินค้าใหม่จากรูปจริง (packshot/lifestyle/on_model/banner) */
const props = defineProps({
  projectId: { type: Number, required: true },
  images: { type: Array, default: () => [] },
  productImages: { type: Array, default: () => [] },
  platformOptions: { type: Array, default: () => [] },
})
const emit = defineEmits(['generated', 'promoted', 'deleted'])

const { t } = useI18n()

const kind = ref('packshot')
const source = ref('')
const platform = ref('')
const count = ref(2)
const instruction = ref('')
const generating = ref(false)

watch(() => props.productImages, (imgs) => {
  if (!source.value || !imgs.includes(source.value)) source.value = imgs?.[0] || ''
}, { immediate: true })

function clampCount() {
  const v = Math.round(Number(count.value))
  count.value = Number.isFinite(v) ? Math.min(4, Math.max(1, v)) : 2
}
function fileNameOf(url) {
  return String(url || '').split('/').pop() || url
}

async function generate() {
  if (!source.value || generating.value) return
  clampCount()
  generating.value = true
  try {
    const created = await studioAPI.generateImages(props.projectId, {
      kind: kind.value,
      sourceImage: source.value,
      count: count.value,
      ...(kind.value === 'banner' && platform.value ? { platform: platform.value } : {}),
      ...(instruction.value.trim() ? { instruction: instruction.value.trim() } : {}),
    })
    toast.success(t('productStudio.productImages.generated', { n: created.length }))
    emit('generated', created)
  } catch (e) {
    toastError(e)
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.ps-pimages { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
.ps-pimages-form { display: flex; flex-direction: column; gap: 8px; }
.ps-filter-group { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-url-row { display: flex; gap: 8px; align-items: flex-end; }
.ps-url-field { flex: 1; min-width: 0; }
.ps-shot-duration { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-2); }
.ps-shot-duration .input { width: 72px; }
.ps-pimages-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px;
}
.ps-hint { font-size: 11.5px; color: var(--text-3); }
.mk-subhead { margin: 0 0 4px; font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--text-1); }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }

@media (max-width: 640px) {
  .ps-url-row { flex-direction: column; align-items: stretch; }
  .ps-pimages-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
}
</style>
