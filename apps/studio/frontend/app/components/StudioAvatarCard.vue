<template>
  <article class="ps-avatar">
    <div class="ps-avatar-visual" :class="{ processing: avatar.imageStatus === 'processing' }">
      <img v-if="avatar.imageUrl" :src="avatar.imageUrl" :alt="avatar.name" loading="lazy" />
      <div v-else-if="avatar.imageStatus === 'processing'" class="ps-avatar-skeleton" role="status">
        <Loader2 :size="18" class="animate-spin" />
      </div>
      <div v-else class="ps-avatar-placeholder"><UserRound :size="24" :stroke-width="1.5" /></div>
    </div>

    <template v-if="!editing">
      <h3 class="ps-avatar-name truncate">{{ avatar.name }}</h3>
      <p class="ps-avatar-desc">{{ avatar.description }}</p>
      <p v-if="avatar.locale" class="ps-avatar-locale">{{ t(`productStudio.markets.${avatar.locale}`) }}</p>
      <p v-if="avatar.imageStatus === 'failed'" class="ps-avatar-error" role="alert">{{ avatar.imageError || t('productStudio.avatars.imageFailed') }}</p>

      <div class="ps-avatar-actions">
        <button type="button" class="btn btn-sm btn-icon ps-del" :title="t('productStudio.avatars.delete')" :aria-label="t('productStudio.avatars.delete')" :disabled="disabled" @click="emit('delete', avatar)">
          <Trash2 :size="13" :stroke-width="1.9" />
        </button>
        <button type="button" class="btn btn-sm" :disabled="disabled" @click="startEdit">
          <Pencil :size="12" :stroke-width="2" />
          {{ t('productStudio.avatars.edit') }}
        </button>
        <button type="button" class="btn btn-sm btn-primary" :disabled="disabled || generating" @click="aiGenerate">
          <Loader2 v-if="generating" :size="12" class="animate-spin" />
          <Sparkles v-else :size="12" :stroke-width="2" />
          {{ avatar.imageUrl ? t('productStudio.avatars.regenerate') : t('productStudio.avatars.aiGenerate') }}
        </button>
      </div>
    </template>

    <form v-else class="ps-avatar-edit" @submit.prevent="save">
      <label class="field">
        <span class="field-label">{{ t('productStudio.avatars.name') }}</span>
        <input v-model="draft.name" class="input" required />
      </label>
      <label class="field">
        <span class="field-label">{{ t('productStudio.avatars.description') }}</span>
        <textarea v-model="draft.description" class="textarea" rows="3" required :placeholder="t('productStudio.avatars.descriptionPlaceholder')" />
        <span class="field-hint">{{ t('productStudio.avatars.descriptionHint') }}</span>
      </label>
      <label class="field">
        <span class="field-label">{{ t('productStudio.avatars.locale') }}</span>
        <select v-model="draft.locale" class="input">
          <option value="">{{ t('productStudio.avatars.localeAny') }}</option>
          <option v-for="m in markets" :key="m" :value="m">{{ t(`productStudio.markets.${m}`) }}</option>
        </select>
      </label>
      <div class="ps-avatar-actions">
        <button type="button" class="btn btn-sm" :disabled="saving" @click="editing = false">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="saving || !draft.name.trim() || !draft.description.trim()">
          <Loader2 v-if="saving" :size="12" class="animate-spin" />
          {{ t('common.save') }}
        </button>
      </div>
    </form>
  </article>
</template>

<script setup>
import { Loader2, Pencil, Sparkles, Trash2, UserRound } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { studioAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** StudioAvatarCard — avatar ของผู้ใช้: รูปอัปโหลด/AI สร้าง, แก้คำบรรยาย, ลบ */
const props = defineProps({
  avatar: { type: Object, required: true },
  markets: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['updated', 'delete'])

const { t } = useI18n()

const editing = ref(false)
const saving = ref(false)
const generating = ref(false)
const draft = reactive({ name: '', description: '', locale: '' })

function startEdit() {
  Object.assign(draft, {
    name: props.avatar.name || '',
    description: props.avatar.description || '',
    locale: props.avatar.locale || '',
  })
  editing.value = true
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const updated = await studioAPI.updateAvatar(props.avatar.id, {
      name: draft.name.trim(),
      description: draft.description.trim(),
      locale: draft.locale || null,
    })
    editing.value = false
    toast.success(t('productStudio.avatars.saved'))
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
    const updated = await studioAPI.generateAvatarImage(props.avatar.id)
    toast.success(t('productStudio.avatars.generating'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
.ps-avatar {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.24s var(--ease-out) both;
}
.ps-avatar-visual {
  position: relative; aspect-ratio: 3 / 4; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--surface-soft);
  overflow: hidden;
}
.ps-avatar-visual img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-avatar-visual.processing::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(100deg, transparent 40%, var(--bg-hover) 50%, transparent 60%);
  background-size: 200% 100%;
  animation: ps-avatar-shimmer 1.4s linear infinite;
}
@keyframes ps-avatar-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.ps-avatar-skeleton, .ps-avatar-placeholder {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3);
}
.ps-avatar-name { margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--text-0); }
.ps-avatar-desc {
  margin: 0; font-size: 12px; color: var(--text-2); line-height: 1.55; flex: 1;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.ps-avatar-locale { margin: 0; font-size: 11px; color: var(--text-3); }
.ps-avatar-error { margin: 0; font-size: 11px; color: var(--action-danger, #dc2626); overflow-wrap: anywhere; }
.ps-avatar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.ps-del { margin-right: auto; width: var(--button-height-sm); min-width: var(--button-height-sm); height: var(--button-height-sm); min-height: var(--button-height-sm); }
.ps-del:hover:not(:disabled) { background: var(--action-danger-bg); color: var(--action-danger); }
.ps-avatar-edit { display: flex; flex-direction: column; gap: 8px; }
.ps-avatar-edit .textarea { resize: vertical; font-size: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.field-label { font-size: 11px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 10.5px; color: var(--text-3); line-height: 1.45; }
</style>
