<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog ps-ic-dialog" role="dialog" aria-modal="true" :aria-label="t('productStudio.influencers.contentTitle')">
      <div class="dialog-head">
        <div class="ps-ic-icon">
          <img v-if="influencer.imageUrl" :src="influencer.imageUrl" alt="" />
          <Sparkles v-else :size="18" :stroke-width="1.8" />
        </div>
        <div class="dialog-head-copy">
          <h2 class="dialog-title">{{ t('productStudio.influencers.contentTitle') }} · {{ influencer.name }}</h2>
          <p class="dialog-desc">{{ t('productStudio.influencers.contentDesc') }}</p>
        </div>
        <button type="button" class="ps-ic-close" :aria-label="t('common.close')" @click="emit('close')">
          <X :size="16" :stroke-width="2" />
        </button>
      </div>

      <div class="ps-ic-body">
        <!-- ===== สินค้า + ฉาก ===== -->
        <section class="ps-ic-section">
          <h3 class="ps-ic-sec-title">{{ t('productStudio.influencers.generateImages') }}</h3>
          <div class="ps-ic-grid">
            <label class="field">
              <span class="field-label">{{ t('productStudio.influencers.productName') }} <span class="ps-required">*</span></span>
              <input v-model="productName" class="input" :placeholder="t('productStudio.influencers.productNamePlaceholder')" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('productStudio.influencers.aspect') }}</span>
              <select v-model="aspectRatio" class="input">
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
          </div>
          <div class="field">
            <span class="field-label">{{ t('productStudio.influencers.productImage') }} <span class="ps-required">*</span></span>
            <div class="ps-ic-upload-row">
              <input ref="productFileEl" type="file" accept="image/*" hidden @change="uploadProduct" />
              <button type="button" class="btn btn-sm" :disabled="uploading" @click="productFileEl?.click()">
                <Loader2 v-if="uploading" :size="12" class="animate-spin" />
                <ImagePlus v-else :size="12" :stroke-width="2" />
                {{ productImage ? t('productStudio.influencers.changeImage') : t('productStudio.influencers.uploadProduct') }}
              </button>
              <img v-if="productImage" :src="productImage" alt="" class="ps-ic-thumb" />
              <span v-else class="field-hint">{{ t('productStudio.influencers.needProductImage') }}</span>
            </div>
          </div>
          <div class="field">
            <span class="field-label">{{ t('productStudio.influencers.scenes') }}</span>
            <div class="ps-ic-chips" role="group" :aria-label="t('productStudio.influencers.scenes')">
              <button
                v-for="s in SCENES"
                :key="s"
                type="button"
                :aria-pressed="scenes.includes(s)"
                :class="['ps-ic-chip', { on: scenes.includes(s) }]"
                @click="toggleScene(s)"
              >
                {{ t(`productStudio.influencers.sceneNames.${s}`) }}
              </button>
            </div>
            <span class="field-hint">{{ t('productStudio.influencers.scenesHint') }}</span>
          </div>
          <label class="field">
            <span class="field-label">{{ t('productStudio.influencers.instruction') }}</span>
            <textarea v-model="instruction" class="textarea" rows="2" :placeholder="t('productStudio.influencers.instructionPlaceholder')" />
          </label>
          <div class="ps-ic-gen-row">
            <span v-if="!influencer.imageUrl" class="ps-foot-hint">{{ t('productStudio.influencers.needPortrait') }}</span>
            <button type="button" class="btn btn-primary" :disabled="!canGenerateImages || generatingImages" @click="generateImages">
              <Loader2 v-if="generatingImages" :size="13" class="animate-spin" />
              <Sparkles v-else :size="13" :stroke-width="2" />
              {{ generatingImages ? t('productStudio.influencers.generatingImages') : t('productStudio.influencers.generateImages') }}
            </button>
          </div>
        </section>

        <!-- ===== สคริปต์รีวิว ===== -->
        <section class="ps-ic-section">
          <h3 class="ps-ic-sec-title">{{ t('productStudio.influencers.scriptTitle') }}</h3>
          <div class="ps-ic-grid ps-ic-grid-4">
            <label class="field">
              <span class="field-label">{{ t('productStudio.influencers.language') }}</span>
              <select v-model="scriptLanguage" class="input">
                <option v-for="l in languages" :key="l" :value="l">{{ t(`productStudio.languages.${l}`) }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">{{ t('productStudio.influencers.platform') }}</span>
              <select v-model="scriptPlatform" class="input">
                <option v-for="p in platforms" :key="p" :value="p">{{ t(`productStudio.platforms.${p}`) }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">{{ t('productStudio.influencers.duration') }}</span>
              <input v-model.number="scriptDuration" class="input" type="number" min="10" max="60" step="1" />
            </label>
            <div class="field ps-ic-gen-cell">
              <button type="button" class="btn" :disabled="!canGenerateScript || generatingScript" @click="generateScript">
                <Loader2 v-if="generatingScript" :size="13" class="animate-spin" />
                <PenLine v-else :size="13" :stroke-width="2" />
                {{ generatingScript ? t('productStudio.influencers.generatingScript') : t('productStudio.influencers.generateScript') }}
              </button>
            </div>
          </div>
          <label class="field">
            <span class="field-label">{{ t('productStudio.influencers.productDescription') }}</span>
            <textarea v-model="productDescription" class="textarea" rows="2" />
          </label>
        </section>

        <!-- ===== ผลลัพธ์ ===== -->
        <section class="ps-ic-section">
          <h3 class="ps-ic-sec-title">{{ t('productStudio.influencers.results') }}</h3>
          <div v-if="!contents.length" class="ps-ic-empty">{{ t('productStudio.influencers.resultsEmpty') }}</div>
          <div v-else class="ps-ic-results">
            <template v-for="c in contents" :key="c.id">
              <figure v-if="c.kind === 'image'" class="ps-ic-result">
                <div class="ps-ic-result-visual" :class="{ processing: c.status === 'processing' }">
                  <img v-if="c.imageUrl" :src="c.imageUrl" :alt="c.scene || ''" loading="lazy" />
                  <div v-else-if="c.status === 'processing'" class="ps-ic-loading" role="status">
                    <Loader2 :size="16" class="animate-spin" />
                  </div>
                  <div v-else class="ps-ic-loading"><ImageOff :size="16" :stroke-width="1.6" /></div>
                </div>
                <figcaption class="ps-ic-result-foot">
                  <span v-if="c.scene" class="tag">{{ t(`productStudio.influencers.sceneNames.${c.scene}`) }}</span>
                  <span v-if="c.status === 'failed'" class="ps-ic-err" role="alert">{{ c.errorMsg || t('productStudio.influencers.contentFailed') }}</span>
                  <button type="button" class="ps-ic-del" :title="t('productStudio.influencers.deleteContent')" @click="removeContent(c)">
                    <Trash2 :size="12" :stroke-width="1.9" />
                  </button>
                </figcaption>
              </figure>
              <article v-else class="ps-ic-script">
                <div class="ps-ic-script-head">
                  <span class="tag tag-info">
                    <Loader2 v-if="c.status === 'processing'" :size="10" class="animate-spin" />
                    <PenLine v-else :size="10" :stroke-width="2" />
                    {{ t('productStudio.influencers.scriptTitle') }} · {{ c.language ? t(`productStudio.languages.${c.language}`) : '' }} · {{ c.durationSec }}s
                  </span>
                  <button type="button" class="ps-ic-del" :title="t('productStudio.influencers.deleteContent')" @click="removeContent(c)">
                    <Trash2 :size="12" :stroke-width="1.9" />
                  </button>
                </div>
                <p v-if="c.status === 'completed' && c.script" class="ps-ic-script-text">{{ c.script }}</p>
                <p v-else-if="c.status === 'failed'" class="ps-ic-err" role="alert">{{ c.errorMsg || t('productStudio.influencers.contentFailed') }}</p>
                <p v-else class="ps-ic-script-wait"><Loader2 :size="12" class="animate-spin" /> {{ t('productStudio.influencers.generatingScript') }}</p>
                <button v-if="c.status === 'completed' && c.script" type="button" class="btn btn-sm" @click="copyScript(c.script!)">
                  <Copy :size="12" :stroke-width="2" />
                  {{ copiedId === c.id ? t('productStudio.influencers.copied') : t('productStudio.influencers.copy') }}
                </button>
              </article>
            </template>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, ImageOff, ImagePlus, Loader2, PenLine, Sparkles, Trash2, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import {
  studioAPI, uploadAPI,
  type InfluencerReviewScene, type StudioInfluencer, type StudioInfluencerContent,
  type StudioLanguage, type StudioOptions, type StudioPlatform,
} from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

/** StudioInfluencerContentDialog — สร้างภาพรีวิว (influencer × สินค้า per scene) + สคริปต์รีวิว, poll งานที่กำลังประมวลผล */
const SCENES: InfluencerReviewScene[] = ['unboxing', 'holding', 'using', 'closeup', 'lifestyle']

const props = defineProps({
  influencer: { type: Object as () => StudioInfluencer, required: true },
  options: { type: Object as () => StudioOptions | null, default: null },
})
const emit = defineEmits(['close'])

const { t } = useI18n()

const languages = computed(() => props.options?.languages || ['th'])
const platforms = computed(() => props.options?.platforms?.map(p => p.id) || ['tiktok'])

const productName = ref('')
const productImage = ref('')
const productDescription = ref('')
const aspectRatio = ref('9:16')
const scenes = ref<InfluencerReviewScene[]>(['holding'])
const instruction = ref('')
const scriptLanguage = ref<StudioLanguage>('th')
const scriptPlatform = ref<StudioPlatform>('tiktok')
const scriptDuration = ref(30)

const uploading = ref(false)
const generatingImages = ref(false)
const generatingScript = ref(false)
const productFileEl = ref<HTMLInputElement | null>(null)

const contents = ref<StudioInfluencerContent[]>([])
const copiedId = ref<number | null>(null)

const canGenerateImages = computed(() => !!(productName.value.trim() && productImage.value && props.influencer.imageUrl))
const canGenerateScript = computed(() => !!productName.value.trim())

function toggleScene(s: InfluencerReviewScene) {
  const i = scenes.value.indexOf(s)
  if (i >= 0) scenes.value = scenes.value.filter(x => x !== s)
  else scenes.value = [...scenes.value, s]
}

async function uploadProduct(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || uploading.value) return
  uploading.value = true
  try {
    const res = await uploadAPI.image(file)
    productImage.value = res.url
  } catch (e) {
    toastError(e)
  } finally {
    uploading.value = false
    if (productFileEl.value) productFileEl.value.value = ''
  }
}

async function generateImages() {
  if (!canGenerateImages.value || generatingImages.value) return
  generatingImages.value = true
  try {
    const rows = await studioAPI.generateInfluencerReviewImages(props.influencer.id, {
      productName: productName.value.trim(),
      productImage: productImage.value,
      scenes: scenes.value,
      aspectRatio: aspectRatio.value,
      instruction: instruction.value.trim() || undefined,
    })
    contents.value = [...(rows || []), ...contents.value]
    toast.success(t('productStudio.influencers.imagesCreated', { n: rows?.length || 0 }))
  } catch (e) {
    toastError(e)
  } finally {
    generatingImages.value = false
  }
}

async function generateScript() {
  if (!canGenerateScript.value || generatingScript.value) return
  generatingScript.value = true
  try {
    const row = await studioAPI.generateInfluencerScript(props.influencer.id, {
      productName: productName.value.trim(),
      productDescription: productDescription.value.trim() || undefined,
      language: scriptLanguage.value,
      platform: scriptPlatform.value,
      durationSec: scriptDuration.value,
    })
    if (row) contents.value = [row, ...contents.value]
  } catch (e) {
    toastError(e)
  } finally {
    generatingScript.value = false
  }
}

async function removeContent(c: StudioInfluencerContent) {
  try {
    await studioAPI.deleteInfluencerContent(props.influencer.id, c.id)
    contents.value = contents.value.filter(x => x.id !== c.id)
  } catch (e) {
    toastError(e)
  }
}

async function copyScript(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copiedId.value = contents.value.find(c => c.script === text)?.id ?? null
    toast.success(t('productStudio.influencers.copied'))
  } catch { /* clipboard ไม่ได้รับอนุญาต — ไม่บล็อก */ }
}

