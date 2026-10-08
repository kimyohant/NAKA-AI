<template>
  <div class="prod-content">
    <div class="prod-section-bar">
      <span class="dim" style="font-size:12px">{{ t('episode.prod.videos') }}</span>
      <span class="tag mono">{{ t('episode.sb.segmentStat', { n: sbs.length, dur: totalDuration }) }}</span>
      <span class="tag mono" :title="t('episode.vid.aspectRatio')">{{ dramaAspectRatio }}</span>
      <div class="ml-auto flex gap-1">
        <button class="btn btn-sm" :disabled="rn" @click="doBreakdown">
          <Loader2 v-if="rt === 'storyboard_breaker'" :size="11" class="animate-spin" />
          <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          {{ sbs.length ? t('episode.sb.rebreak') : t('episode.sb.startBreak') }}
        </button>
        <button class="btn btn-sm" :disabled="videoPromptBatch.running || !sbs.length" @click="batchVideoPrompts">
          <Loader2 v-if="videoPromptBatch.running" :size="11" class="animate-spin" />
          <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          {{ videoPromptBatch.running ? t('episode.sb.promptProgress', { done: videoPromptBatch.completed, total: videoPromptBatch.total }) : (videoSelectMode && selectedVideoSbIds.length ? t('episode.sb.promptSelected', { n: selectedVideoSbIds.length }) : t('episode.sb.batchPrompts')) }}
        </button>
        <button v-if="videoPromptBatch.running" class="btn btn-sm" @click="cancelVideoPromptBatch">
          {{ t('common.cancel') }}
        </button>
        <button v-if="videoTaskFailedCount" class="btn btn-sm video-retry-failed" @click="retryFailedVideos">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          {{ t('episode.vid.retryFailed', { n: videoTaskFailedCount }) }}
        </button>
        <button class="btn btn-sm" :class="{ 'is-on': videoSelectMode }" @click="toggleVideoSelectMode">
          {{ videoSelectMode ? t('episode.vid.selectDone', { n: selectedVideoSbIds.length }) : t('episode.vid.select') }}
        </button>
        <button class="btn btn-sm" :disabled="!sbs.length" @click="batchVideos">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          {{ videoSelectMode && selectedVideoSbIds.length ? t('episode.vid.batchSelected', { n: selectedVideoSbIds.length }) : t('episode.vid.batchVideos') }}
        </button>
      </div>
    </div>
    <div v-if="!sbs.length" class="step-empty video-task-empty-state">
      <div class="empty-visual">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="2" y="2" width="20" height="20" rx="2.5"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/></svg>
      </div>
      <div class="empty-title">{{ t('episode.sb.emptyTitle') }}</div>
      <div class="empty-desc">{{ t('episode.sb.emptyDesc') }}</div>
      <div class="locked-config-banner">{{ t('episode.vid.lockedModel') }}{{ effectiveVideoModelLabel }}</div>
      <button class="btn btn-primary" :disabled="rn" @click="doBreakdown">
        <Loader2 v-if="rt === 'storyboard_breaker'" :size="13" class="animate-spin" />
        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        {{ t('episode.sb.startBreak') }}
      </button>
    </div>
    <div v-else class="video-task-workbench has-player" :style="{ '--vleft': videoLeftW + 'px', '--vright': videoRightW + 'px' }">
      <section class="video-task-list">
        <div class="video-task-head">
        <div>
          <div class="video-task-title">{{ t('episode.vid.listTitle') }}</div>
          <div class="video-task-meta">{{ videoListFilter ? t('episode.vid.listMetaFiltered', { n: videoTaskRows.length, total: allVideoTaskRows.length }) : t('episode.vid.listMeta', { n: videoTaskRows.length }) }}</div>
        </div>
        <div class="video-task-metrics">
          <button type="button" class="video-task-metric is-pending" :class="{ on: videoListFilter === 'pending' }" @click="toggleVideoFilter('pending')">{{ t('episode.vid.metricPending', { n: pendingVideoIds.length }) }}</button>
          <button type="button" class="video-task-metric is-done" :class="{ on: videoListFilter === 'done' }" @click="toggleVideoFilter('done')">{{ t('episode.vid.metricDone', { n: videoTaskDoneCount }) }}</button>
          <button type="button" class="video-task-metric is-failed" :class="{ on: videoListFilter === 'failed' }" @click="toggleVideoFilter('failed')">{{ t('episode.vid.metricFailed', { n: videoTaskFailedCount }) }}</button>
        </div>
        </div>
        <div v-if="videoSelectMode" class="shot-quick-actions video-quick-actions">
          <button class="shot-quick-btn" @click="toggleSelectAllVideos">{{ t('episode.sb.selectAll') }}</button>
          <button class="shot-quick-btn" @click="selectMissingVideos">{{ t('episode.vid.selectMissing') }}</button>
          <button class="shot-quick-btn" @click="selectedVideoSbIds = []">{{ t('episode.sb.clear') }}</button>
        </div>
        <div class="video-task-table">
        <div
          v-for="task in videoTaskRows"
          :key="task.id"
          :class="['video-task-row', 'is-' + videoTaskState(task.storyboard), { active: !videoSelectMode && selectedSb?.id === task.storyboard.id, 'is-selected': videoSelectMode && isVideoSbSelected(task.id) }]"
          role="button"
          tabindex="0"
          @click="onVideoTaskRowClick(task.storyboard)"
          @keydown.enter.prevent="onVideoTaskRowClick(task.storyboard)"
          @keydown.space.prevent="onVideoTaskRowClick(task.storyboard)"
        >
          <div class="video-task-preview">
            <span
              v-if="videoSelectMode"
              class="shot-check video-task-check"
              :class="{ on: isVideoSbSelected(task.id) }"
            >
              <svg v-if="isVideoSbSelected(task.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <video
              v-if="hasVid(task.storyboard)"
              :src="'/' + getVideoUrl(task.storyboard)"
              :poster="posterOf('/' + getVideoUrl(task.storyboard)) || undefined"
              preload="none"
              playsinline
              muted
              tabindex="-1"
            />
            <div v-else class="video-task-empty">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </div>
            <span class="video-task-index">#{{ String(task.index + 1).padStart(2, '0') }}</span>
          </div>
          <div class="video-task-main">
            <div class="video-task-line">
              <strong class="video-task-name">{{ task.title }}</strong>
            </div>
            <div class="video-task-meta-line">
              <span :class="['video-task-state', 'is-' + videoTaskState(task.storyboard)]">
                <i :class="['dot', videoTaskState(task.storyboard) === 'done' && 'ok', videoTaskState(task.storyboard) === 'pending' && 'pending']" />{{ videoTaskStatusLabel(task.storyboard) }}
              </span>
              <span class="video-task-sep">·</span>
              <span>{{ task.duration }}s</span>
              <template v-if="task.meta">
                <span class="video-task-sep">·</span>
                <span class="video-task-loc truncate">{{ task.meta }}</span>
              </template>
            </div>
            <div v-if="task.error" class="video-task-error" :title="task.error">
              {{ mapError(task.error) }}
              <div v-if="videoModerationHint(task.error)" class="video-task-error-hint">{{ videoModerationHint(task.error) }}</div>
            </div>
          </div>
          <button
            class="btn btn-icon btn-sm video-task-action"
            :title="videoTaskActionLabel(task.storyboard)"
            :disabled="['pending', 'blocked'].includes(videoTaskState(task.storyboard))"
            @click.stop="genVid(task.storyboard)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </button>
        </div>
        </div>
      </section>

      <div v-if="selectedSb" class="video-task-side">
      <div class="video-main-col">
      <div class="video-main-scroll">
        <div class="video-main-grid">
          <section class="video-inspector-section">
            <span class="video-inspector-label">{{ t('episode.sb.descSection') }}</span>
            <label class="field">
              <span class="field-label">{{ t('episode.sb.descLabel') }} <span class="dim">({{ t('episode.sb.descHint') }})</span></span>
              <textarea :value="selectedSb.description || ''" class="textarea" rows="7" @blur="updateField(selectedSb, 'description', $event.target.value)" :placeholder="t('episode.sb.descPlaceholder')" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('episode.sb.atmosphere') }}</span>
              <textarea :value="selectedSb.atmosphere || ''" class="textarea" rows="2" @blur="updateField(selectedSb, 'atmosphere', $event.target.value)" :placeholder="t('episode.sb.atmospherePlaceholder')" />
            </label>
          </section>

          <section class="video-inspector-section">
            <div class="video-inspector-prompt-head">
              <span class="video-inspector-label">{{ t('episode.ref.title') }}</span>
              <span class="tag mono">{{ t('episode.ref.boundCount', { bound: refBindableAssets.filter(a => a.bound).length, total: refBindableAssets.length }) }}</span>
            </div>
            <div class="storyboard-ref-list is-embedded">
              <template v-for="g in REF_KINDS" :key="g.kind">
                <div v-if="refBindableAssets.filter(a => a.kind === g.kind).length" class="storyboard-ref-group">
                  <div class="storyboard-ref-group-label">{{ g.label }}</div>
                  <div
                    v-for="asset in refBindableAssets.filter(a => a.kind === g.kind)"
                    :key="asset.key"
                    :class="['storyboard-ref-item', { bound: asset.bound }]"
                    :title="asset.bound ? t('episode.ref.clickRemove') : t('episode.ref.clickAdd')"
                    @click="toggleShotBind(selectedSb, asset)"
                  >
                    <button
                      type="button"
                      class="storyboard-ref-thumb"
                      :disabled="!asset.ready"
                      @click.stop="asset.ready && openImageViewer(assetImageSrc({ imageUrl: asset.imageUrl }), `${asset.name} ${asset.typeLabel}`)"
                    >
                      <img v-if="asset.ready" :src="thumbOf(assetImageSrc({ imageUrl: asset.imageUrl }))" class="previewable-image" loading="lazy" @error="thumbFallback($event, assetImageSrc({ imageUrl: asset.imageUrl }))" />
                      <span v-else>{{ asset.kind === 'scene' ? t('episode.ref.shortScene') : asset.kind === 'prop' ? t('episode.ref.shortProp') : t('episode.ref.shortChar') }}</span>
                    </button>
                    <div class="storyboard-ref-main">
                      <span class="storyboard-ref-name">{{ asset.name }}</span>
                      <span class="storyboard-ref-meta">{{ asset.typeLabel }} · {{ asset.meta }}</span>
                      <span :class="['storyboard-ref-state', asset.bound && asset.ready ? 'is-ready' : '']">
                        {{ asset.bound ? (asset.ready ? t('episode.ref.usable') : t('episode.ref.notReady')) : t('episode.ref.unbound') }}
                      </span>
                      <button v-if="asset.bound && !asset.ready" type="button" class="storyboard-ref-goto" @click.stop="prodTab = 'assets'">{{ t('episode.ref.gotoGenerate') }}</button>
                    </div>
                  </div>
                </div>
              </template>
              <div v-if="!refBindableAssets.length" class="storyboard-ref-empty">{{ t('episode.ref.empty') }}</div>
            </div>
          </section>
        </div>

          <section class="video-inspector-section">
            <div class="video-inspector-prompt-head">
              <span class="video-inspector-label video-inspector-label-hero">{{ t('episode.sb.videoPromptSection') }}</span>
              <button
                type="button"
                class="btn btn-sm"
                :disabled="videoPromptGeneratingIds.includes(selectedSb?.id) || videoPromptBatch.running"
                @click="genVideoPrompt(selectedSb)"
              >
                <Loader2 v-if="videoPromptGeneratingIds.includes(selectedSb?.id)" :size="11" class="animate-spin" />
                {{ (selectedSb.video_prompt || selectedSb.videoPrompt) ? t('episode.sb.regenPrompt') : t('episode.sb.aiGenerate') }}
              </button>
            </div>
            <MentionTextarea
              :model-value="selectedSb.video_prompt || selectedSb.videoPrompt || ''"
              :options="mentionOptions"
              :rows="14"
              input-class="textarea video-inspector-prompt"
              :placeholder="t('episode.inspector.videoPromptPlaceholder')"
              @commit="v => updateField(selectedSb, 'video_prompt', v)"
            />
          </section>
      </div>
      </div>

      <aside class="video-task-inspector">
    <aside class="video-task-player">
      <div class="video-player-head">
        <div class="video-player-head-info">
          <div class="video-player-title">{{ t('episode.vid.playerTitle', { n: String(selectedVideoTaskNumber).padStart(2, '0') }) }}</div>
          <span :class="['video-task-status', 'is-' + videoTaskState(selectedSb)]">
            <span :class="['dot', videoTaskState(selectedSb) === 'done' && 'ok', videoTaskState(selectedSb) === 'pending' && 'pending']" />
            {{ videoTaskStatusLabel(selectedSb) }}
          </span>
          <span v-if="selectedSb.duration" class="video-player-sub">{{ selectedSb.duration }}s</span>
        </div>
        <button
          v-if="previewVideoUrl"
          class="btn btn-sm btn-primary"
          @click="setAsMainVideo"
        >
          {{ t('episode.vid.setMain') }}
        </button>
        <button
          v-else-if="hasVid(selectedSb) && !selectedShotReadiness?.selected?.video && sbVideoHistory.some(isCurrentVideo)"
          class="btn btn-sm btn-primary"
          @click="confirmCurrentVideo"
        >
          {{ t('episode.tasks.confirmVideo') }}
        </button>
        <a
          v-if="previewVideoUrl || hasVid(selectedSb)"
          :href="'/' + (previewVideoUrl || getVideoUrl(selectedSb))"
          download
          class="btn btn-sm"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ t('common.download') }}
        </a>
      </div>
      <div class="video-player-stage">
        <video
          v-if="previewVideoUrl || hasVid(selectedSb)"
          :key="previewVideoUrl || getVideoUrl(selectedSb)"
          :src="'/' + (previewVideoUrl || getVideoUrl(selectedSb))"
          :poster="posterOf('/' + (previewVideoUrl || getVideoUrl(selectedSb))) || undefined"
          controls
          preload="metadata"
          playsinline
          class="video-player-video"
        />
        <div v-else class="video-player-empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          <div class="video-player-empty-copy">
            <div class="video-player-empty-title">{{ videoTaskState(selectedSb) === 'pending' ? t('episode.vid.emptyGenerating') : t('episode.vid.emptyNoVideo') }}</div>
            <div class="video-player-empty-desc">{{ videoTaskState(selectedSb) === 'pending' ? t('episode.vid.emptyGeneratingDesc') : t('episode.vid.emptyNoVideoDesc') }}</div>
          </div>
          <button
            v-if="!['pending', 'blocked'].includes(videoTaskState(selectedSb))"
            class="btn btn-primary btn-sm video-player-empty-action"
            @click="genVid(selectedSb)"
          >
            {{ t('episode.vid.generateVideo') }}
          </button>
        </div>
      </div>
    </aside>

    <div v-if="sbVideoHistory.length" class="video-player-history">
      <div class="video-player-history-head">
        <span>{{ t('episode.vid.history') }}</span>
        <span class="video-player-history-count">{{ sbVideoHistory.length }}</span>
      </div>
      <div class="video-player-history-list">
        <div
          v-for="h in sbVideoHistory"
          :key="h.id"
          :class="['video-history-item', { current: isCurrentVideo(h), viewing: !!previewVideoUrl && previewVideoUrl === taskVideoPath(h) }]"
          role="button"
          tabindex="0"
          @click="previewHistoryVideo(h)"
          @keydown.enter.prevent="previewHistoryVideo(h)"
        >
          <video :src="'/' + taskVideoPath(h)" :poster="posterOf('/' + taskVideoPath(h)) || undefined" preload="none" muted playsinline tabindex="-1" />
          <span class="video-history-time">{{ formatHistoryTime(taskCreatedAt(h)) }}</span>
          <span v-if="isCurrentVideo(h)" class="video-history-badge">{{ t('episode.vid.current') }}</span>
          <button v-else type="button" class="video-history-del" :title="t('episode.vid.deleteRecord')" @click.stop="removeHistoryVideo(h)">×</button>
        </div>
      </div>
    </div>
        <div class="video-inspector-body">
          <section v-if="selectedShotReadiness" class="video-inspector-section">
            <div class="video-inspector-prompt-head">
              <span class="video-inspector-label">{{ t('episode.tasks.readiness') }}</span>
              <span class="tag" :class="selectedShotReadiness.ready_for_video ? 'tag-success' : 'tag-error'">{{ selectedShotReadiness.ready_for_video ? t('episode.tasks.ready') : t('episode.tasks.needsWork') }}</span>
            </div>
            <div v-for="(blocker, index) in selectedShotReadiness.blockers" :key="index" class="video-task-error">
              {{ readinessBlockerLabel(blocker) }}
            </div>
          </section>
          <section class="video-inspector-section">
            <div class="video-inspector-prompt-head">
              <span class="video-inspector-label">{{ t('episode.inspector.boundRefs') }}</span>
              <span class="tag mono">{{ boundRefAssets.length }}</span>
            </div>
            <div v-if="boundRefAssets.length" class="video-bound-refs">
              <button
                v-for="asset in boundRefAssets"
                :key="asset.key"
                type="button"
                class="video-bound-ref"
                :disabled="!asset.ready"
                :title="`${asset.name} · ${asset.typeLabel}`"
                @click="asset.ready && openImageViewer(assetImageSrc({ imageUrl: asset.imageUrl }), `${asset.name} ${asset.typeLabel}`)"
              >
                <img v-if="asset.ready" :src="thumbOf(assetImageSrc({ imageUrl: asset.imageUrl }))" :alt="asset.name" loading="lazy" @error="thumbFallback($event, assetImageSrc({ imageUrl: asset.imageUrl }))" />
                <span v-else class="video-bound-ref-empty">{{ asset.kind === 'scene' ? t('episode.ref.shortScene') : asset.kind === 'prop' ? t('episode.ref.shortProp') : t('episode.ref.shortChar') }}</span>
                <small>{{ asset.name }}</small>
              </button>
            </div>
            <div v-else class="video-bound-refs-empty">{{ t('episode.inspector.noBoundRefs') }}</div>
            <div v-for="asset in boundRefAssets.filter(item => item.kind === 'character')" :key="`look-${asset.id}`" class="video-param-row">
              <label class="video-param-name" :for="`shot-look-${asset.id}`">{{ asset.name }} · {{ t('episode.tasks.look') }}</label>
              <select :id="`shot-look-${asset.id}`" class="input" :value="shotLookId(selectedSb, asset.id) || ''" @change="setShotCharacterLook(asset.id, $event.target.value)">
                <option value="">{{ t('episode.tasks.baseLook') }}</option>
                <option v-for="look in looksForCharacter(asset.id)" :key="look.id" :value="look.id">{{ look.name }}</option>
              </select>
            </div>
          </section>
        </div>

        <!-- 分镜时长 + 生成操作常驻底部：不随检查器内容滚动 -->
        <div class="video-inspector-footer">
          <section class="video-inspector-section video-params-card">
            <div class="video-param-row">
              <span class="video-param-name">{{ t('episode.inspector.duration') }}</span>
              <span class="video-param-control">
                <input
                  :value="selectedSb.duration || 10"
                  type="number"
                  min="2"
                  max="30"
                  class="input video-duration-input"
                  @change="onVideoDurationChange"
                />
                <span class="video-param-unit">{{ t('episode.inspector.durationUnit') }}</span>
              </span>
            </div>
            <div class="video-param-hint">{{ t('episode.inspector.durationHint') }}</div>
          </section>
          <div class="video-inspector-effective">
            {{ t('episode.inspector.effective', { model: effectiveVideoModelLabel || t('episode.vid.defaultModel'), res: episodeResolutionShort, dur: effectiveVideoDuration }) }}
          </div>
          <button
            class="btn btn-primary video-inspector-action"
            :disabled="['pending', 'blocked'].includes(videoTaskState(selectedSb))"
            @click="genVid(selectedSb)"
          >
            {{ videoTaskActionLabel(selectedSb) }}
          </button>
        </div>
      </aside>
      </div>
      <div
        class="video-col-divider is-left"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="startVideoColDrag('left', $event)"
        @dblclick="videoLeftW = VIDEO_COL_DEFAULTS.left"
      ></div>
      <div
        class="video-col-divider is-right"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="startVideoColDrag('right', $event)"
        @dblclick="videoRightW = VIDEO_COL_DEFAULTS.right"
      ></div>
    </div>
  </div>
