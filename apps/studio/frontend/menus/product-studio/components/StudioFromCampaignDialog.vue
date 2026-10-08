<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="dialog ps-fc-dialog" role="dialog" aria-modal="true" :aria-label="t('productStudio.fromCampaign.title')">
      <div class="dialog-head">
        <div class="ps-fc-icon">
          <ShoppingBag :size="18" :stroke-width="1.8" />
        </div>
        <div class="dialog-head-copy">
          <h2 class="dialog-title">{{ t('productStudio.fromCampaign.title') }}</h2>
          <p class="dialog-desc">{{ t('productStudio.fromCampaign.desc', { creative: creativeName }) }}</p>
        </div>
      </div>
      <div class="dialog-body ps-fc-body">
        <p v-if="loadError" class="ps-fc-error" role="alert">{{ loadError }}</p>
        <div v-else-if="!templates.length" class="ps-fc-loading" role="status">
          <Loader2 :size="16" class="animate-spin" />
        </div>
        <StudioTemplateGallery
          v-else
          :templates="templates"
          :selected-id="selectedId"
          :platform-options="[]"
          @select="selectedId = $event.id"
        />
      </div>
      <div class="dialog-foot">
        <span v-if="!selectedId" class="ps-fc-hint">{{ t('productStudio.fromCampaign.needTemplate') }}</span>
        <button type="button" class="btn" :disabled="creating" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="button" class="btn btn-primary" :disabled="creating || !selectedId" @click="create">
          <Loader2 v-if="creating" :size="13" class="animate-spin" />
          <ShoppingBag v-else :size="13" :stroke-width="2" />
          {{ creating ? t('productStudio.fromCampaign.creating') : t('productStudio.fromCampaign.submit') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Loader2, ShoppingBag } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { studioAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** StudioFromCampaignDialog — สร้างโปรเจกต์ Studio จากแคมเปญ Marketer (+ creative ที่เลือก) */
const props = defineProps({
  open: { type: Boolean, default: false },
  campaignId: { type: Number, required: true },
  creative: { type: Object, default: null },
})
const emit = defineEmits(['close', 'created'])

const { t, te } = useI18n()

const templates = ref([])
const selectedId = ref('')
const creating = ref(false)
const loadError = ref('')

const creativeName = computed(() => {
  const c = props.creative
  if (!c) return t('productStudio.fromCampaign.noCreative')
  return c.hook || ''
})

watch(() => props.open, async (v) => {
  if (!v) return
  selectedId.value = ''
  loadError.value = ''
  if (templates.value.length) return
  try {
    templates.value = await studioAPI.templates() || []
  } catch (e) {
    const code = e?.errorCode
    loadError.value = code && te(`errors.codes.${code}`) ? t(`errors.codes.${code}`) : t('productStudio.fromCampaign.loadFailed')
  }
})

async function create() {
  if (creating.value || !selectedId.value) return
  creating.value = true
  try {
    const p = await studioAPI.fromCampaign({
      campaignId: props.campaignId,
      ...(props.creative ? { creativeId: props.creative.id } : {}),
      templateId: selectedId.value,
    })
    toast.success(t('productStudio.fromCampaign.created'))
    emit('close')
    emit('created', p)
  } catch (e) {
    toastError(e)
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.ps-fc-dialog { width: 760px; max-width: calc(100vw - 32px); }
.ps-fc-icon {
  width: 38px; height: 38px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 11px; background: var(--accent-bg); color: var(--accent-text);
}
.ps-fc-body { max-height: 60vh; overflow-y: auto; }
.ps-fc-loading { display: flex; justify-content: center; padding: 32px; color: var(--text-3); }
.ps-fc-error { margin: 0; font-size: 12.5px; color: var(--action-danger, #dc2626); }
.ps-fc-hint { margin-right: auto; align-self: center; font-size: 11.5px; color: var(--text-3); }
</style>
