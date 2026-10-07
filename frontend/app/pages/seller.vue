<template>
  <div class="page page-enter">
    <header class="sl-head">
      <div>
        <p class="eyebrow">{{ t('seller.eyebrow') }}</p>
        <h1 class="sl-title">{{ t('seller.title') }}</h1>
        <p class="sl-sub">{{ t('seller.subtitle') }}</p>
      </div>
      <button class="btn btn-primary" type="button" @click="openCreate">
        <Plus :size="15" :stroke-width="2.2" />
        {{ t('seller.list.new') }}
      </button>
    </header>

    <!-- 3 ขั้น: สินค้า → วิดีโอ → แคปชั่น/โพสต์ -->
    <ol class="sl-steps" :aria-label="t('seller.steps.aria')">
      <li v-for="(s, i) in steps" :key="s.key" class="sl-step">
        <span class="sl-step-icon"><component :is="s.icon" :size="16" :stroke-width="1.9" /></span>
        <div>
          <p class="sl-step-title">{{ i + 1 }}. {{ t(`seller.steps.${s.key}`) }}</p>
          <p class="sl-step-desc">{{ t(`seller.steps.${s.key}Desc`) }}</p>
        </div>
      </li>
    </ol>

    <div v-if="loading" class="sl-grid" aria-hidden="true">
      <div v-for="i in 3" :key="i" class="sl-card sl-skeleton"></div>
    </div>

    <div v-else-if="posts.length" class="sl-grid">
      <article
        v-for="(p, i) in posts" :key="p.id" class="sl-card" tabindex="0" role="button"
        :style="{ animationDelay: `${i * 0.04}s` }"
        :aria-label="t('seller.list.openAria', { title: p.title || p.productName })"
        @click="open(p)" @keydown.enter.self.prevent="open(p)" @keydown.space.self.prevent="open(p)"
      >
        <div class="sl-thumb" aria-hidden="true">
          <video v-if="p.videoUrl && !p.productImages[0]" :src="`${p.videoUrl}#t=0.1`" muted preload="metadata" />
          <img v-else-if="p.productImages[0]" :src="p.productImages[0]" alt="" loading="lazy" />
          <Package v-else :size="22" :stroke-width="1.6" />
          <span v-if="p.videoUrl" class="sl-thumb-badge"><Film :size="11" :stroke-width="2" /></span>
        </div>
        <div class="sl-card-body">
          <div class="sl-card-top">
            <h3 class="sl-card-title truncate">{{ p.title || p.productName }}</h3>
            <AppMenu :open="menuId === p.id" placement="bottom-end" :min-width="120" @update:open="(v) => { menuId = v ? p.id : null }">
              <template #trigger>
                <button class="sl-more" type="button" :title="t('common.more')" :aria-label="t('common.more')" @click.stop>
                  <MoreHorizontal :size="16" :stroke-width="2" />
                </button>
              </template>
              <AppMenuItem danger @click="menuId = null; toDelete = p">{{ t('common.delete') }}</AppMenuItem>
            </AppMenu>
          </div>
          <p v-if="p.productPrice" class="sl-card-price">{{ p.productPrice }}</p>
          <div class="sl-card-tags">
            <span class="tag" :class="p.status === 'ready' ? 'tag-success' : p.status === 'failed' ? 'tag-error' : ''">{{ t(`seller.status.${p.status}`) }}</span>
            <span v-for="ch in p.channels" :key="ch" class="tag">{{ t(`seller.channels.${ch}`) }}</span>
          </div>
          <p class="sl-card-foot"><Clock :size="11" :stroke-width="1.8" /> {{ fmtDate(p.updatedAt) }}</p>
        </div>
      </article>
    </div>

    <div v-else class="sl-empty">
      <Store :size="26" :stroke-width="1.5" />
      <p class="sl-empty-title">{{ t('seller.list.emptyTitle') }}</p>
      <p class="sl-empty-desc">{{ t('seller.list.emptyDesc') }}</p>
      <button class="btn btn-primary" type="button" @click="openCreate">
        <Plus :size="15" :stroke-width="2.2" />
        {{ t('seller.list.new') }}
      </button>
    </div>

    <!-- ===== สร้างโพสต์ ===== -->
    <div v-if="showCreate" class="overlay" @click.self="closeCreate">
      <div class="dialog sl-dialog" role="dialog" aria-modal="true" :aria-label="t('seller.create.title')">
        <div class="dialog-head">
          <div class="sl-dialog-icon"><Store :size="18" :stroke-width="1.8" /></div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('seller.create.title') }}</h2>
            <p class="dialog-desc">{{ t('seller.create.desc') }}</p>
          </div>
        </div>
        <form class="sl-form" @submit.prevent="create()">
          <div class="dialog-body">
            <label class="field">
              <span class="field-label">{{ t('seller.product.url') }}</span>
              <input v-model="form.productUrl" class="input" type="url" :placeholder="t('seller.product.urlPlaceholder')" />
              <span class="field-hint">{{ t('seller.create.urlHint') }}</span>
            </label>
            <label class="field">
              <span class="field-label">{{ t('seller.product.name') }}</span>
              <input v-model="form.productName" class="input" :placeholder="t('seller.product.namePlaceholder')" />
            </label>

            <div v-if="studioVideos.length" class="field">
              <span class="field-label">{{ t('seller.create.fromStudio') }}</span>
              <div class="sl-videos">
                <button
                  v-for="v in studioVideos" :key="v.projectId" type="button"
                  :class="['sl-video', { on: form.studioProjectId === v.projectId }]" :aria-pressed="form.studioProjectId === v.projectId"
                  @click="pickVideo(v)"
                >
                  <video :src="`${v.videoUrl}#t=0.1`" muted preload="metadata" />
                  <span class="truncate">{{ v.title || v.productName }}</span>
                </button>
              </div>
              <span class="field-hint">{{ t('seller.create.fromStudioHint') }}</span>
            </div>
          </div>
          <div class="dialog-foot">
            <span v-if="!canCreate" class="sl-foot-hint">{{ t('seller.create.needProduct') }}</span>
            <button type="button" class="btn" :disabled="creating" @click="closeCreate">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="creating || !canCreate">
              <Loader2 v-if="creating" :size="13" class="animate-spin" />
              {{ creating ? t('seller.create.creating') : t('seller.create.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <ConfirmDialog
      :open="!!toDelete"
      :title="t('seller.delete.title')"
      :message="t('seller.delete.message', { title: toDelete?.title || toDelete?.productName || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="deleting"
      @confirm="remove"
      @cancel="toDelete = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, Film, Loader2, MessageSquareText, MoreHorizontal, Package, Plus, Store, Video } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { sellerAPI, type SellerPost, type SellerStudioVideo } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'

const { t, locale } = useI18n()

const steps = [
  { key: 'product', icon: Package },
  { key: 'video', icon: Video },
  { key: 'copy', icon: MessageSquareText },
]

const posts = ref<SellerPost[]>([])
const loading = ref(true)
const menuId = ref<number | null>(null)

function fmtDate(v?: string) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium' })
}

function open(p: SellerPost) {
  navigateTo(`/seller/${p.id}`)
}

async function load() {
  try {
    posts.value = await sellerAPI.list() || []
  } catch (e) {
    toastError(e)
  } finally {
    loading.value = false
  }
}

// ===== create =====
const showCreate = ref(false)
const creating = ref(false)
const form = ref<{ productUrl: string; productName: string; studioProjectId: number | null }>({ productUrl: '', productName: '', studioProjectId: null })
const studioVideos = ref<SellerStudioVideo[]>([])
const canCreate = computed(() => !!(form.value.productName.trim() || form.value.productUrl.trim()))

async function openCreate() {
  form.value = { productUrl: '', productName: '', studioProjectId: null }
  showCreate.value = true
  try { studioVideos.value = await sellerAPI.studioVideos() || [] } catch { studioVideos.value = [] }
}
function closeCreate() {
  if (!creating.value) showCreate.value = false
}
function pickVideo(v: SellerStudioVideo) {
  if (form.value.studioProjectId === v.projectId) {
    form.value.studioProjectId = null
    return
  }
  form.value.studioProjectId = v.projectId
  form.value.productName = v.productName || v.title
  form.value.productUrl = v.productUrl || form.value.productUrl
}

async function create() {
  if (!canCreate.value || creating.value) return
  creating.value = true
  try {
    const url = form.value.productUrl.trim()
    const video = studioVideos.value.find(v => v.projectId === form.value.studioProjectId)
    const data: Partial<SellerPost> = {
      productName: form.value.productName.trim(),
      productUrl: url || null,
    }
    if (video) {
      Object.assign(data, {
        videoUrl: video.videoUrl,
        studioProjectId: video.projectId,
        productImages: video.productImages,
        productDescription: video.productDescription,
      })
    } else if (url) {
      // ดึงชื่อ/รูป/ราคาจากหน้าสินค้า — ล้มเหลวก็สร้างต่อได้ (กรอกเองในหน้าโพสต์)
      try {
        const info = await sellerAPI.ingestUrl(url)
        Object.assign(data, {
          productName: data.productName || info.productName,
          productDescription: info.productDescription || null,
          productPrice: info.price,
          productImages: info.images,
        })
      } catch {
        toast.info(t('seller.create.ingestFailed'))
      }
    }
    if (!data.productName) data.productName = url
    const post = await sellerAPI.create(data)
    navigateTo(`/seller/${post.id}`)
  } catch (e) {
    toastError(e)
  } finally {
    creating.value = false
  }
}

// ===== delete =====
const toDelete = ref<SellerPost | null>(null)
const deleting = ref(false)
async function remove() {
  const target = toDelete.value
  if (!target) return
  deleting.value = true
  try {
    await sellerAPI.del(target.id)
    posts.value = posts.value.filter(p => p.id !== target.id)
    toast.success(t('seller.delete.deleted'))
    toDelete.value = null
  } catch (e) {
    toastError(e)
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page { padding: 32px 40px 48px; overflow-y: auto; height: 100%; }
.sl-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.eyebrow { margin-bottom: 6px; }
.sl-title { margin: 0; font-family: var(--font-display); font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-0); }
.sl-sub { margin: 6px 0 0; font-size: 13px; color: var(--text-2); max-width: 620px; }

.sl-steps {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;
  margin: 0 0 24px; padding: 0; list-style: none;
}
.sl-step {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 14px; border-radius: var(--radius-lg);
  border: 1px solid var(--border); background: var(--surface-soft);
}
.sl-step-icon {
  width: 34px; height: 34px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; background: var(--accent-bg); color: var(--accent-text);
}
.sl-step-title { margin: 0; font-size: 13.5px; font-weight: 700; color: var(--text-0); }
.sl-step-desc { margin: 2px 0 0; font-size: 12px; line-height: 1.5; color: var(--text-2); }

.sl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.sl-card {
  display: flex; gap: 12px; padding: 12px;
  border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface-soft);
  cursor: pointer; animation: fadeUp 0.24s var(--ease-out) both;
  transition: border-color 0.15s var(--ease-out), transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
.sl-card:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-elevated); }
.sl-card:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.sl-skeleton { height: 128px; cursor: default; animation: sl-pulse 1.4s ease-in-out infinite; }
@keyframes sl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.sl-thumb {
  position: relative; width: 78px; height: 104px; flex-shrink: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; border: 1px solid var(--border); background: var(--bg-2); color: var(--text-3);
}
.sl-thumb img, .sl-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.sl-thumb-badge {
  position: absolute; right: 4px; bottom: 4px; width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff;
}
.sl-card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.sl-card-top { display: flex; align-items: center; gap: 6px; }
.sl-card-title { flex: 1; margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-0); }
.sl-card-price { margin: 0; font-size: 12.5px; font-weight: 700; color: var(--accent-text); }
.sl-card-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.sl-card-foot { display: flex; align-items: center; gap: 5px; margin: auto 0 0; font-size: 11px; color: var(--text-3); }
.sl-more {
  display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
  border: none; border-radius: 8px; background: transparent; color: var(--text-3); cursor: pointer;
}
.sl-more:hover { background: var(--bg-hover); color: var(--text-0); }

