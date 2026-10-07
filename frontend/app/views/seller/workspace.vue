<template>
  <div class="page page-enter">
    <div v-if="loading" class="sw-loading"><Loader2 :size="20" class="animate-spin" /></div>

    <template v-else-if="post">
      <!-- ===== Top bar ===== -->
      <header class="sw-head">
        <NuxtLink to="/seller" class="sw-back" :aria-label="t('seller.workspace.back')">
          <ArrowLeft :size="16" :stroke-width="2" />
        </NuxtLink>
        <input v-model="draft.title" class="sw-title" :placeholder="draft.productName || t('seller.workspace.untitled')" :aria-label="t('seller.workspace.titleAria')" />
        <span class="sw-save" aria-live="polite">
          <Loader2 v-if="saving" :size="12" class="animate-spin" />
          <Check v-else-if="savedOnce" :size="12" :stroke-width="2.4" />
          {{ saving ? t('seller.workspace.saving') : savedOnce ? t('seller.workspace.saved') : '' }}
        </span>
      </header>

      <div class="sw-layout">
        <div class="sw-main">
          <!-- ===== 1. สินค้า ===== -->
          <section class="sw-section">
            <h2 class="sw-section-title"><span class="sw-num">1</span>{{ t('seller.steps.product') }}</h2>
            <div class="sw-row">
              <label class="field">
                <span class="field-label">{{ t('seller.product.name') }} <span class="sw-req">*</span></span>
                <input v-model="draft.productName" class="input" :placeholder="t('seller.product.namePlaceholder')" />
              </label>
              <label class="field sw-price">
                <span class="field-label">{{ t('seller.product.price') }}</span>
                <input v-model="draft.productPrice" class="input" :placeholder="t('seller.product.pricePlaceholder')" />
              </label>
            </div>
            <div class="field">
              <span class="field-label">{{ t('seller.product.url') }}</span>
              <div class="sw-inline">
                <input v-model="draft.productUrl" class="input" type="url" :placeholder="t('seller.product.urlPlaceholder')" />
                <button type="button" class="btn" :disabled="ingesting || !draft.productUrl.trim()" @click="ingest">
                  <Loader2 v-if="ingesting" :size="13" class="animate-spin" />
                  <DownloadCloud v-else :size="13" :stroke-width="2" />
                  {{ t('seller.product.ingest') }}
                </button>
              </div>
            </div>
            <label class="field">
              <span class="field-label">{{ t('seller.product.affiliate') }}</span>
              <input v-model="draft.affiliateUrl" class="input" type="url" :placeholder="t('seller.product.affiliatePlaceholder')" />
              <span class="field-hint">{{ t('seller.product.affiliateHint') }}</span>
            </label>
            <label class="field">
              <span class="field-label">{{ t('seller.product.details') }}</span>
              <textarea v-model="draft.productDescription" class="textarea" rows="3" :placeholder="t('seller.product.detailsPlaceholder')" />
              <span class="field-hint">{{ t('seller.product.detailsHint') }}</span>
            </label>
            <div class="field">
              <span class="field-label">{{ t('seller.product.images') }} <span class="sw-count">{{ draft.productImages.length }}/{{ MAX_IMAGES }}</span></span>
              <div class="sw-images">
                <div v-for="img in draft.productImages" :key="img" class="sw-img">
                  <img :src="img" alt="" loading="lazy" />
                  <button type="button" class="sw-img-del" :aria-label="t('seller.product.removeImage')" @click="removeImage(img)">
                    <X :size="12" :stroke-width="2.4" />
                  </button>
                </div>
                <button v-if="draft.productImages.length < MAX_IMAGES" type="button" class="sw-img-add" :disabled="uploadingImage" @click="imageInput?.click()">
                  <Loader2 v-if="uploadingImage" :size="18" class="animate-spin" />
                  <ImagePlus v-else :size="18" :stroke-width="1.8" />
                  <span>{{ t('seller.product.addImage') }}</span>
                </button>
                <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="uploadImages" />
              </div>
            </div>
          </section>

          <!-- ===== 2. วิดีโอ ===== -->
          <section class="sw-section">
            <h2 class="sw-section-title"><span class="sw-num">2</span>{{ t('seller.steps.video') }}</h2>
            <div class="sw-video-row">
              <div class="sw-video-box">
                <video v-if="draft.videoUrl" :src="`${draft.videoUrl}#t=0.1`" :poster="draft.productImages[0]" controls preload="metadata" />
                <div v-else-if="post.videoJob?.running" class="sw-video-empty">
                  <Loader2 :size="22" class="animate-spin" />
                  <span>{{ t('seller.skillVideo.placeholder') }}</span>
                </div>
                <div v-else class="sw-video-empty">
                  <Video :size="24" :stroke-width="1.5" />
                  <span>{{ t('seller.video.none') }}</span>
                </div>
              </div>
              <div class="sw-video-actions">
                <button type="button" class="btn" :disabled="uploadingVideo" @click="videoInput?.click()">
                  <Loader2 v-if="uploadingVideo" :size="13" class="animate-spin" />
                  <Upload v-else :size="13" :stroke-width="2" />
                  {{ t('seller.video.upload') }}
                </button>
                <input ref="videoInput" type="file" accept="video/*" hidden @change="uploadVideo" />
                <button type="button" class="btn" @click="toggleStudioPicker">
                  <Clapperboard :size="13" :stroke-width="2" />
                  {{ t('seller.video.fromStudio') }}
                </button>
                <button v-if="draft.videoUrl" type="button" class="btn btn-ghost sw-danger" @click="setVideo(null, null)">
                  <Trash2 :size="13" :stroke-width="2" />
                  {{ t('seller.video.remove') }}
                </button>
                <p class="field-hint">{{ t('seller.video.hint') }}</p>
              </div>
            </div>
            <div v-if="showStudioPicker" class="sw-studio">
              <p v-if="!studioVideos.length" class="field-hint">{{ t('seller.video.studioEmpty') }}</p>
              <button
                v-for="v in studioVideos" :key="v.projectId" type="button"
                :class="['sw-studio-item', { on: draft.studioProjectId === v.projectId }]"
                @click="pickStudioVideo(v)"
              >
                <video :src="`${v.videoUrl}#t=0.1`" muted preload="metadata" />
                <span class="truncate">{{ v.title || v.productName }}</span>
              </button>
            </div>

            <!-- คลังสกิล: ทำวิดีโอใหม่จากสินค้าของโพสต์นี้ แล้วแนบเข้าโพสต์เอง -->
            <div id="skill-video" class="sw-divider"><span>{{ t('seller.skillVideo.divider') }}</span></div>
            <SellerSkillVideo
              :post="post"
              :initial-skill="initialSkill"
              :blocked="draft.productName.trim() ? '' : t('seller.copy.needProduct')"
              :before-start="save"
              @updated="onPostUpdated"
            />
          </section>

          <!-- ===== 3. ช่องทาง + สไตล์ ===== -->
          <section class="sw-section">
            <h2 class="sw-section-title"><span class="sw-num">3</span>{{ t('seller.steps.copy') }}</h2>
            <div class="field">
              <span class="field-label">{{ t('seller.copy.channels') }}</span>
              <div class="sw-chips">
                <button
                  v-for="ch in CHANNELS" :key="ch" type="button"
                  :class="['sw-chip', `ch-${ch}`, { on: draft.channels.includes(ch) }]" :aria-pressed="draft.channels.includes(ch)"
                  @click="toggleChannel(ch)"
                >
                  <span class="sw-dot" aria-hidden="true"></span>
                  {{ t(`seller.channels.${ch}`) }}
                </button>
              </div>
            </div>
            <div class="field">
              <span class="field-label">{{ t('seller.copy.tone') }}</span>
              <div class="sw-chips">
                <button
                  v-for="tone in TONES" :key="tone" type="button"
                  :class="['sw-chip', { on: draft.tone === tone }]" :aria-pressed="draft.tone === tone"
                  @click="draft.tone = tone"
                >{{ t(`seller.tones.${tone}`) }}</button>
              </div>
            </div>
            <div class="sw-row">
              <label class="field">
                <span class="field-label">{{ t('seller.copy.notes') }}</span>
                <input v-model="draft.notes" class="input" :placeholder="t('seller.copy.notesPlaceholder')" />
              </label>
              <label class="field sw-lang">
                <span class="field-label">{{ t('seller.copy.language') }}</span>
                <select v-model="draft.language" class="input">
                  <option value="th">ไทย</option>
                  <option value="en">English</option>
                </select>
              </label>
            </div>
            <div class="sw-gen">
              <button type="button" class="btn btn-primary" :disabled="generating || !canGenerate" @click="generate">
                <Loader2 v-if="generating" :size="14" class="animate-spin" />
                <Sparkles v-else :size="14" :stroke-width="2" />
                {{ generating ? t('seller.copy.generating') : hasContent ? t('seller.copy.regenerate') : t('seller.copy.generate') }}
              </button>
              <span v-if="!canGenerate" class="field-hint">{{ !draft.productName.trim() ? t('seller.copy.needProduct') : t('seller.copy.needChannel') }}</span>
              <span v-else-if="post.status === 'failed' && post.errorMsg" class="field-hint sw-danger">{{ t('seller.copy.failed') }}</span>
            </div>
          </section>
        </div>

        <!-- ===== 4. พร้อมโพสต์ ===== -->
        <aside class="sw-side">
          <section class="sw-section sw-ready">
            <h2 class="sw-section-title"><span class="sw-num">4</span>{{ t('seller.ready.title') }}</h2>
            <div v-if="!readyChannels.length" class="sw-ready-empty">
              <MessageSquareText :size="24" :stroke-width="1.5" />
              <p>{{ t('seller.ready.empty') }}</p>
            </div>
            <template v-else>
              <div class="sw-tabs" role="tablist">
                <button
                  v-for="ch in readyChannels" :key="ch" type="button" role="tab" :aria-selected="activeChannel === ch"
                  :class="['sw-tab', `ch-${ch}`, { on: activeChannel === ch }]" @click="activeChannel = ch"
                >
                  <span class="sw-dot" aria-hidden="true"></span>{{ t(`seller.channels.${ch}`) }}
                </button>
              </div>

              <div v-if="active" class="sw-channel">
                <!-- ตัวอย่างหน้าตาโพสต์ -->
                <div class="sw-phone" aria-hidden="true">
                  <video v-if="draft.videoUrl" :src="`${draft.videoUrl}#t=0.1`" :poster="draft.productImages[0]" muted playsinline preload="metadata" />
                  <img v-else-if="draft.productImages[0]" :src="draft.productImages[0]" alt="" />
                  <div v-else class="sw-phone-blank"><Package :size="22" :stroke-width="1.5" /></div>
                  <div class="sw-phone-copy">
                    <p class="sw-phone-caption">{{ active.caption }}</p>
                    <p class="sw-phone-tags">{{ hashtagsText(active.hashtags) }}</p>
                  </div>
                </div>

                <label class="field">
                  <span class="field-label">{{ t('seller.ready.caption') }} <span class="sw-count">{{ composed.post.length }}</span></span>
                  <textarea v-model="active.caption" class="textarea" rows="4" />
                </label>
                <label class="field">
                  <span class="field-label">{{ t('seller.ready.hashtags') }}</span>
                  <input :value="hashtagsText(active.hashtags)" class="input" @change="active.hashtags = parseHashtags(($event.target as HTMLInputElement).value)" />
                </label>
                <label class="field">
                  <span class="field-label">{{ t('seller.ready.comment') }}</span>
                  <textarea v-model="active.comment" class="textarea" rows="2" />
                  <span class="field-hint">
                    <template v-if="link">{{ t('seller.ready.linkAppended') }} <a :href="link" target="_blank" rel="noopener noreferrer" class="sw-link">{{ link }}</a></template>
                    <template v-else>{{ t('seller.ready.noLink') }}</template>
                  </span>
                </label>

                <div class="sw-actions">
                  <button type="button" class="btn btn-primary" @click="copy(composed.post, 'post')">
                    <Copy :size="13" :stroke-width="2" /> {{ t('seller.ready.copyPost') }}
                  </button>
                  <button type="button" class="btn" :disabled="!composed.comment" @click="copy(composed.comment, 'comment')">
                    <MessageSquareText :size="13" :stroke-width="2" /> {{ t('seller.ready.copyComment') }}
                  </button>
                  <a v-if="draft.videoUrl" :href="draft.videoUrl" :download="fileName('mp4')" class="btn">
                    <Download :size="13" :stroke-width="2" /> {{ t('seller.ready.downloadVideo') }}
                  </a>
                  <button v-if="draft.productImages.length" type="button" class="btn" @click="downloadImages">
                    <Images :size="13" :stroke-width="2" /> {{ t('seller.ready.downloadImages', { n: draft.productImages.length }) }}
                  </button>
                  <a :href="CHANNEL_POST_URLS[activeChannel]" target="_blank" rel="noopener noreferrer" class="btn btn-ghost">
                    <ExternalLink :size="13" :stroke-width="2" /> {{ t('seller.ready.openChannel', { channel: t(`seller.channels.${activeChannel}`) }) }}
                  </a>
                </div>
                <p class="field-hint">{{ t(`seller.tips.${activeChannel}`) }}</p>
              </div>
            </template>

            <div class="sw-auto">
              <Zap :size="14" :stroke-width="2" />
              <div>
                <p class="sw-auto-title">{{ t('seller.ready.autoTitle') }} <span class="tag">{{ t('seller.ready.soon') }}</span></p>
                <p class="sw-auto-desc">{{ t('seller.ready.autoDesc') }}</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </template>

    <div v-else class="sw-loading">
      <p>{{ t('seller.workspace.notFound') }}</p>
      <NuxtLink to="/seller" class="btn">{{ t('seller.workspace.back') }}</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import {
  ArrowLeft, Check, Clapperboard, Copy, Download, DownloadCloud, ExternalLink, ImagePlus, Images, Loader2,
  MessageSquareText, Package, Sparkles, Trash2, Upload, Video, X, Zap,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { sellerAPI, uploadAPI, type SellerChannel, type SellerChannelContent, type SellerPost, type SellerStudioVideo, type SellerTone } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { CHANNEL_POST_URLS, SELLER_CHANNELS, composeChannel, hashtagsText, parseHashtags, postLink } from '~/utils/sellerCopy'

const MAX_IMAGES = 9
const CHANNELS = SELLER_CHANNELS as SellerChannel[]
const TONES: SellerTone[] = ['casual', 'fun', 'pro', 'urgent']

const { t } = useI18n()
const route = useRoute()
const id = Number(route.params.id)

const post = ref<SellerPost | null>(null)
const loading = ref(true)

interface Draft {
  title: string; productName: string; productPrice: string; productUrl: string; affiliateUrl: string; productDescription: string
  productImages: string[]; videoUrl: string | null; studioProjectId: number | null
  channels: SellerChannel[]; tone: SellerTone; language: 'th' | 'en'; notes: string
  content: Partial<Record<SellerChannel, SellerChannelContent>>
}
const draft = reactive<Draft>({
  title: '', productName: '', productPrice: '', productUrl: '', affiliateUrl: '', productDescription: '',
  productImages: [], videoUrl: null, studioProjectId: null,
  channels: [], tone: 'casual', language: 'th', notes: '', content: {},
})

function fill(p: SellerPost) {
  Object.assign(draft, {
    title: p.title || '',
    productName: p.productName || '',
    productPrice: p.productPrice || '',
    productUrl: p.productUrl || '',
    affiliateUrl: p.affiliateUrl || '',
    productDescription: p.productDescription || '',
    productImages: [...p.productImages],
    videoUrl: p.videoUrl,
    studioProjectId: p.studioProjectId,
    channels: [...p.channels],
    tone: p.tone,
    language: p.language,
    notes: p.notes || '',
    content: JSON.parse(JSON.stringify(p.content || {})),
  })
}

function payload(): Partial<SellerPost> {
  return {
    title: draft.title.trim(),
    productName: draft.productName.trim(),
    productPrice: draft.productPrice.trim() || null,
    productUrl: draft.productUrl.trim() || null,
    affiliateUrl: draft.affiliateUrl.trim() || null,
    productDescription: draft.productDescription.trim() || null,
    productImages: draft.productImages,
    // videoUrl/studioProjectId ไม่อยู่ใน autosave — เปลี่ยนผ่าน setVideo ทันที (กันค่าเก่าทับวิดีโอที่ระบบเพิ่งแนบจากคลังสกิล)
    channels: draft.channels,
    tone: draft.tone,
    language: draft.language,
    notes: draft.notes.trim() || null,
    content: draft.content,
  }
}

// ===== autosave (debounce) =====
const saving = ref(false)
const savedOnce = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let suppressWatch = false
let lastSaved = ''

async function save() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const body = payload()
  const key = JSON.stringify(body)
  if (key === lastSaved) return
  saving.value = true
  try {
    post.value = await sellerAPI.update(id, body)
    lastSaved = key
    savedOnce.value = true
  } catch (e) {
    toastError(e)
  } finally {
    saving.value = false
  }
}

