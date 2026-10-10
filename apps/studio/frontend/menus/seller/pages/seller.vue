<template>
  <div class="page page-enter">
    <!-- ===== Hero (แนวเดียวกับคลังสกิล) ===== -->
    <section class="sh-hero">
      <MenuHeroArt :src="menuArt('hero-seller')" />
      <p class="sh-kicker">
        <Store :size="13" :stroke-width="2" />
        {{ t('seller.home.kicker') }}
      </p>
      <h1 class="sh-title">{{ t('seller.title') }}</h1>
      <p class="sh-sub">{{ t('seller.home.subtitle') }}</p>
      <div class="sh-hero-row">
        <label class="sh-search">
          <Search :size="16" :stroke-width="2" aria-hidden="true" />
          <input v-model="query" type="search" :placeholder="t('seller.home.searchPlaceholder')" :aria-label="t('seller.home.searchPlaceholder')" />
          <button v-if="query" type="button" class="sh-search-clear" :aria-label="t('productStudio.library.clearSearch')" @click="query = ''">
            <X :size="14" :stroke-width="2" />
          </button>
        </label>
        <button class="btn btn-primary sh-new" type="button" @click="openCreate()">
          <Plus :size="15" :stroke-width="2.2" />
          {{ t('seller.list.new') }}
        </button>
      </div>
    </section>

    <!-- ===== สกิล: เลือกแล้วเริ่มโพสต์ขายพร้อมวิดีโอจากสกิลนั้น ===== -->
    <section class="sh-section">
      <div class="sh-section-head">
        <h2 class="sh-section-title">{{ t('seller.home.skillsTitle') }}</h2>
        <p class="sh-section-desc">{{ t('seller.home.skillsDesc') }}</p>
      </div>
      <div class="sh-chips" role="group" :aria-label="t('productStudio.library.categoriesAria')">
        <button
          v-for="c in chips" :key="c.id" type="button"
          :class="['sh-chip', { on: category === c.id }]" :aria-pressed="category === c.id"
          @click="category = c.id"
        >
          <LayoutGrid v-if="c.id === 'all'" :size="13" :stroke-width="2" />
          {{ c.label }}
          <span class="sh-chip-count">{{ c.count }}</span>
        </button>
      </div>
      <div v-if="templatesLoading" class="sh-skills" aria-hidden="true">
        <div v-for="i in 5" :key="i" class="sh-skill-skeleton"></div>
      </div>
      <div v-else-if="filteredSkills.length" class="sh-skills">
        <StudioSkillCard
          v-for="(tpl, i) in filteredSkills" :key="tpl.id"
          :title="skillTitle(tpl.id)" :description="t(`productStudio.templates.${tpl.id}.description`)"
          :art="templateArt(tpl.id)" :art-index="templates.indexOf(tpl)" :icon="ShoppingBag"
          :badge="t(`productStudio.categories.${tpl.category}`)"
          :duration="t('productStudio.templates.seconds', { n: skillSeconds(tpl) })"
          :tags="tpl.avatarMode === 'required' ? [t('productStudio.library.tagAvatar')] : []"
          :style="{ animationDelay: `${Math.min(i, 8) * 0.03}s` }"
          @use="useSkill(tpl)"
        />
      </div>
      <p v-else-if="templates.length" class="sh-none">{{ t('productStudio.library.emptyTitle') }}</p>
    </section>

    <!-- ===== โพสต์ของฉัน ===== -->
    <section v-if="loading || posts.length" class="sh-section">
      <div class="sh-section-head">
        <h2 class="sh-section-title">{{ t('seller.home.postsTitle') }} <span v-if="posts.length" class="sh-count">{{ posts.length }}</span></h2>
      </div>
      <div v-if="loading" class="sl-grid" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="sl-card sl-skeleton"></div>
      </div>
      <div v-else-if="filteredPosts.length" class="sl-grid">
        <article
          v-for="(p, i) in filteredPosts" :key="p.id" class="sl-card" tabindex="0" role="button"
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
              <span v-if="p.videoJob?.running" class="tag tag-info"><Loader2 :size="10" class="animate-spin" /> {{ t('seller.skillVideo.badge') }}</span>
              <span class="tag" :class="p.status === 'ready' ? 'tag-success' : p.status === 'failed' ? 'tag-error' : ''">{{ t(`seller.status.${p.status}`) }}</span>
              <span v-for="ch in p.channels" :key="ch" class="tag">{{ t(`seller.channels.${ch}`) }}</span>
            </div>
            <p class="sl-card-foot"><Clock :size="11" :stroke-width="1.8" /> {{ fmtDate(p.updatedAt) }}</p>
          </div>
        </article>
      </div>
      <p v-else class="sh-none">{{ t('seller.home.noPostMatch') }}</p>
    </section>

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
            <p v-if="skill" class="sl-skill">
              <LayoutGrid :size="13" :stroke-width="2" />
              {{ t('seller.create.withSkill', { skill: skillName }) }}
            </p>
            <label class="field">
              <span class="field-label">{{ t('seller.product.url') }}</span>
              <input v-model="form.productUrl" class="input" type="url" :placeholder="t('seller.product.urlPlaceholder')" />
              <span class="field-hint">{{ t('seller.create.urlHint') }}</span>
            </label>
            <label class="field">
              <span class="field-label">{{ t('seller.product.name') }}</span>
              <input v-model="form.productName" class="input" :placeholder="t('seller.product.namePlaceholder')" />
            </label>

            <div v-if="studioVideos.length && !skill" class="field">
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
import { useRoute } from 'vue-router'
import { Clock, Film, LayoutGrid, Loader2, MoreHorizontal, Package, Plus, Search, ShoppingBag, Store, X } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { sellerAPI, studioAPI, type SellerPost, type SellerStudioVideo, type StudioTemplate } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { menuArt, templateArt } from '~/utils/studioArt'
import MenuHeroArt from '~/components/MenuHeroArt.vue'
import { beatBars } from '../../product-studio/utils/studioFlow'

