<template>
  <div class="studio ep-workbench" v-if="drama">
    <header class="studio-topbar">
      <div class="studio-topbar-main">
        <button class="back-btn topbar-back" @click="navigateTo(`/drama/${dramaId}`)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          {{ t('episode.topbar.back') }}
        </button>
        <div class="studio-identity">
          <h1 class="studio-title">{{ drama.title }}</h1>
          <span class="studio-episode-chip">{{ t('episode.topbar.episodeN', { n: episodeNumber }) }}</span>
          <div class="studio-meta-row">
            <span class="studio-meta-pill">{{ currentSubStageLabel }}</span>
            <span class="studio-meta-pill is-progress">{{ pipelineProgress }}/{{ pipelineTotal }}</span>
            <span class="studio-meta-inline">{{ t('episode.topbar.meta', { roles: chars.length, shots: sbs.length }) }}</span>
          </div>
        </div>
      </div>

      <div class="studio-topbar-side">
        <div class="studio-model-picks">
          <ModelSelect
            v-if="textModelOptions.length"
            v-model="chatModel"
            :label="t('common.serviceType.text')"
            :options="textModelOptions"
            :default-label="t('episode.model.defaultWith', { model: textModelOptions[0].model })"
            :show-config="textModelMultiCfg"
          />
          <ModelSelect
            v-if="imageModelOptions.length"
            v-model="imageModel"
            :label="t('common.serviceType.image')"
            :options="imageModelOptions"
            :default-label="t('episode.model.defaultWith', { model: imageModelOptions[0].model })"
            :show-config="imageModelMultiCfg"
          />
          <ModelSelect
            v-if="videoModelOptions.length"
            v-model="videoModel"
            :label="t('common.serviceType.video')"
            :options="videoModelOptions"
            :default-label="t('episode.model.defaultWith', { model: videoModelOptions[0].model })"
            :show-config="videoModelMultiCfg"
          />
          <ModelSelect
            v-model="episodeResolution"
            :label="t('episode.topbar.resolution')"
            :options="resolutionOptions"
            hide-default
          />
        </div>
        <div class="studio-actions">
          <LocaleSwitcher />
          <button class="btn btn-icon tour-help-btn" :title="t('tour.helpTitle')" @click="startTour('episode', EPISODE_TOUR, t)">
            <CircleHelp :size="14" :stroke-width="1.8" />
          </button>
          <button class="btn" @click="refresh">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            {{ t('common.refresh') }}
          </button>
          <button class="btn task-drawer-trigger" @click="openTaskDrawer">
            <ListTodo :size="12" />
            {{ t('episode.topbar.tasks') }}
            <span v-if="genTaskActiveCount" class="task-drawer-badge">{{ genTaskActiveCount }}</span>
          </button>
        </div>
      </div>
    </header>

    <div class="studio-body">
    <!-- ========== LEFT SIDEBAR ========== -->
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <nav class="pipeline">
        <div
          v-for="section in sidebarSections"
          :key="section.id"
          :class="['pipe-section', 'is-' + sectionState(section.id)]"
        >
          <div class="pipe-section-label">
            <span v-if="sectionState(section.id) !== 'none'" class="pipe-section-state">
              <svg v-if="sectionState(section.id) === 'done'" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span v-else-if="sectionState(section.id) === 'active'" class="pipe-section-pulse" />
              <span v-else class="pipe-section-dot" />
            </span>
            <span>{{ section.label }}</span>
            <span v-if="sectionState(section.id) === 'active'" class="pipe-section-tag">{{ t('episode.sidebar.inProgress') }}</span>
          </div>
          <button
            v-for="item in section.items"
            :key="item.key"
            :class="['pipe-item pipe-item-sub', {
              active: activeSubStepKey === item.key,
              done: sectionState(section.id) === 'done',
              doing: sectionState(section.id) === 'active',
            }]"
            :title="sidebarCollapsed ? item.label : undefined"
            @click="goSubStep(item.key)"
          >
            <span class="pipe-icon" :class="sectionState(section.id) === 'done' ? 'icon-done' : activeSubStepKey === item.key ? 'icon-active' : ''">
              <!-- 收起态：始终显示步骤图标，进行中用右上角小脉冲点表达 -->
              <template v-if="sidebarCollapsed">
                <component :is="item.icon" :size="12" />
                <span v-if="sectionState(section.id) === 'active'" class="pipe-mini-pulse" />
              </template>
              <svg v-else-if="sectionState(section.id) === 'done'" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span v-else-if="sectionState(section.id) === 'active'" class="pipe-item-pulse" />
              <component v-else :is="item.icon" :size="11" />
            </span>
            <span class="pipe-copy">
              <span class="pipe-label">{{ item.label }}</span>
              <span v-if="item.desc" class="pipe-sub">{{ item.desc }}</span>
            </span>
          </button>
        </div>
      </nav>

      <!-- Bottom: 收起/展开 + Stage marquee + Refresh -->
      <div class="sidebar-bottom">
        <button
          type="button"
          class="sidebar-toggle"
          :title="t(sidebarCollapsed ? 'episode.sidebar.expand' : 'episode.sidebar.collapse')"
          @click="toggleSidebar"
        >
          <svg class="sidebar-toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          <span v-if="!sidebarCollapsed">{{ t('episode.sidebar.collapse') }}</span>
        </button>
        <!-- 步骤跑马灯：四段主流程进度，当前段流动光效，点击段可跳转 -->
        <div class="sidebar-progress">
          <div class="sidebar-progress-head">
            <span class="sidebar-progress-title">{{ currentStageLabel }}</span>
            <span class="sidebar-progress-count">{{ currentMainIdx + 1 }}/{{ mainProgressSteps.length }}</span>
          </div>
          <div class="sidebar-progress-track">
            <button
              v-for="(s, i) in mainProgressSteps"
              :key="s.id"
              type="button"
              :class="['sidebar-progress-seg', { done: i < currentMainIdx || mainStageDone(s.id), current: i === currentMainIdx }]"
              :title="s.label"
              @click="goMainStage(s.id)"
            ><span class="sidebar-progress-seg-fill" /></button>
          </div>
          <div class="sidebar-progress-labels">
            <span
              v-for="(s, i) in mainProgressSteps"
              :key="s.id"
              :class="{ on: i === currentMainIdx, done: i < currentMainIdx || mainStageDone(s.id) }"
            >{{ s.label }}</span>
          </div>
        </div>
        <button class="refresh-btn" @click="refresh">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          {{ t('episode.sidebar.refreshData') }}
        </button>
      </div>
    </aside>

    <!-- ========== MAIN CONTENT ========== -->
    <main class="main">
      <!-- ===== SCRIPT PANEL ===== -->
      <EpisodeScriptPanel v-if="panel === 'script'" />

      <!-- ===== PRODUCTION PANEL ===== -->
      <div v-else-if="panel === 'production'" class="content-panel">
        <!-- Guard: current production step prerequisites -->
        <div v-if="productionBlockMessage" class="step-empty" style="flex:1">
          <div class="empty-visual">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div class="empty-title">{{ t('episode.prod.notReady') }}</div>
          <div class="empty-desc">{{ productionBlockMessage }}</div>
          <button class="btn btn-primary" @click="goProductionBlockTarget">{{ productionBlockActionLabel }}</button>
        </div>

        <template v-else>
          <!-- 制作子步骤导航（资产/分镜拆分/视频生成）由左侧栏承担，顶部不再重复展示 -->
          <!-- Sub: Assets -->
          <EpisodeAssetsTab v-if="prodTab === 'assets'" />

          <!-- Sub: Video Production（分镜拆分 + 视频生成 合并） -->
          <EpisodeVideosTab v-if="prodTab === 'videos'" />

          <!-- Production Navigator -->
        </template>
      </div>

      <!-- ===== EXPORT PANEL ===== -->
      <EpisodeExportPanel v-else />

      <!-- ===== TASK DRAWER ===== -->
      <EpisodeTaskDrawer v-if="taskDrawer" />

      <EpisodeAssetDetail v-if="assetDetail.open && assetDetail.item" />

      <div v-if="imageViewer.open && imageViewer.src" class="overlay image-viewer-overlay" @click.self="closeImageViewer">
        <div class="dialog image-viewer-dialog">
          <div class="image-viewer-head">
            <div class="image-viewer-title">{{ imageViewer.title || t('episode.viewer.imagePreview') }}</div>
            <button class="btn btn-ghost btn-icon" @click="closeImageViewer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="image-viewer-body">
            <img :src="imageViewer.src" :alt="imageViewer.title || t('episode.viewer.imagePreview')" class="image-viewer-img" />
          </div>
        </div>
      </div>

      <div v-if="previewShot" class="overlay image-viewer-overlay" @click.self="previewShot = null">
        <div class="dialog image-viewer-dialog merge-viewer-dialog">
          <div class="image-viewer-head">
            <div class="image-viewer-title">{{ t('episode.export.shotPreview', { n: shotNumberOf(previewShot) }) }}</div>
            <span v-if="previewShot.duration" class="dim" style="font-size:11px">{{ previewShot.duration }}s</span>
            <a :href="'/' + getVideoUrl(previewShot)" download class="btn btn-sm" style="margin-left:auto">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {{ t('common.download') }}
            </a>
            <button class="btn btn-ghost btn-icon" @click="previewShot = null">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="merge-viewer-body">
            <video
              :key="previewShot.id"
              :src="'/' + getVideoUrl(previewShot)"
              controls
              autoplay
              playsinline
              class="merge-viewer-video"
            />
          </div>
        </div>
      </div>

      <div v-if="activeMerge" class="overlay image-viewer-overlay" @click.self="activeMerge = null">
        <div class="dialog image-viewer-dialog merge-viewer-dialog">
          <div class="image-viewer-head">
            <div class="image-viewer-title">{{ t('episode.viewer.filmPreview') }}</div>
            <span class="dim" style="font-size:11px">{{ formatHistoryTime(activeMerge.created_at) }}<template v-if="activeMerge.duration"> · {{ activeMerge.duration }}s</template></span>
            <a :href="'/' + activeMerge.merged_url" download class="btn btn-sm" style="margin-left:auto">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {{ t('episode.viewer.downloadFilm') }}
            </a>
            <button class="btn btn-ghost btn-icon" @click="activeMerge = null">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="merge-viewer-body">
            <video
              :key="activeMerge.id"
              :src="'/' + activeMerge.merged_url"
              controls
              autoplay
              playsinline
              class="merge-viewer-video"
            />
          </div>
        </div>
      </div>

      <div v-if="assetCreate.open" class="overlay" @click.self="assetCreate.open = false">
        <div class="dialog asset-create-dialog">
          <header class="dialog-head">
            <h2 class="dialog-title">{{ t('episode.create.title', { type: assetCreateTypeLabel }) }}</h2>
            <button class="btn btn-ghost btn-icon" @click="assetCreate.open = false">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </header>
          <div class="dialog-body asset-create-body">
            <template v-if="assetCreate.type === 'character'">
              <label class="field"><span class="field-label">{{ t('episode.create.name') }}</span><input v-model="assetCreateDraft.name" class="input" :placeholder="t('episode.create.namePlaceholderChar')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.create.roleField') }}</span><input v-model="assetCreateDraft.role" class="input" :placeholder="t('episode.create.rolePlaceholder')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.asset.appearanceField') }}</span><textarea v-model="assetCreateDraft.appearance" class="textarea" rows="3" :placeholder="t('episode.create.appearancePlaceholder')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.asset.stylingField') }}</span><textarea v-model="assetCreateDraft.styling" class="textarea" rows="2" :placeholder="t('episode.create.stylingPlaceholder')" /></label>
            </template>
            <template v-else-if="assetCreate.type === 'scene'">
              <label class="field"><span class="field-label">{{ t('episode.create.location') }}</span><input v-model="assetCreateDraft.location" class="input" :placeholder="t('episode.create.locationPlaceholder')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.create.time') }}</span><input v-model="assetCreateDraft.time" class="input" :placeholder="t('episode.create.timePlaceholder')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.asset.sceneDescField') }}</span><textarea v-model="assetCreateDraft.prompt" class="textarea" rows="3" :placeholder="t('episode.create.sceneDescPlaceholder')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.asset.sceneLightField') }}</span><input v-model="assetCreateDraft.lighting" class="input" :placeholder="t('episode.create.lightPlaceholder')" /></label>
            </template>
            <template v-else>
              <label class="field"><span class="field-label">{{ t('episode.create.name') }}</span><input v-model="assetCreateDraft.name" class="input" :placeholder="t('episode.create.namePlaceholderProp')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.create.typeField') }}</span><input v-model="assetCreateDraft.type" class="input" :placeholder="t('episode.create.typePlaceholder')" /></label>
              <label class="field"><span class="field-label">{{ t('episode.asset.appearanceOfObject') }}</span><textarea v-model="assetCreateDraft.description" class="textarea" rows="3" :placeholder="t('episode.create.appearanceOnlyPlaceholder')" /></label>
            </template>
          </div>
          <footer class="dialog-foot">
            <button class="btn" @click="assetCreate.open = false">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="assetCreate.saving" @click="saveAssetCreate">
              <Loader2 v-if="assetCreate.saving" :size="12" class="animate-spin" />
              {{ t('common.add') }}
            </button>
          </footer>
        </div>
      </div>

      <div v-if="batchVideoConfirm.open" class="overlay" @click.self="closeBatchVideoConfirm">
        <div class="dialog batch-video-dialog">
          <header class="dialog-head">
            <h2 class="dialog-title">{{ t('episode.vid.confirmTitle') }}</h2>
            <button class="btn btn-ghost btn-icon" :aria-label="t('common.cancel')" @click="closeBatchVideoConfirm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </header>
          <div class="dialog-body batch-video-body">
            <div class="batch-video-row"><span>{{ t('episode.vid.confirmShots') }}</span><strong>{{ t('episode.vid.confirmShotsValue', { n: batchVideoConfirm.previews.length }) }}</strong></div>
            <div class="batch-video-row"><span>{{ t('episode.vid.confirmTotal') }}</span><strong>{{ t('episode.vid.confirmApprox', { n: batchVideoTotalDuration }) }}</strong></div>
            <div class="batch-video-row"><span>{{ t('episode.vid.confirmModel') }}</span><strong>{{ effectiveVideoModelLabel || t('episode.vid.defaultModel') }}</strong></div>
            <div class="batch-video-row"><span>{{ t('episode.vid.confirmResolution') }}</span><strong>{{ episodeResolutionLabel }}</strong></div>
            <div class="batch-video-row"><span>{{ t('productionGuard.estimatedBatch') }}</span><strong>{{ batchVideoCostKnown ? formatBaht(batchVideoEstimatedCost) : t('productionGuard.unpriced') }}</strong></div>
            <div v-if="batchVideoBudget != null" class="batch-video-row"><span>{{ t('productionGuard.remainingBudget') }}</span><strong>{{ formatBaht(batchVideoBudget) }}</strong></div>
            <p v-if="batchVideoBudgetIssue" class="batch-video-blocked" role="alert">{{ batchVideoBudgetIssue }}</p>
            <p v-if="batchVideoConfirm.loading" class="batch-video-note" role="status">{{ t('episode.vid.preflightLoading') }}</p>
            <p v-else-if="batchVideoBlocked" class="batch-video-blocked" role="alert">{{ t('episode.vid.preflightBlocked') }}</p>
            <p v-else class="batch-video-note">{{ t('episode.vid.confirmNote') }}</p>
            <div class="batch-video-previews">
              <details v-for="(item, index) in batchVideoConfirm.previews" :key="item.sb.id" class="batch-video-preview" :open="index === 0 || !!item.error || !!item.plan.issues.length">
                <summary class="batch-video-preview-head">
                  <span class="batch-video-preview-title">{{ t('episode.vid.shotN', { n: item.sb.storyboard_number || item.sb.storyboardNumber || index + 1 }) }} · {{ item.sb.title || item.sb.description || '' }}</span>
                  <span :class="['batch-video-preview-state', (item.error || item.plan.issues.length) ? 'is-error' : '']">{{ (item.error || item.plan.issues.length) ? t('episode.vid.preflightNeedsFix') : `${item.request.duration}s · ${item.plan.references.length} ${t('episode.vid.preflightImages')}` }}</span>
                </summary>
                <div class="batch-video-preview-content">
                  <ul v-if="item.plan.issues.length || item.error" class="batch-video-issues">
                    <li v-for="(issue, issueIndex) in item.plan.issues" :key="issueIndex">{{ videoPreflightIssue(issue) }}</li>
                    <li v-if="item.error">{{ item.error }}</li>
                  </ul>
                  <div class="batch-video-preview-label">{{ t('episode.vid.preflightReferences') }}</div>
                  <div v-if="item.plan.assetPlan.length" class="batch-video-refs">
                    <div v-for="(asset, assetIndex) in item.plan.assetPlan" :key="`${asset.kind}-${assetIndex}`" class="batch-video-ref">
                      <img v-if="asset.url" :src="assetImageSrc({ image_url: asset.url })" :alt="asset.name" loading="lazy" />
                      <span v-else class="batch-video-ref-empty">—</span>
                      <span class="batch-video-ref-name">{{ asset.name || t('episode.vid.unnamedReference') }}<small>{{ videoAssetKindLabel(asset.kind) }}</small></span>
                      <strong>{{ asset.index ? `#${asset.index}` : t('episode.vid.preflightMissing') }}</strong>
                    </div>
                  </div>
                  <p v-else class="batch-video-empty">{{ t('episode.vid.preflightNoReferences') }}</p>
                  <div class="batch-video-preview-label">{{ t('episode.vid.preflightPrompt') }}</div>
                  <pre class="batch-video-prompt">{{ item.prepared?.prompt || item.plan.resolvedPrompt || '—' }}</pre>
                  <button v-if="item.error || item.plan.issues.length" class="btn btn-sm" @click="focusVideoPreflightShot(item.sb)">{{ t('episode.vid.preflightEditShot') }}</button>
                </div>
              </details>
            </div>
          </div>
          <footer class="dialog-foot">
            <button class="btn" @click="closeBatchVideoConfirm">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="batchVideoBlocked" @click="confirmBatchVideos">{{ t('episode.vid.confirmStart', { n: batchVideoConfirm.previews.length }) }}</button>
          </footer>
        </div>
      </div>

      <ConfirmDialog
        :open="assetDelete.open"
        :title="t('episode.delete.title', { type: assetDeleteTypeLabel })"
        :message="t('episode.delete.message', { type: assetDeleteTypeLabel, name: assetDeleteName })"
        :loading="assetDelete.loading"
        @confirm="confirmDeleteAsset"
        @cancel="assetDelete.open = false"
      />
    </main>
    </div>
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import {
  Users, FileText, FolderKanban, Clapperboard, Download, Loader2,
  ListTodo, CircleHelp,
} from 'lucide-vue-next'
import { api, dramaAPI, episodeAPI, storyboardAPI, characterAPI, sceneAPI, propAPI, taskAPI, mergeAPI, aiConfigAPI, uploadAPI } from '~/composables/useApi'
import { startTour, autoTour } from '~/composables/useTour'
import { useAgent } from '~/composables/useAgent'
import { toastError, MODERATION_RE } from '~/composables/useToast'
import { analyzeVideoShot } from '../utils/videoPreflight'
import { createTaskWatch } from '../utils/taskWatch.js'
import LocaleSwitcher from '~/components/LocaleSwitcher.vue'
import { EPISODE_WORKBENCH } from '../utils/episodeWorkbench.js'