watch(draft, () => {
  if (suppressWatch) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 900)
}, { deep: true })

function replaceDraft(p: SellerPost) {
  suppressWatch = true
  fill(p)
  lastSaved = JSON.stringify(payload())
  // reactive watch flush เป็น pre — ปล่อยหลัง tick เพื่อไม่ให้ autosave ตอบสนองการเติมค่า
  nextTick(() => { suppressWatch = false })
}

// ===== product =====
const ingesting = ref(false)
async function ingest() {
  const url = draft.productUrl.trim()
  if (!url || ingesting.value) return
  ingesting.value = true
  try {
    const info = await sellerAPI.ingestUrl(url)
    if (info.productName && !draft.productName.trim()) draft.productName = info.productName
    if (info.productDescription && !draft.productDescription.trim()) draft.productDescription = info.productDescription
    if (info.price && !draft.productPrice.trim()) draft.productPrice = info.price
    draft.productImages = [...new Set([...draft.productImages, ...info.images])].slice(0, MAX_IMAGES)
    toast.success(t('seller.product.ingested'))
  } catch (e) {
    toastError(e)
  } finally {
    ingesting.value = false
  }
}

const imageInput = ref<HTMLInputElement | null>(null)
const uploadingImage = ref(false)
async function uploadImages(ev: Event) {
  const files = [...((ev.target as HTMLInputElement).files || [])].slice(0, MAX_IMAGES - draft.productImages.length)
  if (!files.length) return
  uploadingImage.value = true
  try {
    for (const f of files) {
      const res = await uploadAPI.image(f)
      draft.productImages = [...draft.productImages, res.url]
    }
  } catch (e) {
    toastError(e)
  } finally {
    uploadingImage.value = false
    if (imageInput.value) imageInput.value.value = ''
  }
}
function removeImage(img: string) {
  draft.productImages = draft.productImages.filter(i => i !== img)
}

