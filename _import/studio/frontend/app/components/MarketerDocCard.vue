<template>
  <article class="mk-doc" :class="{ approved: doc?.status === 'approved' }">
    <header class="mk-doc-head">
      <div class="mk-doc-heading">
        <h3 class="mk-doc-title">{{ t(`marketer.docKinds.${kind}`) }}</h3>
        <template v-if="doc">
          <span class="tag mono">{{ t('marketer.doc.version', { n: doc.version || 1 }) }}</span>
          <span class="tag" :class="doc.status === 'approved' ? 'tag-success' : ''">{{ t(`marketer.docStatus.${doc.status || 'draft'}`) }}</span>
        </template>
      </div>
      <div v-if="doc && !editing" class="mk-doc-actions">
        <button type="button" class="btn btn-sm" :disabled="busy || disabled" @click="startEdit">
          <Pencil :size="12" :stroke-width="2" />
          {{ t('marketer.doc.edit') }}
        </button>
        <button type="button" class="btn btn-sm" :disabled="busy || disabled" :aria-expanded="reviseOpen" @click="reviseOpen = !reviseOpen">
          <Wand2 :size="12" :stroke-width="2" />
          {{ t('marketer.doc.revise') }}
        </button>
        <button type="button" class="btn btn-sm" :disabled="busy" :aria-expanded="historyOpen" @click="toggleHistory">
          <History :size="12" :stroke-width="2" />
          {{ t('marketer.doc.history') }}
        </button>
        <button
          v-if="doc.status !== 'approved'"
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="busy || disabled"
          @click="setStatus('approved')"
        >
          <Check :size="12" :stroke-width="2.4" />
          {{ t('marketer.doc.approve') }}
        </button>
        <button v-else type="button" class="btn btn-sm" :disabled="busy || disabled" @click="setStatus('draft')">
          <Undo2 :size="12" :stroke-width="2" />
          {{ t('marketer.doc.unapprove') }}
        </button>
      </div>
    </header>

    <!-- 受控修订：一句指令让 agent 改写本文档（version+1） -->
    <form v-if="doc && reviseOpen && !editing" class="mk-revise" @submit.prevent="revise">
      <textarea
        v-model="instruction"
        class="textarea mk-revise-input"
        rows="2"
        :placeholder="t('marketer.doc.revisePlaceholder')"
        :aria-label="t('marketer.doc.revise')"
        :disabled="isRevising"
        @keydown.ctrl.enter.prevent="revise"
        @keydown.meta.enter.prevent="revise"
      />
      <div class="mk-revise-foot">
        <span class="mk-hint">{{ t('marketer.doc.reviseHint') }}</span>
        <button type="button" class="btn btn-sm" :disabled="isRevising" @click="reviseOpen = false">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="isRevising || !instruction.trim()">
          <Loader2 v-if="isRevising" :size="12" class="animate-spin" />
          {{ revising ? t('marketer.doc.revising') : t('marketer.doc.reviseSubmit') }}
        </button>
      </div>
    </form>

    <!-- 版本历史：agent 修订 / 手动编辑前的快照，可一键恢复（恢复本身 version+1，当前内容先入历史） -->
    <section v-if="doc && historyOpen && !editing" class="mk-history" :aria-label="t('marketer.doc.history')">
      <div v-if="historyLoading" class="mk-history-empty"><Loader2 :size="13" class="animate-spin" /></div>
      <p v-else-if="!revisions.length" class="mk-history-empty">{{ t('marketer.doc.historyEmpty') }}</p>
      <ul v-else class="mk-history-list">
        <li v-for="r in revisions" :key="r.id" class="mk-history-item" :class="{ on: previewId === r.id }">
          <button type="button" class="mk-history-row" :aria-expanded="previewId === r.id" @click="previewId = previewId === r.id ? null : r.id">
            <span class="tag mono">{{ t('marketer.doc.version', { n: r.version }) }}</span>
            <span class="mk-history-source">{{ t(`marketer.doc.source.${r.source}`) }}</span>
            <span class="mk-history-time">{{ fmtTime(r.createdAt) }}</span>
          </button>
          <div v-if="previewId === r.id" class="mk-history-preview">
            <div class="mk-md" v-html="renderMarkdown(r.content)" />
            <div class="mk-history-foot">
              <button type="button" class="btn btn-sm btn-primary" :disabled="restoring || disabled" @click="restore(r)">
                <Loader2 v-if="restoring" :size="12" class="animate-spin" />
                <RotateCcw v-else :size="12" :stroke-width="2" />
                {{ t('marketer.doc.restore') }}
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <div v-if="!doc" class="mk-doc-empty">{{ emptyText || t('marketer.doc.empty') }}</div>

    <div v-else-if="editing" class="mk-doc-edit">
      <textarea v-model="draft" class="textarea mk-doc-textarea" :aria-label="t(`marketer.docKinds.${kind}`)" />
      <div class="mk-doc-edit-foot">
        <span class="mk-hint">{{ t('marketer.doc.editHint') }}</span>
        <button type="button" class="btn btn-sm" :disabled="saving" @click="editing = false">{{ t('common.cancel') }}</button>
        <button type="button" class="btn btn-sm btn-primary" :disabled="saving || !draft.trim()" @click="save">
          <Loader2 v-if="saving" :size="12" class="animate-spin" />
          {{ t('common.save') }}
        </button>
      </div>
    </div>

    <div v-else class="mk-doc-body">
      <div v-if="revising" class="mk-doc-revising">
        <Loader2 :size="14" class="animate-spin" />
        {{ t('marketer.doc.revising') }}
      </div>
      <!-- renderMarkdown 先整体转义 HTML，只输出白名单标签 -->
      <div class="mk-md" v-html="html" />
      <footer class="mk-doc-foot">{{ t('marketer.doc.updated', { time: fmtTime(doc.updatedAt) }) }}</footer>
    </div>
  </article>
