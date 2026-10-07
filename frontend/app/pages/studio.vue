<template>
  <div class="page page-enter">
    <!-- ===== Header (แท็บคลังสกิลมี hero ของตัวเอง) ===== -->
    <header v-if="tab !== 'skills'" class="ps-head">
      <div class="ps-head-copy">
        <p class="eyebrow">{{ t('productStudio.eyebrow') }}</p>
        <h1 class="ps-title">{{ t('productStudio.title') }}</h1>
        <p class="ps-sub">{{ t('productStudio.subtitle') }}</p>
      </div>
      <button class="btn btn-primary" type="button" @click="openCreate()">
        <Plus :size="15" :stroke-width="2.2" />
        {{ headerCreateLabel }}
      </button>
    </header>

    <!-- ===== Tabs ===== -->
    <div class="ps-tabs" role="tablist" :aria-label="t('productStudio.title')">
      <button type="button" role="tab" :aria-selected="tab === 'skills'" :class="['ps-tab', { on: tab === 'skills' }]" @click="switchTab('skills')">
        <LayoutGrid :size="14" :stroke-width="2" />
        {{ t('productStudio.tabs.skills') }}
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'projects'" :class="['ps-tab', { on: tab === 'projects' }]" @click="switchTab('projects')">
        <ShoppingBag :size="14" :stroke-width="2" />
        {{ t('productStudio.tabs.projects') }}
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'avatars'" :class="['ps-tab', { on: tab === 'avatars' }]" @click="switchTab('avatars')">
        <UserRound :size="14" :stroke-width="2" />
        {{ t('productStudio.tabs.avatars') }}
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'influencers'" :class="['ps-tab', { on: tab === 'influencers' }]" @click="switchTab('influencers')">
        <Sparkles :size="14" :stroke-width="2" />
        {{ t('productStudio.tabs.influencers') }}
      </button>
    </div>

    <!-- ===== Skills Library ===== -->
    <StudioSkillsLibrary
      v-if="tab === 'skills'"
      :templates="templates"
      :loading="optionsLoading"
      @use-template="useTemplate"
      @go-tab="switchTab"
    />

    <!-- ===== Projects ===== -->
    <template v-else-if="tab === 'projects'">
      <div v-if="loading" class="ps-grid" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ps-card skeleton-card">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
          <div class="skeleton-line w-80"></div>
        </div>
      </div>

      <div v-else-if="projects.length" class="ps-grid">
        <article
          v-for="(p, i) in projects"
          :key="p.id"
          class="ps-card"
          :style="{ animationDelay: `${i * 0.04}s` }"
          tabindex="0"
          role="button"
          :aria-label="t('productStudio.list.openAria', { title: p.title })"
          @click="open(p)"
          @keydown.enter.self.prevent="open(p)"
          @keydown.space.self.prevent="open(p)"
        >
          <div class="ps-card-top">
            <div class="ps-thumb" aria-hidden="true">
              <img v-if="p.productImages?.[0]" :src="p.productImages[0]" alt="" loading="lazy" />
              <Package v-else :size="16" :stroke-width="1.8" />
            </div>
            <div class="ps-card-heading">
              <h3 class="ps-card-title truncate">{{ p.title }}</h3>
              <p v-if="p.productName && p.productName !== p.title" class="ps-card-product truncate">{{ p.productName }}</p>
            </div>
            <AppMenu :open="menuId === p.id" placement="bottom-end" :min-width="120" @update:open="(v) => { menuId = v ? p.id : null }">
              <template #trigger>
                <button class="ps-more" type="button" :title="t('common.more')" :aria-label="t('common.more')" @click.stop>
                  <MoreHorizontal :size="16" :stroke-width="2" />
                </button>
              </template>
              <AppMenuItem danger @click="menuId = null; toDelete = p">{{ t('productStudio.list.delete') }}</AppMenuItem>
            </AppMenu>
          </div>
          <div class="ps-card-tags">
            <span class="tag" :class="statusTagClass(p.status)">
              <Loader2 v-if="p.status === 'scripting'" :size="10" class="animate-spin" />
              {{ t(`productStudio.status.${p.status}`) }}
            </span>
            <span v-if="isAutoRenderActive(p)" class="tag tag-info">
              <Loader2 :size="10" class="animate-spin" />
              {{ t(`productStudio.autoRender.stage.${p.autoRender.stage}`) }} · {{ autoRenderProgress(p).done }}/{{ autoRenderProgress(p).total }}
            </span>
            <span v-if="templateName(p.templateId)" class="tag">{{ templateName(p.templateId) }}</span>
            <span class="tag">{{ t(`productStudio.languages.${p.language}`) }}</span>
            <span class="tag">{{ t(`productStudio.platforms.${p.platform}`) }}</span>
          </div>
          <div class="ps-card-foot">
            <Clock :size="11" :stroke-width="1.8" />
            {{ fmtDate(p.updatedAt) }}
          </div>
        </article>
      </div>

      <div v-else class="ps-empty">
        <ShoppingBag :size="26" :stroke-width="1.5" />
        <p class="ps-empty-title">{{ t('productStudio.list.emptyTitle') }}</p>
        <p class="ps-empty-desc">{{ t('productStudio.list.emptyDesc') }}</p>
        <button class="btn btn-primary" type="button" @click="openCreate()">
          <Plus :size="15" :stroke-width="2.2" />
          {{ t('productStudio.list.new') }}
        </button>
      </div>
    </template>

    <!-- ===== Avatars ===== -->
    <template v-else-if="tab === 'avatars'">
      <div v-if="avatarsLoading" class="ps-grid" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ps-card skeleton-card">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
          <div class="skeleton-line w-80"></div>
        </div>
      </div>
      <div v-else-if="avatars.length" class="ps-grid ps-avatars-grid">
        <StudioAvatarCard
          v-for="(a, i) in avatars"
          :key="a.id"
          :avatar="a"
          :markets="markets"
          :style="{ animationDelay: `${i * 0.04}s` }"
          @updated="onAvatarUpdated"
          @delete="(a) => avatarToDelete = a"
        />
      </div>
      <div v-else class="ps-empty">
        <UserRound :size="26" :stroke-width="1.5" />
        <p class="ps-empty-title">{{ t('productStudio.avatars.emptyTitle') }}</p>
        <p class="ps-empty-desc">{{ t('productStudio.avatars.emptyDesc') }}</p>
        <button class="btn btn-primary" type="button" @click="openCreate()">
          <Plus :size="15" :stroke-width="2.2" />
          {{ t('productStudio.avatars.create') }}
        </button>
      </div>
    </template>

    <!-- ===== Influencers ===== -->
    <template v-else-if="tab === 'influencers'">
      <div v-if="influencersLoading" class="ps-grid" aria-hidden="true">
        <div v-for="i in 3" :key="i" class="ps-card skeleton-card">
          <div class="skeleton-line w-60"></div>
          <div class="skeleton-line w-40"></div>
          <div class="skeleton-line w-80"></div>
        </div>
      </div>
      <div v-else-if="influencers.length" class="ps-grid ps-influencers-grid">
        <StudioInfluencerCard
          v-for="(inf, i) in influencers"
          :key="inf.id"
          :influencer="inf"
          :markets="markets"
          :style="{ animationDelay: `${i * 0.04}s` }"
          @updated="onInfluencerUpdated"
          @delete="(inf) => influencerToDelete = inf"
          @open="(inf) => contentInfluencer = inf"
        />
      </div>
      <div v-else class="ps-empty">
        <Sparkles :size="26" :stroke-width="1.5" />
        <p class="ps-empty-title">{{ t('productStudio.influencers.emptyTitle') }}</p>
        <p class="ps-empty-desc">{{ t('productStudio.influencers.emptyDesc') }}</p>
        <button class="btn btn-primary" type="button" @click="openCreate()">
          <Plus :size="15" :stroke-width="2.2" />
          {{ t('productStudio.influencers.create') }}
        </button>
      </div>
    </template>

    <!-- ===== New dialog (project / avatar / influencer) ===== -->
    <div v-if="showCreate" class="overlay" @click.self="closeCreate">
      <div :class="['dialog', 'ps-dialog', { wide: tab === 'projects' }]" role="dialog" aria-modal="true" :aria-label="createTitle">
        <div class="dialog-head">
          <div class="ps-dialog-icon">
            <ShoppingBag v-if="tab === 'projects'" :size="18" :stroke-width="1.8" />
            <Sparkles v-else-if="tab === 'influencers'" :size="18" :stroke-width="1.8" />
            <UserRound v-else :size="18" :stroke-width="1.8" />
          </div>
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ createTitle }}</h2>
            <p class="dialog-desc">{{ tab === 'avatars' ? t('productStudio.avatars.createDesc') : tab === 'influencers' ? t('productStudio.influencers.createDesc') : t('productStudio.create.desc') }}</p>
          </div>
        </div>
        <form class="ps-create-form" @submit.prevent="create">
          <div class="dialog-body" :style="tab === 'projects' ? 'max-height: 62vh; overflow-y: auto;' : ''">
            <template v-if="tab === 'projects'">
              <label class="field">
                <span class="field-label">{{ t('productStudio.product.name') }} <span class="ps-required">*</span></span>
                <input v-model="projectForm.productName" class="input" :placeholder="t('productStudio.product.namePlaceholder')" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('productStudio.product.url') }}</span>
                <input v-model="projectForm.productUrl" class="input" type="url" :placeholder="t('productStudio.product.urlPlaceholder')" />
              </label>
              <div class="field">
                <span class="field-label">{{ t('productStudio.create.template') }}</span>
                <div class="ps-tpl-pick">
                  <StudioTemplateGallery
                    :templates="templates"
                    :selected-id="projectForm.templateId"
                    :platform-options="options?.platforms || []"
                    @select="tpl => projectForm.templateId = tpl.id"
                  />
                </div>
                <span v-if="createTemplate" class="field-hint">{{ t(`productStudio.templates.${projectForm.templateId}.description`) }}</span>
              </div>
            </template>
            <template v-else>
              <label class="field">
                <span class="field-label">{{ t('productStudio.avatars.name') }} <span class="ps-required">*</span></span>
                <input v-model="avatarForm.name" class="input" :placeholder="t('productStudio.avatars.namePlaceholder')" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('productStudio.avatars.description') }} <span class="ps-required">*</span></span>
                <textarea v-model="avatarForm.description" class="textarea" rows="3" :placeholder="t('productStudio.avatars.descriptionPlaceholder')" />
                <span class="field-hint">{{ t('productStudio.avatars.descriptionHint') }}</span>
              </label>
              <label class="field">
                <span class="field-label">{{ t('productStudio.avatars.locale') }}</span>
                <select v-model="avatarForm.locale" class="input">
                  <option value="">{{ t('productStudio.avatars.localeAny') }}</option>
                  <option v-for="m in markets" :key="m" :value="m">{{ t(`productStudio.markets.${m}`) }}</option>
                </select>
              </label>
              <div class="field">
                <span class="field-label">{{ t('productStudio.avatars.image') }}</span>
                <div class="ps-upload-row">
                  <input ref="avatarFileEl" type="file" accept="image/*" hidden @change="uploadAvatarImage" />
                  <button type="button" class="btn btn-sm" :disabled="avatarUploading" @click="avatarFileEl?.click()">
                    <Loader2 v-if="avatarUploading" :size="12" class="animate-spin" />
                    <ImagePlus v-else :size="12" :stroke-width="2" />
                    {{ avatarForm.imageUrl ? t('productStudio.avatars.changeImage') : t('productStudio.avatars.uploadImage') }}
                  </button>
                  <img v-if="avatarForm.imageUrl" :src="avatarForm.imageUrl" alt="" class="ps-upload-thumb" />
                  <span v-else class="field-hint">{{ t('productStudio.avatars.uploadHint') }}</span>
                </div>
              </div>
            </template>
            <template v-if="tab === 'influencers'">
              <label class="field">
                <span class="field-label">{{ t('productStudio.influencers.name') }} <span class="ps-required">*</span></span>
                <input v-model="influencerForm.name" class="input" :placeholder="t('productStudio.influencers.namePlaceholder')" />
              </label>
              <label class="field">
                <span class="field-label">{{ t('productStudio.influencers.appearance') }}</span>
                <textarea v-model="influencerForm.appearance" class="textarea" rows="2" :placeholder="t('productStudio.influencers.appearancePlaceholder')" />
                <span class="field-hint">{{ t('productStudio.influencers.appearanceHint') }}</span>
              </label>
              <label class="field">
                <span class="field-label">{{ t('productStudio.influencers.persona') }}</span>
                <textarea v-model="influencerForm.persona" class="textarea" rows="2" :placeholder="t('productStudio.influencers.personaPlaceholder')" />
                <span class="field-hint">{{ t('productStudio.influencers.personaHint') }}</span>
              </label>
              <div class="ps-create-row">
                <label class="field">
                  <span class="field-label">{{ t('productStudio.influencers.niche') }}</span>
                  <select v-model="influencerForm.niche" class="input">
                    <option value="">{{ t('productStudio.influencers.nicheAny') }}</option>
                    <option v-for="n in NICHES" :key="n" :value="n">{{ t(`productStudio.influencers.niches.${n}`) }}</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">{{ t('productStudio.influencers.locale') }}</span>
                  <select v-model="influencerForm.locale" class="input">
                    <option value="">{{ t('productStudio.influencers.localeAny') }}</option>
                    <option v-for="m in markets" :key="m" :value="m">{{ t(`productStudio.markets.${m}`) }}</option>
                  </select>
                </label>
              </div>
              <div class="field">
                <span class="field-label">{{ t('productStudio.influencers.image') }}</span>
                <div class="ps-upload-row">
                  <input ref="influencerFileEl" type="file" accept="image/*" hidden @change="uploadInfluencerImage" />
                  <button type="button" class="btn btn-sm" :disabled="influencerUploading" @click="influencerFileEl?.click()">
                    <Loader2 v-if="influencerUploading" :size="12" class="animate-spin" />
                    <ImagePlus v-else :size="12" :stroke-width="2" />
                    {{ influencerForm.imageUrl ? t('productStudio.influencers.changeImage') : t('productStudio.influencers.uploadImage') }}
                  </button>
                  <img v-if="influencerForm.imageUrl" :src="influencerForm.imageUrl" alt="" class="ps-upload-thumb" />
                  <span v-else class="field-hint">{{ t('productStudio.influencers.uploadHint') }}</span>
                </div>
              </div>
            </template>
          </div>
          <div class="dialog-foot">
            <span v-if="!canCreate" class="ps-foot-hint">{{ tab === 'avatars' ? t('productStudio.avatars.needFields') : tab === 'influencers' ? t('productStudio.influencers.needFields') : t('productStudio.create.needProduct') }}</span>
            <button type="button" class="btn" :disabled="creating" @click="closeCreate">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="creating || !canCreate">
              <Loader2 v-if="creating" :size="13" class="animate-spin" />
              {{ creating ? t('productStudio.creating') : t('productStudio.create.submit') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <ConfirmDialog
      :open="!!toDelete"
      :title="t('productStudio.delete.title')"
      :message="t('productStudio.delete.message', { title: toDelete?.title || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="deleting"
      @confirm="removeProject"
      @cancel="toDelete = null"
    />
    <ConfirmDialog
      :open="!!avatarToDelete"
      :title="t('productStudio.avatars.deleteTitle')"
      :message="t('productStudio.avatars.deleteMessage', { name: avatarToDelete?.name || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="avatarDeleting"
      @confirm="removeAvatar"
      @cancel="avatarToDelete = null"
    />
    <ConfirmDialog
      :open="!!influencerToDelete"
      :title="t('productStudio.influencers.deleteTitle')"
      :message="t('productStudio.influencers.deleteMessage', { name: influencerToDelete?.name || '' })"
      :confirm-text="t('common.delete')"
      :loading-text="t('common.deleteLoading')"
      :loading="influencerDeleting"
      @confirm="removeInfluencer"
      @cancel="influencerToDelete = null"
    />

    <StudioInfluencerContentDialog
      v-if="contentInfluencer"
      :influencer="contentInfluencer"
      :options="options"
      @close="contentInfluencer = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Clock, ImagePlus, LayoutGrid, Loader2, MoreHorizontal, Package, Plus, ShoppingBag, Sparkles, UserRound } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { studioAPI, uploadAPI, type StudioAvatar, type StudioInfluencer, type StudioProject, type StudioTemplate } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { isAutoRenderActive, autoRenderProgress, SCRIPT_POLL_INTERVAL_MS } from '~/utils/studioFlow'

type Tab = 'skills' | 'projects' | 'avatars' | 'influencers'
const TABS: Tab[] = ['skills', 'projects', 'avatars', 'influencers']
const isTab = (v: unknown): v is Tab => TABS.includes(v as Tab)

const NICHES = ['beauty', 'fashion', 'food', 'tech', 'fitness', 'lifestyle', 'gaming', 'travel', 'home', 'mom_baby'] as const

const { t, locale } = useI18n()
const route = useRoute()

const tab = ref<Tab>(isTab(route.query.tab) ? route.query.tab : 'skills')
function switchTab(v: Tab) {
  tab.value = v
}
watch(() => route.query.tab, (v) => { if (isTab(v)) tab.value = v })

// ===== data =====
const projects = ref<StudioProject[]>([])
const templates = ref<StudioTemplate[]>([])
const avatars = ref<StudioAvatar[]>([])
const influencers = ref<StudioInfluencer[]>([])
const options = ref<any>(null)
const markets = computed(() => (options.value?.markets || []).map((m: any) => m.id))
const loading = ref(true)
const optionsLoading = ref(true)
const avatarsLoading = ref(false)
const influencersLoading = ref(false)
const menuId = ref<number | null>(null)

const headerCreateLabel = computed(() => (
  tab.value === 'avatars' ? t('productStudio.avatars.create')
    : tab.value === 'influencers' ? t('productStudio.influencers.create')
      : t('productStudio.list.new')
))

const templateName = (id: string) => (templates.value.some(tpl => tpl.id === id) ? t(`productStudio.templates.${id}.name`) : id)

function statusTagClass(status: string) {
  if (status === 'failed') return 'tag-error'
  if (status === 'scripting') return 'tag-info'
  if (status === 'script_ready') return 'tag-success'
  return ''
}

function fmtDate(v?: string) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { dateStyle: 'medium' })
}

