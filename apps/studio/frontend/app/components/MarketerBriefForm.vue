<template>
  <div class="mk-form">
    <!-- 产品 -->
    <section class="mk-form-section">
      <h3 class="mk-form-section-title">{{ t('marketer.form.sectionProduct') }}</h3>

      <div class="field" :class="{ 'is-highlight': highlight === 'url' }">
        <span class="field-label">{{ t('marketer.form.productUrl') }}</span>
        <div class="mk-url-row">
          <input
            ref="urlInput"
            v-model.trim="form.productUrl"
            class="input"
            type="url"
            inputmode="url"
            :placeholder="t('marketer.form.productUrlPlaceholder')"
            @keydown.enter.prevent="ingest"
          />
          <button type="button" class="btn" :disabled="ingesting || !form.productUrl" @click="ingest">
            <Loader2 v-if="ingesting" :size="13" class="animate-spin" />
            <Link2 v-else :size="13" :stroke-width="2" />
            {{ ingesting ? t('marketer.form.ingesting') : t('marketer.form.ingest') }}
          </button>
        </div>
        <span v-if="ingestNote" class="field-hint" :class="{ 'is-warn': ingestNoteWarn }">{{ ingestNote }}</span>
        <span v-else class="field-hint">{{ t('marketer.form.productUrlHint') }}</span>
      </div>

      <div class="mk-grid-2">
        <label class="field">
          <span class="field-label">{{ t('marketer.form.productName') }} <span class="required">*</span></span>
          <input v-model="form.productName" class="input" :placeholder="t('marketer.form.productNamePlaceholder')" />
        </label>
        <label class="field">
          <span class="field-label">{{ t('marketer.form.title') }}</span>
          <input v-model="form.title" class="input" :placeholder="t('marketer.form.titlePlaceholder')" />
        </label>
      </div>

      <label class="field">
        <span class="field-label">{{ t('marketer.form.productDescription') }}</span>
        <textarea v-model="form.productDescription" class="textarea mk-textarea" rows="4" :placeholder="t('marketer.form.productDescriptionPlaceholder')" />
      </label>

      <div class="field">
        <span class="field-label">{{ t('marketer.form.images') }}</span>
        <div class="mk-images">
          <div v-for="(img, i) in form.productImages" :key="img + i" class="mk-image">
            <img :src="img" :alt="t('marketer.form.imageAlt', { n: i + 1 })" loading="lazy" />
            <button type="button" class="mk-image-remove" :title="t('marketer.form.removeImage')" :aria-label="t('marketer.form.removeImage')" @click="removeImage(i)">
              <X :size="12" :stroke-width="2.2" />
            </button>
          </div>
          <label class="mk-image-add" :class="{ busy: uploading }">
            <Loader2 v-if="uploading" :size="16" class="animate-spin" />
            <ImagePlus v-else :size="16" :stroke-width="1.8" />
            <span>{{ uploading ? t('marketer.form.uploading') : t('marketer.form.upload') }}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple hidden :disabled="uploading" @change="onFiles" />
          </label>
        </div>
        <span class="field-hint">{{ t('marketer.form.imagesHint') }}</span>
      </div>

      <label class="field">
        <span class="field-label">{{ t('marketer.form.brandNotes') }}</span>
        <textarea v-model="form.brandNotes" class="textarea mk-textarea" rows="3" :placeholder="t('marketer.form.brandNotesPlaceholder')" />
      </label>
    </section>

    <!-- 投放目标 -->
    <section class="mk-form-section">
      <h3 class="mk-form-section-title">{{ t('marketer.form.sectionCampaign') }}</h3>

      <div class="field" :class="{ 'is-highlight': highlight === 'multi' }">
        <span class="field-label">{{ t('marketer.form.platforms') }}</span>
        <div class="mk-chips" role="group" :aria-label="t('marketer.form.platforms')">
          <button
            v-for="p in PLATFORMS"
            :key="p"
            type="button"
            class="mk-chip"
            :class="{ on: form.platforms.includes(p) }"
            :aria-pressed="form.platforms.includes(p)"
            @click="togglePlatform(p)"
          >{{ t(`marketer.platforms.${p}`) }}</button>
        </div>
      </div>

      <div class="mk-grid-2">
        <label class="field">
          <span class="field-label">{{ t('marketer.form.audience') }}</span>
          <input v-model="form.audience" class="input" :placeholder="t('marketer.form.audiencePlaceholder')" />
        </label>
        <div class="field">
          <span class="field-label">{{ t('marketer.form.market') }}</span>
          <BaseSelect v-model="form.market" :options="marketOptions" :searchable="false" />
        </div>
      </div>

      <label class="field">
        <span class="field-label">{{ t('marketer.form.goal') }}</span>
        <textarea v-model="form.goal" class="textarea mk-textarea" rows="2" :placeholder="t('marketer.form.goalPlaceholder')" />
      </label>

      <div class="mk-grid-2">
        <div class="field">
          <span class="field-label">{{ t('marketer.form.style') }}</span>
          <BaseSelect v-model="form.style" :options="styleOptions" :placeholder="t('marketer.form.stylePlaceholder')" searchable />
        </div>
        <div class="field">
          <span class="field-label">{{ t('marketer.form.aspectRatio') }}</span>
          <div class="seg" role="radiogroup" :aria-label="t('marketer.form.aspectRatio')">
            <button
              v-for="r in CAMPAIGN_RATIOS"
              :key="r"
              type="button"
              role="radio"
              class="seg-item"
              :class="{ on: form.aspectRatio === r }"
              :aria-checked="form.aspectRatio === r"
              :disabled="ratioLocked"
              @click="form.aspectRatio = r"
            >{{ t(`marketer.ratios.${RATIO_KEY[r]}`) }}</button>
          </div>
          <span class="field-hint">{{ ratioLocked ? t('marketer.form.aspectRatioLocked') : t('marketer.form.aspectRatioHint') }}</span>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { Link2, Loader2, ImagePlus, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import BaseSelect from '~/components/BaseSelect.vue'
import { marketerAPI, uploadAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { PLATFORMS, MARKETS, CAMPAIGN_RATIOS } from '~/utils/marketerFlow'

/**
 * MarketerBriefForm — AI Marketer「Describe the goal」表单（新建弹窗与 workspace Brief 步骤共用）
 * v-model 为可变 form 对象（字段同 Campaign，camelCase）；URL 抓取与图片上传在组件内完成。
 */
const form = defineModel({ type: Object, required: true })
const props = defineProps({
  stylePresets: { type: Array, default: () => [] },
  highlight: { type: String, default: '' },  // 'url' | 'multi' — 快速开始入口高亮对应字段
  ratioLocked: { type: Boolean, default: false }, // 已有 drama 后画面比例固定
})

const { t, te } = useI18n()

const RATIO_KEY = { '9:16': 'portrait', '1:1': 'square', '16:9': 'landscape' }

const marketOptions = computed(() => MARKETS.map(m => ({ label: t(`marketer.markets.${m}`), value: m })))
const styleOptions = computed(() => props.stylePresets.map(p => ({
  label: te(`index.styleNames.${p.value}`) ? t(`index.styleNames.${p.value}`) : (p.name || p.value),
  value: p.value,
})))

function togglePlatform(p) {
  const list = form.value.platforms
  const i = list.indexOf(p)
  if (i >= 0) list.splice(i, 1)
  else list.push(p)
}

// ===== URL → 产品信息 =====
const urlInput = ref(null)
const ingesting = ref(false)
const ingestNote = ref('')
const ingestNoteWarn = ref(false)

async function ingest() {
  const url = form.value.productUrl
  if (!url || ingesting.value) return
  if (!/^https?:\/\/\S+$/i.test(url)) {
    ingestNote.value = t('marketer.form.urlInvalid')
    ingestNoteWarn.value = true
    return
  }
  ingesting.value = true
  ingestNote.value = ''
  try {
    const res = await marketerAPI.ingestUrl(url)
    if (res.productName && !form.value.productName?.trim()) form.value.productName = res.productName
    const extra = [
      res.price ? t('marketer.form.priceLine', { price: res.price }) : '',
      res.brand ? t('marketer.form.brandLine', { brand: res.brand }) : '',
    ].filter(Boolean)
    if (!form.value.productDescription?.trim()) {
      form.value.productDescription = [res.productDescription || '', ...extra].filter(Boolean).join('\n')
    }
    for (const img of res.images || []) {
      if (img && !form.value.productImages.includes(img)) form.value.productImages.push(img)
    }
    ingestNote.value = t('marketer.form.ingested')
    ingestNoteWarn.value = false
  } catch (e) {
    // 抓取失败不阻塞：提示后由用户手动填写
    ingestNote.value = t('marketer.form.ingestFailed')
    ingestNoteWarn.value = true
    toastError(e)
  } finally {
    ingesting.value = false
  }
}

// ===== 产品图上传（复用 uploadAPI） =====
const uploading = ref(false)
const MAX_IMAGE = 10 * 1024 * 1024

async function onFiles(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (!files.length) return
  uploading.value = true
  try {
    for (const file of files) {
      if (file.size > MAX_IMAGE) { toast.error(t('marketer.form.imageTooBig', { name: file.name })); continue }
      try {
        const res = await uploadAPI.image(file)
        const url = res.url || `/${String(res.path || '').replace(/^\/+/, '')}`
        if (!form.value.productImages.includes(url)) form.value.productImages.push(url)
      } catch (err) {
        toastError(err)
      }
    }
  } finally {
    uploading.value = false
  }
}

function removeImage(i) {
  form.value.productImages.splice(i, 1)
}

function focusUrl() {
  urlInput.value?.focus()
}

defineExpose({ focusUrl })
</script>

<style scoped>
.mk-form { display: flex; flex-direction: column; gap: 22px; }
.mk-form-section { display: flex; flex-direction: column; gap: 14px; }
.mk-form-section-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-3);
}
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; border-radius: var(--radius); transition: box-shadow 0.2s var(--ease-out); }
.field.is-highlight { box-shadow: 0 0 0 3px var(--button-focus); padding: 8px; margin: -8px; }
.field-label { font-size: 12px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.field-hint.is-warn { color: var(--warn-text); }
.required { color: var(--error); }
.mk-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.mk-url-row { display: flex; gap: 8px; }
.mk-url-row .input { flex: 1; min-width: 0; }
.mk-textarea { resize: vertical; min-height: 64px; }

.mk-images { display: flex; flex-wrap: wrap; gap: 8px; }
.mk-image {
  position: relative; width: 76px; height: 76px; border-radius: var(--radius);
  overflow: hidden; border: 1px solid var(--border); background: var(--bg-2);
}
.mk-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mk-image-remove {
  position: absolute; top: 4px; right: 4px;
  width: 20px; height: 20px; border: none; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.6); color: #fff; cursor: pointer;
}
.mk-image-remove:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.mk-image-add {
  width: 76px; height: 76px; border-radius: var(--radius);
  border: 1px dashed var(--border-strong); color: var(--text-2);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  font-size: 10.5px; font-weight: 600; text-align: center; cursor: pointer;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.mk-image-add:hover { background: var(--bg-hover); color: var(--text-0); }
.mk-image-add:focus-within { box-shadow: 0 0 0 3px var(--button-focus); }
.mk-image-add.busy { cursor: progress; }

.mk-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mk-chip {
  border: 1px solid var(--border); border-radius: var(--radius-pill); padding: 5px 12px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 500 12px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.mk-chip:hover { color: var(--text-0); background: var(--bg-hover); }
.mk-chip.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent-text); }
.mk-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.seg { align-self: flex-start; }
.seg-item:disabled { cursor: not-allowed; opacity: 0.6; }

@media (max-width: 640px) {
  .mk-grid-2 { grid-template-columns: 1fr; }
  .mk-url-row { flex-direction: column; }
}
</style>