// ===== video =====
const videoInput = ref<HTMLInputElement | null>(null)
const uploadingVideo = ref(false)
async function uploadVideo(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingVideo.value = true
  try {
    const res = await uploadAPI.video(file)
    await setVideo(res.url, null)
  } catch (e) {
    toastError(e)
  } finally {
    uploadingVideo.value = false
    if (videoInput.value) videoInput.value.value = ''
  }
}

const showStudioPicker = ref(false)
const studioVideos = ref<SellerStudioVideo[]>([])
async function toggleStudioPicker() {
  showStudioPicker.value = !showStudioPicker.value
  if (showStudioPicker.value) {
    try { studioVideos.value = await sellerAPI.studioVideos() || [] } catch (e) { toastError(e) }
  }
}
function pickStudioVideo(v: SellerStudioVideo) {
  void setVideo(v.videoUrl, v.projectId)
  if (!draft.productImages.length) draft.productImages = v.productImages.slice(0, MAX_IMAGES)
  showStudioPicker.value = false
}

/** เปลี่ยนวิดีโอของโพสต์ทันที (ไม่รอ autosave) */
async function setVideo(videoUrl: string | null, studioProjectId: number | null) {
  try {
    onPostUpdated(await sellerAPI.update(id, { videoUrl, studioProjectId }))
  } catch (e) {
    toastError(e)
  }
}