function open(p: StudioProject) {
  navigateTo(`/studio/${p.id}`)
}

// ===== create dialog (ใช้ร่วมสองแท็บ) =====
const showCreate = ref(false)
const creating = ref(false)
const projectForm = ref({ productName: '', productUrl: '', templateId: '' })
const avatarForm = ref({ name: '', description: '', locale: '', imageUrl: '' })
const avatarFileEl = ref<HTMLInputElement | null>(null)
const avatarUploading = ref(false)
const influencerForm = ref({ name: '', appearance: '', persona: '', niche: '', locale: '', imageUrl: '' })
const influencerFileEl = ref<HTMLInputElement | null>(null)
const influencerUploading = ref(false)

const createTitle = computed(() => (tab.value === 'avatars' ? t('productStudio.avatars.create')
  : tab.value === 'influencers' ? t('productStudio.influencers.create') : t('productStudio.create.title')))
const createTemplate = computed(() => templates.value.find(tpl => tpl.id === projectForm.value.templateId))
const canCreate = computed(() => tab.value === 'avatars'
  ? !!(avatarForm.value.name.trim() && avatarForm.value.description.trim())
  : tab.value === 'influencers'
    ? !!influencerForm.value.name.trim()
    : !!(projectForm.value.productName.trim() || projectForm.value.productUrl.trim()))

