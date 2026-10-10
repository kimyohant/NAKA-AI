<template>
  <div class="sv">
    <!-- ===== งานที่กำลังทำ / ผลล่าสุด ===== -->
    <div v-if="job && (job.running || job.stage === 'failed' || job.stage === 'cancelled')" :class="['sv-job', { bad: !job.running }]" role="status">
      <div class="sv-job-head">
        <Loader2 v-if="job.running" :size="15" class="animate-spin" />
        <TriangleAlert v-else :size="15" :stroke-width="2" />
        <p class="sv-job-title">
          {{ job.running ? t('seller.skillVideo.making', { skill: skillName(job.templateId) }) : t(`seller.skillVideo.stage.${job.stage}`) }}
        </p>
        <NuxtLink :to="`/studio/${job.projectId}`" class="sv-job-link">
          {{ t('seller.skillVideo.openStudio') }} <ExternalLink :size="11" :stroke-width="2" />
        </NuxtLink>
      </div>
      <ol v-if="job.running" class="sv-steps">
        <li v-for="(st, i) in STEPS" :key="st" :class="{ on: i === stepIndex, done: i < stepIndex }">
          <span class="sv-step-dot"><Check v-if="i < stepIndex" :size="10" :stroke-width="3" /></span>
          {{ t(`seller.skillVideo.stage.${st}`) }}
          <span v-if="i === stepIndex && job.total" class="mono sv-step-count">{{ job.done }}/{{ job.total }}</span>
        </li>
      </ol>
      <p v-if="job.running" class="field-hint">{{ t('seller.skillVideo.runningHint') }}</p>
      <p v-else-if="job.error" class="sv-job-error">{{ errorText(job.error) }}</p>
      <div class="sv-job-actions">
        <button v-if="job.running" type="button" class="btn btn-sm" :disabled="stopping" @click="stop">
          <Loader2 v-if="stopping" :size="12" class="animate-spin" />
          <Square v-else :size="12" :stroke-width="2.2" />
          {{ t('seller.skillVideo.stop') }}
        </button>
      </div>
    </div>

    <template v-if="!job?.running">
      <div class="sv-head">
        <p class="sv-title"><LayoutGrid :size="14" :stroke-width="2" /> {{ t('seller.skillVideo.title') }}</p>
        <div class="sv-chips" role="group" :aria-label="t('productStudio.library.categoriesAria')">
          <button
            v-for="c in categories" :key="c" type="button"
            :class="['sv-chip', { on: category === c }]" :aria-pressed="category === c"
            @click="category = c"
          >{{ c === 'all' ? t('productStudio.library.all') : t(`productStudio.categories.${c}`) }}</button>
        </div>
      </div>

      <div v-if="loadingTemplates" class="sv-grid" aria-hidden="true">
        <div v-for="i in 4" :key="i" class="sv-skeleton"></div>
      </div>
      <div v-else class="sv-grid">
        <div v-for="(tpl, i) in filtered" :key="tpl.id" :class="['sv-pick', { on: selectedId === tpl.id }]">
          <StudioSkillCard
            :title="skillName(tpl.id)"
            :description="t(`productStudio.templates.${tpl.id}.description`)"
            :art="templateArt(tpl.id)" :art-index="templates.indexOf(tpl)" :icon="ShoppingBag"
            :badge="t(`productStudio.categories.${tpl.category}`)"
            :duration="t('productStudio.templates.seconds', { n: seconds(tpl) })"
            :tags="tpl.avatarMode === 'required' ? [t('productStudio.library.tagAvatar')] : []"
            :style="{ animationDelay: `${Math.min(i, 8) * 0.03}s` }"
            @use="select(tpl)"
          />
          <span v-if="selectedId === tpl.id" class="sv-pick-check" aria-hidden="true"><Check :size="13" :stroke-width="3" /></span>
        </div>
      </div>

      <!-- ===== สกิลที่เลือก ===== -->
      <div v-if="selected" ref="panel" class="sv-panel">
        <div class="sv-panel-copy">
          <p class="sv-panel-title">{{ skillName(selected.id) }}</p>
          <p class="field-hint">{{ t('seller.skillVideo.selectedHint', { n: seconds(selected) }) }}</p>
        </div>
        <label v-if="selected.avatarMode !== 'none' && selected.avatarMode !== 'hands'" class="field">
          <span class="field-label">
            {{ t('seller.skillVideo.presenter') }}
            <span v-if="selected.avatarMode === 'required'" class="sv-req">*</span>
          </span>
          <select v-model="presenter" class="input">
            <option value="">{{ selected.avatarMode === 'required' ? t('seller.skillVideo.presenterPick') : t('seller.skillVideo.presenterNone') }}</option>
            <optgroup v-if="influencers.length" :label="t('productStudio.tabs.influencers')">
              <option v-for="inf in influencers" :key="`i${inf.id}`" :value="`i:${inf.id}`">{{ inf.name }}</option>
            </optgroup>
            <optgroup v-if="avatars.length" :label="t('productStudio.tabs.avatars')">
              <option v-for="a in avatars" :key="`a${a.id}`" :value="`a:${a.id}`">{{ a.name }}</option>
            </optgroup>
          </select>
          <span v-if="selected.avatarMode === 'required' && !avatars.length && !influencers.length" class="field-hint">
            {{ t('seller.skillVideo.noPresenter') }}
            <NuxtLink to="/studio?tab=influencers" class="sv-inline-link">{{ t('seller.skillVideo.createPresenter') }}</NuxtLink>
          </span>
        </label>
        <div class="sv-panel-actions">
          <span v-if="blockReason" class="field-hint">{{ blockReason }}</span>
          <button type="button" class="btn btn-primary" :disabled="starting || !!blockReason" @click="start">
            <Loader2 v-if="starting" :size="14" class="animate-spin" />
            <Wand2 v-else :size="14" :stroke-width="2" />
            {{ t('seller.skillVideo.make') }}
          </button>
        </div>
        <p class="field-hint">{{ t('seller.skillVideo.costHint') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, LayoutGrid, Loader2, ShoppingBag, Square, TriangleAlert, Wand2 } from 'lucide-vue-next'
import { sellerAPI, studioAPI, type SellerPost, type StudioAvatar, type StudioInfluencer, type StudioTemplate } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { templateArt } from '~/utils/studioArt'
import { beatBars } from '../../product-studio/utils/studioFlow'

/**
 * SellerSkillVideo — ขั้น "วิดีโอ" ของ AI นักขาย ที่รวมคลังสกิลไว้ในตัว:
 * เลือกสกิล (= เทมเพลต Product Studio) → backend สร้างโปรเจกต์จากสินค้าของโพสต์ เขียนบท → render → รวมคลิป
 * แล้วแนบวิดีโอเข้าโพสต์เอง (หน้าแม่ poll ระหว่าง videoJob.running)
 */
const props = defineProps<{
  post: SellerPost
  /** สกิลที่ส่งมาจากหน้าคลังสกิล (?skill=) */
  initialSkill?: string
  /** เหตุผลที่ยังทำวิดีโอไม่ได้ (เช่น ยังไม่มีชื่อสินค้า) */
  blocked?: string
  /** บันทึกร่างของหน้าแม่ก่อนเริ่ม (ให้ backend ใช้ข้อมูลสินค้าล่าสุด) */
  beforeStart?: () => Promise<void>
}>()
const emit = defineEmits<{ (e: 'updated', post: SellerPost): void }>()
const { t, te } = useI18n()

const STEPS = ['scripting', 'keyframes', 'videos', 'merging'] as const
const job = computed(() => props.post.videoJob)
const stepIndex = computed(() => Math.max(0, STEPS.indexOf((job.value?.stage || 'scripting') as typeof STEPS[number])))

const templates = ref<StudioTemplate[]>([])
const loadingTemplates = ref(true)
const avatars = ref<StudioAvatar[]>([])
const influencers = ref<StudioInfluencer[]>([])
const category = ref('all')
const categories = computed(() => ['all', ...new Set(templates.value.map(tpl => tpl.category))])
const filtered = computed(() => templates.value.filter(tpl => category.value === 'all' || tpl.category === category.value))

const selectedId = ref('')
const selected = computed(() => templates.value.find(tpl => tpl.id === selectedId.value) || null)
const presenter = ref('')
const panel = ref<HTMLElement | null>(null)

const skillName = (id: string) => (te(`productStudio.templates.${id}.name`) ? t(`productStudio.templates.${id}.name`) : id)
const seconds = (tpl: StudioTemplate) => beatBars(tpl).reduce((s: number, b: { seconds: number }) => s + b.seconds, 0)

/** "E_CODE: message" → ข้อความแปลของ errors.codes (ไม่มีคำแปล = ข้อความเดิม) */
function errorText(raw: string) {
  const m = /^(E_[A-Z0-9_]+):?\s*(.*)$/s.exec(raw)
  if (m && te(`errors.codes.${m[1]}`)) return t(`errors.codes.${m[1]}`)
  return m ? (m[2] || m[1]) : raw
}

const blockReason = computed(() => {
  if (props.blocked) return props.blocked
  if (selected.value?.avatarMode === 'required' && !presenter.value) return t('seller.skillVideo.needPresenter')
  return ''
})

function select(tpl: StudioTemplate) {
  selectedId.value = tpl.id
  presenter.value = ''
  nextTick(() => panel.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
}

const starting = ref(false)
async function start() {
  if (!selected.value || starting.value || blockReason.value) return
  starting.value = true
  try {
    await props.beforeStart?.()
    const [kind, id] = presenter.value.split(':')
    const post = await sellerAPI.makeVideo(props.post.id, {
      templateId: selected.value.id,
      avatarId: kind === 'a' ? Number(id) : null,
      influencerId: kind === 'i' ? Number(id) : null,
    })
    emit('updated', post)
  } catch (e) {
    toastError(e)
  } finally {
    starting.value = false
  }
}

const stopping = ref(false)
async function stop() {
  stopping.value = true
  try {
    emit('updated', await sellerAPI.stopVideo(props.post.id))
  } catch (e) {
    toastError(e)
  } finally {
    stopping.value = false
  }
}

watch(() => props.initialSkill, (id) => {
  if (id && templates.value.some(tpl => tpl.id === id)) select(templates.value.find(tpl => tpl.id === id)!)
})

onMounted(async () => {
  try {
    const [tpls, avs, infs] = await Promise.all([
      studioAPI.templates(),
      studioAPI.avatars().catch(() => [] as StudioAvatar[]),
      studioAPI.influencers().catch(() => [] as StudioInfluencer[]),
    ])
    templates.value = tpls || []
    avatars.value = (avs || []).filter(a => a.imageStatus === 'completed')
    influencers.value = (infs || []).filter(inf => inf.imageStatus === 'completed')
    const init = props.initialSkill && templates.value.find(tpl => tpl.id === props.initialSkill)
    if (init) select(init)
  } catch (e) {
    toastError(e)
  } finally {
    loadingTemplates.value = false
  }
})
</script>

<style scoped>
.sv { display: flex; flex-direction: column; gap: 12px; }
.sv-head { display: flex; flex-direction: column; gap: 8px; }
.sv-title { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12.5px; font-weight: 700; color: var(--text-1); }
.sv-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px; }
.sv-chip {
  flex-shrink: 0; height: 30px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface-raised);
  font: 600 12px var(--font-body); color: var(--text-1); cursor: pointer; white-space: nowrap;
}
.sv-chip.on { border-color: transparent; background: var(--text-0); color: var(--bg-base); }
.sv-chip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.sv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px 12px; }
.sv-skeleton { aspect-ratio: 3 / 4; border-radius: var(--radius-xl); background: var(--bg-hover); }
.sv-pick { position: relative; border-radius: var(--radius-xl); }
.sv-pick :deep(.sk-title) { font-size: 13.5px; }
.sv-pick :deep(.sk-desc) { font-size: 11.5px; }
.sv-pick.on :deep(.sk-media) { box-shadow: 0 0 0 3px var(--accent); }
.sv-pick-check {
  position: absolute; top: 8px; right: 8px; z-index: 2; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--accent-gradient); color: #fff; pointer-events: none;
}
.sv-pick.on :deep(.sk-duration) { display: none; }