// The big parts of the workbench are separate chunks (views/episode/): the page downloads only the part
// that is open; the rest is fetched once the browser is idle, so switching steps does not wait.
const loadScriptPanel = () => import('./episode/ScriptPanel.vue')
const loadAssetsTab = () => import('./episode/AssetsTab.vue')
const loadVideosTab = () => import('./episode/VideosTab.vue')
const loadExportPanel = () => import('./episode/ExportPanel.vue')
const loadTaskDrawer = () => import('./episode/TaskDrawer.vue')
const loadAssetDetail = () => import('./episode/AssetDetail.vue')
const EpisodeScriptPanel = defineAsyncComponent(loadScriptPanel)
const EpisodeAssetsTab = defineAsyncComponent(loadAssetsTab)
const EpisodeVideosTab = defineAsyncComponent(loadVideosTab)
const EpisodeExportPanel = defineAsyncComponent(loadExportPanel)
const EpisodeTaskDrawer = defineAsyncComponent(loadTaskDrawer)
const EpisodeAssetDetail = defineAsyncComponent(loadAssetDetail)

definePageMeta({ layout: 'studio' })

const { t } = useI18n()

const route = useRoute()
const dramaId = Number(route.params.id)
const episodeNumber = Number(route.params.episodeNumber)

const drama = ref(null), episode = ref(null), chars = ref([]), scenes = ref([]), propItems = ref([]), sbs = ref([]), mergeData = ref(null)
const characterLooks = ref([])
const shotLookAssignments = ref([])
const newLookName = ref('')
const uploadingLook = ref(false)
// 工作台面板位置记忆（按剧集隔离）：仅页面刷新(reload)时恢复到上次所在步骤；
// 从列表/详情页点击进入时始终默认「剧本」面板
const PANEL_STORE_KEY = `naka:workbench:panel:${dramaId}:${episodeNumber}`
const isPageReload = (() => {
  try { return performance.getEntriesByType('navigation')[0]?.type === 'reload' } catch { return false }
})()
const storedPanel = (() => {
  if (!isPageReload) return null
  try { return JSON.parse(localStorage.getItem(PANEL_STORE_KEY) || 'null') } catch { return null }
})()
// 首个 refresh 时若已恢复面板位置，跳过按内容自动重置 scriptStep
let panelRestored = !!storedPanel
// 项目页卡片可直达指定步骤：?panel=production&tab=videos（优先于本地记忆）
const queryPanel = ['script', 'production', 'export'].includes(String(route.query.panel)) ? String(route.query.panel) : null
const queryProdTab = ['assets', 'videos'].includes(String(route.query.tab)) ? String(route.query.tab) : null
const panel = ref(queryPanel || (['production', 'export'].includes(storedPanel?.panel) ? storedPanel.panel : 'script'))
const { running: rn, runningType: rt, run: runAgent } = useAgent()

const localRaw = ref(''), localScript = ref('')
const rawContent = computed(() => episode.value?.content || '')
const scriptContent = computed(() => episode.value?.script_content || episode.value?.scriptContent || '')
const epId = computed(() => episode.value?.id || 0)
const rawLen = computed(() => localRaw.value.replace(/\s/g, '').length || 0)
const scriptLen = computed(() => localScript.value.replace(/\s/g, '').length || 0)

// ===== 拼接导出:镜头选择 + 成片列表 =====
const exportSelectedIds = ref([]) // 勾选的镜头 id
const exportMerges = ref([])      // 成片(拼接记录)列表
let exportSelTouched = false      // 用户手动操作过选择后,不再自动全选

const exportHealth = ref(null)
const exportHealthLoading = ref(false)
const exportHealthError = ref('')
const exportReadyIds = computed(() => sbs.value.filter(s => hasVid(s)).map(s => s.id))
const exportSelectedReadyIds = computed(() => exportSelectedIds.value.filter(id => exportReadyIds.value.includes(id)))

watch(exportReadyIds, (ids) => {
  if (exportSelTouched) {
    exportSelectedIds.value = exportSelectedIds.value.filter(id => ids.includes(id))
  } else {
    exportSelectedIds.value = [...ids]
  }
})

function isExportSelected(id) { return exportSelectedIds.value.includes(id) }
function toggleExportSelect(sb) {
  if (!hasVid(sb)) return
  exportSelTouched = true
  exportSelectedIds.value = isExportSelected(sb.id)
    ? exportSelectedIds.value.filter(x => x !== sb.id)
    : [...exportSelectedIds.value, sb.id]
}
function toggleSelectAllExport() {
  exportSelTouched = true
  exportSelectedIds.value = exportSelectedReadyIds.value.length === exportReadyIds.value.length ? [] : [...exportReadyIds.value]
}

async function loadExportMerges() {
  if (!epId.value) return
  void loadExportHealth()
  try { exportMerges.value = await mergeAPI.list(epId.value) || [] } catch { /* 静默 */ }
}

const scriptStep = ref(storedPanel ? (storedPanel.scriptStep === 0 ? 0 : 1) : 0)
// 旧版本地存储的 'storyboard' 子步骤已并入 'videos'（视频制作）
const storedProdTab = storedPanel?.prodTab === 'storyboard' ? 'videos' : storedPanel?.prodTab
const prodTab = ref(queryProdTab || (['assets', 'videos'].includes(storedProdTab) ? storedProdTab : 'assets'))
// 面板位置变化即持久化
watch([panel, scriptStep, prodTab], ([p, s, pt]) => {
  try { localStorage.setItem(PANEL_STORE_KEY, JSON.stringify({ panel: p, scriptStep: s, prodTab: pt })) } catch { /* 静默 */ }
})
// ===== 视频制作三栏宽度：拖拽调节 + 全局持久化（双击分隔条恢复默认） =====
const VIDEO_COL_STORE_KEY = 'naka:workbench:video-cols'
const VIDEO_COL_DEFAULTS = { left: 236, right: 340 }
const VIDEO_COL_LIMITS = { left: [180, 420], right: [260, 560] }
const storedVideoCols = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(VIDEO_COL_STORE_KEY) || 'null')
    return c && typeof c === 'object' ? c : null
  } catch { return null }
})()
const clampVideoCol = (which, w) => Math.min(VIDEO_COL_LIMITS[which][1], Math.max(VIDEO_COL_LIMITS[which][0], Math.round(w)))
const videoLeftW = ref(clampVideoCol('left', Number(storedVideoCols?.left) || VIDEO_COL_DEFAULTS.left))
const videoRightW = ref(clampVideoCol('right', Number(storedVideoCols?.right) || VIDEO_COL_DEFAULTS.right))
watch([videoLeftW, videoRightW], ([l, r]) => {
  try { localStorage.setItem(VIDEO_COL_STORE_KEY, JSON.stringify({ left: l, right: r })) } catch { /* 静默 */ }
})
function startVideoColDrag(which, e) {
  if (e.button !== 0) return
  e.preventDefault()
  const target = e.currentTarget
  const startX = e.clientX
  const startW = which === 'left' ? videoLeftW.value : videoRightW.value
  const onMove = (ev) => {
    const dx = ev.clientX - startX
    const w = clampVideoCol(which, which === 'left' ? startW + dx : startW - dx)
    if (which === 'left') videoLeftW.value = w
    else videoRightW.value = w
  }
  const onUp = () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
    document.body.classList.remove('is-video-col-dragging')
  }
  document.body.classList.add('is-video-col-dragging')
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onUp)
  target.setPointerCapture?.(e.pointerId)
}
const activeExtractTab = ref('characters')
const prodTabIdx = computed({
  get: () => prodTabDefs.value.findIndex(d => d.id === prodTab.value),
  set: (v) => { prodTab.value = prodTabDefs.value[v]?.id || 'assets' },
})
const imageConfigs = ref([])
const videoConfigs = ref([])
const textConfigs = ref([])
// 生成时可选模型：空串 = 跟随配置默认（models[0]）；选择持久化到 localStorage，刷新页面后保留
const MODEL_STORE_KEYS = { chat: 'naka:model:chat', image: 'naka:model:image', video: 'naka:model:video' }
function readStoredModel(key, legacyKey = '') {
  try { return localStorage.getItem(key) || (legacyKey && localStorage.getItem(legacyKey)) || '' } catch { return '' }
}
// 顶栏文本模型：适用于所有 Chat Agent 调用（改写/提取/拆镜/视频提示词/最终提示词），空串 = 跟随配置默认
const chatModel = ref(readStoredModel(MODEL_STORE_KEYS.chat, 'naka:model:rewrite'))
const imageModel = ref(readStoredModel(MODEL_STORE_KEYS.image))
const videoModel = ref(readStoredModel(MODEL_STORE_KEYS.video))
function persistModel(modelRef, key) {
  watch(modelRef, v => {
    try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key) } catch {}
  })
}
persistModel(chatModel, MODEL_STORE_KEYS.chat)
persistModel(imageModel, MODEL_STORE_KEYS.image)
persistModel(videoModel, MODEL_STORE_KEYS.video)
// 左侧菜单栏收起/展开：收起为窄图标栏给内容区让位，持久化到 localStorage
const SIDEBAR_COLLAPSED_KEY = 'naka:sidebar-collapsed'
const sidebarCollapsed = ref((() => {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' } catch { return false }
})())
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try {
    sidebarCollapsed.value
      ? localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
      : localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
  } catch { /* 静默 */ }
}
/** 顶栏文本模型覆盖参数：未选择时为 undefined，后端回退到 Agent/文本配置默认 */
function chatModelOverride() { return bareModelName(chatModel.value) || undefined }
function chatConfigId() { return ownerConfigId(textModelOptions.value, chatModel.value) }
const pendingCharImageIds = ref([])
const pendingSceneImageIds = ref([])
const pendingPropImageIds = ref([])
const pendingVideoIds = ref([])
const unknownVideoIds = ref([])
const failedVideoMessages = ref({})
// 任务列表面板：顶栏按钮触发的右侧抽屉,按集聚合 sys_task + video_merges
const genTasks = ref([])
const genMerges = ref([])
const taskDrawer = ref(false)
let genTasksTimer = null

function openTaskDrawer() {
  taskDrawer.value = true
  loadGenTasks()
}
function closeTaskDrawer() {
  taskDrawer.value = false
}
const imageViewer = ref({ open: false, src: '', title: '' })
const activeMerge = ref(null) // 成片大预览弹窗中正在播放的拼接记录
const previewShot = ref(null) // 导出页镜头素材预览弹窗中正在播放的分镜
function shotNumberOf(sb) {
  const i = sbs.value.findIndex(s => s.id === sb?.id)
  return i >= 0 ? i + 1 : 0
}
// 导出步骤完成 = 用户手动标记（episodes.status = 'completed'），不再按最新拼接记录推算
const exportDone = computed(() => episode.value?.status === 'completed')
async function toggleExportDone() {
  if (!epId.value) return
  const status = exportDone.value ? 'active' : 'completed'
  try {
    await episodeAPI.update(epId.value, { status })
    if (episode.value) episode.value.status = status
    toast.success(status === 'completed' ? t('episode.export.markedDoneToast') : t('episode.export.unmarkDoneToast'))
  } catch (e) {
    toastError(e)
  }
}
const assetDetail = ref({ open: false, type: '', item: null })
const assetDetailDraft = ref({ appearance: '', styling: '', prompt: '', lighting: '', description: '' })
// 最终提示词手动编辑：dirty 时才随保存提交，避免无修改保存误清空 Agent 生成的提示词
const assetPromptDraft = ref('')
const assetPromptDirty = ref(false)
const savingAssetDetail = ref(false)