function openCreate(templateId?: string) {
  projectForm.value = { productName: '', productUrl: '', templateId: templateId || templates.value[0]?.id || '' }
  avatarForm.value = { name: '', description: '', locale: '', imageUrl: '' }
  influencerForm.value = { name: '', appearance: '', persona: '', niche: '', locale: '', imageUrl: '' }
  showCreate.value = true
}
// คลังสกิล → เลือกสกิลวิดีโอสินค้า = เปิดฟอร์มสร้างโปรเจกต์โดยเลือกเทมเพลตนั้นไว้แล้ว
function useTemplate(tpl: StudioTemplate) {
  tab.value = 'projects'
  openCreate(tpl.id)
}
function closeCreate() {
  if (!creating.value) showCreate.value = false
}

async function uploadAvatarImage(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || avatarUploading.value) return
  avatarUploading.value = true
  try {
    const res = await uploadAPI.image(file)
    avatarForm.value.imageUrl = res.url
  } catch (e) {
    toastError(e)
  } finally {
    avatarUploading.value = false
    if (avatarFileEl.value) avatarFileEl.value.value = ''
  }
}

async function uploadInfluencerImage(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file || influencerUploading.value) return
  influencerUploading.value = true
  try {
    const res = await uploadAPI.image(file)
    influencerForm.value.imageUrl = res.url
  } catch (e) {
    toastError(e)
  } finally {
    influencerUploading.value = false
    if (influencerFileEl.value) influencerFileEl.value.value = ''
  }
}