// ===== คลังสกิล → วิดีโอ: poll ระหว่างระบบทำวิดีโอ แล้วรับวิดีโอที่แนบเข้ามา =====
const initialSkill = computed(() => (typeof route.query.skill === 'string' ? route.query.skill : ''))
let videoPoll: ReturnType<typeof setInterval> | null = null

function onPostUpdated(p: SellerPost) {
  const wasRunning = !!post.value?.videoJob?.running
  post.value = p
  draft.videoUrl = p.videoUrl
  draft.studioProjectId = p.studioProjectId
  if (wasRunning && !p.videoJob?.running && p.videoJob?.stage === 'done') toast.success(t('seller.skillVideo.attached'))
}

watch(() => post.value?.videoJob?.running, (running) => {
  if (running && !videoPoll) {
    videoPoll = setInterval(async () => {
      try { onPostUpdated(await sellerAPI.get(id)) } catch { /* ลองใหม่รอบถัดไป */ }
    }, 5000)
  } else if (!running && videoPoll) {
    clearInterval(videoPoll)
    videoPoll = null
  }
})

// ===== copy generation =====
function toggleChannel(ch: SellerChannel) {
  draft.channels = draft.channels.includes(ch)
    ? draft.channels.filter(c => c !== ch)
    : CHANNELS.filter(c => c === ch || draft.channels.includes(c))
}