function isPendingCharImage(id) {
  return pendingCharImageIds.value.includes(id)
}

function openImageViewer(src, title = '') {
  if (!src) return
  imageViewer.value = { open: true, src, title }
}

function closeImageViewer() {
  imageViewer.value = { open: false, src: '', title: '' }
}

function openAssetDetail(type, item) {
  if (!item) return
  assetDetail.value = { open: true, type, item }
  assetDetailDraft.value = {
    appearance: item.appearance || '',
    styling: item.styling || '',
    prompt: item.prompt || (type === 'prop' ? '' : item.description) || '',
    lighting: item.lighting || '',
    description: item.description || '',
  }
  assetPromptDraft.value = item.final_prompt || item.finalPrompt || ''
  assetPromptDirty.value = false
}

function closeAssetDetail() {
  assetDetail.value = { open: false, type: '', item: null }
  assetDetailDraft.value = { appearance: '', styling: '', prompt: '', lighting: '', description: '' }
  assetPromptDraft.value = ''
  assetPromptDirty.value = false
}

// ─── 手动新增资产 ────────────────────────────────────────────
// 类型短显示名渲染时求值（不模块级固化），逻辑判断一律用 kind code
const assetKindLabelMap = computed(() => ({
  character: t('common.role'),
  scene: t('common.scene'),
  prop: t('common.prop'),
}))
function assetKindLabel(type) {
  return assetKindLabelMap.value[type] || t('episode.asset.fallbackType')
}
const assetCreate = ref({ open: false, type: 'character', saving: false })
const assetCreateDraft = ref({})
const assetCreateTypeLabel = computed(() => assetKindLabel(assetCreate.value.type))

function openAssetCreate(type) {
  assetCreateDraft.value = { name: '', role: '', appearance: '', styling: '', location: '', time: '', prompt: '', lighting: '', type: '', description: '' }
  assetCreate.value = { open: true, type, saving: false }
}

async function saveAssetCreate() {
  const d = assetCreateDraft.value
  const type = assetCreate.value.type
  if (assetCreate.value.saving) return
  if (type === 'scene' ? !d.location?.trim() : !d.name?.trim()) {
    toast.warning(type === 'scene' ? t('episode.create.locationRequired') : t('episode.create.nameRequired'))
    return
  }
  assetCreate.value.saving = true
  try {
    const base = { drama_id: dramaId, episode_id: epId.value }
    if (type === 'character') await characterAPI.create({ ...base, name: d.name, role: d.role, appearance: d.appearance, styling: d.styling })
    else if (type === 'scene') await sceneAPI.create({ ...base, location: d.location, time: d.time, prompt: d.prompt, lighting: d.lighting })
    else await propAPI.create({ ...base, name: d.name, type: d.type, description: d.description })
    toast.success(t('episode.create.created', { type: assetCreateTypeLabel.value }))
    assetCreate.value.open = false
    await refresh()
  } catch (e) {
    toastError(e)
  } finally {
    assetCreate.value.saving = false
  }
}

// ─── 删除资产 ────────────────────────────────────────────────
const assetDelete = ref({ open: false, type: '', item: null, loading: false })
const assetDeleteTypeLabel = computed(() => assetKindLabel(assetDelete.value.type))
const assetDeleteName = computed(() => assetDelete.value.item?.name || assetDelete.value.item?.location || '')

function askDeleteAsset(type, item) {
  assetDelete.value = { open: true, type, item, loading: false }
}

async function confirmDeleteAsset() {
  const { type, item } = assetDelete.value
  if (!item || assetDelete.value.loading) return
  assetDelete.value.loading = true
  try {
    if (type === 'character') await characterAPI.del(item.id)
    else if (type === 'scene') await sceneAPI.del(item.id)
    else await propAPI.del(item.id)
    toast.success(t('episode.delete.deleted', { type: assetDeleteTypeLabel.value }))
    assetDelete.value.open = false
    if (assetDetail.value.open && assetDetail.value.type === type && assetDetail.value.item?.id === item.id) closeAssetDetail()
    await refresh()
  } catch (e) {
    toastError(e)
  } finally {
    assetDelete.value.loading = false
  }
}

function onAssetPromptInput(event) {
  assetPromptDraft.value = event.target.value
  assetPromptDirty.value = true
}

const assetFinalPrompt = computed(() => {
  const item = assetDetail.value?.item
  return item?.final_prompt || item?.finalPrompt || ''
})

/** 把生成好的最终提示词同步到列表项与弹窗项 */
function applyFinalPrompt(type, id, fp) {
  const patch = { final_prompt: fp, finalPrompt: fp }
  const list = type === 'character' ? chars.value : type === 'scene' ? scenes.value : propItems.value
  const target = list.find(x => x.id === id)
  if (target) Object.assign(target, patch)
  if (assetDetail.value.open && assetDetail.value.type === type && assetDetail.value.item?.id === id) {
    Object.assign(assetDetail.value.item, patch)
  }
}

const generatingPromptKeys = ref([])

function isGeneratingPrompt(type, id) {
  return generatingPromptKeys.value.includes(`${type}:${id}`)
}

/** 该资产图片是否在外层「生成」流程中（含提示词阶段与生图阶段） */
function isAssetImagePending(type, id) {
  return type === 'character' ? isPendingCharImage(id) : type === 'scene' ? isPendingSceneImage(id) : isPendingPropImage(id)
}

/**
 * 生成最终提示词（弹窗按钮与外层两段式生图共用同一 key 状态，避免重复触发）
 * force=true 时忽略已有提示词强制重新生成
 * 返回最终提示词；生成失败由接口抛错，Agent 返回空时返回 ''
 */
async function ensureAssetPrompt(type, id, force = false) {
  const key = `${type}:${id}`
  if (generatingPromptKeys.value.includes(key)) return ''
  generatingPromptKeys.value.push(key)
  try {
    const res = type === 'character'
      ? await characterAPI.generatePrompt(id, epId.value, force, chatModelOverride(), chatConfigId())
      : type === 'scene'
        ? await sceneAPI.generatePrompt(id, epId.value, force, chatModelOverride(), chatConfigId())
        : await propAPI.generatePrompt(id, epId.value, force, chatModelOverride(), chatConfigId())
    const fp = res?.final_prompt || res?.finalPrompt || ''
    if (fp) applyFinalPrompt(type, id, fp)
    return fp
  } finally {
    generatingPromptKeys.value = generatingPromptKeys.value.filter(k => k !== key)
  }
}

/** 弹窗内生成最终提示词（不生图）；已有最终提示词时重新生成（force） */
async function genAssetFinalPrompt() {
  const detail = assetDetail.value
  if (!detail.open || !detail.item?.id) return
  const force = !!assetFinalPrompt.value
  try {
    const fp = await ensureAssetPrompt(detail.type, detail.item.id, force)
    if (!fp) throw new Error(t('episode.asset.promptGenFailedRetry'))
    assetPromptDraft.value = fp
    assetPromptDirty.value = false
    toast.success(force ? t('episode.asset.promptRegenerated') : t('episode.asset.promptGenerated'))
  } catch (e) {
    toastError(e, { fallback: 'episode.asset.promptGenFailed' })
  }
}

async function copyAssetFinalPrompt() {
  const text = assetPromptDraft.value || assetFinalPrompt.value
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('episode.asset.promptCopied'))
  } catch {
    toast.error(t('episode.asset.copyFailed'))
  }
}

async function saveAssetDetail() {
  const detail = assetDetail.value
  if (!detail.open || !detail.item?.id) return
  const item = detail.item
  // 只提交真正修改过的字段：无修改保存不应触发后端的提示词失效置空
  const payload = {}
  let infoChanged = false
  if (detail.type === 'character') {
    if (assetDetailDraft.value.appearance !== (item.appearance || '')) payload.appearance = assetDetailDraft.value.appearance
    if (assetDetailDraft.value.styling !== (item.styling || '')) payload.styling = assetDetailDraft.value.styling
  } else if (detail.type === 'scene') {
    if (assetDetailDraft.value.prompt !== (item.prompt || '')) payload.prompt = assetDetailDraft.value.prompt
    if (assetDetailDraft.value.lighting !== (item.lighting || '')) payload.lighting = assetDetailDraft.value.lighting
  } else {
    if (assetDetailDraft.value.description !== (item.description || '')) payload.description = assetDetailDraft.value.description
  }
  infoChanged = Object.keys(payload).length > 0
  // 手动编辑过最终提示词才提交；空串视为清空
  if (assetPromptDirty.value) payload.final_prompt = assetPromptDraft.value.trim() || ''
  if (!infoChanged && !assetPromptDirty.value) {
    toast.info(t('episode.asset.noChanges'))
    return
  }
  savingAssetDetail.value = true
  try {
    if (detail.type === 'character') await characterAPI.update(item.id, payload)
    else if (detail.type === 'scene') await sceneAPI.update(item.id, payload)
    else await propAPI.update(item.id, payload)
    // 本地同步：手动编辑的提示词以草稿为准；仅信息字段变更时提示词已被后端置空
    const { final_prompt, ...infoPatch } = payload
    const promptValue = assetPromptDirty.value ? (payload.final_prompt || null) : (infoChanged ? null : (item.final_prompt || item.finalPrompt || null))
    Object.assign(item, infoPatch, { final_prompt: promptValue, finalPrompt: promptValue })
    const list = detail.type === 'character' ? chars.value : detail.type === 'scene' ? scenes.value : propItems.value
    const target = list.find(x => x.id === item.id)
    if (target) Object.assign(target, infoPatch, { final_prompt: promptValue, finalPrompt: promptValue })
    if (assetPromptDirty.value) assetPromptDraft.value = payload.final_prompt || ''
    assetPromptDirty.value = false
    toast.success(t('episode.asset.saved'))
  } catch (e) {
    toastError(e, { fallback: 'episode.asset.saveFailed' })
  } finally {
    savingAssetDetail.value = false
  }
}

function assetImageSrc(item) {
  const raw = item?.image_url || item?.imageUrl || ''
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) return raw
  return `/${raw}`
}

function assetDetailTitle(detail) {
  if (!detail?.item) return ''
  if (detail.type === 'character') return detail.item.name || t('episode.asset.unnamedChar')
  if (detail.type === 'prop') return detail.item.name || t('episode.asset.unnamedProp')
  return detail.item.location || t('episode.asset.unnamedScene')
}

/** 资产详情弹窗 kicker / aria-label 用长标签 */
function assetTypeLabel(type) {
  return { character: t('episode.asset.typeChar'), scene: t('episode.asset.typeScene'), prop: t('episode.asset.typeProp') }[type] || t('episode.asset.fallbackType')
}

/** 资产详情预览图标题（角色形象/场景图/道具图） */
function assetDetailImageTitle(detail) {
  if (!detail?.item) return ''
  const kindLabel = detail.type === 'character' ? t('episode.asset.charPortrait') : detail.type === 'scene' ? t('episode.asset.sceneImage') : t('common.prop')
  return `${assetDetailTitle(detail)} ${kindLabel}`
}

function characterAppearanceValue(char) {
  return char?.appearance || t('episode.asset.appearanceTodo')
}

function characterStylingValue(char) {
  return char?.styling || t('episode.asset.stylingTodo')
}

function characterVisualSummary(char) {
  return `${t('episode.asset.appearance')}${characterAppearanceValue(char)} · ${t('episode.asset.styling')}${characterStylingValue(char)}`
}

function sceneDescriptionValue(scene) {
  return scene?.prompt || scene?.description || t('episode.asset.sceneDescTodo')
}

function sceneLightingValue(scene) {
  return scene?.lighting || t('episode.asset.sceneLightTodo')
}

function handleImageViewerKeydown(event) {
  if (event.key !== 'Escape') return
  if (imageViewer.value.open) closeImageViewer()
  else if (assetDetail.value.open) closeAssetDetail()
  else if (taskDrawer.value) closeTaskDrawer()
}

onMounted(() => {
  window.addEventListener('keydown', handleImageViewerKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleImageViewerKeydown)
  stopGenTasksPolling()
  videoWatch.stop()
  imageWatch.stop()
})

function isPendingSceneImage(id) {
  return pendingSceneImageIds.value.includes(id)
}

function isPendingVideo(id) {
  return pendingVideoIds.value.includes(id)
}

function videoFailMessage(id) {
  return failedVideoMessages.value[id] || ''
}

// 内容审核类失败（真人/敏感内容，如火山的 OutputVideoSensitiveContentDetected）：
// 各厂商审核尺度不同，给出切换模型重试的引导
function videoModerationHint(msg) {
  return MODERATION_RE.test(String(msg || '')) ? t('episode.vid.moderationHint') : ''
}

function videoTaskState(sb) {
  if (hasVid(sb)) return 'done'
  if (unknownVideoIds.value.includes(sb?.id)) return 'blocked'
  if (isPendingVideo(sb?.id)) return 'pending'
  if (videoFailMessage(sb?.id)) return 'failed'
  return 'ready'
}

function videoTaskStatusLabel(sb) {
  const state = videoTaskState(sb)
  if (state === 'done') return t('episode.status.done')
  if (state === 'pending') return t('episode.status.generating')
  if (state === 'blocked') return t('episode.tasks.unknown')
  if (state === 'failed') return t('episode.status.failed')
  return t('episode.status.todo')
}

function videoTaskActionLabel(sb) {
  const state = videoTaskState(sb)
  if (state === 'done') return t('episode.asset.regen')
  if (state === 'pending') return t('episode.asset.generating')
  if (state === 'blocked') return t('episode.tasks.unknown')
  return t('episode.asset.generate')
}

const allVideoTaskRows = computed(() => sbs.value.map((sb, index) => {
  const duration = Number(sb.duration || 5)
  const referenceCount = getVideoShotPlan(sb).references.length
  const sceneName = getSceneName(sb)
  return {
    id: sb.id,
    index,
    storyboard: sb,
    title: sb.description || t('episode.vid.shotN', { n: String(index + 1).padStart(2, '0') }),
    meta: sceneName,
    duration: Number.isFinite(duration) ? duration : 5,
    referenceCount,
    state: videoTaskState(sb),
    // 只有当前处于失败状态才显示错误,避免重试成功的分镜残留历史错误信息
    error: videoTaskState(sb) === 'failed' ? videoFailMessage(sb.id) : '',
  }
}))
// 列表筛选：点击顶部统计徽章过滤（再点一次取消）
const videoListFilter = ref('')
const videoTaskRows = computed(() => videoListFilter.value
  ? allVideoTaskRows.value.filter(task => task.state === videoListFilter.value)
  : allVideoTaskRows.value)