async function create() {
  if (!canCreate.value || creating.value) return
  creating.value = true
  try {
    if (tab.value === 'influencers') {
      const inf = await studioAPI.createInfluencer({
        name: influencerForm.value.name.trim(),
        appearance: influencerForm.value.appearance.trim(),
        persona: influencerForm.value.persona.trim(),
        ...(influencerForm.value.niche ? { niche: influencerForm.value.niche } : {}),
        ...(influencerForm.value.locale ? { locale: influencerForm.value.locale as any } : {}),
        ...(influencerForm.value.imageUrl ? { imageUrl: influencerForm.value.imageUrl } : {}),
      })
      toast.success(t('productStudio.influencers.created'))
      influencers.value = [inf, ...influencers.value]
    } else if (tab.value === 'avatars') {
      const a = await studioAPI.createAvatar({
        name: avatarForm.value.name.trim(),
        description: avatarForm.value.description.trim(),
        ...(avatarForm.value.locale ? { locale: avatarForm.value.locale as any } : {}),
        ...(avatarForm.value.imageUrl ? { imageUrl: avatarForm.value.imageUrl } : {}),
      })
      toast.success(t('productStudio.avatars.created'))
      avatars.value = [a, ...avatars.value]
    } else {
      const p = await studioAPI.create({
        productName: projectForm.value.productName.trim() || projectForm.value.productUrl.trim(),
        productUrl: projectForm.value.productUrl.trim() || null,
        templateId: projectForm.value.templateId,
      })
      toast.success(t('productStudio.create.created'))
      navigateTo(`/studio/${p.id}`)
      return
    }
    showCreate.value = false
  } catch (e) {
    toastError(e)
  } finally {
    creating.value = false
  }
}

