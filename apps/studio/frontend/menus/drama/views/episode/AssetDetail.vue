<template>
  <div class="overlay asset-detail-overlay" @click.self="closeAssetDetail">
    <section
      class="dialog asset-detail-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('episode.asset.detailTitle', { type: assetTypeLabel(assetDetail.type) })"
    >
      <header class="dialog-head asset-detail-head">
        <div class="asset-detail-title-block">
          <span class="asset-detail-kicker">{{ assetTypeLabel(assetDetail.type) }}</span>
          <h2 class="asset-detail-title">{{ assetDetailTitle(assetDetail) }}</h2>
        </div>
        <div class="asset-detail-head-actions">
          <span class="tag" v-if="assetDetail.type === 'character'">{{ assetDetail.item.role || t('common.role') }}</span>
          <span class="tag" v-else-if="assetDetail.type === 'prop'">{{ assetDetail.item.type || t('common.prop') }}</span>
          <span class="tag" v-else>{{ assetDetail.item.time || t('episode.asset.noTime') }}</span>
          <button class="btn btn-ghost btn-icon" @click="closeAssetDetail">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </header>

      <div class="dialog-body asset-detail-body">
        <div class="asset-detail-shell">
          <aside class="asset-detail-preview-panel">
            <div class="asset-detail-section-title">
              <span>{{ t('episode.asset.visualPreview') }}</span>
              <span :class="['asset-detail-state', assetImageSrc(assetDetail.item) ? 'is-ready' : '']">
                {{ assetImageSrc(assetDetail.item) ? t('episode.asset.ready') : t('episode.asset.todo') }}
              </span>
            </div>

            <button
              type="button"
              class="asset-detail-media-frame"
              :disabled="!assetImageSrc(assetDetail.item)"
              @click.stop="openImageViewer(assetImageSrc(assetDetail.item), assetDetailImageTitle(assetDetail))"
            >
              <img
                v-if="assetImageSrc(assetDetail.item)"
                :src="thumbOf(assetImageSrc(assetDetail.item))"
                class="previewable-image"
                @error="thumbFallback($event, assetImageSrc(assetDetail.item))"
              />
              <span v-else class="asset-detail-media-empty">
                <svg v-if="assetDetail.type === 'character'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <svg v-else-if="assetDetail.type === 'prop'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                <svg v-else width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </span>
            </button>

            <div class="asset-detail-meta-row">
              <div class="asset-detail-meta-item">
                <span>{{ t('episode.asset.kindLabel') }}</span>
                <strong>{{ assetDetail.type === 'character' ? t('episode.asset.charPortrait') : assetDetail.type === 'prop' ? t('common.prop') : t('episode.asset.sceneImage') }}</strong>
              </div>
              <div class="asset-detail-meta-item">
                <span>{{ assetDetail.type === 'character' ? t('episode.asset.roleLabel') : assetDetail.type === 'prop' ? t('episode.asset.propTypeLabel') : t('episode.asset.timeLabel') }}</span>
                <strong>{{ assetDetail.type === 'character' ? (assetDetail.item.role || t('common.role')) : assetDetail.type === 'prop' ? (assetDetail.item.type || t('common.prop')) : (assetDetail.item.time || t('episode.asset.noTime')) }}</strong>
              </div>
            </div>
          </aside>

          <section class="asset-detail-editor-panel">
            <div class="asset-detail-section-title">
              <span>{{ t('episode.asset.editInfo') }}</span>
              <span class="dim">{{ assetDetail.type === 'character' ? t('episode.asset.editHintChar') : assetDetail.type === 'prop' ? t('episode.asset.editHintProp') : t('episode.asset.editHintScene') }}</span>
            </div>

            <div v-if="assetDetail.type === 'prop'" class="asset-detail-edit-grid asset-detail-edit-grid--prop">
              <label class="asset-detail-edit-field">
                <span>{{ t('episode.asset.appearanceOfObject') }}</span>
                <textarea
                  v-model="assetDetailDraft.description"
                  class="textarea asset-detail-textarea"
                  rows="6"
                  :placeholder="t('episode.asset.appearancePlaceholder')"
                />
              </label>
            </div>

            <div v-else :class="['asset-detail-edit-grid', `asset-detail-edit-grid--${assetDetail.type}`]">
              <label v-if="assetDetail.type === 'character'" class="asset-detail-edit-field">
                <span>{{ t('episode.asset.appearanceField') }}</span>
                <textarea
                  v-model="assetDetailDraft.appearance"
                  class="textarea asset-detail-textarea"
                  rows="6"
                  :placeholder="t('episode.asset.appearanceFieldPlaceholder')"
                />
              </label>
              <label v-if="assetDetail.type === 'character'" class="asset-detail-edit-field">
                <span>{{ t('episode.asset.stylingField') }}</span>
                <textarea
                  v-model="assetDetailDraft.styling"
                  class="textarea asset-detail-textarea"
                  rows="6"
                  :placeholder="t('episode.asset.stylingFieldPlaceholder')"
                />
              </label>
              <label v-if="assetDetail.type === 'scene'" class="asset-detail-edit-field">
                <span>{{ t('episode.asset.sceneDescField') }}</span>
                <textarea
                  v-model="assetDetailDraft.prompt"
                  class="textarea asset-detail-textarea"
                  rows="5"
                  :placeholder="t('episode.asset.sceneDescPlaceholder')"
                />
              </label>
              <label v-if="assetDetail.type === 'scene'" class="asset-detail-edit-field">
                <span>{{ t('episode.asset.sceneLightField') }}</span>
                <textarea
                  v-model="assetDetailDraft.lighting"
                  class="textarea asset-detail-textarea"
                  rows="5"
                  :placeholder="t('episode.asset.sceneLightPlaceholder')"
                />
              </label>
            </div>

            <div v-if="assetDetail.type === 'character'" class="asset-detail-edit-field">
              <span>{{ t('episode.tasks.looks') }}</span>
              <div v-for="look in looksForCharacter(assetDetail.item.id)" :key="look.id" class="video-param-row">
                <img v-if="look.image_url" :src="assetImageSrc({ imageUrl: look.image_url })" :alt="look.name" width="40" height="40" class="previewable-image" />
                <span>{{ look.name }}</span>
                <button type="button" class="btn btn-ghost btn-sm" @click="deleteCharacterLook(look)">{{ t('common.delete') }}</button>
              </div>
              <input v-model="newLookName" class="input" :placeholder="t('episode.tasks.lookName')" />
              <button type="button" class="btn btn-ghost btn-sm" :disabled="uploadingLook" @click="uploadCharacterLook(assetDetail.item.id)">
                {{ t('episode.tasks.addLookImage') }}
              </button>
            </div>

          </section>
        </div>

        <section class="asset-detail-prompt-panel">
          <div class="asset-detail-section-title">
            <span>{{ assetDetail.type === 'character' ? t('episode.asset.finalPromptTurnaround') : assetDetail.type === 'scene' ? t('episode.asset.finalPromptFixed') : t('episode.asset.finalPromptWhiteBg') }}</span>
            <div class="asset-detail-prompt-head-actions">
              <button
                class="btn btn-sm"
                :disabled="isGeneratingPrompt(assetDetail.type, assetDetail.item.id) || isAssetImagePending(assetDetail.type, assetDetail.item.id)"
                @click="genAssetFinalPrompt"
              >
                <Loader2 v-if="isGeneratingPrompt(assetDetail.type, assetDetail.item.id)" :size="11" class="animate-spin" />
                {{ isGeneratingPrompt(assetDetail.type, assetDetail.item.id) ? t('episode.asset.generating') : (assetFinalPrompt ? t('episode.asset.regenPrompt') : t('episode.asset.genPrompt')) }}
              </button>
              <span :class="['asset-detail-state', assetFinalPrompt && 'is-ready']">
                {{ assetFinalPrompt ? t('episode.asset.ready') : t('episode.asset.todo') }}
              </span>
              <button
                v-if="assetPromptDraft"
                class="btn btn-ghost btn-sm asset-detail-copy-btn"
                @click="copyAssetFinalPrompt"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                {{ t('common.copy') }}
              </button>
            </div>
          </div>
          <textarea
            :value="assetPromptDraft"
            @input="onAssetPromptInput"
            class="textarea asset-detail-prompt-textarea"
            rows="5"
            :placeholder="assetDetail.type === 'character'
              ? t('episode.asset.promptPlaceholderChar')
              : assetDetail.type === 'scene'
                ? t('episode.asset.promptPlaceholderScene')
                : t('episode.asset.promptPlaceholderProp')"
          />
          <p class="asset-detail-prompt-hint">
            {{ assetDetail.type === 'character'
              ? t('episode.asset.promptHintChar')
              : assetDetail.type === 'scene'
                ? t('episode.asset.promptHintScene')
                : t('episode.asset.promptHintProp') }}
          </p>
        </section>
      </div>

      <footer class="dialog-foot asset-detail-foot">
        <div class="asset-detail-secondary-actions">
          <button class="btn btn-danger" @click="askDeleteAsset(assetDetail.type, assetDetail.item)">{{ t('common.delete') }}</button>
          <button class="btn" @click="closeAssetDetail">{{ t('common.close') }}</button>
        </div>
        <div class="asset-detail-primary-actions">
          <button
            class="btn"
            :disabled="isUploadingAsset(assetDetail.type, assetDetail.item.id)"
            @click="uploadAssetImage(assetDetail.type, assetDetail.item.id)"
          >
            <Loader2 v-if="isUploadingAsset(assetDetail.type, assetDetail.item.id)" :size="11" class="animate-spin" />
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {{ t('episode.asset.uploadImage') }}
          </button>
          <button
            v-if="assetDetail.type === 'character'"
            class="btn"
            :disabled="isPendingCharImage(assetDetail.item.id)"
            @click="genCharImg(assetDetail.item.id)"
          >
            {{ assetImageSrc(assetDetail.item) ? t('episode.asset.regenPortrait') : (isPendingCharImage(assetDetail.item.id) ? t('episode.asset.generating') : t('episode.asset.genPortrait')) }}
          </button>
          <button
            v-else-if="assetDetail.type === 'scene'"
            class="btn"
            :disabled="isPendingSceneImage(assetDetail.item.id)"
            @click="genSceneImg(assetDetail.item.id)"
          >
            {{ assetImageSrc(assetDetail.item) ? t('episode.asset.regenScene') : (isPendingSceneImage(assetDetail.item.id) ? t('episode.asset.generating') : t('episode.asset.genScene')) }}
          </button>
          <button
            v-else-if="assetDetail.type === 'prop'"
            class="btn"
            :disabled="isPendingPropImage(assetDetail.item.id)"
            @click="genPropImg(assetDetail.item.id)"
          >
            {{ assetImageSrc(assetDetail.item) ? t('episode.asset.regenProp') : (isPendingPropImage(assetDetail.item.id) ? t('episode.asset.generating') : t('episode.asset.genProp')) }}
          </button>
          <button class="btn btn-primary" :disabled="savingAssetDetail" @click="saveAssetDetail">
            <Loader2 v-if="savingAssetDetail" :size="12" class="animate-spin" />
            {{ t('episode.asset.saveChanges') }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup>
// Episode workbench · asset detail dialog. Markup only: lazy-loaded by views/episode.vue, which owns
// the state (inject EPISODE_WORKBENCH) and loads the styles (./workbench.css).
import { inject } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { EPISODE_WORKBENCH } from '../../utils/episodeWorkbench.js'

const {
  askDeleteAsset, assetDetail, assetDetailDraft, assetDetailImageTitle, assetDetailTitle,
  assetFinalPrompt, assetImageSrc, assetPromptDraft, assetTypeLabel, closeAssetDetail,
  copyAssetFinalPrompt, deleteCharacterLook, episode, genAssetFinalPrompt, genCharImg, genPropImg,
  genSceneImg, isAssetImagePending, isGeneratingPrompt, isPendingCharImage, isPendingPropImage,
  isPendingSceneImage, isUploadingAsset, looksForCharacter, newLookName, onAssetPromptInput,
  openImageViewer, panel, saveAssetDetail, savingAssetDetail, t, uploadAssetImage, uploadCharacterLook,
  uploadingLook,
} = inject(EPISODE_WORKBENCH)
</script>