const { t, te, locale } = useI18n()
const route = useRoute()

// มาจากคลังสกิล (/seller?skill=<templateId>) → เปิดฟอร์มสร้างโพสต์ แล้วพาไปขั้นทำวิดีโอด้วยสกิลนั้น
const skill = ref(typeof route.query.skill === 'string' ? route.query.skill : '')
const skillName = computed(() => (te(`productStudio.templates.${skill.value}.name`) ? t(`productStudio.templates.${skill.value}.name`) : skill.value))

// ===== คลังสกิลบนหน้าแรก =====
const templates = ref<StudioTemplate[]>([])
const templatesLoading = ref(true)
const query = ref('')
const category = ref('all')
const q = computed(() => query.value.trim().toLowerCase())
const matches = (...texts: unknown[]) => !q.value || texts.some(x => String(x || '').toLowerCase().includes(q.value))
const skillTitle = (id: string) => t(`productStudio.templates.${id}.name`)
const skillSeconds = (tpl: StudioTemplate) => beatBars(tpl).reduce((sum: number, b: { seconds: number }) => sum + b.seconds, 0)
const searchedSkills = computed(() => templates.value.filter(tpl => matches(
  skillTitle(tpl.id), t(`productStudio.templates.${tpl.id}.description`), t(`productStudio.categories.${tpl.category}`),
)))
const filteredSkills = computed(() => searchedSkills.value.filter(tpl => category.value === 'all' || tpl.category === category.value))
const chips = computed(() => [
  { id: 'all', label: t('productStudio.library.all'), count: searchedSkills.value.length },
  ...[...new Set(templates.value.map(tpl => tpl.category))].map(c => ({
    id: c, label: t(`productStudio.categories.${c}`), count: searchedSkills.value.filter(tpl => tpl.category === c).length,
  })),
])

/** เลือกสกิล → ฟอร์มสร้างโพสต์ (จำสกิลไว้) → หน้าโพสต์ที่เลือกสกิลนั้นในขั้นวิดีโอ */
function useSkill(tpl: StudioTemplate) {
  skill.value = tpl.id
  openCreate()
}

const posts = ref<SellerPost[]>([])
const loading = ref(true)
const menuId = ref<number | null>(null)

function fmtDate(v?: string) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium' })
}

const filteredPosts = computed(() => posts.value.filter(p => matches(p.title, p.productName, p.productPrice)))

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
  if (creating.value) return
  showCreate.value = false
  skill.value = ''
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
    navigateTo(skill.value ? { path: `/seller/${post.id}`, query: { skill: skill.value }, hash: '#skill-video' } : `/seller/${post.id}`)
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

onMounted(() => {
  load()
  studioAPI.templates()
    .then((tpls) => { templates.value = tpls || [] })
    .catch(toastError)
    .finally(() => { templatesLoading.value = false })
  if (skill.value) openCreate()
})
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 24px; padding: 32px 40px 48px; overflow-y: auto; height: 100%; }
.page > * { flex-shrink: 0; } /* หน้าเป็น flex column สูงคงที่ — ห้ามบีบ hero/section */

