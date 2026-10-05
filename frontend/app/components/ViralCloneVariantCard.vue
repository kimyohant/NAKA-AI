<template>
  <article class="vc-card">
    <div class="vc-head">
      <span class="vc-label truncate">{{ variant.label }}</span>
      <span class="tag" :class="statusClass">
        <Loader2 v-if="busy" :size="10" class="animate-spin" />
        {{ t(`viralClone.status.${variant.status}`) }}
      </span>
    </div>

    <div class="vc-meta">
      <span v-if="queuePosition" class="tag tag-info vc-queue">
        <Clock :size="10" :stroke-width="2" />
        {{ t('viralClone.variants.queuePosition', { n: queuePosition }) }}
      </span>
      <span v-for="chip in metaChips" :key="chip" class="tag">{{ chip }}</span>
    </div>

    <!-- พรีวิวเมื่อ render เสร็จ -->
    <video v-if="variant.status === 'completed' && variant.outputPath" class="vc-video" :src="variant.outputPath" controls preload="metadata" />

    <p v-if="errorText" class="vc-error">{{ errorText }}</p>

    <div class="vc-foot">
      <span v-if="variant.durationSec" class="vc-dur">{{ t('viralClone.variants.duration', { n: variant.durationSec }) }}</span>
      <div class="vc-actions">
        <a v-if="variant.outputPath" class="btn btn-ghost btn-sm" :href="variant.outputPath" download>
          <Download :size="12" :stroke-width="2" />
          {{ t('viralClone.variants.download') }}
        </a>
        <button v-if="!busy" class="btn btn-sm" type="button" @click="emit('render', variant.id)">
          <Clapperboard :size="12" :stroke-width="2" />
          {{ t('viralClone.variants.render') }}
        </button>
        <button v-if="!busy" class="vc-del" type="button" :title="t('viralClone.variants.delete')" @click="emit('del', variant.id)">
          <Trash2 :size="12" :stroke-width="2" />
        </button>
      </div>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, Clapperboard, Download, Loader2, Trash2 } from 'lucide-vue-next'
import { cloneErrorCodeOf, isCloneVariantBusy } from '~/utils/viralCloneFlow'

const props = defineProps({
  variant: { type: Object, required: true },
  products: { type: Array, default: () => [] },
  avatars: { type: Array, default: () => [] },
})
const emit = defineEmits(['render', 'del'])
const { t, te } = useI18n()

const busy = computed(() => isCloneVariantBusy(props.variant.status))
const queuePosition = computed(() => props.variant.queuePosition ?? null)
const statusClass = computed(() => {
  if (props.variant.status === 'completed') return 'tag-success'
  if (props.variant.status === 'failed') return 'tag-error'
  if (busy.value) return 'tag-info'
  return ''
})

// overrides → ชิปสรุปตัวแปร (hook/สินค้า/avatar/ภาษา)
const metaChips = computed(() => {
  const o = props.variant.overrides || {}
  const chips = []
  chips.push(o.hookIndex != null ? `Hook #${o.hookIndex + 1}` : t('viralClone.variants.hookOriginal'))
  if (o.productId != null) {
    const p = props.products.find((x) => x.id === o.productId)
    if (p?.title) chips.push(p.title)
  }
  if (o.avatarId != null) {
    const a = props.avatars.find((x) => x.id === o.avatarId)
    if (a?.name) chips.push(a.name)
  }
  if (o.language) chips.push(t(`viralClone.languages.${o.language}`))
  return chips.filter(Boolean)
})

// error: แปลรหัสก่อนเสมอ (E_CODE: message) — ไม่มีรหัสใน locale ค่อยโชว์ข้อความดิบ
const errorText = computed(() => {
  const raw = props.variant.errorMsg || ''
  if (!raw) return ''
  const code = props.variant.errorCode || cloneErrorCodeOf(raw)
  if (code && te(`errors.codes.${code}`)) return t(`errors.codes.${code}`)
  return raw
})
</script>

<style scoped>
.vc-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
}
.vc-head { display: flex; align-items: center; gap: 8px; }
.vc-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--text-0); }
.vc-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.vc-meta .tag { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.vc-queue { font-variant-numeric: tabular-nums; }
.vc-video { width: 100%; aspect-ratio: 9 / 16; max-height: 300px; border-radius: 10px; background: var(--bg-2); object-fit: contain; }
.vc-error { margin: 0; font-size: 11.5px; color: var(--danger, #e5484d); }
.vc-foot { display: flex; align-items: center; gap: 8px; margin-top: auto; }
.vc-dur { font-size: 11.5px; color: var(--text-3); }
.vc-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.vc-del {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  border: none; border-radius: 8px; background: transparent; color: var(--text-3); cursor: pointer;
}
.vc-del:hover { background: var(--bg-hover); color: var(--text-0); }
</style>
