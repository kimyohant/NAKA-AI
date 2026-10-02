<template>
  <article class="mk-ref" :class="`st-${adRef.status}`">
    <div class="mk-ref-head">
      <div class="mk-ref-title-wrap">
        <h3 class="mk-ref-title truncate">{{ adRef.title }}</h3>
        <span class="tag mk-ref-status" :class="adRef.status === 'analyzed' ? 'tag-success' : ''">
          {{ t(`marketer.referenceStatus.${adRef.status}`) }}
        </span>
      </div>
      <a v-if="adRef.sourceUrl" :href="adRef.sourceUrl" target="_blank" rel="noopener noreferrer" class="mk-ref-link">
        <Link2 :size="12" :stroke-width="2" />
        <span class="truncate">{{ adRef.sourceUrl }}</span>
      </a>
    </div>

    <p v-if="adRef.notes" class="mk-ref-notes">{{ adRef.notes }}</p>

    <button type="button" class="mk-ref-toggle" :aria-expanded="transcriptOpen" @click="transcriptOpen = !transcriptOpen">
      <ChevronRight :size="13" :stroke-width="2" class="mk-ref-chevron" :class="{ open: transcriptOpen }" />
      {{ transcriptOpen ? t('marketer.references.hideTranscript') : t('marketer.references.showTranscript') }}
    </button>
    <pre v-if="transcriptOpen" class="mk-ref-transcript">{{ adRef.transcript }}</pre>

    <template v-if="adRef.status === 'analyzed' && adRef.analysis">
      <button type="button" class="mk-ref-toggle" :aria-expanded="analysisOpen" @click="analysisOpen = !analysisOpen">
        <ChevronRight :size="13" :stroke-width="2" class="mk-ref-chevron" :class="{ open: analysisOpen }" />
        {{ analysisOpen ? t('marketer.references.hideAnalysis') : t('marketer.references.showAnalysis') }}
      </button>
      <!-- 渲染器复用 marketerMarkdown：先转义再白名单标签，v-html 安全 -->
      <div v-if="analysisOpen" class="mk-ref-analysis mk-md" v-html="renderedAnalysis" />
    </template>

    <!-- 编辑态：title / sourceUrl / transcript / notes -->
    <form v-else-if="editing" class="mk-ref-edit" @submit.prevent="save">
      <label class="field">
        <span class="field-label">{{ t('marketer.references.name') }}</span>
        <input v-model="draft.title" class="input" :placeholder="t('marketer.references.namePlaceholder')" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('marketer.references.link') }}</span>
        <input v-model="draft.sourceUrl" class="input" type="url" :placeholder="t('marketer.references.linkPlaceholder')" />
      </label>
      <label class="field">
        <span class="field-label">{{ t('marketer.references.transcript') }}</span>
        <textarea v-model="draft.transcript" class="textarea mk-ref-input" rows="6" required />
        <span v-if="transcriptChanged && adRef.status === 'analyzed'" class="field-hint mk-ref-warn">
          {{ t('marketer.references.transcriptChangeWarn') }}
        </span>
      </label>
      <label class="field">
        <span class="field-label">{{ t('marketer.references.notes') }}</span>
        <textarea v-model="draft.notes" class="textarea" rows="2" />
      </label>
      <div class="mk-ref-actions">
        <button type="button" class="btn btn-sm" :disabled="saving" @click="editing = false">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="saving || !draft.transcript.trim()">
          <Loader2 v-if="saving" :size="12" class="animate-spin" />
          {{ t('common.save') }}
        </button>
      </div>
    </form>

    <div v-if="!editing" class="mk-ref-actions">
      <button type="button" class="btn btn-sm btn-icon mk-del" :title="t('marketer.references.delete')" :aria-label="t('marketer.references.delete')" :disabled="disabled || busy" @click="emit('delete', adRef)">
        <Trash2 :size="13" :stroke-width="1.9" />
      </button>
      <button type="button" class="btn btn-sm" :disabled="disabled || busy" @click="startEdit">
        <Pencil :size="12" :stroke-width="2" />
        {{ t('marketer.references.edit') }}
      </button>
      <button type="button" class="btn btn-sm" :disabled="disabled || busy" @click="analyze">
        <Loader2 v-if="analyzing" :size="12" class="animate-spin" />
        <ScanSearch v-else :size="12" :stroke-width="2" />
        {{ t('marketer.references.analyze') }}
      </button>
      <button v-if="adRef.status === 'analyzed'" type="button" class="btn btn-sm btn-primary" :disabled="disabled || busy" @click="emit('generate', adRef)">
        <Wand2 :size="12" :stroke-width="2" />
        {{ t('marketer.references.generateFrom') }}
      </button>
    </div>
  </article>