const videoTaskDoneCount = computed(() => allVideoTaskRows.value.filter(task => task.state === 'done').length)
const videoTaskFailedCount = computed(() => allVideoTaskRows.value.filter(task => task.state === 'failed').length)
function toggleVideoFilter(state) {
  videoListFilter.value = videoListFilter.value === state ? '' : state
}

// ===== 批量视频：选择模式 + 生成前确认（视频生成成本高，避免误触全量触发） =====
const videoSelectMode = ref(false)
const selectedVideoSbIds = ref([])
const batchVideoConfirm = ref({ open: false, previews: [], loading: false })
let batchVideoPreviewRun = 0
const batchVideoBlocked = computed(() => batchVideoConfirm.value.loading
  || !batchVideoConfirm.value.previews.length
  || batchVideoConfirm.value.previews.some(item => item.error || item.plan.issues.length)
  || Boolean(batchVideoBudgetIssue.value))
const batchVideoTotalDuration = computed(() =>
  batchVideoConfirm.value.previews.reduce((sum, item) => sum + Number(item.request.duration), 0))
const batchVideoCosts = computed(() => batchVideoConfirm.value.previews.map(item => item.prepared?.cost?.estimated_cost_thb))
const batchVideoCostKnown = computed(() => batchVideoCosts.value.length > 0 && batchVideoCosts.value.every(cost => typeof cost === 'number'))
const batchVideoEstimatedCost = computed(() => batchVideoCosts.value.reduce((sum, cost) => sum + (Number(cost) || 0), 0))
const batchVideoBudget = computed(() => batchVideoConfirm.value.previews.find(item => item.prepared?.cost)?.prepared?.cost?.remaining_thb ?? null)
const batchVideoBudgetIssue = computed(() => {
  if (batchVideoConfirm.value.loading || batchVideoBudget.value == null) return ''
  if (!batchVideoCostKnown.value) return t('productionGuard.needPrice')
  if (batchVideoEstimatedCost.value > batchVideoBudget.value) return t('productionGuard.overBudget')
  return ''
})
function formatBaht(value) { return `฿${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

function closeBatchVideoConfirm() {
  batchVideoPreviewRun++
  batchVideoConfirm.value = { open: false, previews: [], loading: false }
}

async function loadExportHealth() {
  if (!epId.value) return
  exportHealthLoading.value = true
  exportHealthError.value = ''
  try { exportHealth.value = await mergeAPI.health(epId.value) }
  catch (error) { exportHealthError.value = error.message || t('productionGuard.healthFailed') }
  finally { exportHealthLoading.value = false }
}

function clipHealthMessage(clip) {
  const source = clip.source_state === 'stale'
    ? `${t('productionGuard.sourceChanged')}: ${clip.changed_sources.map(key => t(`productionGuard.source.${key}`)).join(', ')}`
    : clip.source_state === 'untracked' ? t('productionGuard.sourceUnknown') : ''
  return [source, ...clip.errors.map(clipProblemLabel), ...clip.warnings
    .filter(warning => !warning.startsWith('Source changed:') && !warning.startsWith('Legacy clip:'))
    .map(clipProblemLabel)].filter(Boolean).join(' · ')
}
function clipProblemLabel(problem) {
  if (problem.startsWith('Clip duration differs')) return t('productionGuard.media.durationMismatch')
  const keys = {
    'No video selected': 'noVideo',
    'Video file is missing': 'missingFile',
    'Video file is empty or incomplete': 'incompleteFile',
    'No decodable video stream': 'noVideoStream',
    'Invalid duration': 'invalidDuration',
    'Invalid dimensions': 'invalidDimensions',
    'ffprobe could not read this video': 'unreadable',
    'No audio stream': 'noAudio',
    'Mixed aspect ratios in episode': 'mixedRatios',
  }
  return keys[problem] ? t(`productionGuard.media.${keys[problem]}`) : problem
}

function videoPreflightIssue(issue) {
  return t(`episode.vid.preflightIssues.${issue.code}`, {
    name: issue.name || t('episode.vid.unnamedReference'),
    count: issue.count,
    limit: issue.limit,
  })
}
function videoAssetKindLabel(kind) {
  return t(kind === 'scene' ? 'common.scene' : kind === 'prop' ? 'common.prop' : 'common.role')
}
function focusVideoPreflightShot(sb) {
  selectedSb.value = sb
  closeBatchVideoConfirm()
}

function isVideoSbSelected(id) { return selectedVideoSbIds.value.includes(id) }
function toggleVideoSbSelect(id) {
  selectedVideoSbIds.value = isVideoSbSelected(id)
    ? selectedVideoSbIds.value.filter(item => item !== id)
    : [...selectedVideoSbIds.value, id]
}
function toggleVideoSelectMode() {
  videoSelectMode.value = !videoSelectMode.value
  if (!videoSelectMode.value) selectedVideoSbIds.value = []
}
function onVideoTaskRowClick(sb) {
  if (videoSelectMode.value) toggleVideoSbSelect(sb.id)
  else selectedSb.value = sb
}

// 旁白角色识别：按内容语言的关键词匹配（提取产物中的旁白角色不参与画面生成）
function isNarratorCharacter(char) {
  const text = `${char?.name || ''} ${char?.role || ''}`.toLowerCase()
  return ['旁白', '画外音', 'narrator', 'ผู้บรรยาย', 'เสียงบรรยาย', 'ナレーター', 'ナレーション', '내레이션', '해설'].some(k => text.includes(k))
}

const visualChars = computed(() => chars.value.filter(c => !isNarratorCharacter(c)))
const lockedVideoConfigId = computed(() => episode.value?.video_config_id || episode.value?.videoConfigId || null)
// 集视频分辨率：顶栏直接修改（持久化 episodes.resolution，生成任务按此值锁定）。
// 内部统一存 480p/720p/1080p 三档，界面按当前选中的视频模型显示厂商原生档位
// （Seedance 480p/720p、MiniMax 768P/2K、Wan 3.0 480P/720P/1080P），适配器再映射为官方枚举
const RESOLUTION_TIERS = {
  volcengine: ['480p', '720p'],
  minimax: ['720p', '1080p'],
  aliyun: ['480p', '720p', '1080p'],
}
const RESOLUTION_DISPLAY = {
  volcengine: { '480p': '480p', '720p': '720p', '1080p': '720p' },
  minimax: { '480p': '768P', '720p': '768P', '1080p': '2K' },
  aliyun: { '480p': '480P', '720p': '720P', '1080p': '1080P' },
}
const resolutionProvider = computed(() => RESOLUTION_TIERS[selectedVideoConfig.value?.provider] ? selectedVideoConfig.value.provider : 'volcengine')
const resolutionOptions = computed(() => RESOLUTION_TIERS[resolutionProvider.value].map(key => ({
  key,
  model: `${RESOLUTION_DISPLAY[resolutionProvider.value][key]} · ${t(`episode.resolution.${key === '480p' ? 'smooth' : key === '720p' ? 'hd' : 'uhd'}`)}`,
})))
const episodeResolution = computed({
  get: () => {
    const v = episode.value?.resolution
    return resolutionOptions.value.some(o => o.key === v) ? v : '720p'
  },
  set: (val) => { void changeEpisodeResolution(val) },
})
async function changeEpisodeResolution(val) {
  if (!episode.value || val === episodeResolution.value) return
  const prev = episode.value.resolution
  episode.value.resolution = val
  const label = resolutionOptions.value.find(o => o.key === val)?.model || val
  try {
    await episodeAPI.update(epId.value, { resolution: val })
    toast.success(t('episode.vid.resolutionSwitched', { label }))
  } catch (e) {
    episode.value.resolution = prev
    toastError(e)
  }
}
// 画面比例在创建项目时固定，视频生成统一使用
const dramaAspectRatio = computed(() => drama.value?.aspect_ratio || drama.value?.aspectRatio || '16:9')

// 生成可选模型列表：配置中的模型数组（首位为配置默认）；API 可能返回数组或 JSON 字符串
function configModels(cfg) {
  const raw = cfg?.model
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try { const m = JSON.parse(raw); return Array.isArray(m) ? m.filter(Boolean) : [m].filter(Boolean) } catch { return [raw].filter(Boolean) }
}
// 汇总该类型全部启用配置的模型（按 厂商+模型 去重，按优先级排序），选中模型时连同所属配置一起调用
// 选中值使用 'provider/model' 复合键：同名模型可能来自不同厂商（如中转站与官方），必须区分
function collectModelOptions(cfgs) {
  const seen = new Set()
  const out = []
  const sorted = [...cfgs].filter(c => c.is_active).sort((a, b) => (b.priority || 0) - (a.priority || 0))
  for (const c of sorted) {
    for (const m of configModels(c)) {
      const key = `${c.provider}/${m}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ key, model: m, provider: c.provider, configId: c.id, configName: c.name || c.provider })
    }
  }
  return out
}
// 复合键 → 裸模型名（后端适配器按厂商校验模型名，不能带 provider 前缀）
function bareModelName(key) {
  if (!key) return ''
  const i = key.indexOf('/')
  return i >= 0 ? key.slice(i + 1) : key
}
function ownerConfigId(options, key) {
  return key ? (options.find(o => o.key === key)?.configId || undefined) : undefined
}
function hasMultiConfigs(options) {
  return new Set(options.map(o => o.configId)).size > 1
}
const textModelOptions = computed(() => collectModelOptions(textConfigs.value))
const imageModelOptions = computed(() => collectModelOptions(imageConfigs.value))
const videoModelOptions = computed(() => collectModelOptions(videoConfigs.value))
const selectedVideoConfig = computed(() => {
  const selected = videoModelOptions.value.find(option => option.key === videoModel.value)
  if (selected) return videoConfigs.value.find(config => config.id === selected.configId)
  const locked = videoConfigs.value.find(config => config.id === lockedVideoConfigId.value && config.is_active)
  if (locked) return locked
  return [...videoConfigs.value]
    .filter(config => config.is_active)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
})
const isWan3Video = computed(() => selectedVideoConfig.value?.provider === 'aliyun'
  || bareModelName(videoModel.value).startsWith('wan3.0-video'))

// 参考图上限（Wan 3.0 官方 10 张，其他模型 9 张），绑定素材收集与 @名字 映射统一读取
const refImageLimit = computed(() => isWan3Video.value ? 10 : 9)

// 本次生成的生效配置（模型/分辨率/时长），用于右侧小结与批量确认弹窗
const effectiveVideoModelLabel = computed(() => {
  const explicit = bareModelName(videoModel.value)
  if (explicit) return explicit
  return configModels(selectedVideoConfig.value)[0] || ''
})
const episodeResolutionLabel = computed(() =>
  resolutionOptions.value.find(o => o.key === episodeResolution.value)?.model || episodeResolution.value)
// 短档位标签（480p / 768P / 2K 等厂商原生档位），用于底部生效配置小结
const episodeResolutionShort = computed(() =>
  RESOLUTION_DISPLAY[resolutionProvider.value][episodeResolution.value] || episodeResolution.value)
const effectiveVideoDuration = computed(() => Number(selectedSb.value?.duration || 10))
async function openBatchVideoConfirm(pool) {
  const targets = pool.filter(s => !isPendingVideo(s.id) && !unknownVideoIds.value.includes(s.id))
  if (!targets.length) { toast.info(t('episode.vid.noneToGenerate')); return }
  const previews = targets.map(sb => {
    const plan = getVideoShotPlan(sb)
    const request = {
      type: 'video',
      storyboard_id: sb.id,
      drama_id: dramaId,
      prompt: plan.resolvedPrompt,
      duration: Number(sb.duration || 10),
      aspect_ratio: dramaAspectRatio.value,
      generate_audio: true,
      model: bareModelName(videoModel.value) || undefined,
      config_id: ownerConfigId(videoModelOptions.value, videoModel.value),
      reference_image_urls: plan.references,
    }
    return { sb, plan, request, prepared: null, error: '' }
  })
  const run = ++batchVideoPreviewRun
  batchVideoConfirm.value = { open: true, previews, loading: true }
  await Promise.all(previews.map(async item => {
    if (item.plan.issues.length) return
    try { item.prepared = await taskAPI.preflight(item.request) }
    catch (e) { item.error = e.message || t('episode.vid.preflightFailed') }
  }))
  if (run === batchVideoPreviewRun) batchVideoConfirm.value.loading = false
}
function batchVideos() {
  // 选择模式且有勾选 → 仅所选（允许重出已完成镜头）；否则全部未完成（待生成+失败）
  const useSelection = videoSelectMode.value && selectedVideoSbIds.value.length
  const pool = useSelection
    ? sbs.value.filter(s => selectedVideoSbIds.value.includes(s.id))
    : sbs.value.filter(s => !hasVid(s))
  openBatchVideoConfirm(pool)
}
function retryFailedVideos() {
  openBatchVideoConfirm(sbs.value.filter(s => videoTaskState(s) === 'failed'))
}
function confirmBatchVideos() {
  if (batchVideoBlocked.value) return
  const previews = [...batchVideoConfirm.value.previews]
  closeBatchVideoConfirm()
  const ids = previews.map(item => item.sb.id)
  previews.forEach(item => genVid(item.sb, { approved: true, request: item.request, silent: true }))
  toast.success(t('episode.vid.batchStarted', { n: ids.length }))
  if (videoSelectMode.value) toggleVideoSelectMode()
}

// 配置变化后校验持久化的模型是否仍存在（配置被删/模型被移除时回退默认，避免把失效模型传给后端）
function pruneStaleModel(modelRef, optionsRef) {
  watch(optionsRef, opts => {
    if (!modelRef.value || !opts.length) return
    if (opts.some(o => o.key === modelRef.value)) return
    // 旧版本地存储只有裸模型名：能对上则升级为复合键，对不上回退默认
    const legacy = opts.filter(o => o.model === modelRef.value)
    modelRef.value = legacy.length ? legacy[0].key : ''
  }, { immediate: true })
}
pruneStaleModel(chatModel, textModelOptions)
pruneStaleModel(imageModel, imageModelOptions)
pruneStaleModel(videoModel, videoModelOptions)
const textModelMultiCfg = computed(() => hasMultiConfigs(textModelOptions.value))
const imageModelMultiCfg = computed(() => hasMultiConfigs(imageModelOptions.value))
const videoModelMultiCfg = computed(() => hasMultiConfigs(videoModelOptions.value))