const canGenerate = computed(() => !!draft.productName.trim() && draft.channels.length > 0)
const hasContent = computed(() => draft.channels.some(ch => draft.content[ch]?.caption))
const generating = ref(false)
async function generate() {
  if (!canGenerate.value || generating.value) return
  generating.value = true
  try {
    await save()
    const p = await sellerAPI.generate(id, { channels: draft.channels, tone: draft.tone, language: draft.language, notes: draft.notes.trim() || null })
    post.value = p
    replaceDraft(p)
    if (!draft.channels.includes(activeChannel.value)) activeChannel.value = draft.channels[0]!
    toast.success(t('seller.copy.done'))
  } catch (e) {
    toastError(e)
  } finally {
    generating.value = false
  }
}

// ===== ready to post =====
const readyChannels = computed(() => draft.channels.filter(ch => draft.content[ch]?.caption || draft.content[ch]?.comment))
const activeChannel = ref<SellerChannel>('tiktok')
watch(readyChannels, (list) => {
  if (list.length && !list.includes(activeChannel.value)) activeChannel.value = list[0]!
}, { immediate: true })
const active = computed(() => draft.content[activeChannel.value])
const link = computed(() => postLink(draft))
const composed = computed(() => composeChannel(active.value, link.value))

async function copy(text: string, kind: 'post' | 'comment') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t(kind === 'post' ? 'seller.ready.copiedPost' : 'seller.ready.copiedComment'))
  } catch {
    toast.error(t('seller.ready.copyFailed'))
  }
}