// ===== delete =====
const toDelete = ref<StudioProject | null>(null)
const deleting = ref(false)
async function removeProject() {
  if (!toDelete.value) return
  deleting.value = true
  try {
    await studioAPI.del(toDelete.value.id)
    toast.success(t('productStudio.delete.deleted'))
    toDelete.value = null
    await load(true)
  } catch (e) {
    toastError(e)
  } finally {
    deleting.value = false
  }
}
const avatarToDelete = ref<StudioAvatar | null>(null)
const avatarDeleting = ref(false)
async function removeAvatar() {
  const target = avatarToDelete.value
  if (!target) return
  avatarDeleting.value = true
  try {
    await studioAPI.deleteAvatar(target.id)
    toast.success(t('productStudio.avatars.deleted'))
    avatarToDelete.value = null
    avatars.value = avatars.value.filter(a => a.id !== target.id)
  } catch (e) {
    toastError(e)
  } finally {
    avatarDeleting.value = false
  }
}

function onAvatarUpdated(a: StudioAvatar) {
  avatars.value = avatars.value.map(x => x.id === a.id ? a : x)
}

const influencerToDelete = ref<StudioInfluencer | null>(null)
const influencerDeleting = ref(false)
async function removeInfluencer() {
  const target = influencerToDelete.value
  if (!target) return
  influencerDeleting.value = true
  try {
    await studioAPI.deleteInfluencer(target.id)
    toast.success(t('productStudio.influencers.deleted'))
    influencerToDelete.value = null
    influencers.value = influencers.value.filter(x => x.id !== target.id)
  } catch (e) {
    toastError(e)
  } finally {
    influencerDeleting.value = false
  }
}