// Production step helpers
// ========== 任务列表面板 ==========
let genTasksLoading = null
function loadGenTasks() {
  genTasksLoading ??= loadGenTasksNow().finally(() => { genTasksLoading = null })
  return genTasksLoading
}
async function loadGenTasksNow() {
  if (!epId.value) return
  try {
    const data = await taskAPI.listByEpisode(epId.value)
    genTasks.value = data?.tasks || []
    genMerges.value = data?.merges || []

    // 生成中/失败状态只存在内存里,页面刷新后丢失;从 sys_task 记录按分镜恢复,
    // 否则已失败的镜头刷新后会退化成"待生成"
    const videoTasks = genTasks.value.filter(t => t.type === 'video' && t.storyboard_id)
    // 每个分镜只取最新一条任务(created_at 降序、id 兜底),旧任务不干预当前状态
    const latestBySb = new Map()
    for (const t of videoTasks) {
      const prev = latestBySb.get(t.storyboard_id)
      if (!prev
        || String(t.created_at || '') > String(prev.created_at || '')
        || (String(t.created_at || '') === String(prev.created_at || '') && t.id > prev.id)) {
        latestBySb.set(t.storyboard_id, t)
      }
    }
    // pending/failed 全量重建而非与现有值并集——否则刷新恢复的"生成中"在任务失败后
    // 永不消退(videoTaskState 中 pending 优先于 failed,重试按钮还被禁用)
    const pending = new Set()
    const unknown = new Set()
    const failed = {}
    for (const [sbId, t] of latestBySb) {
      // 分镜已有视频(失败后重试成功)时不再报历史错误
      if (hasVid(sbs.value.find(s => s.id === sbId))) continue
      if (['queued', 'submitting', 'processing'].includes(t.status)) pending.add(sbId)
      else if (t.status === 'unknown') unknown.add(sbId)
      else if (t.status === 'failed') failed[sbId] = t.error_msg || t('episode.status.failed')
    }
    // 刚点击提交、任务记录尚未加载出来的本地状态保留,避免状态闪退
    for (const id of pendingVideoIds.value) if (!latestBySb.has(id)) pending.add(id)
    for (const id of Object.keys(failedVideoMessages.value)) {
      if (!latestBySb.has(Number(id))) failed[id] = failedVideoMessages.value[id]
    }
    pendingVideoIds.value = [...pending]
    unknownVideoIds.value = [...unknown]
    failedVideoMessages.value = failed
    if (pending.size) videoWatch.start()
    resumeImageTasks(genTasks.value)
    if (selectedSb.value?.id) await loadSelectedShotReadiness()
  } catch { /* 静默失败,不打断其他刷新 */ }
}

function stopGenTasksPolling() {
  if (genTasksTimer) { clearInterval(genTasksTimer); genTasksTimer = null }
}

const genTaskActiveCount = computed(() =>
  genTasks.value.filter(t => ['queued', 'submitting', 'processing'].includes(t.status)).length +
  genMerges.value.filter(m => m.status === 'processing' || m.status === 'pending').length
)
const genTaskDoneCount = computed(() =>
  genTasks.value.filter(t => t.status === 'completed').length +
  genMerges.value.filter(m => m.status === 'completed').length
)
const genTaskFailedCount = computed(() =>
  genTasks.value.filter(t => t.status === 'failed').length +
  genMerges.value.filter(m => m.status === 'failed').length
)

function genTaskTargetLabel(task) {
  if (task.storyboard_id) {
    const sb = sbs.value.find(x => x.id === task.storyboard_id)
    return t('episode.tasks.sbN', { n: sb?.storyboard_number ?? sb?.storyboardNumber ?? task.storyboard_id })
  }
  if (task.character_id) {
    const c = chars.value.find(x => x.id === task.character_id)
    return `${t('common.role')} · ${c?.name || task.character_id}`
  }
  if (task.scene_id) {
    const s = scenes.value.find(x => x.id === task.scene_id)
    return `${t('common.scene')} · ${s?.location || task.scene_id}`
  }
  if (task.prop_id) {
    const p = propItems.value.find(x => x.id === task.prop_id)
    return `${t('common.prop')} · ${p?.name || task.prop_id}`
  }
  return t('episode.tasks.generic')
}

// 统一行结构：image / video / merge 三类合并按时间倒序
const genTaskRows = computed(() => {
  const taskRows = genTasks.value.map(t => ({
    key: `task-${t.id}`,
    kind: t.type, // image | video
    id: t.id,
    storyboardId: t.storyboard_id,
    slot: taskRowSlot(t),
    targetLabel: genTaskTargetLabel(t),
    provider: t.provider || '',
    model: t.model || '',
    status: t.status || 'processing',
    // Phase Unsloth: งาน local ที่รอคิว (provider ประกาศ maxConcurrent) — backend คำนวณตำแหน่งคิวให้
    queuePosition: t.queue_position ?? null,
    errorMsg: t.error_msg || '',
    errorCode: t.error_code || '',
    taskId: t.task_id || '',
    previewUrl: t.local_path || t.result_url || '',
    prompt: t.prompt || '',
    createdAt: t.created_at || '',
    completedAt: t.completed_at || '',
  }))
  const mergeRows = genMerges.value.map(m => ({
    key: `merge-${m.id}`,
    kind: 'merge',
    id: m.id,
    targetLabel: t('episode.tasks.fullMerge'),
    provider: m.provider || 'ffmpeg',
    model: m.model || '',
    status: m.status || 'pending',
    errorMsg: m.error_msg || '',
    previewUrl: m.merged_url || '',
    prompt: '',
    createdAt: m.created_at || '',
    completedAt: m.completed_at || '',
  }))
  return [...taskRows, ...mergeRows].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
})

function genTaskKindLabel(kind) {
  return kind === 'image' ? t('common.serviceType.image') : kind === 'video' ? t('common.serviceType.video') : t('episode.tasks.mergeKind')
}

function genTaskStatusLabel(status) {
  if (status === 'completed') return t('episode.status.done')
  if (status === 'failed') return t('episode.status.failed')
  if (status === 'unknown') return t('episode.tasks.unknown')
  if (status === 'queued') return t('episode.tasks.queued')
  return t('episode.status.generating')
}

// 映射到现有 video-task-status 的样式类:is-done / is-pending / is-failed
function genTaskStateClass(status) {
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'unknown') return 'blocked'
  return 'pending'
}

/** งานวิดีโอ local ที่รอคิว — แสดง "คิวที่ n" คู่กับสถานะ ไม่กระทบ provider อื่น */
function taskQueuePosition(row) {
  return row.kind === 'video' && row.status === 'queued' ? row.queuePosition : null
}

function taskRowSlot(task) {
  if (task.type === 'video') return 'video'
  let params = {}
  try { params = JSON.parse(task.params || '{}') } catch {}
  return params.frameType === 'first_frame' ? 'first_frame' : params.frameType === 'last_frame' ? 'last_frame' : 'composed'
}

async function selectImageCandidate(row) {
  try {
    const selected = await storyboardAPI.selectMedia(row.storyboardId, row.id, row.slot)
    const shot = sbs.value.find(sb => sb.id === row.storyboardId)
    const field = { composed: 'composed_image', first_frame: 'first_frame_image', last_frame: 'last_frame_image' }[row.slot]
    if (shot && field) shot[field] = selected.path
    toast.success(t('episode.tasks.candidateSelected'))
    await loadSelectedShotReadiness()
  } catch (error) { toastError(error) }
}

async function recoverProviderTask(row) {
  try {
    await taskAPI.recover(row.id)
    toast.success(t('episode.tasks.recoverStarted'))
    await loadGenTasks()
  } catch (error) { toastError(error) }
}

// local_path 为站内相对路径补 '/',远端 result_url 原样使用
function genTaskPreviewSrc(url) {
  if (!url) return ''
  return /^https?:\/\//.test(url) ? url : '/' + url
}