.sv-panel {
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  border-radius: var(--radius-lg); border: 1px solid var(--accent); background: var(--accent-bg);
}
.sv-panel-title { margin: 0; font: 800 14px var(--font-display); color: var(--text-0); }
.sv-panel-copy .field-hint { margin-top: 2px; }
.sv-panel-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
.sv-req { color: var(--accent-text); }
.sv-inline-link { color: var(--accent-text); font-weight: 600; }

.sv-job {
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  border-radius: var(--radius-lg); border: 1px solid var(--accent); background: var(--accent-bg); color: var(--accent-text);
}
.sv-job.bad { border-color: var(--warn-border, var(--border)); background: var(--warn-bg, var(--surface-raised)); color: var(--warn-text, var(--text-1)); }
.sv-job-head { display: flex; align-items: center; gap: 8px; }
.sv-job-title { flex: 1; margin: 0; font-size: 13px; font-weight: 700; color: var(--text-0); }
.sv-job-link { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 600; color: var(--accent-text); text-decoration: none; white-space: nowrap; }
.sv-job-error { margin: 0; font-size: 12px; color: var(--text-1); }
.sv-job-actions { display: flex; gap: 8px; }
.sv-job-actions:empty { display: none; }
.sv-steps { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0; padding: 0; list-style: none; }
.sv-steps li { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-3); }
.sv-steps li.on { color: var(--text-0); font-weight: 700; }
.sv-steps li.done { color: var(--text-1); }
.sv-step-dot {
  width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid var(--border-strong, var(--border));
}
.sv-steps li.on .sv-step-dot { border-color: var(--accent); background: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.sv-steps li.done .sv-step-dot { border-color: var(--accent); background: var(--action-primary); color: var(--action-primary-text); }
.sv-step-count { font-size: 11px; color: var(--text-2); }
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { margin: 0; font-size: 11px; color: var(--text-3); line-height: 1.5; }
@media (max-width: 860px) {
  .sv-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