/* === Hero (แนวเดียวกับคลังสกิล) === */
.sh-hero {
  position: relative; overflow: hidden; isolation: isolate;
  display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 10px;
  min-height: 300px; justify-content: center;
  padding: 44px 40px 36px;
  border-radius: var(--radius-xl); border: 1px solid var(--border);
  background:
    radial-gradient(ellipse at 15% 0%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 55%),
    radial-gradient(ellipse at 90% 100%, color-mix(in srgb, #ee4d2d 16%, transparent), transparent 55%),
    var(--surface-soft);
}
.sh-kicker {
  display: inline-flex; align-items: center; gap: 6px; margin: 0;
  padding: 4px 12px; border-radius: 999px;
  font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  background: var(--accent-bg); color: var(--accent-text);
}
.sh-title {
  margin: 0;
  font-family: var(--font-display); font-size: clamp(28px, 4.5vw, 44px); font-weight: 800;
  letter-spacing: -0.02em; line-height: 1.15;
  background: var(--accent-gradient); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.sh-sub { margin: 0; max-width: 600px; font-size: 14px; line-height: 1.6; color: var(--text-2); }
.sh-hero-row { display: flex; align-items: center; gap: 10px; width: min(640px, 100%); margin-top: 8px; }
.sh-search {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  height: 46px; padding: 0 8px 0 16px;
  border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface-raised); color: var(--text-3);
  transition: border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
}
.sh-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.sh-search input {
  flex: 1; min-width: 0; height: 100%;
  border: none; outline: none; background: transparent;
  font: 500 14px var(--font-body); color: var(--text-0);
}
.sh-search input::placeholder { color: var(--text-3); }
.sh-search input::-webkit-search-cancel-button { display: none; }
.sh-search-clear {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: none; border-radius: 50%;
  background: transparent; color: var(--text-3); cursor: pointer;
}
.sh-search-clear:hover { background: var(--bg-hover); color: var(--text-0); }
.sh-new { height: 46px; padding: 0 20px; border-radius: 999px; white-space: nowrap; }

/* === Sections === */
.sh-section { display: flex; flex-direction: column; gap: 14px; }
.sh-section-head { display: flex; flex-direction: column; gap: 2px; }
.sh-section-title { display: flex; align-items: center; gap: 8px; margin: 0; font-family: var(--font-display); font-size: 19px; font-weight: 800; color: var(--text-0); }
.sh-section-desc { margin: 0; font-size: 12.5px; color: var(--text-2); }
.sh-count {
  min-width: 22px; padding: 0 7px; border-radius: 999px; text-align: center;
  font: 700 11.5px/20px var(--font-body); background: var(--bg-hover); color: var(--text-2);
}
.sh-chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px; scrollbar-width: none; }
.sh-chips::-webkit-scrollbar { display: none; }
.sh-chip {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; padding: 0 14px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-raised);
  font: 600 13px var(--font-body); color: var(--text-1); cursor: pointer; white-space: nowrap;
  transition: border-color 0.15s var(--ease-out), background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.sh-chip:hover { border-color: var(--border-strong); color: var(--text-0); }
.sh-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.sh-chip.on { border-color: transparent; background: var(--text-0); color: var(--bg-base); }
.sh-chip-count {
  min-width: 20px; padding: 0 6px; border-radius: 999px;
  font-size: 11px; line-height: 18px; text-align: center;
  background: var(--bg-hover); color: var(--text-2);
}
.sh-chip.on .sh-chip-count { background: color-mix(in srgb, var(--bg-base) 22%, transparent); color: var(--bg-base); }
.sh-skills { display: grid; gap: 22px 16px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
.sh-skill-skeleton { aspect-ratio: 3 / 4; border-radius: var(--radius-xl); background: var(--bg-hover); animation: sl-pulse 1.4s ease-in-out infinite; }
.sh-none { margin: 0; padding: 20px 0; font-size: 12.5px; color: var(--text-3); }

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


.sl-skill {
  display: flex; align-items: center; gap: 6px; margin: 0 0 12px; padding: 8px 12px;
  border-radius: 10px; background: var(--accent-bg); color: var(--accent-text); font-size: 12.5px; font-weight: 600;
}
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
  .sh-hero { padding: 32px 16px 26px; }
  .sh-hero-row { flex-direction: column; align-items: stretch; }
  .sh-search { flex: none; }
  .sh-skills { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 12px; }
  .sl-grid { grid-template-columns: 1fr; }
}
</style>