function fileName(ext: string) {
  const base = (draft.title || draft.productName || 'naka-post').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60)
  return `${base}.${ext}`
}

function downloadImages() {
  draft.productImages.forEach((src, i) => {
    const a = document.createElement('a')
    a.href = src
    a.download = fileName(`${i + 1}.${(src.split('.').pop() || 'png').slice(0, 5)}`)
    document.body.appendChild(a)
    a.click()
    a.remove()
  })
}

onMounted(async () => {
  try {
    const p = await sellerAPI.get(id)
    post.value = p
    replaceDraft(p)
  } catch (e) {
    post.value = null
    if ((e as any)?.status !== 404) toastError(e)
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => {
  if (saveTimer) save()
  if (videoPoll) clearInterval(videoPoll)
})
</script>

<style scoped>
.page { padding: 24px 40px 48px; overflow-y: auto; height: 100%; }
.sw-loading { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 80px 0; color: var(--text-3); }

.sw-head { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; }
.sw-back {
  display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex-shrink: 0;
  border-radius: 10px; border: 1px solid var(--border); color: var(--text-1); text-decoration: none;
}
.sw-back:hover { background: var(--bg-hover); color: var(--text-0); }
.sw-title {
  flex: 1; min-width: 0; border: none; background: transparent; outline: none;
  font: 800 22px var(--font-display); color: var(--text-0); letter-spacing: -0.01em;
  padding: 4px 6px; border-radius: 8px;
}
.sw-title:hover, .sw-title:focus { background: var(--bg-hover); }
.sw-save { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-3); white-space: nowrap; }

.sw-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 420px); gap: 18px; align-items: start; }
.sw-main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.sw-side { position: sticky; top: 0; min-width: 0; }
.sw-section {
  display: flex; flex-direction: column; gap: 12px;
  padding: 18px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: var(--surface-soft);
}
.sw-section-title { display: flex; align-items: center; gap: 8px; margin: 0; font: 800 15px var(--font-display); color: var(--text-0); }
.sw-num {
  width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--accent-gradient); color: #fff; font-size: 12px;
}
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { margin: 0; font-size: 11px; color: var(--text-3); line-height: 1.5; }
.sw-req { color: var(--accent-text); }
.sw-count { margin-left: 4px; font-weight: 500; color: var(--text-3); }
.sw-row { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 12px; }
.sw-inline { display: flex; gap: 8px; }
.sw-inline .input { flex: 1; min-width: 0; }
.textarea { resize: vertical; }
.sw-danger { color: var(--error); }