function genTaskDuration(row) {
  if (!row.createdAt || !row.completedAt) return ''
  const ms = new Date(row.completedAt).getTime() - new Date(row.createdAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  return ms >= 60000 ? `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`
}

// 抽屉打开且有进行中任务时,4s 轮询;关闭或全部结束时停止
watch([taskDrawer, genTaskActiveCount], ([open, active]) => {
  stopGenTasksPolling()
  if (open && active > 0) {
    genTasksTimer = setInterval(() => { if (!videoWatch.running && !imageWatch.running) loadGenTasks() }, 4000)
  }
})

const productionBlockMessage = computed(() => {
  if (!scriptContent.value) return t('episode.prod.scriptFirst')
  return ''
})
const productionBlockActionLabel = computed(() => {
  if (!scriptContent.value) return t('episode.export.gotoScript')
  return t('episode.prod.goBack')
})
function goProductionBlockTarget() {
  if (!scriptContent.value) {
    panel.value = 'script'
    scriptStep.value = rawContent.value ? 1 : 0
    return
  }
  panel.value = 'production'
  prodTab.value = 'assets'
}
const stepLabels = computed(() => [t('episode.script.raw'), t('episode.script.rewrite')])

const charImgCount = computed(() => visualChars.value.filter(c => c.image_url || c.imageUrl).length)
const sceneImgCount = computed(() => scenes.value.filter(s => s.image_url || s.imageUrl).length)
const propImgCount = computed(() => propItems.value.filter(p => p.image_url || p.imageUrl).length)
const shotVidCount = computed(() => sbs.value.filter(s => s.video_url || s.videoUrl).length)
const visualCharTotal = computed(() => visualChars.value.length)
const pendingCharacterImageCount = computed(() => Math.max(visualCharTotal.value - charImgCount.value, 0))
const pendingSceneImageCount = computed(() => Math.max(scenes.value.length - sceneImgCount.value, 0))
const pendingAssetImageCount = computed(() => pendingCharacterImageCount.value + pendingSceneImageCount.value)
const assetTotalCount = computed(() => visualCharTotal.value + scenes.value.length + propItems.value.length)
const assetReadyCount = computed(() => charImgCount.value + sceneImgCount.value + propImgCount.value)

const prodTabDefs = computed(() => [
  { id: 'assets', label: t('episode.prod.assets'), icon: FolderKanban, badge: assetTotalCount.value ? `${assetReadyCount.value}/${assetTotalCount.value}` : '' },
  { id: 'videos', label: t('episode.prod.videos'), icon: Clapperboard, badge: sbs.value.length ? `${shotVidCount.value}/${sbs.value.length}` : '' },
])

const mainStageDefs = computed(() => ([
  { id: 'script', label: t('episode.stage.script'), desc: t('episode.stage.scriptDesc'), icon: FileText },
  { id: 'assets', label: t('episode.prod.assets'), desc: t('episode.stage.assetsDesc'), icon: FolderKanban },
  { id: 'videos', label: t('episode.stage.videos'), desc: t('episode.stage.videosDesc'), icon: Clapperboard },
  { id: 'export', label: t('episode.stage.export'), desc: t('episode.stage.exportDesc'), icon: Download },
]))

const sidebarSections = computed(() => ([
  {
    id: 'script',
    label: t('episode.stage.script'),
    items: [
      { key: 'script:raw', label: t('episode.script.raw'), desc: '', icon: FileText },
      { key: 'script:rewrite', label: t('episode.script.rewrite'), desc: '', icon: FileText },
    ],
  },
  {
    id: 'production',
    label: t('episode.stage.production'),
    items: [
      { key: 'prod:assets', label: t('episode.prod.assets'), desc: '', icon: Users },
      { key: 'prod:videos', label: t('episode.prod.videos'), desc: '', icon: Clapperboard },
    ],
  },
  {
    id: 'export',
    label: t('episode.stage.export'),
    items: [
      { key: 'export:merge', label: t('episode.stage.mergeExport'), desc: '', icon: Download },
    ],
  },
]))

// 大环节状态:pending(未开始)/ active(进行中)/ done(已完成)/ none(不显示状态,导出用)
// 进行中 = 环节内有任意进度但未全部完成,或当前正处于该环节
function sectionState(sectionId) {
  if (sectionId === 'export') return 'none'
  const done = sectionId === 'script'
    ? mainStageDone('script')
    : mainStageDone('assets') && mainStageDone('videos')
  if (done) return 'done'

  const hasProgress = sectionId === 'script'
    ? !!(rawContent.value || scriptContent.value)
    : !!(chars.value.length || scenes.value.length || propItems.value.length || sbs.value.length || shotVidCount.value)
  const isCurrent = sectionId === 'script'
    ? panel.value === 'script'
    : panel.value === 'production'
  return (hasProgress || isCurrent) ? 'active' : 'pending'
}

const activeMainStage = computed(() => {
  if (panel.value === 'export') return 'export'
  if (panel.value === 'production') {
    return prodTab.value === 'assets' ? 'assets' : 'videos'
  }
  return 'script'
})

function mainStageDone(stageId) {
  if (stageId === 'script') return !!scriptContent.value
  if (stageId === 'assets') return assetTotalCount.value > 0 && assetReadyCount.value === assetTotalCount.value
  if (stageId === 'videos') {
    return !!sbs.value.length && shotVidCount.value === sbs.value.length
  }
  if (stageId === 'export') return exportDone.value
  return false
}

function goMainStage(stageId) {
  if (stageId === 'script') {
    panel.value = 'script'
    scriptStep.value = Math.min(scriptStep.value, 1)
    return
  }
  if (stageId === 'assets') {
    panel.value = 'production'
    prodTab.value = 'assets'
    return
  }
  if (stageId === 'videos') {
    panel.value = 'production'
    prodTab.value = 'videos'
    return
  }
  panel.value = 'export'
}

const activeSubStepKey = computed(() => {
  if (panel.value === 'script') {
    if (scriptStep.value === 0) return 'script:raw'
    return 'script:rewrite'
  }
  if (panel.value === 'production') return `prod:${prodTab.value}`
  return 'export:merge'
})

// 步骤跑马灯：四段主流程（剧本 → 资产制作 → 视频制作 → 导出），段点击跳转、当前段流动光效
const mainProgressSteps = computed(() => [
  { id: 'script', label: t('episode.stage.script') },
  { id: 'assets', label: t('episode.prod.assets') },
  { id: 'videos', label: t('episode.stage.videos') },
  { id: 'export', label: t('episode.stage.export') },
])
const currentMainIdx = computed(() => {
  const i = mainProgressSteps.value.findIndex(s => s.id === activeMainStage.value)
  return i < 0 ? 0 : i
})

function goSubStep(key) {
  if (key.startsWith('script:')) {
    panel.value = 'script'
    const stepMap = {
      'script:raw': 0,
      'script:rewrite': 1,
    }
    scriptStep.value = stepMap[key] ?? 0
    return
  }
  if (key.startsWith('prod:')) {
    panel.value = 'production'
    prodTab.value = key.replace('prod:', '')
    return
  }
  panel.value = 'export'
}

const pipelineTotal = 2
const pipelineProgress = computed(() =>
  ['script', 'production'].filter(id => sectionState(id) === 'done').length
)

const currentStageLabel = computed(() => {
  if (panel.value === 'script') return t('episode.stage.scriptStage', { step: stepLabels.value[scriptStep.value] })
  if (panel.value === 'production') return t('episode.stage.prodStage', { step: prodTabDefs.value[prodTabIdx.value]?.label || t('episode.stage.production') })
  return exportDone.value ? t('episode.stage.exportDone') : t('episode.stage.exportWaiting')
})

const currentMainStageLabel = computed(() => {
  const current = mainStageDefs.value.find(stage => stage.id === activeMainStage.value)
  return current?.label || t('episode.stage.workbench')
})

const currentSubStageLabel = computed(() => currentStageLabel.value)

const totalDuration = computed(() => sbs.value.reduce((s, sb) => s + (sb.duration || 10), 0))
const selectedSb = ref(null)
const selectedShotReadiness = ref(null)
async function loadSelectedShotReadiness() {
  const id = selectedSb.value?.id
  if (!id) { selectedShotReadiness.value = null; return }
  try {
    const result = await storyboardAPI.readiness(id)
    if (selectedSb.value?.id === id) selectedShotReadiness.value = result
  } catch { selectedShotReadiness.value = null }
}
watch(() => selectedSb.value?.id, loadSelectedShotReadiness)

function readinessBlockerLabel(blocker) {
  const code = blocker.code
  if (code === 'missing_prompt') return t('episode.tasks.missingPrompt')
  if (code === 'select_image_candidate') return t('episode.tasks.selectImageForSlot', { slot: blocker.slot })
  return t('episode.tasks.missingAsset', { name: blocker.name || code })
}
const selectedVideoTaskNumber = computed(() => {
  const index = videoTaskRows.value.findIndex(task => String(task.id) === String(selectedSb.value?.id))
  return index >= 0 ? index + 1 : 0
})

function updateField(sb, field, value) {
  const current = sb[field] ?? sb[toCamel(field)]
  if (current === value) return
  sb[field] = value
  const camelField = toCamel(field)
  if (camelField !== field) sb[camelField] = value
  storyboardAPI.update(sb.id, { [field]: value })
    .then(() => { if (field === 'video_prompt') loadSelectedShotReadiness() })
    .catch(e => toastError(e))
}

function toCamel(field) {
  return field.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

function getStoryboardCharacterIds(sb) {
  return sb?.character_ids || sb?.characterIds || []
}

function getStoryboardCharacters(sb) {
  const ids = getStoryboardCharacterIds(sb)
  return visualChars.value.filter(char => ids.includes(char.id))
}

function getStoryboardScene(sb) {
  const sceneId = sb?.scene_id || sb?.sceneId
  if (!sceneId) return null
  return scenes.value.find(s => s.id === sceneId) || null
}

function isStoryboardCharacterSelected(sb, charId) {
  return getStoryboardCharacterIds(sb).includes(charId)
}

function toggleStoryboardCharacter(sb, charId) {
  const currentIds = getStoryboardCharacterIds(sb)
  const nextIds = currentIds.includes(charId)
    ? currentIds.filter(id => id !== charId)
    : [...currentIds, charId]
  updateField(sb, 'character_ids', nextIds)
}

function getStoryboardPropIds(sb) {
  return sb?.prop_ids || sb?.propIds || []
}

function getStoryboardProps(sb) {
  const ids = getStoryboardPropIds(sb)
  return propItems.value.filter(p => ids.includes(p.id))
}

function isStoryboardPropSelected(sb, propId) {
  return getStoryboardPropIds(sb).includes(propId)
}

function toggleStoryboardProp(sb, propId) {
  const currentIds = getStoryboardPropIds(sb)
  const nextIds = currentIds.includes(propId)
    ? currentIds.filter(id => id !== propId)
    : [...currentIds, propId]
  updateField(sb, 'prop_ids', nextIds)
}

function getSceneName(sb) {
  const scene = getStoryboardScene(sb)
  if (!scene) return ''
  return `${scene.location} · ${scene.time || t('episode.asset.noTime')}`
}

const sceneOptions = computed(() => [
  { label: t('episode.sb.unboundScene'), value: '' },
  ...scenes.value.map(s => ({ label: `${s.location} · ${s.time || t('episode.asset.noTime')}`, value: s.id })),
])


function sceneShotCount(sceneId) {
  return sbs.value.filter(sb => String(sb?.scene_id || sb?.sceneId || '') === String(sceneId)).length
}

watch(rawContent, v => { localRaw.value = v }, { immediate: true })
watch(scriptContent, v => { localScript.value = v }, { immediate: true })

/** Reload only the shots (a video finished): keeps the selected shot and the multi-select. */
async function reloadStoryboards(episodeId = epId.value) {
  if (!episodeId) return
  sbs.value = await episodeAPI.storyboards(episodeId)
  selectedVideoSbIds.value = selectedVideoSbIds.value.filter(id => sbs.value.some(sb => sb.id === id))
  const currentSelectedId = selectedSb.value?.id
  selectedSb.value = sbs.value.find(sb => sb.id === currentSelectedId) || sbs.value[0] || null
}

async function refresh() {
  try {
    drama.value = await dramaAPI.get(dramaId)
    const ep = drama.value.episodes?.find(e => (e.episode_number || e.episodeNumber) === episodeNumber)
    if (ep) {
      episode.value = ep
      try { chars.value = await episodeAPI.characters(ep.id) } catch { chars.value = [] }
      try { scenes.value = await episodeAPI.scenes(ep.id) } catch { scenes.value = [] }
      try { propItems.value = await episodeAPI.props(ep.id) } catch { propItems.value = [] }
      await reloadStoryboards(ep.id)
      const [looksResult, assignmentsResult] = await Promise.allSettled([
        characterAPI.looks(dramaId), episodeAPI.characterLooks(ep.id),
      ])
      characterLooks.value = looksResult.status === 'fulfilled' ? looksResult.value : []
      shotLookAssignments.value = assignmentsResult.status === 'fulfilled' ? assignmentsResult.value : []

      const epHasContent = !!(episode.value?.content)
      const epHasScript = !!(episode.value?.script_content || episode.value?.scriptContent)

      if (panelRestored) {
        // 已恢复到上次所在步骤，跳过自动重置（仅首次加载生效）
        panelRestored = false
      } else if (epHasScript || epHasContent) scriptStep.value = 1
      else scriptStep.value = 0
    }
  } catch (e) {
    toastError(e)
  }
  try { mergeData.value = await mergeAPI.status(epId.value) } catch {}
  await Promise.all([loadGenTasks(), loadExportMerges()])
}

function saveRaw() { episodeAPI.update(epId.value, { content: localRaw.value }); episode.value.content = localRaw.value }
function saveScr() { episodeAPI.update(epId.value, { script_content: localScript.value }); episode.value.script_content = localScript.value }
// 发给 Agent 的 message 是功能性提示词而非 UI 文案：产出语言由后端全局「内容语言」指令控制，
// 这里保持中文不随界面语言变化
async function doRewrite() {
  saveRaw()
  await runAgent('script_rewriter', '请读取剧本并改写为格式化剧本，然后保存', dramaId, epId.value, refresh, chatModelOverride(), chatConfigId())
  // Auto Review & Optimize（项目设置开启时）：改写完成立即跑一遍审校优化
  if (drama.value?.metadata?.auto_review) {
    try {
      const res = await episodeAPI.reviewScript(epId.value)
      toast.info(t('episode.script.reviewDone', { summary: String(res?.summary || '').slice(0, 160) }))
    } catch (e) {
      toastError(e)
    }
    refresh()
  }
  // ผลิตต่ออัตโนมัติ（auto_pipeline）：แต่งบท/ตรวจทานจบ → เริ่มแยกตัวละคร/ฉาก/พร็อพทันที
  if (drama.value?.metadata?.auto_pipeline) {
    if (!extractingTargets.value.length) doExtractAll()
    toast.info(t('episode.script.pipelineContinued'))
  }
}
function skipRewrite() {
  const raw = (localRaw.value || rawContent.value || '').trim()
  if (!raw) {
    toast.warning(t('episode.script.rawRequired'))
    return
  }
  localScript.value = raw
  saveScr()
  toast.success(t('episode.script.skipDone'))
  panel.value = 'production'
  prodTab.value = 'assets'
}
// 资产提取：按类型独立的异步任务（后端任务表驱动），三类可并行；前端轮询状态直到完成
// label 渲染时求值（语言切换即时生效），key 为逻辑值
const EXTRACT_TARGETS = computed(() => [
  { key: 'characters', label: t('common.role') },
  { key: 'scenes', label: t('common.scene') },
  { key: 'props', label: t('common.prop') },
])
const extractingTargets = ref([])
const extractingLabels = computed(() => EXTRACT_TARGETS.value.filter(x => extractingTargets.value.includes(x.key)).map(x => x.label).join(t('common.listJoin')))
function isExtracting(target) { return extractingTargets.value.includes(target) }

function doExtract(target) {
  if (isExtracting(target) || !epId.value) return
  saveScr()
  extractingTargets.value.push(target)
  episodeAPI.extract(epId.value, target, chatModelOverride(), chatConfigId())
    .then(() => pollExtractStatus(target))
    .catch(e => {
      extractingTargets.value = extractingTargets.value.filter(x => x !== target)
      toastError(e)
    })
}
function doExtractAll() { EXTRACT_TARGETS.value.forEach(x => doExtract(x.key)) }

// ยกเลิกงานแยกองค์ประกอบ（协作式 cancel）：สถานะ cancelled จะหลุดจาก polling เอง
async function cancelExtract(target) {
  try { await episodeAPI.cancelExtract(epId.value, target) } catch (e) { toastError(e) }
}
function cancelAllExtracts() { extractingTargets.value.forEach(t => cancelExtract(t)) }

async function cancelVideoPromptBatch() {
  try {
    await episodeAPI.cancelVideoPrompts(epId.value)
    toast.info(t('episode.sb.batchCancelling'))
  } catch (e) { toastError(e) }
}

function pollExtractStatus(target, attempts = 150) {
  const label = EXTRACT_TARGETS.value.find(x => x.key === target)?.label || target
  const tick = async (left) => {
    try {
      const st = await episodeAPI.extractStatus(epId.value)
      const task = st?.[target]
      if (task && task.status !== 'running') {
        extractingTargets.value = extractingTargets.value.filter(x => x !== target)
        if (task.status === 'done') {
          toast.success(t('episode.extract.done', { type: label }))
          await refresh()
        } else if (task.status === 'cancelled') {
          toast.info(t('episode.extract.cancelled', { type: label }))
        } else {
          toastError(task.error, { fallback: 'episode.extract.failed' })
        }
        return
      }
    } catch {}
    if (left > 0) setTimeout(() => tick(left - 1), 2500)
    else extractingTargets.value = extractingTargets.value.filter(x => x !== target)
  }
  setTimeout(() => tick(attempts), 2500)
}

/** 页面加载后恢复仍在运行的提取任务状态（刷新页面不丢进度展示） */
async function syncExtractStatus() {
  if (!epId.value) return
  try {
    const st = await episodeAPI.extractStatus(epId.value)
    for (const x of EXTRACT_TARGETS.value) {
      if (st?.[x.key]?.status === 'running' && !isExtracting(x.key)) {
        extractingTargets.value.push(x.key)
        pollExtractStatus(x.key)
      }
    }
  } catch {}
  try {
    const vp = await episodeAPI.videoPromptsStatus(epId.value)
    if (vp?.status === 'running' && !videoPromptBatch.value.running) {
      videoPromptBatch.value = { running: true, total: vp.total || 0, completed: vp.completed || 0 }
      pollVideoPromptBatch()
    }
  } catch {}
}

// ─── 批量视频提示词：后端异步逐分镜生成，前端轮询进度 ──────────
const videoPromptBatch = ref({ running: false, total: 0, completed: 0 })
// 单个视频提示词生成：按分镜 ID 跟踪，允许不同分镜并行生成（不走全局 rn 锁）
const videoPromptGeneratingIds = ref([])
// 视频制作页多选快捷操作：全选 / 仅选未生成视频（勾选集与批量视频共用 selectedVideoSbIds）
function toggleSelectAllVideos() {
  selectedVideoSbIds.value = selectedVideoSbIds.value.length === sbs.value.length ? [] : sbs.value.map(sb => sb.id)
}
function selectMissingVideos() {
  selectedVideoSbIds.value = sbs.value.filter(sb => !hasVid(sb)).map(sb => sb.id)
}

async function batchVideoPrompts() {
  if (videoPromptBatch.value.running || !epId.value) return
  if (!sbs.value.length) { toast.warning(t('episode.sb.breakFirst')); return }
  // 选择模式下有勾选 → 仅补齐所选；否则全量补齐缺失
  const ids = (videoSelectMode.value && selectedVideoSbIds.value.length) ? [...selectedVideoSbIds.value] : undefined
  try {
    const res = await episodeAPI.generateVideoPrompts(epId.value, chatModelOverride(), chatConfigId(), ids)
    if (!res?.total) {
      if (res?.already_running) {
        videoPromptBatch.value = { running: true, total: 0, completed: 0 }
        pollVideoPromptBatch()
      } else toast.info(ids ? t('episode.sb.selectedMissing') : t('episode.sb.allHavePrompts'))
      return
    }
    videoPromptBatch.value = { running: true, total: res.total, completed: 0 }
    toast.info(t('episode.sb.batchStarted', { n: res.total }))
    pollVideoPromptBatch()
  } catch (e) {
    toastError(e)
  }
}

function pollVideoPromptBatch(attempts = 240) {
  const tick = async (left) => {
    try {
      const st = await episodeAPI.videoPromptsStatus(epId.value)
      if (st && st.status !== 'running') {
        videoPromptBatch.value = { running: false, total: 0, completed: 0 }
        await refresh()
        if (st.status === 'done') {
          toast.success(st.failed ? t('episode.sb.batchDoneFailed', { n: st.failed }) : t('episode.sb.batchDone'))
        } else if (st.status === 'cancelled') {
          toast.info(t('episode.sb.batchCancelled', { done: st.completed, total: st.total }))
        } else {
          toastError(st.error, { fallback: 'episode.sb.batchFailed' })
        }
        return
      }
      if (st) {
        const prev = videoPromptBatch.value.completed
        videoPromptBatch.value = { running: true, total: st.total || 0, completed: st.completed || 0 }
        if ((st.completed || 0) !== prev) await refresh() // 每完成一条刷新，提示词逐步出现
      }
    } catch {}
    if (left > 0) setTimeout(() => tick(left - 1), 2500)
    else videoPromptBatch.value = { running: false, total: 0, completed: 0 }
  }
  setTimeout(() => tick(attempts), 2500)
}
function doBreakdown() {
  const charList = chars.value.length
    ? chars.value.map(c => `${c.name}(ID:${c.id})`).join('、')
    : '（当前集还没有角色）'
  const sceneList = scenes.value.length
    ? scenes.value.map(s => `${s.location} · ${s.time || '未设时间'}(ID:${s.id})`).join('、')
    : '（当前集还没有场景）'
  const propList = propItems.value.length
    ? propItems.value.map(p => `${p.name}(ID:${p.id})`).join('、')
    : '（当前集还没有道具）'
  runAgent('storyboard_breaker', `请基于当前集剧本拆分分镜，并为每个分镜段落同时生成 video_prompt（视频生成提示词）。
本次视频模型：${effectiveVideoModelLabel.value}，请按该模型的特性与时长限制生成 video_prompt。

当前集已有角色：${charList}
当前集已有场景：${sceneList}
当前集已有道具：${propList}

绑定要求：
- 每个镜头必须根据剧本内容，从上述当前集已有角色中选出出场的角色绑定 character_ids（ID 必须来自上述列表；有角色出场就必须绑定，不要遗漏）
- 每个镜头尽量匹配上述已有场景填写 scene_id（ID 必须来自上述列表），不要凭空创造新场景
- 每个镜头出现关键道具（被使用、交接、特写或在画面中明显可见）时，从上述当前集已有道具中绑定 prop_ids（ID 必须来自上述列表）；没有道具出现可传空数组
- 只有纯环境空镜头才可以不绑定角色`, dramaId, epId.value, onBreakdownDone, chatModelOverride(), chatConfigId())
}

/** 拆分完成后刷新并自动补齐缺失的视频提示词（兜住 Agent 漏写/截断） */
async function onBreakdownDone() {
  await refresh()
  const missing = sbs.value.filter(sb => !(sb.video_prompt || sb.videoPrompt || '').trim())
  if (missing.length) batchVideoPrompts()
}

// 按需为单个分镜生成视频提示词：由 prompt_generator 读取分镜字段生成并保存到 video_prompt
async function genVideoPrompt(sb) {
  if (!sb || videoPromptGeneratingIds.value.includes(sb.id)) return
  const idx = sbs.value.indexOf(sb) + 1
  const cfg = selectedVideoConfig.value
  const label = cfg ? `${cfg.name} (${cfg.provider})` : '默认'
  const charNames = getStoryboardCharacters(sb).map(c => c.name).join('、') || '无'
  const propNames = getStoryboardProps(sb).map(p => p.name).join('、') || '无'
  videoPromptGeneratingIds.value.push(sb.id)
  try {
    await api.post(`/agent/prompt_generator/chat`, {
      message: `请为分镜 #${idx}(ID:${sb.id})生成视频提示词(video_prompt)。视频模型:${label},请根据该模型的特性和时长限制生成。

该分镜信息:时长 ${sb.duration || 10}s;场景:${getSceneName(sb) || '未绑定'};角色:${charNames};道具:${propNames}。

请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围及时长,据此生成 video_prompt(按 3 秒分段换行、用 @角色名/@场景名/@道具名 引用参考素材；段落内允许多镜头切镜,但不跨场景,切镜点对齐 description 的【镜头N】结构),然后调用 update_storyboard 保存到分镜 ID:${sb.id}。只更新 video_prompt 字段,不要改动其他字段,不要重新拆分整集。`,
      drama_id: dramaId,
      episode_id: epId.value,
      model: chatModelOverride() || undefined,
      config_id: chatConfigId() || undefined,
    })
    toast.success(t('episode.sb.promptGenerated', { n: idx }))
    await refresh()
  } catch (e) {
    toastError(e)
  } finally {
    videoPromptGeneratingIds.value = videoPromptGeneratingIds.value.filter(id => id !== sb.id)
  }
}

async function genAssetImage(kind, id, api, generatingKey) {
  const list = assetLists[kind].value
  try {
    markImagePending(kind, [id])
    const item = list.find(x => x.id === id)
    if (item && !(item.final_prompt || item.finalPrompt)) {
      toast.info(t('episode.asset.generatingPrompt'))
      try {
        await ensureAssetPrompt(kind, id)
      } catch {} // 提示词生成失败不阻断：后端生图前会再兜底生成或回退本地拼接
    }
    const res = await api.generateImage(id, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId())
    toast.success(t(generatingKey))
    imageWatch.track(res?.image_generation_id, imageKey(kind, id))
    await loadGenTasks()
  } catch (e) {
    dropPendingImage(kind, [id])
    toastError(e)
  }
}
function genCharImg(id) { return genAssetImage('character', id, characterAPI, 'episode.image.generatingChar') }
function genSceneImg(id) { return genAssetImage('scene', id, sceneAPI, 'episode.image.generatingScene') }
function genPropImg(id) { return genAssetImage('prop', id, propAPI, 'episode.image.generatingProp') }
function isPendingPropImage(id) {
  return pendingPropImageIds.value.includes(id)
}
function batchCharImages() {
  const ids = visualChars.value.filter(c => !(c.image_url || c.imageUrl)).map(c => c.id)
  if (!ids.length) { toast.info(t('episode.image.allCharsDone')); return }
  markImagePending('character', ids)
  characterAPI.batchImages(ids, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId()).then(async res => {
    toast.success(t('episode.image.batchGeneratingChar'))
    // the batch answers with task ids only: the task list says which character each one is for
    const taskIds = new Set(res?.ids || [])
    await loadGenTasks()
    const started = []
    for (const task of genTasks.value) {
      const target = imageTaskTarget(task)
      if (!taskIds.has(task.id) || target?.[0] !== 'character') continue
      imageWatch.track(task.id, imageKey('character', target[1]))
      started.push(target[1])
    }
    dropPendingImage('character', ids.filter(id => !started.includes(id))) // skipped by the server
  }).catch(e => {
    dropPendingImage('character', ids)
    toastError(e)
  })
}
function batchAssetImages(kind, items, api, doneKey, startedKey) {
  const ids = items.filter(x => !(x.image_url || x.imageUrl)).map(x => x.id)
  if (!ids.length) { toast.info(t(doneKey)); return }
  markImagePending(kind, ids)
  for (const id of ids) {
    api.generateImage(id, epId.value, bareModelName(imageModel.value) || undefined, ownerConfigId(imageModelOptions.value, imageModel.value), chatModelOverride(), chatConfigId())
      .then(res => imageWatch.track(res?.image_generation_id, imageKey(kind, id)))
      .catch(e => { dropPendingImage(kind, [id]); toastError(e) })
  }
  toast.success(t(startedKey))
}
function batchSceneImages() {
  batchAssetImages('scene', scenes.value, sceneAPI, 'episode.image.allScenesDone', 'episode.image.batchGeneratingScene')
}
function batchPropImages() {
  batchAssetImages('prop', propItems.value, propAPI, 'episode.image.allPropsDone', 'episode.image.batchGeneratingProp')
}
function getVideoUrl(s) { return s?.video_url || s?.videoUrl || s?.composed_video_url || s?.composedVideoUrl || null }
function hasVid(s) { return !!getVideoUrl(s) }

function looksForCharacter(characterId) {
  return characterLooks.value.filter(look => look.character_id === characterId)
}
function shotLookId(sb, characterId) {
  return shotLookAssignments.value.find(row => row.storyboard_id === sb?.id && row.character_id === characterId)?.look_id || null
}
function characterImageForShot(sb, character) {
  const lookId = shotLookId(sb, character.id)
  return lookId ? characterLooks.value.find(look => look.id === lookId)?.image_url || '' : character.image_url || character.imageUrl || ''
}
async function setShotCharacterLook(characterId, value) {
  const sb = selectedSb.value
  if (!sb) return
  const lookId = value ? Number(value) : null
  try {
    await storyboardAPI.assignLook(sb.id, characterId, lookId)
    shotLookAssignments.value = shotLookAssignments.value.filter(row => !(row.storyboard_id === sb.id && row.character_id === characterId))
    if (lookId) shotLookAssignments.value.push({ storyboard_id: sb.id, character_id: characterId, look_id: lookId })
    await loadSelectedShotReadiness()
  } catch (error) { toastError(error) }
}
function uploadCharacterLook(characterId) {
  pickFile('image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', async file => {
    uploadingLook.value = true
    try {
      const uploaded = await uploadAPI.image(file)
      const name = newLookName.value.trim() || file.name.replace(/\.[^.]+$/, '')
      const look = await characterAPI.createLook(characterId, { name, image_url: uploaded.path })
      characterLooks.value.push(look)
      newLookName.value = ''
      toast.success(t('episode.tasks.lookAdded'))
    } catch (error) { toastError(error) }
    finally { uploadingLook.value = false }
  })
}
async function deleteCharacterLook(look) {
  try {
    await characterAPI.deleteLook(look.character_id, look.id)
    characterLooks.value = characterLooks.value.filter(row => row.id !== look.id)
    toast.success(t('index.deleted'))
  } catch (error) { toastError(error) }
}

// ===== 分镜视频历史（一个分镜可能生成多个视频,sys_task 留存全部记录）=====
const sbVideoHistory = ref([])
const previewVideoUrl = ref('') // 正在预览的历史视频(相对路径);空 = 预览当前主视频

// 注意:/tasks 返回原始行(camelCase),/episodes/:id/generation-tasks 返回 snake_case,两种命名都兼容
function taskVideoPath(t) { return t?.local_path || t?.localPath || t?.result_url || t?.resultUrl || '' }
function taskCreatedAt(t) { return t?.created_at || t?.createdAt || '' }
function isCurrentVideo(t) { const p = taskVideoPath(t); return !!p && p === getVideoUrl(selectedSb.value) }

async function loadSbVideoHistory() {
  previewVideoUrl.value = ''
  if (!selectedSb.value?.id) { sbVideoHistory.value = []; return }
  try {
    const rows = await taskAPI.list({ type: 'video', storyboard_id: selectedSb.value.id })
    sbVideoHistory.value = (Array.isArray(rows) ? rows : [])
      .filter(t => t.status === 'completed' && taskVideoPath(t))
      .sort((a, b) => taskCreatedAt(b).localeCompare(taskCreatedAt(a)))
  } catch { sbVideoHistory.value = [] }
}

watch(() => [selectedSb.value?.id, getVideoUrl(selectedSb.value)], () => { loadSbVideoHistory() })

function previewHistoryVideo(t) {
  previewVideoUrl.value = isCurrentVideo(t) ? '' : taskVideoPath(t)
}

async function setAsMainVideo() {
  const sb = selectedSb.value
  if (!sb || !previewVideoUrl.value) return
  try {
    const candidate = sbVideoHistory.value.find(task => taskVideoPath(task) === previewVideoUrl.value)
    if (!candidate) return
    const selected = await storyboardAPI.selectMedia(sb.id, candidate.id, 'video')
    sb.video_url = selected.path
    sb.videoUrl = selected.path
    await loadSelectedShotReadiness()
    toast.success(t('episode.vid.setMainDone'))
  } catch (e) { toastError(e, { fallback: 'episode.vid.setMainFailed' }) }
}

async function removeHistoryVideo(t) {
  try {
    await taskAPI.del(t.id)
    sbVideoHistory.value = sbVideoHistory.value.filter(x => x.id !== t.id)
    if (previewVideoUrl.value === taskVideoPath(t)) previewVideoUrl.value = ''
    toast.success(t('episode.vid.historyDeleted'))
  } catch (e) { toastError(e, { fallback: 'common.deleteFailed' }) }
}

function formatHistoryTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function getVideoShotPlan(sb) {
  const assets = []
  const scene = getStoryboardScene(sb)
  if (scene) assets.push({ kind: 'scene', name: scene.location, url: scene.image_url || scene.imageUrl || '' })
  else if (sb?.scene_id || sb?.sceneId) assets.push({ kind: 'scene', name: `#${sb.scene_id || sb.sceneId}`, url: '' })
  for (const char of getStoryboardCharacters(sb)) {
    assets.push({ kind: 'character', name: char.name, url: characterImageForShot(sb, char) })
  }
  for (const prop of getStoryboardProps(sb)) {
    assets.push({ kind: 'prop', name: prop.name, url: prop.image_url || prop.imageUrl || '' })
  }
  return analyzeVideoShot({
    prompt: sb?.video_prompt || sb?.videoPrompt || '',
    assets,
    limit: refImageLimit.value,
    duration: Number(sb?.duration || 10),
  })
}

async function confirmCurrentVideo() {
  const sb = selectedSb.value
  const candidate = sbVideoHistory.value.find(isCurrentVideo)
  if (!sb || !candidate) return
  try {
    await storyboardAPI.selectMedia(sb.id, candidate.id, 'video')
    await loadSelectedShotReadiness()
    toast.success(t('episode.tasks.videoConfirmed'))
  } catch (error) { toastError(error) }
}

// 右侧参考素材面板：本集全部可绑定素材（场景单选、角色/道具多选），bound 标记是否已绑定
// kind 为英文 code（逻辑值）；typeLabel 为显示名（渲染时求值）
function shotBindableAssets(sb) {
  const out = []
  for (const char of visualChars.value) {
    const imageUrl = characterImageForShot(sb, char)
    out.push({
      key: `character-${char.id}`,
      id: char.id,
      kind: 'character',
      typeLabel: t('common.role'),
      name: char.name || t('episode.asset.unnamedChar'),
      meta: char.role || t('episode.asset.charPortrait'),
      imageUrl,
      ready: !!imageUrl,
      bound: getStoryboardCharacterIds(sb).includes(char.id),
    })
  }
  for (const scene of scenes.value) {
    const imageUrl = scene.image_url || scene.imageUrl || ''
    out.push({
      key: `scene-${scene.id}`,
      id: scene.id,
      kind: 'scene',
      typeLabel: t('common.scene'),
      name: `${scene.location} · ${scene.time || t('episode.asset.noTime')}`,
      meta: scene.time || t('episode.asset.sceneImage'),
      imageUrl,
      ready: !!imageUrl,
      bound: (sb?.scene_id || sb?.sceneId) === scene.id,
    })
  }
  for (const prop of propItems.value) {
    const imageUrl = prop.image_url || prop.imageUrl || ''
    out.push({
      key: `prop-${prop.id}`,
      id: prop.id,
      kind: 'prop',
      typeLabel: t('common.prop'),
      name: prop.name || t('episode.asset.unnamedProp'),
      meta: prop.type || t('episode.asset.propSingleImage'),
      imageUrl,
      ready: !!imageUrl,
      bound: getStoryboardPropIds(sb).includes(prop.id),
    })
  }
  // 固定顺序（角色→场景→道具，按资产原顺序）：点击绑定/解绑不重排，避免跳动
  return out
}

// 右侧参考素材面板渲染用：当前分镜可绑定的全部素材
const refBindableAssets = computed(() => {
  const sb = selectedSb.value
  return sb ? shotBindableAssets(sb) : []
})

// 右栏「绑定参考图」：当前分镜已绑定素材（生成时作为参考图提交），按分组顺序平铺展示
const boundRefAssets = computed(() => refBindableAssets.value.filter(a => a.bound))

// 参考面板分组顺序（kind code 驱动，label 渲染时求值）
const REF_KINDS = computed(() => ([
  { kind: 'character', label: t('common.role') },
  { kind: 'scene', label: t('common.scene') },
  { kind: 'prop', label: t('common.prop') },
]))

// 右侧面板切换绑定：场景单选（切换/解绑），角色/道具多选（kind code 判断，不依赖显示文案）
function toggleShotBind(sb, asset) {
  if (asset.kind === 'scene') {
    const current = sb?.scene_id || sb?.sceneId
    updateField(sb, 'scene_id', current === asset.id ? null : asset.id)
    return
  }
  if (asset.kind === 'character') {
    toggleStoryboardCharacter(sb, asset.id)
    return
  }
  toggleStoryboardProp(sb, asset.id)
}

// 视频提示词 @ 引用候选：仅当前分镜已绑定的角色与道具（按名字引用）、场景（按地点引用），展示顺序：角色 → 场景 → 道具
// kind 为逻辑值（MentionTextarea 按 kind 着色/选图标），group 为显示文案
const mentionOptions = computed(() => {
  const sb = selectedSb.value
  if (!sb) return []
  const scene = getStoryboardScene(sb)
  return [
    ...getStoryboardCharacters(sb).map(c => ({
      label: c.name,
      value: c.name,
      kind: 'character',
      group: t('common.role'),
      image: thumbOf(assetImageSrc({ imageUrl: characterImageForShot(sb, c) })),
    })),
    ...(scene ? [{
      label: `${scene.location} · ${scene.time || t('episode.asset.noTime')}`,
      value: scene.location,
      kind: 'scene',
      group: t('common.scene'),
      image: thumbOf(assetImageSrc(scene)),
    }] : []),
    ...getStoryboardProps(sb).map(p => ({
      label: p.name,
      value: p.name,
      kind: 'prop',
      group: t('common.prop'),
      image: thumbOf(assetImageSrc(p)),
    })),
  ]
})

// 分镜时长（视频生成参数区直接编辑并保存到分镜）：
// 统一限制 2-30s，列表/批量/单次生成统一读取该值；超出厂商支持范围由后端适配器收敛
function onVideoDurationChange(e) {
  const sb = selectedSb.value
  if (!sb) return
  const min = 2
  const max = 30
  let v = Math.round(Number(e.target.value))
  if (!Number.isFinite(v)) v = Number(sb.duration || 10)
  v = Math.min(max, Math.max(min, v))
  e.target.value = v
  updateField(sb, 'duration', v)
}

function pickFile(accept, cb) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.onchange = () => { const f = input.files?.[0]; if (f) cb(f) }
  input.click()
}

// ===== 资产图片手动上传（角色形象 / 场景图 / 道具图）=====
// 上传类型显示名渲染时求值
const assetUploadLabelMap = computed(() => ({
  character: t('episode.asset.charPortrait'),
  scene: t('episode.asset.sceneImage'),
  prop: t('episode.asset.propImage'),
}))
const uploadingAssetKeys = ref([])
function isUploadingAsset(kind, id) { return uploadingAssetKeys.value.includes(`${kind}:${id}`) }
function uploadAssetImage(kind, id) {
  pickFile('image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp', async (file) => {
    const key = `${kind}:${id}`
    if (!uploadingAssetKeys.value.includes(key)) uploadingAssetKeys.value.push(key)
    try {
      const res = await uploadAPI.image(file)
      // 与生图回写保持一致：存相对路径（static/...），前端展示时补前导斜杠
      const payload = { image_url: res.path, local_path: res.path }
      if (kind === 'character') await characterAPI.update(id, payload)
      else if (kind === 'scene') await sceneAPI.update(id, payload)
      else await propAPI.update(id, payload)
      toast.success(t('episode.upload.assetDone', { type: assetUploadLabelMap.value[kind] || '' }))
      await refresh()
    } catch (e) {
      toastError(e)
    } finally {
      uploadingAssetKeys.value = uploadingAssetKeys.value.filter(k => k !== key)
    }
  })
}

async function genVid(sb, opts = {}) {
  if (!opts.approved) {
    await openBatchVideoConfirm([sb])
    return
  }
  try {
    delete failedVideoMessages.value[sb.id]
    if (!isPendingVideo(sb.id)) pendingVideoIds.value.push(sb.id)
    const generation = await taskAPI.generate(opts.request)
    if (!opts.silent) toast.success(t('episode.vid.generating'))
    videoWatch.track(generation?.id, sb.id)
    await loadGenTasks()
  } catch (e) {
    pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== sb.id)
    failedVideoMessages.value = {
      ...failedVideoMessages.value,
      [sb.id]: e.message || t('episode.vid.genFailed'),
    }
    toastError(e, { fallback: 'episode.vid.genFailed' })
  }
}
// ===== video status: one watcher for the whole page (../utils/taskWatch.js) =====
// One task-list request every 4 s for every shot being generated; the shots reload only when a video
// finished. Stops when the page closes; loadGenTasks restarts it for shots still generating on reopen.
function dropPendingVideo(storyboardId) {
  pendingVideoIds.value = pendingVideoIds.value.filter(item => item !== storyboardId)
}
const videoWatch = createTaskWatch({
  pendingKeys: () => pendingVideoIds.value,
  loadTasks: async () => { await loadGenTasks(); return genTasks.value },
  reload: () => reloadStoryboards(),
  isDone: id => !!getVideoUrl(sbs.value.find(s => s.id === id)),
  onExpired: dropPendingVideo,
  onFinished: (storyboardId, task) => {
    dropPendingVideo(storyboardId)
    if (task.status === 'completed') {
      delete failedVideoMessages.value[storyboardId]
      toast.success(t('episode.vid.genDone'))
    } else if (task.status === 'failed') {
      const errMsg = task.error_msg || task.errorMsg || t('episode.vid.genFailed')
      failedVideoMessages.value = { ...failedVideoMessages.value, [storyboardId]: errMsg }
      toastError(errMsg, { fallback: 'episode.vid.genFailed' })
    } else {
      if (!unknownVideoIds.value.includes(storyboardId)) unknownVideoIds.value.push(storyboardId)
      toast.warning(t('episode.tasks.unknown'))
    }
  },
})