</template>

<script setup>
import { Link2, Loader2, Pencil, ScanSearch, Trash2, Wand2, ChevronRight } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { marketerAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { renderMarkdown } from '~/utils/marketerMarkdown'

/** MarketerReferenceCard — 广告参考单卡：transcript 存档 + 同步 analyze + 按结构生成 creative */
const props = defineProps({
  campaignId: { type: Number, required: true },
  adRef: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['updated', 'delete', 'generate'])

const { t } = useI18n()

const transcriptOpen = ref(false)
const analysisOpen = ref(true)
const editing = ref(false)
const saving = ref(false)
const analyzing = ref(false)
const busy = computed(() => saving.value || analyzing.value)
const draft = reactive({ title: '', sourceUrl: '', transcript: '', notes: '' })

const renderedAnalysis = computed(() => renderMarkdown(props.adRef.analysis))
const transcriptChanged = computed(() => draft.transcript !== (props.adRef.transcript || ''))

function startEdit() {
  Object.assign(draft, {
    title: props.adRef.title || '',
    sourceUrl: props.adRef.sourceUrl || '',
    transcript: props.adRef.transcript || '',
    notes: props.adRef.notes || '',
  })
  editing.value = true
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const updated = await marketerAPI.updateReference(props.campaignId, props.adRef.id, {
      title: draft.title.trim() || null,
      sourceUrl: draft.sourceUrl.trim() || null,
      transcript: draft.transcript,
      notes: draft.notes.trim() || null,
    })
    editing.value = false
    toast.success(t('marketer.references.saved'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

async function analyze() {
  if (analyzing.value) return
  analyzing.value = true
  try {
    const updated = await marketerAPI.analyzeReference(props.campaignId, props.adRef.id)
    analysisOpen.value = true
    toast.success(t('marketer.references.analyzed'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    analyzing.value = false
  }
}
</script>

<style scoped>
.mk-ref {
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.28s var(--ease-out) both;
  transition: border-color 0.16s var(--ease-out);
}
.mk-ref:hover { border-color: var(--border-strong); }
.mk-ref.st-analyzed { border-color: color-mix(in srgb, var(--success) 40%, var(--border)); }
.mk-ref-head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.mk-ref-title-wrap { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mk-ref-title {
  margin: 0; font-family: var(--font-display);
  font-size: 14.5px; font-weight: 600; color: var(--text-0);
}
.mk-ref-status { flex-shrink: 0; }
.mk-ref-link {
  display: inline-flex; align-items: center; gap: 5px; max-width: fit-content;
  font-size: 11.5px; color: var(--accent-text); text-decoration: none;
}
.mk-ref-link:hover { text-decoration: underline; }
.mk-ref-notes { margin: 0; font-size: 12.5px; color: var(--text-1); line-height: 1.55; overflow-wrap: anywhere; }
.mk-ref-toggle {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px 2px 2px; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-2); font: 600 12px var(--font-body); cursor: pointer;
}
.mk-ref-toggle:hover { color: var(--text-0); background: var(--bg-hover); }
.mk-ref-toggle:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-ref-chevron { transition: transform 0.18s var(--ease-out); }
.mk-ref-chevron.open { transform: rotate(90deg); }
.mk-ref-transcript {
  max-height: 260px; overflow: auto;
  margin: 0; padding: 12px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border);
  font: 12px/1.65 var(--font-mono); color: var(--text-1);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.mk-ref-analysis {
  padding: 12px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border);
  font-size: 12.5px; color: var(--text-1); line-height: 1.6;
  max-height: 420px; overflow: auto;
}
.mk-ref-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.mk-del { margin-right: auto; width: var(--button-height-sm); min-width: var(--button-height-sm); height: var(--button-height-sm); min-height: var(--button-height-sm); }
.mk-del:hover:not(:disabled) { background: var(--action-danger-bg); color: var(--action-danger); }
.mk-ref-edit { display: flex; flex-direction: column; gap: 10px; }
.mk-ref-input { min-height: 180px; resize: vertical; font-family: var(--font-mono); font-size: 12px; }
.mk-ref-edit .textarea { resize: vertical; }
.mk-ref-warn { color: var(--warning, #d97706); font-weight: 500; }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
</style>
