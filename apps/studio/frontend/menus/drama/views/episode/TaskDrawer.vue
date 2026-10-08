<template>
  <div class="task-drawer-overlay" @click.self="closeTaskDrawer">
    <aside class="task-drawer" role="dialog" aria-modal="true" :aria-label="t('episode.tasks.title')">
      <header class="task-drawer-head">
        <div>
          <div class="video-task-title">{{ t('episode.tasks.title') }}</div>
          <div class="video-task-meta">{{ t('episode.tasks.meta', { n: genTaskRows.length }) }}</div>
        </div>
        <div class="task-drawer-head-actions">
          <button class="btn btn-sm" @click="loadGenTasks">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            {{ t('common.refresh') }}
          </button>
          <button class="btn btn-ghost btn-icon" @click="closeTaskDrawer"><X :size="14" /></button>
        </div>
      </header>
      <div class="video-task-metrics task-drawer-metrics">
        <span class="video-task-metric is-pending">{{ t('episode.vid.metricPending', { n: genTaskActiveCount }) }}</span>
        <span class="video-task-metric is-done">{{ t('episode.vid.metricDone', { n: genTaskDoneCount }) }}</span>
        <span class="video-task-metric is-failed">{{ t('episode.vid.metricFailed', { n: genTaskFailedCount }) }}</span>
      </div>
      <div v-if="!genTaskRows.length" class="step-empty task-drawer-empty">
        <div class="empty-visual">
          <ListTodo :size="32" />
        </div>
        <div class="empty-title">{{ t('episode.tasks.emptyTitle') }}</div>
        <div class="empty-desc">{{ t('episode.tasks.emptyDesc') }}</div>
      </div>
      <div v-else class="video-task-table task-drawer-body">
        <div
          v-for="row in genTaskRows"
          :key="row.key"
          :class="['video-task-row', 'gen-task-row', 'is-' + genTaskStateClass(row.status)]"
        >
          <div class="video-task-preview">
            <video
              v-if="row.previewUrl && (row.kind === 'video' || row.kind === 'merge')"
              :src="genTaskPreviewSrc(row.previewUrl)"
              :poster="posterOf(genTaskPreviewSrc(row.previewUrl)) || undefined"
              controls
              preload="none"
              playsinline
            />
            <img
              v-else-if="row.previewUrl"
              :src="thumbOf(genTaskPreviewSrc(row.previewUrl))"
              :alt="row.targetLabel"
              loading="lazy"
              @error="thumbFallback($event, genTaskPreviewSrc(row.previewUrl))"
              @click="openImageViewer(genTaskPreviewSrc(row.previewUrl), row.targetLabel)"
            />
            <div v-else class="video-task-empty">
              <Loader2 v-if="genTaskStateClass(row.status) === 'pending'" :size="18" class="animate-spin" />
              <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <span class="video-task-index">{{ genTaskKindLabel(row.kind) }}</span>
          </div>
          <div class="video-task-main">
            <div class="video-task-line">
              <strong class="video-task-name truncate">{{ row.targetLabel }}</strong>
            </div>
            <div class="video-task-meta-line">
              <span class="video-task-loc truncate">{{ row.provider }}{{ row.model ? ' · ' + row.model : '' }}</span>
              <template v-if="genTaskDuration(row)">
                <span class="video-task-sep">·</span>
                <span>{{ t('episode.tasks.duration', { dur: genTaskDuration(row) }) }}</span>
              </template>
              <span class="video-task-sep">·</span>
              <span>#{{ row.id }}</span>
            </div>
            <div v-if="row.errorMsg" class="video-task-error" :title="row.errorMsg">
              {{ mapError(row.errorMsg) }}
              <div v-if="row.kind === 'video' && videoModerationHint(row.errorMsg)" class="video-task-error-hint">{{ videoModerationHint(row.errorMsg) }}</div>
              <div v-if="row.provider === 'wancreate' && row.errorCode === '9006'" class="video-task-error-hint">{{ t('episode.tasks.wan9006Hint') }}</div>
            </div>
            <button v-if="row.kind === 'image' && row.status === 'completed' && row.storyboardId" class="btn btn-ghost btn-sm" @click="selectImageCandidate(row)">{{ t('episode.tasks.selectCandidate') }}</button>
            <button v-if="row.status === 'unknown' && row.taskId" class="btn btn-ghost btn-sm" @click="recoverProviderTask(row)">{{ t('episode.tasks.recover') }}</button>
          </div>
          <span :class="['video-task-status', 'is-' + genTaskStateClass(row.status)]">
            <span :class="['dot', genTaskStateClass(row.status) === 'done' && 'ok', genTaskStateClass(row.status) === 'pending' && 'pending']" />
            {{ genTaskStatusLabel(row.status) }}
          </span>
          <span v-if="taskQueuePosition(row) != null" class="video-task-status is-pending">
            {{ t('episode.tasks.queuePosition', { n: taskQueuePosition(row) }) }}
          </span>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup>
// Episode workbench · generation task drawer. Markup only: lazy-loaded by views/episode.vue, which owns
// the state (inject EPISODE_WORKBENCH) and loads the styles (./workbench.css).
import { inject } from 'vue'
import { ListTodo, Loader2, X } from 'lucide-vue-next'
import { mapError } from '~/composables/useToast'
import { EPISODE_WORKBENCH } from '../../utils/episodeWorkbench.js'

const {
  closeTaskDrawer, episode, genTaskActiveCount, genTaskDoneCount, genTaskDuration, genTaskFailedCount,
  genTaskKindLabel, genTaskPreviewSrc, genTaskRows, genTaskStateClass, genTaskStatusLabel, loadGenTasks,
  openImageViewer, recoverProviderTask, selectImageCandidate, t, taskQueuePosition, videoModerationHint,
} = inject(EPISODE_WORKBENCH)
</script>
