<template>
  <article class="mk-creative" :class="`st-${creative.status}`">
    <div class="mk-creative-tags">
      <span class="tag tag-accent">{{ formatLabel(creative.format) }}</span>
      <span class="tag">{{ platformLabel(creative.platform) }}</span>
      <span class="tag mono">{{ t('marketer.creatives.duration', { n: creative.durationSec || 0 }) }}</span>
      <span v-if="creative.referenceId && referenceTitle" class="tag tag-info" :title="referenceTitle">
        <Wand2 :size="10" :stroke-width="2" />
        {{ t('marketer.creatives.fromReference', { title: referenceTitle }) }}
      </span>
      <span class="tag mk-status" :class="statusTagClass">{{ t(`marketer.creativeStatus.${creative.status}`) }}</span>
    </div>

    <template v-if="!editing">
      <p class="mk-creative-label">{{ t('marketer.creatives.hook') }}</p>
      <h3 class="mk-creative-hook">{{ creative.hook }}</h3>

      <dl class="mk-creative-meta">
        <div>
          <dt>{{ t('marketer.creatives.angle') }}</dt>
          <dd>{{ creative.angle || t('marketer.creatives.none') }}</dd>
        </div>
        <div>
          <dt>{{ t('marketer.creatives.cta') }}</dt>
          <dd>{{ creative.cta || t('marketer.creatives.none') }}</dd>
        </div>
      </dl>

      <button type="button" class="mk-script-toggle" :aria-expanded="scriptOpen" @click="scriptOpen = !scriptOpen">
        <ChevronRight :size="13" :stroke-width="2" class="mk-script-chevron" :class="{ open: scriptOpen }" />
        {{ scriptOpen ? t('marketer.creatives.hideScript') : t('marketer.creatives.showScript') }}
      </button>
      <pre v-if="scriptOpen" class="mk-script">{{ creative.script }}</pre>
    </template>

    <!-- 编辑态：hook / angle / CTA / 时长 / 脚本 -->
    <form v-else class="mk-creative-edit" @submit.prevent="save">
      <label class="field">
        <span class="field-label">{{ t('marketer.creatives.hook') }}</span>
        <textarea v-model="draft.hook" class="textarea" rows="2" required />
      </label>
      <div class="mk-edit-grid">
        <label class="field">
          <span class="field-label">{{ t('marketer.creatives.angle') }}</span>
          <input v-model="draft.angle" class="input" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('marketer.creatives.cta') }}</span>
          <input v-model="draft.cta" class="input" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('marketer.creatives.durationLabel') }}</span>
          <input v-model.number="draft.durationSec" class="input" type="number" min="5" max="180" step="1" />
        </label>
      </div>
      <label class="field">
        <span class="field-label">{{ t('marketer.creatives.script') }}</span>
        <textarea v-model="draft.script" class="textarea mk-script-input" required />
        <span class="field-hint">{{ t('marketer.creatives.scriptHint') }}</span>
      </label>
      <div class="mk-creative-actions">
        <button type="button" class="btn btn-sm" :disabled="saving" @click="editing = false">{{ t('common.cancel') }}</button>
        <button type="submit" class="btn btn-sm btn-primary" :disabled="saving || !draft.hook.trim() || !draft.script.trim()">
          <Loader2 v-if="saving" :size="12" class="animate-spin" />
          {{ t('common.save') }}
        </button>
      </div>
    </form>

    <div v-if="!editing" class="mk-creative-actions">
      <template v-if="creative.status === 'in_production'">
        <NuxtLink v-if="episodeLink" :to="episodeLink" class="btn btn-sm">
          <ExternalLink :size="12" :stroke-width="2" />
          {{ t('marketer.production.openEpisode', { n: creative.episodeNumber }) }}
        </NuxtLink>
      </template>
      <template v-else>
        <button type="button" class="btn btn-sm" :title="t('marketer.creatives.toStudio')" :disabled="disabled || busy" @click="emit('toStudio', creative)">
          <ShoppingBag :size="12" :stroke-width="2" />
          {{ t('marketer.creatives.toStudio') }}
        </button>
                <button type="button" class="btn btn-sm btn-icon mk-del" :title="t('marketer.creatives.delete')" :aria-label="t('marketer.creatives.delete')" :disabled="disabled || busy" @click="emit('delete', creative)">
          <Trash2 :size="13" :stroke-width="1.9" />
        </button>
        <button type="button" class="btn btn-sm" :disabled="disabled || busy" @click="startEdit">
          <Pencil :size="12" :stroke-width="2" />
          {{ t('marketer.creatives.edit') }}
        </button>
        <button v-if="creative.status === 'approved'" type="button" class="btn btn-sm" :disabled="disabled || busy" @click="setStatus('draft')">
          <Undo2 :size="12" :stroke-width="2" />
          {{ t('marketer.creatives.unapprove') }}
        </button>
        <button v-else type="button" class="btn btn-sm btn-primary" :disabled="disabled || busy" @click="setStatus('approved')">
          <Check :size="12" :stroke-width="2.4" />
          {{ t('marketer.creatives.approve') }}
        </button>
      </template>
    </div>
  </article>