const contentInfluencer = ref<StudioInfluencer | null>(null)
function onInfluencerUpdated(inf: StudioInfluencer) {
  influencers.value = influencers.value.map(x => x.id === inf.id ? inf : x)
  if (contentInfluencer.value?.id === inf.id) contentInfluencer.value = inf
}

// ===== load + poll (โปรเจกต์ scripting / avatar กำลังสร้างรูป) =====
let pollTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  // load ที่ค้างอยู่ตอนออกจากหน้าจะเรียกมาที่นี่อีก — ห้ามตั้ง timer ใหม่หลัง unmount
  if (disposed) { pollTimer = null; return }
  const busyProjects = tab.value === 'projects' && projects.value.some(p => p.status === 'scripting' || isAutoRenderActive(p))
  const busyAvatars = tab.value === 'avatars' && avatars.value.some(a => a.imageStatus === 'processing')
  const busyInfluencers = tab.value === 'influencers' && influencers.value.some(a => a.imageStatus === 'processing')
  pollTimer = (busyProjects || busyAvatars || busyInfluencers) ? setTimeout(() => load(true), SCRIPT_POLL_INTERVAL_MS) : null
}

async function load(silent = false) {
  if (tab.value === 'influencers') {
    if (!silent) influencersLoading.value = true
    try {
      influencers.value = await studioAPI.influencers() || []
    } catch (e) {
      if (!silent) toastError(e)
    } finally {
      influencersLoading.value = false
      schedulePoll()
    }
    return
  }
  if (tab.value === 'avatars') {
    if (!silent) avatarsLoading.value = true
    try {
      avatars.value = await studioAPI.avatars() || []
    } catch (e) {
      if (!silent) toastError(e)
    } finally {
      avatarsLoading.value = false
      schedulePoll()
    }
    return
  }
  if (!silent) loading.value = true
  try {
    projects.value = await studioAPI.list() || []
  } catch (e) {
    if (!silent) toastError(e)
  } finally {
    loading.value = false
    schedulePoll()
  }
}