.sl-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 64px 24px; border: 1px dashed var(--border); border-radius: var(--radius-lg);
  color: var(--text-3); text-align: center;
}
.sl-empty-title { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--text-1); }
.sl-empty-desc { margin: 0 0 14px; font-size: 12.5px; max-width: 420px; }

.sl-dialog { width: 600px; max-width: calc(100vw - 32px); }
.sl-dialog-icon {
  width: 38px; height: 38px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  border-radius: 11px; background: var(--accent-bg); color: var(--accent-text);
}
.sl-form .field { margin-bottom: 12px; }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.sl-foot-hint { margin-right: auto; align-self: center; font-size: 11.5px; color: var(--text-3); }
.sl-videos { display: flex; gap: 8px; overflow-x: auto; padding: 2px; }
.sl-video {
  display: flex; flex-direction: column; gap: 4px; width: 92px; flex-shrink: 0; padding: 4px;
  border: 2px solid var(--border); border-radius: 10px; background: var(--surface-raised);
  font: 600 11px var(--font-body); color: var(--text-1); cursor: pointer; text-align: left;
}
.sl-video video { width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 6px; background: var(--bg-2); }
.sl-video.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }

@media (max-width: 860px) {
  .page { padding: 20px 16px 32px; }
  .sl-head { flex-direction: column; align-items: stretch; }
  .sl-steps { grid-template-columns: 1fr; }
  .sl-grid { grid-template-columns: 1fr; }
}
</style>
