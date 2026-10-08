<template>
  <div class="mk-refs">
    <div class="mk-refs-head">
      <div>
        <h3 class="mk-refs-title">{{ t('marketer.references.title') }}</h3>
        <p class="mk-refs-desc">{{ t('marketer.references.desc') }}</p>
      </div>
      <button type="button" class="btn btn-sm" :disabled="disabled" @click="formOpen = !formOpen">
        <Plus :size="12" :stroke-width="2" />
        {{ t('marketer.references.add') }}
      </button>
    </div>

    <!-- 新增表单：链接可选，transcript 必填；明确说明不抓取链接里的视频 -->
    <form v-if="formOpen" class="mk-refs-form" @submit.prevent="add">
      <div class="mk-refs-grid">
        <label class="field">
          <span class="field-label">{{ t('marketer.references.name') }}</span>
          <input v-model="form.title" class="input" :placeholder="t('marketer.references.namePlaceholder')" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('marketer.references.link') }}</span>
          <input v-model="form.sourceUrl" class="input" type="url" :placeholder="t('marketer.references.linkPlaceholder')" />
        </label>
      </div>
      <label class="field">
        <span class="field-label">{{ t('marketer.references.transcript') }} <span class="mk-required">*</span></span>
        <textarea v-model="form.transcript" class="textarea mk-refs-transcript" rows="6" required :placeholder="t('marketer.references.transcriptPlaceholder')" />
        <span class="field-hint">{{ t('marketer.references.transcriptHint') }}</span>
        <span class="field-hint mk-refs-note">{{ t('marketer.references.noVideoNote') }}</span>
      </label>
      <label class="field">
        <span class="field-label">{{ t('marketer.references.notes') }}</span>
        <textarea v-model="form.notes" class="textarea" rows="2" :placeholder="t('marketer.references.notesPlaceholder')" />
      </label>
      <div class="mk-refs-actions">
        <button type="button" class="btn btn-sm" @click="formOpen = false">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="submitting || !form.transcript.trim()">
          <Loader2 v-if="submitting" :size="12" class="animate-spin" />
          {{ t('marketer.references.submit') }}
        </button>
      </div>
    </form>

    <div v-if="references.length" class="mk-refs-list">
      <MarketerReferenceCard
        v-for="r in references"
        :key="r.id"
        :campaign-id="campaignId"
        :ad-ref="r"
        :disabled="disabled"
        @updated="emit('updated', $event)"
        @delete="toDelete = $event"
        @generate="emit('generate', $event)"
      />
    </div>
    <p v-else class="mk-refs-empty">{{ t('marketer.references.empty') }}</p>

    <ConfirmDialog
      :open="!!toDelete"
      :title="t('marketer.references.deleteTitle')"
      :message="t('marketer.references.deleteMessage', { title: toDelete?.title || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="deleting"
      @confirm="remove"
      @cancel="toDelete = null"
    />
  </div>
</template>

<script setup>
import { Loader2, Plus } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { marketerAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** MarketerReferencePanel — Recreate Viral Ad：参考列表 + 新增表单（transcript 必填） */
const props = defineProps({
  campaignId: { type: Number, required: true },
  references: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['updated', 'refresh', 'generate'])

const { t } = useI18n()

const formOpen = ref(false)
const submitting = ref(false)
const deleting = ref(false)
const toDelete = ref(null)
const form = reactive({ title: '', sourceUrl: '', transcript: '', notes: '' })

async function add() {
  if (submitting.value) return
  submitting.value = true
  try {
    const created = await marketerAPI.addReference(props.campaignId, {
      transcript: form.transcript,
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      ...(form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    })
    Object.assign(form, { title: '', sourceUrl: '', transcript: '', notes: '' })
    formOpen.value = false
    toast.success(t('marketer.references.created'))
    emit('updated', created)
  } catch (e) {
    toastError(e)
  } finally {
    submitting.value = false
  }
}

async function remove() {
  const r = toDelete.value
  if (!r) return
  deleting.value = true
  try {
    await marketerAPI.deleteReference(props.campaignId, r.id)
    toDelete.value = null
    toast.success(t('marketer.references.deleted'))
    emit('refresh')
  } catch (e) {
    toastError(e)
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.mk-refs { display: flex; flex-direction: column; gap: 12px; }
.mk-refs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.mk-refs-title { margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--text-0); }
.mk-refs-desc { margin: 2px 0 0; font-size: 12px; color: var(--text-3); line-height: 1.5; }
.mk-refs-form {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px; border-radius: var(--radius);
  border: 1px dashed var(--border-strong); background: var(--surface-soft);
}
.mk-refs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mk-refs-transcript { min-height: 150px; resize: vertical; font-family: var(--font-mono); font-size: 12px; }
.mk-refs-form .textarea { resize: vertical; }
.mk-required { color: var(--accent-text); }
.mk-refs-note { color: var(--accent-text); }
.mk-refs-actions { display: flex; justify-content: flex-end; gap: 6px; }
.mk-refs-list { display: flex; flex-direction: column; gap: 10px; }
.mk-refs-empty { margin: 0; font-size: 12.5px; color: var(--text-3); }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }

@media (max-width: 640px) {
  .mk-refs-grid { grid-template-columns: 1fr; }
}
</style>