</template>

<script setup>
// Episode workbench · production · videos: shots, inspector, player. Markup only: lazy-loaded by views/episode.vue, which owns
// the state (inject EPISODE_WORKBENCH) and loads the styles (./workbench.css).
import { inject } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { mapError } from '~/composables/useToast'
import { EPISODE_WORKBENCH } from '../../utils/episodeWorkbench.js'

const {
  REF_KINDS, VIDEO_COL_DEFAULTS, allVideoTaskRows, assetImageSrc, batchVideoPrompts, batchVideos,
  boundRefAssets, cancelVideoPromptBatch, confirmCurrentVideo, doBreakdown, dramaAspectRatio,
  effectiveVideoDuration, effectiveVideoModelLabel, episode, episodeResolutionShort, formatHistoryTime,
  genVid, genVideoPrompt, getVideoUrl, hasVid, isCurrentVideo, isVideoSbSelected, looksForCharacter,
  mentionOptions, onVideoDurationChange, onVideoTaskRowClick, openImageViewer, pendingVideoIds,
  previewHistoryVideo, previewVideoUrl, prodTab, readinessBlockerLabel, refBindableAssets,
  removeHistoryVideo, retryFailedVideos, rn, rt, sbVideoHistory, sbs, selectMissingVideos, selectedSb,
  selectedShotReadiness, selectedVideoSbIds, selectedVideoTaskNumber, setAsMainVideo,
  setShotCharacterLook, shotLookId, startVideoColDrag, t, taskCreatedAt, taskVideoPath,
  toggleSelectAllVideos, toggleShotBind, toggleVideoFilter, toggleVideoSelectMode, totalDuration,
  updateField, videoLeftW, videoListFilter, videoModerationHint, videoPromptBatch,
  videoPromptGeneratingIds, videoRightW, videoSelectMode, videoTaskActionLabel, videoTaskDoneCount,
  videoTaskFailedCount, videoTaskRows, videoTaskState, videoTaskStatusLabel,
} = inject(EPISODE_WORKBENCH)
</script>