async function loadOptions() {
  try {
    const [opts, tpls] = await Promise.all([
      studioAPI.options(),
      studioAPI.templates(),
    ])
    options.value = opts
    templates.value = tpls || []
  } catch {
    // options/templates โหลดไม่ได้ไม่บล็อกหน้า — ฟอร์มแก้ค่าใน workspace แทน
  } finally {
    optionsLoading.value = false
  }
}

watch(tab, () => {
  if (tab.value === 'avatars' && !avatars.value.length) load()
  else if (tab.value === 'influencers' && !influencers.value.length) load()
  else schedulePoll()
})

onMounted(() => {
  load()
  loadOptions()
})
onBeforeUnmount(() => {
  disposed = true
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<style scoped>
.page {
  padding: 32px 40px 48px;
  overflow-y: auto;
  height: 100%;
}

/* === Header === */
.ps-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.eyebrow { margin-bottom: 6px; }
.ps-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-0);
}
.ps-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-2);
  max-width: 560px;
}

/* === Tabs === */
.ps-tabs { display: flex; gap: 6px; margin-bottom: 20px; overflow-x: auto; padding: 3px; margin-left: -3px; margin-right: -3px; scrollbar-width: none; }
.ps-tabs::-webkit-scrollbar { display: none; }
.ps-tab {
  display: inline-flex; align-items: center; gap: 6px;
  flex-shrink: 0; white-space: nowrap;
  padding: 8px 16px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-raised);
  font: 600 13px var(--font-body); color: var(--text-2); cursor: pointer;
  transition: border-color 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.ps-tab:hover { border-color: var(--border-strong); color: var(--text-0); }