// ===== character / scene / prop images: one watcher for the whole page (../utils/taskWatch.js) =====
// Every image used to start its own loop that reloaded the whole page (≈10 requests) every 2.5 s. Now one
// task-list request every 3 s covers every image being made, and only characters, scenes and props reload
// when one finished. Images are followed by their task id, so a regenerated image is not "done" just
// because the old one is still there, and a failed one says so and frees its button. Keys: 'character:12'.
const pendingImageIds = { character: pendingCharImageIds, scene: pendingSceneImageIds, prop: pendingPropImageIds }
const imageKey = (kind, id) => `${kind}:${id}`
function imageKeyParts(key) {
  const [kind, id] = key.split(':')
  return [kind, Number(id)]
}
function markImagePending(kind, ids) {
  pendingImageIds[kind].value = [...new Set([...pendingImageIds[kind].value, ...ids])]
}
function dropPendingImage(kind, ids) {
  pendingImageIds[kind].value = pendingImageIds[kind].value.filter(id => !ids.includes(id))
}
/** the asset a sys_task makes an image for: [kind, id], or null (shot frames, other menus) */
function imageTaskTarget(task) {
  if (task.type !== 'image' || task.storyboard_id) return null
  if (task.character_id) return ['character', task.character_id]
  if (task.scene_id) return ['scene', task.scene_id]
  if (task.prop_id) return ['prop', task.prop_id]
  return null
}
/** images still being made after the page (re)opened: show them as generating and follow them.
 *  Only each asset's latest task counts (the list is newest first), so an old stuck task cannot hold a button. */
