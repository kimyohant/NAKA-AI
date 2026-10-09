<template>
  <div class="overlay" @click.self="close">
    <div class="dialog create-dialog qc-dialog" role="dialog" aria-modal="true" :aria-label="t(`marketer.quick.ways.${mode}.title`)">
      <div class="dialog-head">
        <div class="qc-icon" :class="`art-${mode}`"><component :is="ICON[mode]" :size="18" :stroke-width="1.8" /></div>
        <div class="dialog-head-copy">
          <h2 class="dialog-title">{{ t(`marketer.quick.ways.${mode}.title`) }}</h2>
          <p class="dialog-desc">{{ t(`marketer.quick.campaign.${mode}Desc`) }}</p>
        </div>
      </div>

      <form class="create-form" @submit.prevent="submit">
        <div class="dialog-body">
          <!-- ตัวอย่างผลลัพธ์ (คลิปที่ NAKA-AI สร้างเอง) — แสดงเมื่อมีไฟล์ -->
          <div v-if="examples.length" class="qc-examples">
            <span class="field-label">{{ t('marketer.quick.campaign.examples') }}</span>
            <div class="qc-example-row">
              <MarketerMedia v-for="id in examples" :key="id" class="qc-example" :id="id" play="visible" />
            </div>
          </div>
          <!-- 02 URL → video: ดึงข้อมูลหน้าสินค้า (ingest-url เดิม) -->
          <template v-if="mode === 'url'">
            <div class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.url') }} <span class="mk-required">*</span></span>
              <div class="qc-url-row">
                <input v-model="form.productUrl" class="input" type="url" inputmode="url" maxlength="2000" placeholder="https://shopee.co.th/… · https://www.lazada.co.th/…" />
                <button type="button" class="btn" :disabled="ingesting || !/^https?:\/\//i.test(form.productUrl)" @click="ingest">
                  <Loader2 v-if="ingesting" :size="13" class="animate-spin" />
                  {{ ingesting ? t('marketer.quick.campaign.fetching') : t('marketer.quick.campaign.fetch') }}
                </button>
              </div>
              <span v-if="ingestNote" class="field-hint">{{ ingestNote }}</span>
            </div>
            <div v-if="images.length" class="qc-images">
              <label v-for="(src, i) in images" :key="src" class="qc-image">
                <input v-model="pickedImages" type="checkbox" :value="src" :aria-label="t('marketer.quick.campaign.useImage', { n: i + 1 })" />
                <img :src="src" alt="" loading="lazy" referrerpolicy="no-referrer" />
              </label>
            </div>
          </template>

          <label class="qc-field">
            <span class="field-label">{{ t('marketer.form.productName') }} <span v-if="mode !== 'url'" class="mk-required">*</span></span>
            <input v-model="form.productName" class="input" maxlength="160" :placeholder="t('marketer.quick.campaign.productPlaceholder')" />
          </label>

          <!-- 03 Recreate: บทพูด/คำบรรยายฉากของคลิปต้นแบบ → AdReference (ไม่ดาวน์โหลดคลิปจากแพลตฟอร์ม) -->
          <template v-if="mode === 'recreate'">
            <div class="qc-modes" role="radiogroup" :aria-label="t('marketer.quick.campaign.modeLabel')">
              <button v-for="m in ['structure', 'replace']" :key="m" type="button" role="radio" :aria-checked="recreateMode === m" class="qc-mode" :class="{ active: recreateMode === m }" @click="recreateMode = m as 'structure' | 'replace'">
                <strong>{{ t(`marketer.quick.campaign.mode.${m}`) }}</strong>
                <small>{{ t(`marketer.quick.campaign.mode.${m}Desc`) }}</small>
              </button>
            </div>
            <label class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.transcript') }} <span class="mk-required">*</span></span>
              <textarea v-model="form.transcript" class="textarea" rows="5" maxlength="20000" :placeholder="t('marketer.quick.campaign.transcriptPlaceholder')"></textarea>
              <span class="field-hint">{{ t('marketer.quick.campaign.transcriptHint') }}</span>
            </label>
            <label class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.sourceUrl') }}</span>
              <input v-model="form.sourceUrl" class="input" type="url" maxlength="2000" placeholder="https://www.tiktok.com/@…/video/…" />
            </label>
            <label class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.newContent') }}</span>
              <input v-model="form.newContent" class="input" maxlength="500" :placeholder="t('marketer.quick.campaign.newContentPlaceholder')" />
            </label>
          </template>

          <label class="qc-field">
            <span class="field-label">{{ mode === 'bulk' ? t('marketer.quick.campaign.brief') : t('marketer.quick.campaign.details') }} <span v-if="mode === 'bulk'" class="mk-required">*</span></span>
            <textarea v-model="form.productDescription" class="textarea" rows="3" maxlength="4000" :placeholder="t('marketer.quick.campaign.briefPlaceholder')"></textarea>
          </label>

          <div class="qc-row">
            <label class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.sellingPoint') }}</span>
              <input v-model="form.goal" class="input" maxlength="300" :placeholder="t('marketer.quick.campaign.sellingPointPlaceholder')" />
            </label>
            <label class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.audience') }}</span>
              <input v-model="form.audience" class="input" maxlength="300" :placeholder="t('marketer.quick.campaign.audiencePlaceholder')" />
            </label>
          </div>

          <div class="qc-field">
            <span class="field-label">{{ t('marketer.quick.campaign.platforms') }}</span>
            <div class="qc-chips">
              <button v-for="p in PLATFORMS" :key="p" type="button" class="qc-chip" :class="{ active: form.platforms.includes(p) }" :aria-pressed="form.platforms.includes(p)" @click="togglePlatform(p)">
                {{ t(`marketer.platforms.${p}`) }}
              </button>
            </div>
          </div>

          <div class="qc-row">
            <div class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.aspect') }}</span>
              <div class="qc-chips">
                <button v-for="a in ['9:16', '1:1', '16:9']" :key="a" type="button" class="qc-chip" :class="{ active: form.aspectRatio === a }" @click="form.aspectRatio = a">{{ a }}</button>
              </div>
            </div>
            <div class="qc-field">
              <span class="field-label">{{ t('marketer.quick.campaign.count') }}</span>
              <div class="qc-stepper">
                <button type="button" :disabled="count <= 1" :aria-label="t('marketer.quick.campaign.less')" @click="count--">−</button>
                <output>{{ count }}</output>
                <button type="button" :disabled="count >= maxCount" :aria-label="t('marketer.quick.campaign.more')" @click="count++">+</button>
              </div>
            </div>
          </div>
          <p class="qc-note">{{ t('marketer.quick.campaign.autopilotNote') }}</p>
        </div>
        <div class="dialog-foot">
          <button type="button" class="btn" :disabled="submitting" @click="close">{{ t('common.cancel') }}</button>
          <button type="submit" class="btn btn-primary" :disabled="submitting || !canSubmit">
            <Loader2 v-if="submitting" :size="13" class="animate-spin" />
            {{ submitting ? t('marketer.quick.campaign.submitting') : t('marketer.quick.campaign.submit') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, markRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { Layers, Link2, Loader2, Repeat2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { marketerAPI, type Platform } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { mkGroup } from '../utils/marketerMedia'

/**
 * การ์ด 02–04 ของ quick start → สร้างแคมเปญ + autopilot (research → strategy → creatives) แล้วพาไปหน้าแคมเปญ
 * ผลิตวิดีโอจริงต่อจากหน้าแคมเปญด้วยปุ่ม produce เดิม (pipeline ภาพ → วิดีโอ → merge)
 */
const props = defineProps<{ mode: 'url' | 'recreate' | 'bulk' }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

const ICON = { url: markRaw(Link2), recreate: markRaw(Repeat2), bulk: markRaw(Layers) }
const examples = mkGroup('example').filter(id => id.startsWith(`example-${props.mode}-`))
const PLATFORMS: Platform[] = ['tiktok', 'reels', 'youtube_shorts', 'facebook', 'shopee', 'lazada'] as Platform[]

const form = ref({
  productUrl: '', productName: '', productDescription: '', goal: '', audience: '',
  platforms: ['tiktok'] as Platform[], aspectRatio: '9:16', transcript: '', sourceUrl: '', newContent: '',
})
const recreateMode = ref<'structure' | 'replace'>('structure')
const maxCount = computed(() => (props.mode === 'bulk' ? 10 : 5))
const count = ref(props.mode === 'bulk' ? 4 : 3)
const images = ref<string[]>([])
const pickedImages = ref<string[]>([])
const ingesting = ref(false)
const ingestNote = ref('')
const submitting = ref(false)

const canSubmit = computed(() => {
  const f = form.value
  if (props.mode === 'url') return !!(f.productUrl.trim() || f.productName.trim())
  if (props.mode === 'recreate') return !!(f.productName.trim() && f.transcript.trim())
  return !!(f.productName.trim() && f.productDescription.trim())
})

function togglePlatform(p: Platform) {
  const list = form.value.platforms
  form.value.platforms = list.includes(p) ? (list.length > 1 ? list.filter(x => x !== p) : list) : [...list, p]
}
function close() { if (!submitting.value) emit('close') }

async function ingest() {
  ingesting.value = true
  ingestNote.value = ''
  try {
    const product = await marketerAPI.ingestUrl(form.value.productUrl.trim())
    form.value.productName ||= product.productName || ''
    form.value.productDescription ||= [product.productDescription, product.price ? `ราคา ${product.price}` : ''].filter(Boolean).join('\n')
    images.value = (product.images || []).slice(0, 6)
    pickedImages.value = [...images.value]
    ingestNote.value = t('marketer.quick.campaign.fetched')
  } catch (e) {
    ingestNote.value = t('marketer.quick.campaign.fetchFailed')
    toastError(e)
  } finally {
    ingesting.value = false
  }
}

async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  const f = form.value
  try {
    const campaign = await marketerAPI.create({
      title: f.productName.trim() || undefined,
      productUrl: f.productUrl.trim() || undefined,
      productName: f.productName.trim() || undefined,
      productDescription: f.productDescription.trim() || undefined,
      productImages: props.mode === 'url' ? pickedImages.value : undefined,
      goal: f.goal.trim() || undefined,
      audience: f.audience.trim() || undefined,
      platforms: f.platforms,
      aspectRatio: f.aspectRatio as any,
      market: 'TH',
    } as any)
    let referenceId: number | undefined
    if (props.mode === 'recreate') {
      const modeNote = t(`marketer.quick.campaign.mode.${recreateMode.value}Note`)
      const reference = await marketerAPI.addReference(campaign.id, {
        transcript: f.transcript.trim(),
        sourceUrl: f.sourceUrl.trim() || undefined,
        title: f.sourceUrl.trim() ? undefined : t('marketer.quick.campaign.referenceTitle'),
        notes: [modeNote, f.newContent.trim()].filter(Boolean).join('\n'),
      })
      referenceId = reference.id
    }
    // แคมเปญถูกสร้างแล้ว — autopilot ล้ม (เช่น ยังไม่ตั้งโมเดลข้อความ) ก็ยังพาไปหน้าแคมเปญให้ทำต่อเองได้
    try {
      await marketerAPI.autopilot(campaign.id, { count: count.value, referenceId, platforms: f.platforms })
      toast.success(t('marketer.quick.campaign.started'))
    } catch (e) {
      toastError(e)
    }
    emit('close')
    navigateTo(`/marketer/${campaign.id}`)
  } catch (e) {
    toastError(e)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.qc-dialog { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; }
.qc-icon { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 10px; color: #fff; }
.art-url { background: linear-gradient(135deg, #3a1f55, #a855f7); }
.art-recreate { background: linear-gradient(135deg, #55301f, #f97316); }
.art-bulk { background: linear-gradient(135deg, #1f5540, #14b3a0); }
.qc-field { display: grid; gap: 6px; margin-bottom: 12px; }
.qc-examples { display: grid; gap: 6px; margin-bottom: 14px; }
.qc-example-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.qc-example { aspect-ratio: 9 / 16; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-soft); }
.qc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.qc-url-row { display: flex; gap: 8px; }
.qc-url-row .input { flex: 1; }
.qc-images { display: flex; gap: 8px; flex-wrap: wrap; margin: -4px 0 12px; }
.qc-image { position: relative; cursor: pointer; }
.qc-image img { width: 72px; height: 72px; object-fit: cover; border-radius: 10px; border: 2px solid transparent; background: var(--surface-soft); }
.qc-image input { position: absolute; top: 5px; left: 5px; accent-color: var(--accent); }
.qc-image input:checked + img { border-color: var(--accent); }
.qc-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.qc-mode { display: grid; gap: 2px; padding: 10px 12px; text-align: left; border: 1px solid var(--border); border-radius: 12px; background: transparent; color: var(--text-1); cursor: pointer; }
.qc-mode strong { font-size: 13px; color: var(--text-0); }
.qc-mode small { font-size: 11px; color: var(--text-2); }
.qc-mode.active { border-color: var(--accent); background: var(--accent-bg); }
.qc-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.qc-chip { padding: 5px 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-1); font-size: 12px; cursor: pointer; }
.qc-chip.active { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); font-weight: 600; }
.qc-stepper { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; width: max-content; }
.qc-stepper button { width: 36px; height: 34px; border: 0; background: transparent; color: var(--text-0); font-size: 16px; cursor: pointer; }
.qc-stepper button:disabled { opacity: .4; cursor: not-allowed; }
.qc-stepper output { min-width: 36px; text-align: center; font-weight: 700; color: var(--text-0); }
.qc-note { margin: 4px 0 0; font-size: 11px; color: var(--text-2); }
@media (max-width: 640px) { .qc-row, .qc-modes { grid-template-columns: 1fr; } }
</style>