.ps-tab.on { border-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); }
.ps-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }

/* === Grid & cards === */
.ps-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.ps-avatars-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.ps-influencers-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.ps-create-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ps-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-soft);
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), transform 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out);
  animation: fadeUp 0.24s var(--ease-out) both;
}
.ps-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevated);
}
.ps-card:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--button-focus);
}
.ps-card-top { display: flex; align-items: center; gap: 10px; }
.ps-thumb {
  width: 40px; height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; overflow: hidden;
  border: 1px solid var(--border); background: var(--bg-2); color: var(--text-3);
}
.ps-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-card-heading { flex: 1; min-width: 0; }
.ps-card-title { margin: 0; font-size: 14.5px; font-weight: 700; color: var(--text-0); }
.ps-card-product { margin: 2px 0 0; font-size: 11.5px; color: var(--text-3); }
.ps-more {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  border: none; border-radius: 8px; background: transparent;
  color: var(--text-3); cursor: pointer;
}
.ps-more:hover { background: var(--bg-hover); color: var(--text-0); }
.ps-more:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.ps-card-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-card-tags .tag { display: inline-flex; align-items: center; gap: 4px; }
.ps-card-foot {
  display: flex; align-items: center; gap: 5px;
  margin-top: auto; font-size: 11px; color: var(--text-3);
}

/* === Empty === */
.ps-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 72px 24px;
  border: 1px dashed var(--border); border-radius: var(--radius-lg);
  color: var(--text-3); text-align: center;
}
.ps-empty-title { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--text-1); }
.ps-empty-desc { margin: 0 0 14px; font-size: 12.5px; max-width: 380px; }

/* === Create dialog === */
.ps-dialog { width: 560px; max-width: calc(100vw - 32px); }
.ps-dialog.wide { width: 760px; }
.ps-tpl-pick { max-height: 340px; overflow-y: auto; padding: 2px; margin: -2px; }
.ps-create-form { display: flex; flex-direction: column; min-height: 0; }
.ps-create-form .field { margin-bottom: 12px; }
.ps-create-form .textarea { resize: vertical; }
.ps-dialog-icon {
  width: 38px; height: 38px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 11px; background: var(--accent-bg); color: var(--accent-text);
}
.ps-foot-hint { margin-right: auto; align-self: center; font-size: 11.5px; color: var(--text-3); }
.ps-upload-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ps-upload-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); }
.ps-required { color: var(--accent-text); }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }

/* === Skeleton === */
.skeleton-card { cursor: default; animation: none; }
.skeleton-line {
  height: 12px; border-radius: 6px;
  background: var(--bg-hover);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.skeleton-line.w-40 { width: 40%; }
.skeleton-line.w-60 { width: 60%; }
.skeleton-line.w-80 { width: 80%; }
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (max-width: 860px) {
  .page { padding: 20px 16px 32px; }
  .ps-head { flex-direction: column; align-items: stretch; }
}
</style>