function resumeImageTasks(tasks) {
  const seen = new Set()
  for (const task of tasks) {
    const target = imageTaskTarget(task)
    if (!target || seen.has(imageKey(...target))) continue
    seen.add(imageKey(...target))
    if (!['queued', 'submitting', 'processing'].includes(task.status) || imageWatch.has(imageKey(...target))) continue
    markImagePending(target[0], [target[1]])
    imageWatch.track(task.id, imageKey(...target))
  }
}
async function reloadAssets(episodeId = epId.value) {
  if (!episodeId) return
  const [c, sc, pr] = await Promise.allSettled([
    episodeAPI.characters(episodeId), episodeAPI.scenes(episodeId), episodeAPI.props(episodeId),
  ])
  if (c.status === 'fulfilled') chars.value = c.value
  if (sc.status === 'fulfilled') scenes.value = sc.value
  if (pr.status === 'fulfilled') propItems.value = pr.value
}
const assetLists = { character: chars, scene: scenes, prop: propItems }
const imageWatch = createTaskWatch({
  intervalMs: 3000,
  maxMs: 15 * 60 * 1000,
  pendingKeys: () => Object.entries(pendingImageIds).flatMap(([kind, ids]) => ids.value.map(id => imageKey(kind, id))),
  loadTasks: async () => { await loadGenTasks(); return genTasks.value },
  reload: () => reloadAssets(),
  isDone: key => {
    const [kind, id] = imageKeyParts(key)
    const item = assetLists[kind].value.find(x => x.id === id)
    return !!(item?.image_url || item?.imageUrl)
  },
  onExpired: key => {
    const [kind, id] = imageKeyParts(key)
    dropPendingImage(kind, [id])
    toast.info(t('episode.image.genTimeout'))
  },
  onFinished: (key, task) => {
    const [kind, id] = imageKeyParts(key)
    dropPendingImage(kind, [id])
    if (task.status !== 'completed') toastError(task.error_msg || task.errorMsg, { fallback: 'episode.image.genFailed' })
  },
})
async function doMerge(ids) {
  const storyboardIds = Array.isArray(ids) ? ids : undefined
  if (storyboardIds && !storyboardIds.length) {
    toast.error(t('episode.export.selectFirst'))
    return
  }
  try {
    const health = await mergeAPI.health(epId.value, storyboardIds)
    if (!health.ready) {
      exportHealth.value = health
      toast.error(t('productionGuard.fixClips'))
      return
    }
    await mergeAPI.merge(epId.value, storyboardIds)
    toast.success(t('episode.export.mergingToast'))
  } catch (e) {
    toastError(e, { fallback: 'episode.export.mergeFailed' })
    return
  }
  const poll = setInterval(async () => {
    try { mergeData.value = await mergeAPI.status(epId.value) } catch {}
    if (mergeData.value?.status === 'completed' || mergeData.value?.status === 'failed') {
      clearInterval(poll)
      if (mergeData.value.status === 'completed') {
        toast.success(t('episode.export.mergeDone'))
        loadExportMerges()
      } else {
        toastError(mergeData.value?.error_msg || mergeData.value?.errorMsg, { fallback: 'episode.export.mergeFailed' })
      }
    }
  }, 3000)
}
async function loadConfigs() {
  try {
    const [imgCfgs, vidCfgs, txtCfgs] = await Promise.all([
      aiConfigAPI.list('image'),
      aiConfigAPI.list('video'),
      aiConfigAPI.list('text'),
    ])
    imageConfigs.value = imgCfgs || []
    videoConfigs.value = vidCfgs || []
    textConfigs.value = txtCfgs || []
  } catch (e) { console.error('Failed to load AI configs', e) }
}

onMounted(async () => { await refresh(); loadConfigs(); syncExtractStatus() })

// ===== 应用内引导（工作台）：沿左侧进度栏走 6 步流水线 =====
const EPISODE_TOUR = [
  { element: '.studio-topbar-main', titleKey: 'tour.episode.topbar.title', descKey: 'tour.episode.topbar.desc', popoverSide: 'bottom' },
  { element: '.pipe-section:nth-of-type(1)', titleKey: 'tour.episode.script.title', descKey: 'tour.episode.script.desc', popoverSide: 'right' },
  { element: '.pipe-section:nth-of-type(2)', titleKey: 'tour.episode.assets.title', descKey: 'tour.episode.assets.desc', popoverSide: 'right' },
  { element: '.pipe-section:nth-of-type(2) .pipe-item:last-child', titleKey: 'tour.episode.videos.title', descKey: 'tour.episode.videos.desc', popoverSide: 'right' },
  { element: '.studio-actions .tour-help-btn', titleKey: 'tour.episode.help.title', descKey: 'tour.episode.help.desc', popoverSide: 'bottom', popoverAlign: 'end' },
]
onMounted(() => setTimeout(() => autoTour('episode', EPISODE_TOUR, t), 900))

// The lazy parts render from the page's state: everything their templates use is handed down here
// (refs stay refs, so v-model and assignments in their templates write back to the page).
provide(EPISODE_WORKBENCH, {
  EXTRACT_TARGETS, REF_KINDS, VIDEO_COL_DEFAULTS, activeMerge, allVideoTaskRows, askDeleteAsset,
  assetDetail, assetDetailDraft, assetDetailImageTitle, assetDetailTitle, assetFinalPrompt,
  assetImageSrc, assetPromptDraft, assetReadyCount, assetTotalCount, assetTypeLabel, batchCharImages,
  batchPropImages, batchSceneImages, batchVideoPrompts, batchVideos, boundRefAssets, cancelAllExtracts,
  cancelVideoPromptBatch, characterAppearanceValue, characterStylingValue, characterVisualSummary,
  chars, clipHealthMessage, closeAssetDetail, closeTaskDrawer, confirmCurrentVideo,
  copyAssetFinalPrompt, deleteCharacterLook, doBreakdown, doExtract, doExtractAll, doMerge, doRewrite,
  dramaAspectRatio, effectiveVideoDuration, effectiveVideoModelLabel, episode, episodeResolutionShort,
  exportDone, exportHealth, exportHealthError, exportHealthLoading, exportMerges, exportReadyIds,
  exportSelectedReadyIds, extractingLabels, extractingTargets, formatHistoryTime, genAssetFinalPrompt,
  genCharImg, genPropImg, genSceneImg, genTaskActiveCount, genTaskDoneCount, genTaskDuration,
  genTaskFailedCount, genTaskKindLabel, genTaskPreviewSrc, genTaskRows, genTaskStateClass,
  genTaskStatusLabel, genVid, genVideoPrompt, getVideoUrl, hasVid, isAssetImagePending, isCurrentVideo,
  isExportSelected, isExtracting, isGeneratingPrompt, isPendingCharImage, isPendingPropImage,
  isPendingSceneImage, isUploadingAsset, isVideoSbSelected, loadExportHealth, loadExportMerges,
  loadGenTasks, localRaw, localScript, looksForCharacter, mentionOptions, newLookName,
  onAssetPromptInput, onVideoDurationChange, onVideoTaskRowClick, openAssetCreate, openAssetDetail,
  openImageViewer, panel, pendingVideoIds, previewHistoryVideo, previewShot, previewVideoUrl, prodTab,
  propItems, rawContent, rawLen, readinessBlockerLabel, recoverProviderTask, refBindableAssets,
  removeHistoryVideo, retryFailedVideos, rn, rt, saveAssetDetail, saveRaw, savingAssetDetail,
  sbVideoHistory, sbs, sceneDescriptionValue, sceneLightingValue, scenes, scriptContent, scriptLen,
  scriptStep, selectImageCandidate, selectMissingVideos, selectedSb, selectedShotReadiness,
  selectedVideoSbIds, selectedVideoTaskNumber, setAsMainVideo, setShotCharacterLook, shotLookId,
  shotVidCount, skipRewrite, startVideoColDrag, t, taskCreatedAt, taskQueuePosition, taskVideoPath,
  toggleExportDone, toggleExportSelect, toggleSelectAllExport, toggleSelectAllVideos, toggleShotBind,
  toggleVideoFilter, toggleVideoSelectMode, totalDuration, updateField, uploadAssetImage,
  uploadCharacterLook, uploadingLook, videoLeftW, videoListFilter, videoModerationHint,
  videoPromptBatch, videoPromptGeneratingIds, videoRightW, videoSelectMode, videoTaskActionLabel,
  videoTaskDoneCount, videoTaskFailedCount, videoTaskRows, videoTaskState, videoTaskStatusLabel,
  visualChars,
})
// the open part starts downloading now, alongside the page's data; the others once the browser is idle
const loadOpenPart = { script: loadScriptPanel, production: prodTab.value === 'videos' ? loadVideosTab : loadAssetsTab, export: loadExportPanel }[panel.value]
loadOpenPart?.().catch(() => {})
const preloadParts = () => [loadScriptPanel, loadAssetsTab, loadVideosTab, loadExportPanel, loadTaskDrawer, loadAssetDetail]
  .forEach(load => load().catch(() => {}))
onMounted(() => (window.requestIdleCallback || (fn => setTimeout(fn, 1500)))(preloadParts))
</script>

<!-- Plain CSS under the page's root class .ep-workbench (not scoped: the lazy parts in ./episode/ share it). -->
<style src="./episode/workbench.css"></style>