</template>

<script setup>
import { Check, ChevronRight, ExternalLink, Loader2, Pencil, ShoppingBag, Trash2, Undo2, Wand2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { marketerAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** MarketerCreativeCard — 单条广告创意：hook 突出展示，脚本可展开/编辑，审批与删除 */
const props = defineProps({
  campaignId: { type: Number, required: true },
  creative: { type: Object, required: true },
  dramaId: { type: Number, default: null },
  disabled: { type: Boolean, default: false },
  referenceTitle: { type: String, default: '' },
})
const emit = defineEmits(['updated', 'delete', 'toStudio'])

const { t, te } = useI18n()

const scriptOpen = ref(false)
const editing = ref(false)
const saving = ref(false)
const statusSaving = ref(false)
const busy = computed(() => saving.value || statusSaving.value)
const draft = reactive({ hook: '', angle: '', cta: '', durationSec: 15, script: '' })

const statusTagClass = computed(() => ({
  'tag-success': props.creative.status === 'approved',
  'tag-info': props.creative.status === 'in_production',
}))

const episodeLink = computed(() => (props.dramaId && props.creative.episodeNumber)
  ? `/drama/${props.dramaId}/episode/${props.creative.episodeNumber}`
  : '')

function formatLabel(f) { return te(`marketer.formats.${f}`) ? t(`marketer.formats.${f}`) : (f || '') }
function platformLabel(p) { return te(`marketer.platforms.${p}`) ? t(`marketer.platforms.${p}`) : (p || '') }

function startEdit() {
  Object.assign(draft, {
    hook: props.creative.hook || '',
    angle: props.creative.angle || '',
    cta: props.creative.cta || '',
    durationSec: props.creative.durationSec || 15,
    script: props.creative.script || '',
  })
  editing.value = true
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const duration = Math.round(Number(draft.durationSec))
    const updated = await marketerAPI.updateCreative(props.campaignId, props.creative.id, {
      hook: draft.hook.trim(),
      angle: draft.angle.trim(),
      cta: draft.cta.trim() || null,
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : props.creative.durationSec,
      script: draft.script,
    })
    editing.value = false
    toast.success(t('marketer.creatives.saved'))
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

async function setStatus(status) {
  if (statusSaving.value) return
  statusSaving.value = true
  try {
    const updated = await marketerAPI.updateCreative(props.campaignId, props.creative.id, { status })
    emit('updated', updated)
  } catch (e) {
    toastError(e)
  } finally {
    statusSaving.value = false
  }
}
</script>

<style scoped>
.mk-creative {
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-raised);
  animation: fadeUp 0.28s var(--ease-out) both;
  transition: border-color 0.16s var(--ease-out);
}
.mk-creative:hover { border-color: var(--border-strong); }
.mk-creative.st-approved { border-color: color-mix(in srgb, var(--success) 40%, var(--border)); }
.mk-creative-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.mk-status { margin-left: auto; }
.mk-creative-label {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--accent-text); line-height: 1.2;
}
.mk-creative-hook {
  font-family: var(--font-display);
  font-size: 18px; font-weight: 600; line-height: 1.4; letter-spacing: 0;
  color: var(--text-0); overflow-wrap: anywhere;
}
.mk-creative-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.mk-creative-meta dt { font-size: 11px; font-weight: 600; color: var(--text-3); }
.mk-creative-meta dd { font-size: 12.5px; color: var(--text-1); line-height: 1.5; overflow-wrap: anywhere; }
.mk-script-toggle {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px 2px 2px; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-2); font: 600 12px var(--font-body); cursor: pointer;
}
.mk-script-toggle:hover { color: var(--text-0); background: var(--bg-hover); }
.mk-script-toggle:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-script-chevron { transition: transform 0.18s var(--ease-out); }
.mk-script-chevron.open { transform: rotate(90deg); }
.mk-script {
  max-height: 360px; overflow: auto;
  margin: 0; padding: 12px; border-radius: var(--radius);
  background: var(--surface-soft); border: 1px solid var(--border);
  font: 12px/1.65 var(--font-mono); color: var(--text-1);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.mk-creative-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.mk-del { margin-right: auto; width: var(--button-height-sm); min-width: var(--button-height-sm); height: var(--button-height-sm); min-height: var(--button-height-sm); }
.mk-del:hover:not(:disabled) { background: var(--action-danger-bg); color: var(--action-danger); }

.mk-creative-edit { display: flex; flex-direction: column; gap: 10px; }
.mk-edit-grid { display: grid; grid-template-columns: 1fr 1fr 120px; gap: 8px; }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.mk-script-input { min-height: 240px; resize: vertical; font-family: var(--font-mono); font-size: 12px; }
.mk-creative-edit .textarea { resize: vertical; }

@media (max-width: 640px) {
  .mk-edit-grid { grid-template-columns: 1fr; }
  .mk-creative-meta { grid-template-columns: 1fr; }
}
</style>
