<template>
  <div class="content-panel">
    <div v-if="!sbs.length" class="step-empty" style="flex:1">
      <div class="empty-visual">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </div>
      <div class="empty-title">{{ t('episode.prod.notReady') }}</div>
      <div class="empty-desc">{{ t('episode.export.notReadyDesc') }}</div>
      <button class="btn btn-primary" @click="panel = 'script'">{{ t('episode.export.gotoScript') }}</button>
    </div>
    <div v-else class="export-split">
      <div class="export-main">
        <!-- 上方:成片列表 -->
        <div class="export-section">
          <div class="export-section-head">
            <span class="export-section-title">{{ t('episode.export.filmList') }}</span>
            <span class="dim" style="font-size:11px">{{ t('episode.export.countN', { n: exportMerges.length }) }}</span>
            <button
              :class="['btn btn-sm ml-auto export-done-btn', { on: exportDone }]"
              :title="t('episode.export.markDoneTitle')"
              @click="toggleExportDone"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {{ exportDone ? t('episode.export.markedDone') : t('episode.export.markDone') }}
            </button>
            <button class="btn btn-sm" @click="loadExportMerges">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              {{ t('common.refresh') }}
            </button>
          </div>
          <div v-if="exportMerges.length" class="export-merge-strip">
            <div
              v-for="m in exportMerges"
              :key="m.id"
              :class="['merge-card', m.status === 'completed' && m.merged_url && 'playable']"
              :role="m.status === 'completed' && m.merged_url ? 'button' : undefined"
              :tabindex="m.status === 'completed' && m.merged_url ? 0 : undefined"
              @click="m.status === 'completed' && m.merged_url && (activeMerge = m)"
              @keydown.enter.prevent="m.status === 'completed' && m.merged_url && (activeMerge = m)"
            >
              <div class="merge-card-thumb">
                <video
                  v-if="m.status === 'completed' && m.merged_url"
                  :src="'/' + m.merged_url"
                  :poster="posterOf('/' + m.merged_url) || undefined"
                  preload="none"
                  muted
                  playsinline
                  tabindex="-1"
                />
                <div v-else :class="['merge-card-pending', m.status === 'failed' && 'is-failed']" :title="m.status === 'failed' ? m.error_msg : null">
                  {{ m.status === 'failed' ? mapError(m.error_msg, { fallback: 'episode.export.mergeFailed' }) : t('episode.export.merging') }}
                </div>
                <span v-if="m.status === 'completed' && m.merged_url" class="merge-card-play">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                </span>
              </div>
              <div class="merge-card-meta">
                <span class="mono">{{ formatHistoryTime(m.created_at) }}</span>
                <span v-if="m.duration">· {{ m.duration }}s</span>
                <a
                  v-if="m.status === 'completed' && m.merged_url"
                  :href="'/' + m.merged_url"
                  download
                  class="btn btn-sm"
                  @click.stop
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {{ t('common.download') }}
                </a>
              </div>
            </div>
          </div>
          <div v-else class="export-merge-empty">{{ t('episode.export.empty') }}</div>
        </div>

        <!-- 下方:镜头素材(可勾选) -->
        <div class="export-section export-section-grow">
          <div class="export-section-head">
            <span class="export-section-title">{{ t('episode.export.shotAssets') }}</span>
            <span class="dim" style="font-size:11px">{{ t('episode.export.shotStat', { done: shotVidCount, total: sbs.length, selected: exportSelectedReadyIds.length }) }}</span>
            <div class="ml-auto flex gap-1">
              <button class="btn btn-sm" :disabled="!exportReadyIds.length" @click="toggleSelectAllExport">
                {{ exportSelectedReadyIds.length === exportReadyIds.length && exportReadyIds.length ? t('episode.export.clearSelection') : t('episode.export.selectAllReady') }}
              </button>
              <button
                class="btn btn-sm btn-primary"
                :disabled="!exportSelectedReadyIds.length"
                @click="doMerge(exportSelectedReadyIds)"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                {{ t('episode.export.mergeSelected', { n: exportSelectedReadyIds.length }) }}
              </button>
            </div>
          </div>
          <div class="export-health-panel" aria-live="polite">
            <div class="export-health-summary">
              <span>{{ t('productionGuard.exportHealth') }}</span>
              <span v-if="exportHealth">{{ t('productionGuard.healthSummary', { errors: exportHealth.error_count, warnings: exportHealth.warning_count }) }}</span>
              <button class="btn btn-sm" type="button" :disabled="exportHealthLoading" @click="loadExportHealth">{{ t('common.refresh') }}</button>
            </div>
            <p v-if="exportHealthLoading" class="dim">{{ t('productionGuard.checkingClips') }}</p>
            <p v-if="exportHealthError" role="alert">{{ exportHealthError }}</p>
            <template v-if="exportHealth">
              <div v-for="clip in exportHealth.clips.filter(row => row.errors.length || row.warnings.length)" :key="clip.storyboard_id" class="export-health-line" :class="{ 'is-error': clip.errors.length }">
                <strong>S{{ clip.shot_number }}</strong>
                <span>{{ clipHealthMessage(clip) }}</span>
              </div>
            </template>
          </div>
          <div class="export-grid">
            <div
              v-for="(sb, i) in sbs"
              :key="sb.id"
              :class="['exp-card', { selected: isExportSelected(sb.id), playable: hasVid(sb) }]"
              :role="hasVid(sb) ? 'button' : undefined"
              :tabindex="hasVid(sb) ? 0 : undefined"
              @click="toggleExportSelect(sb)"
              @keydown.enter.prevent="toggleExportSelect(sb)"
            >
              <div class="exp-thumb">
                <video
                  v-if="hasVid(sb)"
                  :src="'/' + getVideoUrl(sb)"
                  :poster="posterOf('/' + getVideoUrl(sb)) || undefined"
                  preload="none"
                  muted
                  playsinline
                  tabindex="-1"
                />
                <div v-else class="exp-thumb-empty">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                </div>
                <span class="exp-thumb-index">#{{ String(i+1).padStart(2,'0') }}</span>
                <span v-if="sb.duration" class="exp-thumb-duration">{{ sb.duration }}s</span>
                <span
                  v-if="hasVid(sb)"
                  class="exp-play"
                  :title="t('episode.export.previewShot')"
                  @click.stop="previewShot = sb"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                </span>
                <span v-if="hasVid(sb)" :class="['exp-check', isExportSelected(sb.id) && 'on']">
                  <svg v-if="isExportSelected(sb.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </span>
              </div>
              <div class="exp-row-line">
                <span class="truncate" style="flex:1;font-size:11px">{{ sb.description || sb.title || '—' }}</span>
                <span :class="['dot', hasVid(sb) && 'ok']" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// Episode workbench · merge + export. Markup only: lazy-loaded by views/episode.vue, which owns
// the state (inject EPISODE_WORKBENCH) and loads the styles (./workbench.css).
import { inject } from 'vue'
import { mapError } from '~/composables/useToast'
import { EPISODE_WORKBENCH } from '../../utils/episodeWorkbench.js'

const {
  activeMerge, clipHealthMessage, doMerge, episode, exportDone, exportHealth, exportHealthError,
  exportHealthLoading, exportMerges, exportReadyIds, exportSelectedReadyIds, formatHistoryTime,
  getVideoUrl, hasVid, isExportSelected, loadExportHealth, loadExportMerges, panel, previewShot, sbs,
  shotVidCount, t, toggleExportDone, toggleExportSelect, toggleSelectAllExport,
} = inject(EPISODE_WORKBENCH)
</script>