.sw-images { display: flex; flex-wrap: wrap; gap: 8px; }
.sw-img, .sw-img-add {
  position: relative; width: 84px; height: 84px; border-radius: 10px; overflow: hidden;
  border: 1px solid var(--border); background: var(--bg-2);
}
.sw-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sw-img-del {
  position: absolute; top: 4px; right: 4px; width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%; background: rgba(0, 0, 0, 0.6); color: #fff; cursor: pointer;
}
.sw-img-add {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  border-style: dashed; color: var(--text-2); font: 600 10.5px var(--font-body); cursor: pointer;
}
.sw-img-add:hover { border-color: var(--accent); color: var(--accent-text); }

.sw-video-row { display: flex; gap: 16px; align-items: flex-start; }
.sw-video-box {
  width: 150px; aspect-ratio: 9 / 16; flex-shrink: 0; overflow: hidden;
  border-radius: 12px; border: 1px solid var(--border); background: var(--bg-2);
}
.sw-video-box video { width: 100%; height: 100%; object-fit: cover; display: block; background: #000; }
.sw-video-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--text-3); font-size: 11.5px; text-align: center; padding: 8px; }
.sw-video-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.sw-divider {
  display: flex; align-items: center; gap: 10px; margin-top: 4px;
  font-size: 12px; font-weight: 700; color: var(--text-2);
}
.sw-divider::before, .sw-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
.sw-studio { display: flex; gap: 8px; overflow-x: auto; padding: 2px; }
.sw-studio-item {
  display: flex; flex-direction: column; gap: 4px; width: 92px; flex-shrink: 0; padding: 4px;
  border: 2px solid var(--border); border-radius: 10px; background: var(--surface-raised);
  font: 600 11px var(--font-body); color: var(--text-1); cursor: pointer; text-align: left;
}
.sw-studio-item video { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 6px; background: var(--bg-2); }
.sw-studio-item.on { border-color: var(--accent); }