// ===== poll งาน processing (ภาพ sys_task / สคริปต์ agent) =====
let pollTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  if (disposed) { pollTimer = null; return }
  pollTimer = contents.value.some(c => c.status === 'processing')
    ? setTimeout(poll, 3000)
    : null
}
async function poll() {
  try {
    contents.value = await studioAPI.influencerContents(props.influencer.id) || []
  } catch { /* poll พลาดรอบเดียวไม่บล็อก */ }
  schedulePoll()
}

onMounted(async () => {
  try {
    contents.value = await studioAPI.influencerContents(props.influencer.id) || []
  } catch (e) {
    toastError(e)
  }
  schedulePoll()
})
onBeforeUnmount(() => {
  disposed = true
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<style scoped>
.ps-ic-dialog { width: 680px; max-width: calc(100vw - 32px); display: flex; flex-direction: column; max-height: calc(100vh - 64px); }
.ps-ic-icon {
  width: 38px; height: 38px; flex-shrink: 0; border-radius: 11px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-bg); color: var(--accent-text);
}
.ps-ic-icon img { width: 100%; height: 100%; object-fit: cover; }
.ps-ic-close {
  margin-left: auto; align-self: flex-start;
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 8px;
  background: transparent; color: var(--text-3); cursor: pointer;
}
.ps-ic-close:hover { background: var(--bg-hover); color: var(--text-0); }
.ps-ic-body { overflow-y: auto; display: flex; flex-direction: column; gap: 18px; padding-right: 2px; }
.ps-ic-section {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--surface-soft);
}
.ps-ic-sec-title { margin: 0; font-size: 13px; font-weight: 700; color: var(--text-0); }
.ps-ic-grid { display: grid; grid-template-columns: 1fr 140px; gap: 10px; }
.ps-ic-grid-4 { grid-template-columns: 1fr 1fr 90px auto; }
.ps-ic-gen-cell { justify-content: flex-end; }
.ps-ic-upload-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ps-ic-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }
.ps-ic-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-ic-chip {
  padding: 5px 12px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-raised);
  font: 600 12px var(--font-body); color: var(--text-2); cursor: pointer;
}
.ps-ic-chip:hover { border-color: var(--border-strong); color: var(--text-0); }
.ps-ic-chip.on { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); }
.ps-ic-gen-row { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }
.ps-ic-empty { font-size: 12.5px; color: var(--text-3); text-align: center; padding: 18px 0; }
.ps-ic-results { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.ps-ic-result { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.ps-ic-result-visual {
  aspect-ratio: 9 / 16; border-radius: var(--radius); border: 1px solid var(--border);
  background: var(--bg-2); overflow: hidden;
}
.ps-ic-result-visual img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-ic-loading {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  color: var(--text-3);
}
.ps-ic-result-foot { display: flex; align-items: center; gap: 6px; }
.ps-ic-err { font-size: 10.5px; color: var(--action-danger, #dc2626); overflow-wrap: anywhere; }
.ps-ic-del {
  margin-left: auto; display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border: none; border-radius: 7px;
  background: transparent; color: var(--text-3); cursor: pointer;
}
.ps-ic-del:hover { background: var(--action-danger-bg); color: var(--action-danger); }
.ps-ic-script {
  grid-column: 1 / -1;
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface-raised);
}
.ps-ic-script-head { display: flex; align-items: center; gap: 6px; }
.ps-ic-script-text {
  margin: 0; font-size: 12.5px; color: var(--text-1); line-height: 1.65;
  white-space: pre-wrap; max-height: 200px; overflow-y: auto;
}
.ps-ic-script-wait { margin: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); }
.ps-required { color: var(--accent-text); }
.ps-foot-hint { margin-right: auto; font-size: 11.5px; color: var(--text-3); }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.textarea { resize: vertical; }
@media (max-width: 640px) {
  .ps-ic-grid, .ps-ic-grid-4 { grid-template-columns: 1fr; }
}
</style>