</template>

<script setup>
import { Check, History, Loader2, Pencil, RotateCcw, Undo2, Wand2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { marketerAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { renderMarkdown } from '~/utils/marketerMarkdown'

/** MarketerDocCard — 单份策略/调研文档：Markdown 渲染 + 编辑 + 审批 + 指令式修订 */
const props = defineProps({
  campaignId: { type: Number, required: true },
  kind: { type: String, required: true },
  doc: { type: Object, default: null },
  disabled: { type: Boolean, default: false }, // campaign 有异步任务进行中时禁用操作
  emptyText: { type: String, default: '' },
})
const emit = defineEmits(['updated', 'error'])

const { t, locale } = useI18n()

const html = computed(() => renderMarkdown(props.doc?.content || ''))

const editing = ref(false)
const draft = ref('')
const saving = ref(false)
const statusSaving = ref(false)
const reviseOpen = ref(false)
const instruction = ref('')
const revising = ref(false)
// กำลังแก้จริง = local pending (รอ 202) หรือ backend บอก doc.revising (ผล poll)
const isRevising = computed(() => revising.value || !!props.doc?.revising)
const historyOpen = ref(false)
const historyLoading = ref(false)
const revisions = ref([])
const previewId = ref(null)
const restoring = ref(false)
const busy = computed(() => saving.value || statusSaving.value || revising.value || restoring.value)

// 切换到另一份文档时收起编辑/修订/历史态
watch(() => props.doc?.id, () => {
  editing.value = false
  reviseOpen.value = false
  instruction.value = ''
  historyOpen.value = false
  previewId.value = null
})
// 内容被外部更新（轮询 / 修订）后历史已过期：展开中则重新拉取
watch(() => props.doc?.version, () => {
  if (historyOpen.value) loadHistory()
})

async function loadHistory() {
  if (!props.doc) return
  historyLoading.value = true
  try {
    revisions.value = await marketerAPI.docRevisions(props.campaignId, props.doc.id) || []
  } catch (e) {
    toastError(e)
  } finally {
    historyLoading.value = false
  }
}

function toggleHistory() {
  historyOpen.value = !historyOpen.value
  previewId.value = null
  if (historyOpen.value) {
    reviseOpen.value = false
    loadHistory()
  }
}

async function restore(r) {
  if (!props.doc || restoring.value) return
  restoring.value = true
  try {
    const updated = await marketerAPI.restoreDocRevision(props.campaignId, props.doc.id, r.id)
    previewId.value = null
    toast.success(t('marketer.doc.restored', { n: r.version }))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
    emit('error', e)
  } finally {
    restoring.value = false
  }
}

function startEdit() {
  draft.value = props.doc?.content || ''
  reviseOpen.value = false
  historyOpen.value = false
  editing.value = true
}

async function save() {
  if (!props.doc || saving.value) return
  saving.value = true
  try {
    const updated = await marketerAPI.updateDoc(props.campaignId, props.doc.id, { content: draft.value })
    editing.value = false
    toast.success(t('marketer.doc.saved'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
    emit('error', e)
  } finally {
    saving.value = false
  }
}

async function setStatus(status) {
  if (!props.doc || statusSaving.value) return
  statusSaving.value = true
  try {
    const updated = await marketerAPI.updateDoc(props.campaignId, props.doc.id, { status })
    emit('updated', updated)
  } catch (e) {
    toastError(e)
    emit('error', e)
  } finally {
    statusSaving.value = false
  }
}

// Phase Unsloth: revise แบบ async ({ async: true }) — POST 202 แล้วหน้า poll ตาม doc.revising
// (โมเดล local บน CPU ช้ามาก sync จะโดน proxy timeout)
async function revise() {
  const text = instruction.value.trim()
  if (!props.doc || !text || revising.value) return
  revising.value = true
  try {
    await marketerAPI.reviseDoc(props.campaignId, props.doc.id, text, true)
    instruction.value = ''
    reviseOpen.value = false
    emit('async-started')
  } catch (e) {
    toastError(e)
    emit('error', e)
    revising.value = false
  }
}

function fmtTime(s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(locale.value === 'th' ? 'th-TH' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<style scoped>
.mk-doc {
  display: flex; flex-direction: column; gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--surface-raised);
}
.mk-doc.approved { border-color: color-mix(in srgb, var(--success) 35%, var(--border)); }
.mk-doc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.mk-doc-heading { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.mk-doc-title { font-size: 15px; font-weight: 700; color: var(--text-0); }
.mk-doc-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.mk-doc-empty {
  padding: 20px; text-align: center; font-size: 12.5px; color: var(--text-3);
  border: 1px dashed var(--border-strong); border-radius: var(--radius);
}
.mk-hint { font-size: 11px; color: var(--text-3); margin-right: auto; }

.mk-revise {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border);
}
.mk-revise-input { resize: vertical; }
.mk-revise-foot, .mk-doc-edit-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.mk-history {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border);
}
.mk-history-empty { display: flex; justify-content: center; padding: 8px; font-size: 12px; color: var(--text-3); }
.mk-history-list { display: flex; flex-direction: column; gap: 4px; list-style: none; margin: 0; padding: 0; }
.mk-history-item { border-radius: var(--radius-sm); }
.mk-history-item.on { background: var(--surface-raised); box-shadow: inset 0 0 0 1px var(--border); }
.mk-history-row {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-1); font: 500 12px var(--font-body);
  text-align: left; cursor: pointer;
}
.mk-history-row:hover { background: var(--bg-hover); }
.mk-history-row:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-history-source { color: var(--text-2); }
.mk-history-time { margin-left: auto; font-size: 11px; color: var(--text-3); }
.mk-history-preview { padding: 4px 10px 10px; max-height: 360px; overflow-y: auto; }
.mk-history-foot { display: flex; justify-content: flex-end; margin-top: 8px; }

.mk-doc-edit { display: flex; flex-direction: column; gap: 8px; }
.mk-doc-textarea { min-height: 320px; resize: vertical; font-family: var(--font-mono); font-size: 12.5px; }

.mk-doc-body { position: relative; }
.mk-doc-revising {
  display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
  font-size: 12px; color: var(--accent-text);
}
.mk-doc-foot { margin-top: 12px; font-size: 11px; color: var(--text-3); }

/* Markdown 内容排版（v-html 内部元素需 :deep） */
.mk-md { font-size: 13.5px; line-height: 1.7; color: var(--text-1); overflow-wrap: anywhere; }
.mk-md :deep(h1), .mk-md :deep(h2), .mk-md :deep(h3), .mk-md :deep(h4), .mk-md :deep(h5), .mk-md :deep(h6) {
  margin: 18px 0 8px; color: var(--text-0); letter-spacing: -0.01em; line-height: 1.35;
}
.mk-md :deep(h1) { font-size: 18px; }
.mk-md :deep(h2) { font-size: 16px; }
.mk-md :deep(h3) { font-size: 14.5px; }
.mk-md :deep(h4), .mk-md :deep(h5), .mk-md :deep(h6) { font-size: 13.5px; }
.mk-md :deep(:is(h1, h2, h3, h4, h5, h6):first-child) { margin-top: 0; }
.mk-md :deep(p) { margin: 0 0 10px; line-height: 1.7; }
.mk-md :deep(ul), .mk-md :deep(ol) { margin: 0 0 10px; padding-left: 22px; }
.mk-md :deep(li) { margin: 3px 0; }
.mk-md :deep(strong) { color: var(--text-0); font-weight: 650; }
.mk-md :deep(code) {
  padding: 1px 5px; border-radius: 5px; background: var(--overlay-track);
  font-family: var(--font-mono); font-size: 12px;
}
.mk-md :deep(pre) {
  margin: 0 0 10px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border); overflow-x: auto;
}
.mk-md :deep(pre code) { padding: 0; background: transparent; }
.mk-md :deep(blockquote) {
  margin: 0 0 10px; padding: 6px 12px; border-left: 3px solid var(--accent);
  background: var(--accent-bg); border-radius: 0 var(--radius-sm) var(--radius-sm) 0; color: var(--text-1);
}
.mk-md :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 14px 0; }
.mk-md :deep(a) { color: var(--accent-text); }
.mk-md :deep(.md-table) { overflow-x: auto; margin: 0 0 12px; border: 1px solid var(--border); border-radius: var(--radius); }
.mk-md :deep(table) { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.mk-md :deep(th), .mk-md :deep(td) { padding: 7px 10px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); }
.mk-md :deep(th) { background: var(--surface-soft); color: var(--text-0); font-weight: 650; white-space: nowrap; }
.mk-md :deep(tr:last-child td) { border-bottom: none; }
</style>
