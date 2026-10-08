<template>
  <div class="prod-content">
    <div class="prod-section-bar">
      <span class="dim" style="font-size:12px">{{ t('episode.prod.assets') }}</span>
      <span class="tag mono">{{ t('episode.prod.readyCount', { ready: assetReadyCount, total: assetTotalCount }) }}</span>
      <div class="ml-auto flex gap-1 asset-bar-actions">
        <button
          v-for="et in EXTRACT_TARGETS"
          :key="et.key"
          class="btn btn-sm asset-btn-extract"
          :disabled="isExtracting(et.key)"
          @click="doExtract(et.key)"
        >
          <Loader2 v-if="isExtracting(et.key)" :size="11" class="animate-spin" />
          <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          {{ (et.key === 'characters' ? chars.length : et.key === 'scenes' ? scenes.length : propItems.length) ? t('episode.prod.reextract', { type: et.label }) : t('episode.prod.extract', { type: et.label }) }}
        </button>
        <span class="asset-bar-divider" />
        <button class="btn btn-sm asset-btn-batch" @click="batchCharImages">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          {{ t('episode.prod.batchChar') }}
        </button>
        <button class="btn btn-sm asset-btn-batch" @click="batchSceneImages">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          {{ t('episode.prod.batchScene') }}
        </button>
        <button class="btn btn-sm asset-btn-batch" @click="batchPropImages">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          {{ t('episode.prod.batchProp') }}
        </button>
      </div>
    </div>
    <div v-if="extractingTargets.length && !chars.length && !scenes.length && !propItems.length" class="step-loading">
      <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
      <div class="loading-text">{{ t('episode.prod.extractingTypes', { types: extractingLabels }) }}</div>
      <button class="btn btn-sm" @click="cancelAllExtracts">{{ t('common.cancel') }}</button>
    </div>
    <div v-else-if="!chars.length && !scenes.length && !propItems.length" class="step-empty asset-empty-state">
      <div class="empty-visual">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </div>
      <div class="empty-title">{{ t('episode.prod.emptyTitle') }}</div>
      <div class="empty-desc">{{ t('episode.prod.emptyDesc') }}</div>
      <button class="btn btn-primary" :disabled="!!extractingTargets.length" @click="doExtractAll">
        <Loader2 v-if="extractingTargets.length" :size="13" class="animate-spin" />
        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        {{ extractingTargets.length ? t('episode.prod.extractingTypesDots', { types: extractingLabels }) : t('episode.prod.startExtract') }}
      </button>
    </div>
    <template v-else>
    <div class="asset-section-title">
      {{ t('common.role') }}
      <button class="asset-add-btn" @click="openAssetCreate('character')"><Plus :size="11" /> {{ t('common.add') }}</button>
    </div>
    <template v-if="visualChars.length">
    <div class="character-asset-grid">
      <article
        v-for="c in visualChars"
        :key="c.id"
        class="card character-asset-card"
        tabindex="0"
        role="button"
        @click="openAssetDetail('character', c)"
        @keydown.enter.prevent="openAssetDetail('character', c)"
        @keydown.space.prevent="openAssetDetail('character', c)"
      >
        <button class="asset-del-btn" :title="t('episode.asset.delChar')" @click.stop="askDeleteAsset('character', c)"><X :size="11" /></button>
        <div class="character-asset-main">
          <div class="character-asset-overview"><div class="character-portrait">
              <img
                v-if="c.image_url || c.imageUrl"
                :src="thumbOf(assetImageSrc(c))"
                class="previewable-image"
                loading="lazy"
                @error="thumbFallback($event, assetImageSrc(c))"
                @click.stop="openImageViewer(assetImageSrc(c), t('episode.asset.charImageTitle', { name: c.name }))"
              />
              <div v-else class="character-portrait-empty">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <span class="asset-cover-badge" :class="(c.image_url || c.imageUrl) ? 'is-ready' : (isPendingCharImage(c.id) ? 'is-pending' : '')">
                {{ (c.image_url || c.imageUrl) ? t('episode.asset.portraitReady') : (isPendingCharImage(c.id) ? t('episode.asset.portraitPending') : t('episode.asset.portraitTodo')) }}
              </span>
            </div>

            <div class="character-asset-head">
              <div class="character-title-block">
                <div class="character-name-row">
                  <strong class="character-name">{{ c.name }}</strong>
                  <span class="tag">{{ c.role || t('common.role') }}</span>
                </div>
                <div class="character-visual-summary" :title="characterVisualSummary(c)">
                  <span>{{ t('episode.asset.appearance') }}{{ characterAppearanceValue(c) }}</span>
                  <span>{{ t('episode.asset.styling') }}{{ characterStylingValue(c) }}</span>
                </div>
              </div>
              <button class="btn btn-sm character-gen-btn" :disabled="isPendingCharImage(c.id)" @click.stop="genCharImg(c.id)">
                <Loader2 v-if="isPendingCharImage(c.id)" :size="11" class="animate-spin" />
                {{ (c.image_url || c.imageUrl) ? t('episode.asset.regen') : (isPendingCharImage(c.id) ? t('episode.asset.generating') : t('episode.asset.generate')) }}
              </button>
              <button class="btn btn-sm" :title="t('episode.asset.uploadCharImage')" :disabled="isUploadingAsset('character', c.id)" @click.stop="uploadAssetImage('character', c.id)">
                <Loader2 v-if="isUploadingAsset('character', c.id)" :size="11" class="animate-spin" />
                <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {{ t('episode.asset.upload') }}
              </button>
            </div>
          </div>
          <div class="asset-final-prompt" :title="c.final_prompt || c.finalPrompt || ''">
            <span class="afp-label">{{ t('episode.asset.finalPromptTurnaround') }}</span>
            <span :class="['afp-text', !(c.final_prompt || c.finalPrompt) && 'dim']">{{ c.final_prompt || c.finalPrompt || t('episode.asset.finalPromptAutoTurnaround') }}</span>
          </div>
        </div>
      </article>
    </div>
    </template>

    <div class="asset-section-title">
      {{ t('common.scene') }}
      <button class="asset-add-btn" @click="openAssetCreate('scene')"><Plus :size="11" /> {{ t('common.add') }}</button>
    </div>
    <template v-if="scenes.length">
    <div class="asset-grid">
      <div
        v-for="s in scenes"
        :key="s.id"
        class="card asset-card asset-click-card"
        tabindex="0"
        role="button"
        @click="openAssetDetail('scene', s)"
        @keydown.enter.prevent="openAssetDetail('scene', s)"
        @keydown.space.prevent="openAssetDetail('scene', s)"
      >
        <button class="asset-del-btn" :title="t('episode.asset.delScene')" @click.stop="askDeleteAsset('scene', s)"><X :size="11" /></button>
        <div class="asset-cover wide">
          <img
            v-if="s.image_url || s.imageUrl"
            :src="thumbOf(assetImageSrc(s))"
            class="previewable-image"
            loading="lazy"
            @error="thumbFallback($event, assetImageSrc(s))"
            @click.stop="openImageViewer(assetImageSrc(s), t('episode.asset.sceneImageTitle', { name: s.location }))"
          />
          <div v-else class="asset-cover-empty">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <span class="asset-cover-badge" :class="(s.image_url || s.imageUrl) ? 'is-ready' : (isPendingSceneImage(s.id) ? 'is-pending' : '')">{{ (s.image_url || s.imageUrl) ? t('episode.asset.ready') : (isPendingSceneImage(s.id) ? t('episode.asset.generating') : t('episode.asset.todo')) }}</span>
        </div>
        <div class="asset-body">
          <div class="asset-name" :title="s.location">{{ s.location }}</div>
          <div class="asset-meta asset-desc dim" :title="sceneDescriptionValue(s)">{{ sceneDescriptionValue(s) }}</div>
          <div v-if="sceneLightingValue(s)" class="asset-meta asset-light dim" :title="sceneLightingValue(s)">{{ t('episode.asset.lighting') }}{{ sceneLightingValue(s) }}</div>
          <div class="asset-meta asset-final" :class="{ dim: !(s.final_prompt || s.finalPrompt) }" :title="s.final_prompt || s.finalPrompt || ''">
            <span class="afp-label">{{ t('episode.asset.finalPromptFixed') }}</span>
            {{ s.final_prompt || s.finalPrompt || t('episode.asset.finalPromptAutoFixed') }}
          </div>
        </div>
        <div class="asset-foot">
          <span :class="['dot', (s.image_url || s.imageUrl) && 'ok', isPendingSceneImage(s.id) && 'pending']" />
          <button class="btn btn-sm ml-auto" :title="t('episode.asset.uploadSceneImage')" :disabled="isUploadingAsset('scene', s.id)" @click.stop="uploadAssetImage('scene', s.id)">
            <Loader2 v-if="isUploadingAsset('scene', s.id)" :size="11" class="animate-spin" />
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {{ t('episode.asset.upload') }}
          </button>
          <button class="btn btn-sm" :disabled="isPendingSceneImage(s.id)" @click.stop="genSceneImg(s.id)">
            <Loader2 v-if="isPendingSceneImage(s.id)" :size="11" class="animate-spin" />
            {{ (s.image_url || s.imageUrl) ? t('episode.asset.regen') : (isPendingSceneImage(s.id) ? t('episode.asset.generating') : t('episode.asset.generate')) }}
          </button>
        </div>
      </div>
    </div>
    </template>

    <div class="asset-section-title">
      {{ t('common.prop') }}
      <button class="asset-add-btn" @click="openAssetCreate('prop')"><Plus :size="11" /> {{ t('common.add') }}</button>
    </div>
    <div v-if="propItems.length" class="asset-grid">
      <div
        v-for="p in propItems"
        :key="p.id"
        class="card asset-card asset-click-card prop-card"
        tabindex="0"
        role="button"
        @click="openAssetDetail('prop', p)"
        @keydown.enter.prevent="openAssetDetail('prop', p)"
        @keydown.space.prevent="openAssetDetail('prop', p)"
      >
        <button class="asset-del-btn" :title="t('episode.asset.delProp')" @click.stop="askDeleteAsset('prop', p)"><X :size="11" /></button>
        <div class="asset-cover wide">
          <img
            v-if="p.image_url || p.imageUrl"
            :src="thumbOf(assetImageSrc(p))"
            class="previewable-image"
            loading="lazy"
            @error="thumbFallback($event, assetImageSrc(p))"
            @click.stop="openImageViewer(assetImageSrc(p), t('episode.asset.propImageTitle', { name: p.name }))"
          />
          <div v-else class="asset-cover-empty">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <span class="asset-cover-badge" :class="(p.image_url || p.imageUrl) ? 'is-ready' : (isPendingPropImage(p.id) ? 'is-pending' : '')">{{ (p.image_url || p.imageUrl) ? t('episode.asset.ready') : (isPendingPropImage(p.id) ? t('episode.asset.generating') : t('episode.asset.todo')) }}</span>
        </div>
        <div class="asset-body">
          <div class="prop-name-row">
            <span class="asset-name" :title="p.name">{{ p.name }}</span>
            <span class="tag">{{ p.type || t('common.prop') }}</span>
          </div>
          <div class="asset-meta asset-desc dim" :title="p.description || ''">{{ p.description || t('episode.asset.noDescription') }}</div>
          <div class="asset-meta asset-final" :class="{ dim: !(p.final_prompt || p.finalPrompt) }" :title="p.final_prompt || p.finalPrompt || ''">
            <span class="afp-label">{{ t('episode.asset.finalPromptWhiteBg') }}</span>
            {{ p.final_prompt || p.finalPrompt || t('episode.asset.finalPromptAutoWhiteBg') }}
          </div>
        </div>
        <div class="asset-foot">
          <span :class="['dot', (p.image_url || p.imageUrl) && 'ok', isPendingPropImage(p.id) && 'pending']" />
          <button class="btn btn-sm ml-auto" :title="t('episode.asset.uploadPropImage')" :disabled="isUploadingAsset('prop', p.id)" @click.stop="uploadAssetImage('prop', p.id)">
            <Loader2 v-if="isUploadingAsset('prop', p.id)" :size="11" class="animate-spin" />
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {{ t('episode.asset.upload') }}
          </button>
          <button class="btn btn-sm" :disabled="isPendingPropImage(p.id)" @click.stop="genPropImg(p.id)">
            <Loader2 v-if="isPendingPropImage(p.id)" :size="11" class="animate-spin" />
            {{ (p.image_url || p.imageUrl) ? t('episode.asset.regen') : (isPendingPropImage(p.id) ? t('episode.asset.generating') : t('episode.asset.generate')) }}
          </button>
        </div>
      </div>
    </div>
    <div v-else class="asset-props-empty">{{ t('episode.asset.propsEmpty') }}</div>
    </template>
  </div>
</template>

<script setup>
// Episode workbench · production · assets: characters, scenes, props. Markup only: lazy-loaded by views/episode.vue, which owns
// the state (inject EPISODE_WORKBENCH) and loads the styles (./workbench.css).
import { inject } from 'vue'
import { Loader2, Plus, X } from 'lucide-vue-next'
import { EPISODE_WORKBENCH } from '../../utils/episodeWorkbench.js'

const {
  EXTRACT_TARGETS, askDeleteAsset, assetImageSrc, assetReadyCount, assetTotalCount, batchCharImages,
  batchPropImages, batchSceneImages, cancelAllExtracts, characterAppearanceValue, characterStylingValue,
  characterVisualSummary, chars, doExtract, doExtractAll, episode, extractingLabels, extractingTargets,
  genCharImg, genPropImg, genSceneImg, isExtracting, isPendingCharImage, isPendingPropImage,
  isPendingSceneImage, isUploadingAsset, openAssetCreate, openAssetDetail, openImageViewer, propItems,
  sceneDescriptionValue, sceneLightingValue, scenes, t, uploadAssetImage, visualChars,
} = inject(EPISODE_WORKBENCH)
</script>