/* channel colours */
.ch-tiktok { --ch: var(--text-0); }
.ch-shopee { --ch: #ee4d2d; }
.ch-facebook { --ch: #1877f2; }
.ch-instagram { --ch: #d62976; }
.sw-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ch, var(--accent)); flex-shrink: 0; }
.sw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.sw-chip {
  display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px;
  border-radius: 999px; border: 1px solid var(--border); background: var(--surface-raised);
  font: 600 12.5px var(--font-body); color: var(--text-1); cursor: pointer;
}
.sw-chip:hover { border-color: var(--border-strong); }
.sw-chip.on { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); }
.sw-chip:focus-visible, .sw-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.sw-lang { max-width: 180px; }
.sw-gen { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.sw-ready-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 12px; color: var(--text-3); text-align: center; font-size: 12.5px; }
.sw-ready-empty p { margin: 0; }
.sw-tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.sw-tab {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; height: 32px; padding: 0 12px;
  border: 1px solid transparent; border-radius: 999px; background: transparent;
  font: 600 12.5px var(--font-body); color: var(--text-2); cursor: pointer;
}
.sw-tab.on { border-color: var(--border); background: var(--surface-raised); color: var(--text-0); }
.sw-channel { display: flex; flex-direction: column; gap: 12px; }
.sw-phone {
  position: relative; width: 200px; aspect-ratio: 9 / 16; margin: 0 auto; overflow: hidden;
  border-radius: 18px; border: 4px solid var(--text-0); background: #000;
}
.sw-phone video, .sw-phone img { width: 100%; height: 100%; object-fit: cover; display: block; }
.sw-phone-blank { height: 100%; display: flex; align-items: center; justify-content: center; color: #9ca3af; background: var(--bg-2); }
.sw-phone-copy {
  position: absolute; inset: auto 0 0 0; padding: 40px 10px 10px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent); color: #fff;
}
.sw-phone-caption {
  margin: 0; font-size: 10.5px; line-height: 1.4; white-space: pre-line;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}
.sw-phone-tags { margin: 3px 0 0; font-size: 10px; font-weight: 700; color: #e0e7ff; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.sw-link { color: var(--accent-text); word-break: break-all; }
.sw-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.sw-actions .btn { text-decoration: none; }
.sw-auto {
  display: flex; gap: 10px; padding: 12px; border-radius: 12px;
  border: 1px dashed var(--border); color: var(--text-2);
}
.sw-auto svg { flex-shrink: 0; margin-top: 2px; color: var(--accent-text); }
.sw-auto-title { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12.5px; font-weight: 700; color: var(--text-1); }
.sw-auto-desc { margin: 2px 0 0; font-size: 11.5px; line-height: 1.5; }

@media (max-width: 1100px) {
  .sw-layout { grid-template-columns: 1fr; }
  .sw-side { position: static; }
}
@media (max-width: 860px) {
  .page { padding: 16px 16px 32px; }
  .sw-row { grid-template-columns: 1fr; }
  .sw-lang { max-width: none; }
  .sw-video-row { flex-direction: column; }
}
</style>
