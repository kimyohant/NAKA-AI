<template>
  <article class="ps-inf">
    <div class="ps-inf-visual" :class="{ processing: influencer.imageStatus === 'processing' }">
      <img v-if="influencer.imageUrl" :src="influencer.imageUrl" :alt="influencer.name" loading="lazy" />
      <div v-else-if="influencer.imageStatus === 'processing'" class="ps-inf-skeleton" role="status">
        <Loader2 :size="18" class="animate-spin" />
      </div>
      <div v-else class="ps-inf-placeholder"><Sparkles :size="24" :stroke-width="1.5" /></div>
      <span v-if="influencer.niche" class="ps-inf-niche">{{ t(`productStudio.influencers.niches.${influencer.niche}`) }}</span>
    </div>

    <template v-if="!editing">
      <h3 class="ps-inf-name truncate">{{ influencer.name }}</h3>
      <p class="ps-inf-desc">{{ influencer.persona || influencer.appearance }}</p>
      <p v-if="influencer.imageStatus === 'failed'" class="ps-inf-error" role="alert">{{ influencer.imageError || t('productStudio.influencers.imageFailed') }}</p>

      <div class="ps-inf-actions">
        <button type="button" class="btn btn-sm btn-icon ps-del" :title="t('productStudio.influencers.delete')" :aria-label="t('productStudio.influencers.delete')" :disabled="disabled" @click="emit('delete', influencer)">
          <Trash2 :size="13" :stroke-width="1.9" />
        </button>
        <button type="button" class="btn btn-sm" :disabled="disabled" @click="startEdit">
          <Pencil :size="12" :stroke-width="2" />
          {{ t('productStudio.influencers.edit') }}
        </button>
        <button type="button" class="btn btn-sm" :disabled="disabled || generating" :title="t('productStudio.influencers.aiGenerate')" @click="aiGenerate">
          <Loader2 v-if="generating" :size="12" class="animate-spin" />
          <ImagePlus v-else :size="12" :stroke-width="2" />
          {{ influencer.imageUrl ? t('productStudio.influencers.regenerate') : t('productStudio.influencers.aiGenerate') }}
        </button>
        <button type="button" class="btn btn-sm btn-primary" :disabled="disabled" @click="emit('open', influencer)">
          <Clapperboard :size="12" :stroke-width="2" />
          {{ t('productStudio.influencers.contentTitle') }}
        </button>
      </div>
    </template>

    <form v-else class="ps-inf-edit" @submit.prevent="save">
      <label class="field">
        <span class="field-label">{{ t('productStudio.influencers.name') }}</span>
        <input v-model="draft.name" class="input" required />
      </label>
      <label class="field">
        <span class="field-label">{{ t('productStudio.influencers.appearance') }}</span>
        <textarea v-model="draft.appearance" class="textarea" rows="2" :placeholder="t('productStudio.influencers.appearancePlaceholder')" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('productStudio.influencers.persona') }}</span>
        <textarea v-model="draft.persona" class="textarea" rows="2" :placeholder="t('productStudio.influencers.personaPlaceholder')" />
      </label>
      <div class="ps-inf-edit-row">
        <label class="field">
          <span class="field-label">{{ t('productStudio.influencers.niche') }}</span>
          <select v-model="draft.niche" class="input">
            <option value="">{{ t('productStudio.influencers.nicheAny') }}</option>
            <option v-for="n in NICHES" :key="n" :value="n">{{ t(`productStudio.influencers.niches.${n}`) }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">{{ t('productStudio.influencers.locale') }}</span>
          <select v-model="draft.locale" class="input">
            <option value="">{{ t('productStudio.influencers.localeAny') }}</option>
            <option v-for="m in markets" :key="m" :value="m">{{ t(`productStudio.markets.${m}`) }}</option>
          </select>
        </label>
      </div>
      <div class="ps-inf-actions">
        <button type="button" class="btn btn-sm" :disabled="saving" @click="editing = false">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="saving || !draft.name.trim()">
          <Loader2 v-if="saving" :size="12" class="animate-spin" />
          {{ t('common.save') }}
        </button>
      </div>
    </form>
  </article>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clapperboard, ImagePlus, Loader2, Pencil, Sparkles, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { studioAPI, type StudioInfluencer } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** StudioInfluencerCard — พรีเซนเตอร์ AI: รูปอัปโหลด/AI สร้าง (reference คุมหน้าเดิม), แก้ไข, ลบ, เปิดคอนเทนต์รีวิว */
const NICHES = ['beauty', 'fashion', 'food', 'tech', 'fitness', 'lifestyle', 'gaming', 'travel', 'home', 'mom_baby'] as const

const props = defineProps({
  influencer: { type: Object as () => StudioInfluencer, required: true },
  markets: { type: Array as () => string[], default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['updated', 'delete', 'open'])

const { t } = useI18n()

const editing = ref(false)
const saving = ref(false)
const generating = ref(false)
const draft = reactive({ name: '', appearance: '', persona: '', niche: '', locale: '' })

function startEdit() {
  Object.assign(draft, {
    name: props.influencer.name || '',
    appearance: props.influencer.appearance || '',
    persona: props.influencer.persona || '',
    niche: props.influencer.niche || '',
    locale: props.influencer.locale || '',
  })
  editing.value = true
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const updated = await studioAPI.updateInfluencer(props.influencer.id, {
      name: draft.name.trim(),
      appearance: draft.appearance.trim(),
      persona: draft.persona.trim(),
      niche: draft.niche || null,
      locale: (draft.locale || null) as StudioInfluencer['locale'],
    })
    editing.value = false
    toast.success(t('productStudio.influencers.saved'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

async function aiGenerate() {
  if (generating.value) return
  generating.value = true
  try {
    const updated = await studioAPI.generateInfluencerImage(props.influencer.id)
    toast.success(t('productStudio.influencers.generating'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.ps-inf {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.24s var(--ease-out) both;
}
.ps-inf-visual {
  position: relative; aspect-ratio: 3 / 4; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--surface-soft);
  overflow: hidden;
}
.ps-inf-visual img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-inf-visual.processing::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(100deg, transparent 40%, var(--bg-hover) 50%, transparent 60%);
  background-size: 200% 100%;
  animation: ps-inf-shimmer 1.4s linear infinite;
}
@keyframes ps-inf-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.ps-inf-skeleton, .ps-inf-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3);
}
.ps-inf-niche {
  position: absolute; top: 8px; left: 8px;
  padding: 2px 8px; border-radius: 999px;
  font-size: 10px; font-weight: 600;
  background: color-mix(in srgb, var(--bg-0) 72%, transparent);
  color: var(--text-0); backdrop-filter: blur(4px);
}
.ps-inf-name { margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--text-0); }
.ps-inf-desc {
  margin: 0; font-size: 12px; color: var(--text-2); line-height: 1.55; flex: 1;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.ps-inf-error { margin: 0; font-size: 11px; color: var(--action-danger, #dc2626); overflow-wrap: anywhere; }
.ps-inf-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.ps-del { margin-right: auto; width: var(--button-height-sm); min-width: var(--button-height-sm); height: var(--button-height-sm); min-height: var(--button-height-sm); }
.ps-del:hover:not(:disabled) { background: var(--action-danger-bg); color: var(--action-danger); }
.ps-inf-edit { display: flex; flex-direction: column; gap: 8px; }
.ps-inf-edit .textarea { resize: vertical; font-size: 12px; }
.ps-inf-edit-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field-label { font-size: 11px; font-weight: 600; color: var(--text-1); }
</style>
