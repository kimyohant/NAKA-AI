<template>
  <div v-if="detail" class="ps-ws">
    <!-- ===== Topbar ===== -->
    <header class="ps-topbar">
      <div class="ps-topbar-main">
        <button class="back-btn" type="button" @click="navigateTo('/studio')">
          <ArrowLeft :size="15" :stroke-width="2.1" />
          {{ t('marketer.work.back') }}
        </button>
        <div class="ps-identity">
          <h1 class="ps-title truncate">{{ detail.title }}</h1>
          <div class="ps-meta-row">
            <span class="tag ps-status-tag" :class="statusTagClass">
              <Loader2 v-if="scripting" :size="10" class="animate-spin" />
              {{ t(`productStudio.status.${detail.status}`) }}
            </span>
            <span v-if="template" class="ps-inline truncate">{{ t(`productStudio.templates.${detail.templateId}.name`) }}</span>
          </div>
        </div>
      </div>
      <div class="ps-topbar-side">
        <NuxtLink v-if="detail.sourceCampaignId" :to="`/marketer/${detail.sourceCampaignId}`" class="btn">
          <Megaphone :size="13" :stroke-width="1.9" />
          {{ t('productStudio.fromCampaign.backToCampaign') }}
        </NuxtLink>
        <NuxtLink v-if="detail.dramaId" :to="`/drama/${detail.dramaId}/episode/1`" class="btn">
          <Clapperboard :size="13" :stroke-width="1.9" />
          {{ t('productStudio.export.openEpisode') }}
        </NuxtLink>
        <button class="btn" type="button" :disabled="refreshing" @click="refresh()">
          <RefreshCw :size="12" :stroke-width="2" :class="{ 'animate-spin': refreshing }" />
          {{ t('common.refresh') }}
        </button>
      </div>
    </header>

    <div class="ps-body">
      <!-- ===== LEFT: stepper ===== -->
      <aside class="ps-sidebar">
        <nav class="ps-stages" :aria-label="t('productStudio.workspace.steps')">
          <button
            v-for="(s, i) in steps"
            :key="s.id"
            type="button"
            :class="['ps-stage', { active: step === s.id, done: s.done }]"
            :aria-current="step === s.id ? 'step' : undefined"
            @click="goStep(s.id)"
          >
            <span class="ps-stage-state">
              <Loader2 v-if="scripting && s.id === 'script'" :size="11" class="animate-spin" />
              <Check v-else-if="s.done" :size="10" :stroke-width="2.6" />
              <span v-else class="ps-stage-num">{{ i + 1 }}</span>
            </span>
            <span class="ps-stage-copy">
              <span class="ps-stage-label">{{ s.label }}</span>
              <span class="ps-stage-sub">{{ s.sub }}</span>
            </span>
          </button>
        </nav>
        <div class="ps-rail">
          <div class="ps-rail-head">
            <span class="ps-rail-title">{{ steps[stepIdx]?.label }}</span>
            <span class="ps-rail-count">{{ stepIdx + 1 }}/{{ steps.length }}</span>
          </div>
          <div class="ps-rail-track">
            <button
              v-for="(s, i) in steps"
              :key="s.id"
              type="button"
              :class="['ps-rail-seg', { done: s.done, current: i === stepIdx }]"
              :title="s.label"
              :aria-label="s.label"
              @click="goStep(s.id)"
            ><span class="ps-rail-fill" /></button>
          </div>
        </div>
      </aside>

      <!-- ===== MAIN ===== -->
      <main class="ps-main">
        <!-- failed banner -->
        <div v-if="detail.status === 'failed'" class="ps-alert" role="alert">
          <CircleAlert :size="16" :stroke-width="1.9" />
          <div class="ps-alert-copy">
            <strong>{{ t('productStudio.workspace.failedTitle') }}</strong>
            <span>{{ failedText }}</span>
          </div>
          <button v-if="failedCode === 'E_AVATAR_REQUIRED'" class="btn btn-sm" type="button" @click="goStep('settings')">
            {{ t('productStudio.settings.pickAvatar') }}
          </button>
          <button class="btn btn-sm" type="button" @click="goStep('script')">
            {{ t('productStudio.script.title') }}
          </button>
        </div>
        <!-- โมเดลยังไม่ตั้งค่า → banner ลิงก์ไประบบผู้ดูแล -->
        <div v-if="modelBanner" class="ps-alert" role="alert">
          <CircleAlert :size="16" :stroke-width="1.9" />
          <div class="ps-alert-copy"><span>{{ t(`errors.codes.${modelBanner}`) }}</span></div>
          <NuxtLink :to="{ path: '/settings', query: { tab: 'ai' } }" class="btn btn-sm">{{ t('layout.banner.goSettings') }}</NuxtLink>
        </div>
        <!-- scripting -->
        <div v-if="scripting" class="ps-running" role="status">
          <Loader2 :size="16" class="animate-spin" />
          <span>{{ t('productStudio.workspace.scripting') }}</span>
        </div>

        <!-- ========== 1 สินค้า ========== -->
        <section v-if="step === 'product'" class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('productStudio.product.title') }}</h2>
            <p class="panel-desc">{{ t('productStudio.product.desc') }}</p>
          </div>

          <div class="ps-url-row">
            <label class="field ps-url-field">
              <span class="field-label">{{ t('productStudio.product.url') }}</span>
              <input v-model="productDraft.productUrl" class="input" type="url" :placeholder="t('productStudio.product.urlPlaceholder')" />
            </label>
            <button class="btn" type="button" :disabled="ingesting || !productDraft.productUrl.trim()" @click="ingest">
              <Loader2 v-if="ingesting" :size="13" class="animate-spin" />
              <Link2 v-else :size="13" :stroke-width="2" />
              {{ t('productStudio.product.ingest') }}
            </button>
          </div>
          <p class="field-hint">{{ t('productStudio.product.ingestHint') }}</p>

          <label class="field">
            <span class="field-label">{{ t('productStudio.product.name') }} <span class="ps-required">*</span></span>
            <input v-model="productDraft.productName" class="input" :placeholder="t('productStudio.product.namePlaceholder')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('productStudio.product.description') }}</span>
            <textarea v-model="productDraft.productDescription" class="textarea" rows="3" :placeholder="t('productStudio.product.descriptionPlaceholder')" />
          </label>

          <div class="field">
            <span class="field-label">{{ t('productStudio.product.images') }}</span>
            <div v-if="productDraft.productImages.length" class="ps-imgs-manage">
              <div v-for="(img, i) in productDraft.productImages" :key="img" class="ps-imgs-item">
                <img :src="img" alt="" loading="lazy" />
                <div class="ps-imgs-btns">
                  <button type="button" class="ps-icon-btn" :disabled="i === 0" :title="t('productStudio.product.moveUp')" :aria-label="t('productStudio.product.moveUp')" @click="moveImage(i, -1)">
                    <ChevronUp :size="12" :stroke-width="2" />
                  </button>
                  <button type="button" class="ps-icon-btn" :disabled="i === productDraft.productImages.length - 1" :title="t('productStudio.product.moveDown')" :aria-label="t('productStudio.product.moveDown')" @click="moveImage(i, 1)">
                    <ChevronDown :size="12" :stroke-width="2" />
                  </button>
                  <button type="button" class="ps-icon-btn ps-del-btn" :title="t('productStudio.product.removeImage')" :aria-label="t('productStudio.product.removeImage')" @click="productDraft.productImages.splice(i, 1)">
                    <Trash2 :size="12" :stroke-width="1.9" />
                  </button>
                </div>
              </div>
            </div>
            <p v-else class="ps-hint">{{ t('productStudio.product.noImages') }}</p>
            <input ref="fileEl" type="file" accept="image/*" multiple hidden @change="uploadImages" />
            <button class="btn btn-sm" type="button" :disabled="uploading" @click="fileEl?.click()">
              <Loader2 v-if="uploading" :size="12" class="animate-spin" />
              <ImagePlus v-else :size="12" :stroke-width="2" />
              {{ t('productStudio.product.upload') }}
            </button>
          </div>

          <!-- ===== แผงรอง: ภาพสินค้า (สร้างภาพใหม่จากรูปจริง) ===== -->
          <StudioProductImages
            v-if="productDraft.productImages.length"
            :project-id="projectId"
            :images="images"
            :product-images="productDraft.productImages"
            :platform-options="options?.platforms || []"
            @generated="onImagesGenerated"
            @promoted="onImagePromoted"
            @deleted="onImageDeleted"
          />

          <div class="ps-split">
            <span class="ps-hint">{{ productDirty ? t('productStudio.product.unsaved') : '' }}</span>
            <div class="ps-actions">
              <button class="btn" type="button" :disabled="saving || !productDirty || !productValid" @click="saveProduct()">
                <Loader2 v-if="saving" :size="13" class="animate-spin" />
                {{ t('common.save') }}
              </button>
              <button class="btn btn-primary" type="button" :disabled="!productValid" @click="productNext">
                {{ t('productStudio.product.next') }}
                <ArrowRight :size="13" :stroke-width="2" />
              </button>
            </div>
          </div>
        </section>

        <!-- ========== 2 เทมเพลต ========== -->
        <section v-else-if="step === 'template'" class="panel panel-wide">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('productStudio.template.title') }}</h2>
            <p class="panel-desc">{{ t('productStudio.template.desc') }}</p>
          </div>
          <StudioTemplateGallery :templates="templates" :selected-id="productDraft.templateId" :platform-options="options?.platforms || []" @select="selectTemplate" />
          <p v-if="templateChangedWarn" class="ps-warn-note" role="alert">{{ t('productStudio.template.changeWarn') }}</p>
          <div class="ps-split">
            <span class="ps-hint">{{ t('productStudio.template.selected', { name: productDraft.templateId ? t(`productStudio.templates.${productDraft.templateId}.name`) : '—' }) }}</span>
            <button class="btn btn-primary" type="button" :disabled="!productDraft.templateId || saving" @click="saveProduct().then(() => goStep('settings'))">
              {{ t('productStudio.template.next') }}
              <ArrowRight :size="13" :stroke-width="2" />
            </button>
          </div>
        </section>

        <!-- ========== 3 ตั้งค่า ========== -->
        <section v-else-if="step === 'settings'" class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('productStudio.settings.title') }}</h2>
            <p class="panel-desc">{{ t('productStudio.settings.desc') }}</p>
          </div>

          <div class="ps-settings-grid">
            <label class="field">
              <span class="field-label">{{ t('productStudio.settings.language') }}</span>
              <select v-model="settingsDraft.language" class="input">
                <option v-for="l in (options?.languages || [])" :key="l" :value="l">{{ t(`productStudio.languages.${l}`) }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">{{ t('productStudio.settings.market') }}</span>
              <select v-model="settingsDraft.market" class="input">
                <option v-for="m in (options?.markets || [])" :key="m.id" :value="m.id">{{ t(`productStudio.markets.${m.id}`) }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">{{ t('productStudio.settings.platform') }}</span>
              <select class="input" :value="settingsDraft.platform" @change="changePlatform(($event.target as HTMLSelectElement).value)">
                <option v-for="p in (options?.platforms || [])" :key="p.id" :value="p.id">{{ t(`productStudio.platforms.${p.id}`) }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">{{ t('productStudio.settings.aspect') }}</span>
              <select v-model="settingsDraft.aspectRatio" class="input">
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
          </div>
          <p v-if="audioQualityWarn" class="ps-warn-note" role="alert">{{ t('productStudio.settings.audioQualityWarn') }}</p>

          <label class="field">
            <span class="field-label">{{ t('productStudio.settings.duration', { min: STUDIO_DURATION_MIN, max: durationMax }) }}</span>
            <input v-model.number="settingsDraft.durationSec" class="input ps-duration" type="range" :min="STUDIO_DURATION_MIN" :max="durationMax" step="1" />
            <span class="field-hint">{{ t('productStudio.settings.durationValue', { n: settingsDraft.durationSec }) }} · {{ t('productStudio.settings.durationTemplate', { n: template?.defaultDurationSec ?? 0 }) }}</span>
            <span v-if="videoProvider?.minDurationSec" class="field-hint" :class="{ 'ps-cap-warn': belowMinDuration }">
              {{ t('productStudio.settings.minDurationHint', { n: videoProvider.minDurationSec.toFixed(2) }) }}<template v-if="belowMinDuration"> — {{ t('productStudio.settings.belowMinWarn', { n: belowMinDuration }) }}</template>
            </span>
            <span v-if="isLocalVideoProvider && estimatedRenderMinutes" class="field-hint">
              {{ t('productStudio.settings.estimateTotal', { n: estimatedRenderMinutes }) }}
            </span>
          </label>

          <div class="field">
            <span class="field-label">{{ t('productStudio.settings.avatar') }}</span>
            <div v-if="avatars.length" class="ps-avatar-pick" role="radiogroup" :aria-label="t('productStudio.settings.avatar')">
              <button
                type="button"
                role="radio"
                :aria-checked="settingsDraft.avatarId === null"
                :class="['ps-avatar-opt', { on: settingsDraft.avatarId === null, dim: template?.avatarMode === 'required' }]"
                @click="settingsDraft.avatarId = null"
              >
                <Ban :size="16" :stroke-width="1.6" />
                <span>{{ t('productStudio.settings.avatarNone') }}</span>
              </button>
              <button
                v-for="a in avatars"
                :key="a.id"
                type="button"
                role="radio"
                :aria-checked="settingsDraft.avatarId === a.id"
                :class="['ps-avatar-opt', { on: settingsDraft.avatarId === a.id }]"
                @click="settingsDraft.avatarId = a.id"
              >
                <img v-if="a.imageUrl" :src="a.imageUrl" alt="" loading="lazy" />
                <Loader2 v-else-if="a.imageStatus === 'processing'" :size="14" class="animate-spin" />
                <UserRound v-else :size="14" :stroke-width="1.6" />
                <span class="truncate">{{ a.name }}</span>
              </button>
            </div>
            <p v-else class="ps-hint">{{ t('productStudio.settings.noAvatars') }}</p>
            <span v-if="presenterMissing" class="ps-warn-note" role="alert">{{ t('productStudio.settings.avatarRequiredWarn') }}</span>
            <NuxtLink to="/studio?tab=avatars" class="ps-side-link">{{ t('productStudio.settings.manageAvatars') }}</NuxtLink>
          </div>

          <div class="field">
            <span class="field-label">{{ t('productStudio.settings.influencer') }}</span>
            <div v-if="influencers.length" class="ps-avatar-pick" role="radiogroup" :aria-label="t('productStudio.settings.influencer')">
              <button
                type="button"
                role="radio"
                :aria-checked="settingsDraft.influencerId === null"
                :class="['ps-avatar-opt', { on: settingsDraft.influencerId === null, dim: template?.avatarMode === 'required' }]"
                @click="settingsDraft.influencerId = null"
              >
                <Ban :size="16" :stroke-width="1.6" />
                <span>{{ t('productStudio.settings.influencerNone') }}</span>
              </button>
              <button
                v-for="inf in influencers"
                :key="inf.id"
                type="button"
                role="radio"
                :aria-checked="settingsDraft.influencerId === inf.id"
                :class="['ps-avatar-opt', { on: settingsDraft.influencerId === inf.id }]"
                @click="settingsDraft.influencerId = inf.id"
              >
                <img v-if="inf.imageUrl" :src="inf.imageUrl" alt="" loading="lazy" />
                <Loader2 v-else-if="inf.imageStatus === 'processing'" :size="14" class="animate-spin" />
                <Sparkles v-else :size="14" :stroke-width="1.6" />
                <span class="truncate">{{ inf.name }}</span>
              </button>
            </div>
            <p v-else class="ps-hint">{{ t('productStudio.settings.noInfluencers') }}</p>
            <NuxtLink to="/studio?tab=influencers" class="ps-side-link">{{ t('productStudio.settings.manageInfluencers') }}</NuxtLink>
          </div>

          <label class="field">
            <span class="field-label">{{ t('productStudio.settings.tone') }}</span>
            <input v-model="settingsDraft.tone" class="input" :placeholder="t('productStudio.settings.tonePlaceholder')" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('productStudio.settings.notes') }}</span>
            <textarea v-model="settingsDraft.notes" class="textarea" rows="2" :placeholder="t('productStudio.settings.notesPlaceholder')" />
          </label>
          <div class="ps-settings-grid">
            <label class="field">
              <span class="field-label">{{ t('productStudio.settings.budget') }}</span>
              <input v-model="settingsDraft.budgetThb" class="input" type="number" min="0" step="100" inputmode="decimal" :placeholder="t('productStudio.settings.budgetPlaceholder')" />
            </label>
            <label class="field ps-check-field">
              <span class="field-label">{{ t('productStudio.settings.aiDisclosure') }}</span>
              <label class="ps-check">
                <input v-model="settingsDraft.aiDisclosure" type="checkbox" />
                <span>{{ t('productStudio.settings.aiDisclosureHint') }}</span>
              </label>
            </label>
          </div>

          <!-- Phase 2: captions -->
          <div class="ps-captions">
            <label class="ps-check">
              <input v-model="settingsDraft.captions" type="checkbox" />
              <span>{{ t('productStudio.captions.enable') }}</span>
            </label>
            <template v-if="settingsDraft.captions">
              <span class="field-label">{{ t('productStudio.captions.style') }}</span>
              <div class="ps-cap-styles" role="radiogroup" :aria-label="t('productStudio.captions.style')">
                <button
                  v-for="st in CAPTION_STYLES"
                  :key="st"
                  type="button"
                  role="radio"
                  :aria-checked="settingsDraft.captionStyle === st"
                  :class="['ps-cap-style', { on: settingsDraft.captionStyle === st }]"
                  @click="settingsDraft.captionStyle = st"
                >
                  <span class="ps-cap-frame" :data-aspect="settingsDraft.aspectRatio">
                    <span class="ps-cap-preview" :class="`cap-${st}`">{{ t('productStudio.captions.previewText') }}</span>
                  </span>
                  <span>{{ t(`productStudio.captions.styles.${st}`) }}</span>
                </button>
              </div>
              <label class="ps-check">
                <input v-model="settingsDraft.aiLabelBurnIn" type="checkbox" />
                <span>{{ t('productStudio.captions.burnIn') }}</span>
              </label>
              <p class="field-hint">{{ t('productStudio.captions.burnInHint') }}</p>
            </template>
          </div>

          <div class="ps-split">
            <span class="ps-hint">{{ settingsDirty ? t('productStudio.product.unsaved') : '' }}</span>
            <div class="ps-actions">
              <button class="btn" type="button" :disabled="saving || !settingsDirty" @click="saveSettings()">
                <Loader2 v-if="saving" :size="13" class="animate-spin" />
                {{ t('common.save') }}
              </button>
              <button class="btn btn-primary" type="button" :disabled="saving" @click="settingsNext">
                {{ t('productStudio.settings.next') }}
                <ArrowRight :size="13" :stroke-width="2" />
              </button>
            </div>
          </div>
        </section>

        <!-- ========== 4 บท ========== -->
        <section v-else-if="step === 'script'" class="panel panel-wide">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('productStudio.script.title') }}</h2>
            <p class="panel-desc">{{ t('productStudio.script.desc') }}</p>
          </div>

          <div class="ps-run-row">
            <input v-model="scriptInstruction" class="input ps-run-input" :placeholder="t('productStudio.script.instructionPlaceholder')" />
            <button class="btn btn-primary" type="button" :disabled="scripting || !productValid" @click="generateScript()">
              <Loader2 v-if="scripting" :size="13" class="animate-spin" />
              <Sparkles v-else :size="13" :stroke-width="2" />
              {{ shots.length ? t('productStudio.script.regenerate') : t('productStudio.script.generate') }}
            </button>
          </div>
          <p v-if="shots.length" class="ps-warn-note">{{ t('productStudio.script.regenerateWarn') }}</p>

          <p v-if="noCaptionCount" class="ps-warn-note" role="status">{{ t('productStudio.captions.shotsNoCaption', { n: noCaptionCount }) }}</p>

          <div v-if="shots.length" class="ps-shots-grid">
            <StudioShotCard
              v-for="s in shots"
              :key="s.id"
              :project-id="projectId"
              :shot="s"
              :language="detail.language"
              :role-label="beatLabel(s.role)"
              mode="script"
              @updated="onShotUpdated"
            />
          </div>
          <div v-else class="step-empty">
            <ScrollText :size="24" :stroke-width="1.5" />
            <p class="empty-note">{{ t('productStudio.script.empty') }}</p>
          </div>

          <div class="stage-next">
            <button class="btn btn-primary" type="button" :disabled="!shots.length" @click="goStep('render')">
              {{ t('productStudio.script.next') }}
              <ArrowRight :size="13" :stroke-width="2" />
            </button>
          </div>
        </section>

        <!-- ========== 5 สร้าง ========== -->
        <section v-else-if="step === 'render'" class="panel panel-wide">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('productStudio.render.title') }}</h2>
            <p class="panel-desc">{{ t('productStudio.render.desc') }}</p>
          </div>

          <div v-if="presenterMissing" class="ps-warn-note ps-run-warn" role="alert">{{ t('productStudio.settings.avatarRequiredWarn') }}</div>
          <div class="ps-run-row">
            <button class="btn" type="button" :disabled="renderBlock || presenterMissing || !shots.length" @click="renderStage('keyframes')">
              <ImageIcon :size="13" :stroke-width="2" />
              {{ t('productStudio.render.keyframesAll') }}
            </button>
            <button class="btn" type="button" :disabled="renderBlock || presenterMissing || !allKeyframesDone" @click="renderStage('videos')">
              <Film :size="13" :stroke-width="2" />
              {{ t('productStudio.render.videosAll') }}
            </button>
            <button class="btn btn-primary" type="button" :disabled="renderBlock || presenterMissing || !shots.length" @click="startAutoRender(false)">
              <Sparkles :size="13" :stroke-width="2" />
              {{ t('productStudio.autoRender.start') }}
            </button>
            <button v-if="anyMediaDone" class="btn" type="button" :disabled="renderBlock || presenterMissing || !shots.length" :title="t('productStudio.autoRender.forceHint')" @click="startAutoRender(true)">
              <RotateCcw :size="13" :stroke-width="2" />
              {{ t('productStudio.autoRender.force') }}
            </button>
          </div>

          <!-- server-side pipeline: ปิดหน้าได้ server ทำต่อเอง -->
          <div v-if="autoRenderActive" class="ps-auto" role="status">
            <Loader2 :size="15" class="animate-spin" />
            <div class="ps-auto-copy">
              <div class="ps-auto-line">
                <strong>{{ t(`productStudio.autoRender.stage.${autoRenderInfo.stage}`) }}</strong>
                <span class="mono">{{ autoRenderProgress.done }}/{{ autoRenderProgress.total }}</span>
                <span v-if="autoRenderProgress.failed" class="tag tag-error">{{ t('productStudio.autoRender.failedCount', { n: autoRenderProgress.failed }) }}</span>
                <span v-if="queuedVideoCount" class="tag">{{ t('productStudio.settings.queuedCount', { n: queuedVideoCount }) }}</span>
              </div>
              <div class="ps-auto-bar"><span class="ps-auto-fill" :style="{ width: `${autoRenderProgress.percent}%` }" /></div>
            </div>
            <button class="btn btn-sm" type="button" @click="stopAutoRender">
              <Ban :size="12" :stroke-width="2" />
              {{ t('productStudio.autoRender.cancel') }}
            </button>
          </div>
          <div v-else-if="autoRenderInfo?.stage === 'done'" class="ps-auto ps-auto-done" role="status">
            <Check :size="15" :stroke-width="2.4" />
            <span class="ps-auto-copy">{{ t('productStudio.autoRender.done') }}</span>
            <button class="btn btn-sm btn-primary" type="button" @click="goStep('export')">
              {{ t('productStudio.render.next') }}
              <ArrowRight :size="12" :stroke-width="2" />
            </button>
          </div>
          <div v-else-if="autoRenderInfo?.stage === 'failed'" class="ps-alert" role="alert">
            <CircleAlert :size="16" :stroke-width="1.9" />
            <div class="ps-alert-copy">
              <strong>{{ t('productStudio.autoRender.failed') }}</strong>
              <span>{{ autoRenderFailedText }}</span>
            </div>
            <button class="btn btn-sm" type="button" :disabled="!shots.length" @click="startAutoRender(false)">{{ t('productStudio.autoRender.retry') }}</button>
          </div>

          <div v-if="shots.length" class="ps-shots-grid">
            <StudioShotCard
              v-for="s in shots"
              :key="s.id"
              :project-id="projectId"
              :shot="s"
              :language="detail.language"
              :role-label="beatLabel(s.role)"
              mode="render"
              :disabled="renderBlock"
              @render="renderStage($event.stage, [$event.shotId])"
            />
          </div>
          <div v-else class="step-empty">
            <ScrollText :size="24" :stroke-width="1.5" />
            <p class="empty-note">{{ t('productStudio.render.needScript') }}</p>
            <button class="btn" type="button" @click="goStep('script')">{{ t('productStudio.render.toScript') }}</button>
          </div>

          <div class="stage-next">
            <button class="btn btn-primary" type="button" :disabled="!anyVideoDone" @click="goStep('export')">
              {{ t('productStudio.render.next') }}
              <ArrowRight :size="13" :stroke-width="2" />
            </button>
          </div>
        </section>

        <!-- ========== 6 ส่งออก ========== -->
        <section v-else-if="step === 'export'" class="panel">
          <div class="panel-head">
            <h2 class="panel-title">{{ t('productStudio.export.title') }}</h2>
            <p class="panel-desc">{{ t('productStudio.export.desc') }}</p>
          </div>

          <div class="ps-export-box">
            <label class="ps-check ps-captions-switch">
              <input v-model="mergeCaptions" type="checkbox" :disabled="merging" />
              <span>{{ t('productStudio.captions.exportSwitch') }}</span>
            </label>
            <div class="ps-run-row">
              <button class="btn btn-primary" type="button" :disabled="merging || !anyVideoDone" @click="merge">
                <Loader2 v-if="merging" :size="13" class="animate-spin" />
                <Clapperboard v-else :size="13" :stroke-width="2" />
                {{ t('productStudio.export.merge') }}
              </button>
              <span v-if="!anyVideoDone" class="ps-hint">{{ t('productStudio.export.noneVideos') }}</span>
            </div>

            <div v-if="latestMerge" class="ps-merge">
              <video v-if="latestMerge.status === 'completed' && latestMerge.videoUrl" :src="latestMerge.videoUrl" controls preload="metadata" class="ps-merge-video" />
              <div v-else-if="latestMerge.status === 'processing'" class="ps-merge-status" role="status">
                <Loader2 :size="16" class="animate-spin" />
                <span>{{ t('productStudio.mediaStatus.processing') }}</span>
              </div>
              <div v-else-if="latestMerge.status === 'failed'" class="ps-merge-status" role="alert">
                <CircleAlert :size="16" :stroke-width="1.8" />
                <span>{{ latestMerge.errorMsg || t('productStudio.mediaStatus.failed') }}</span>
              </div>
              <div v-if="latestMerge.status === 'completed'" class="ps-run-row">
                <a v-if="latestMerge.videoUrl" :href="latestMerge.videoUrl" download class="btn btn-sm">
                  <Download :size="12" :stroke-width="2" />
                  {{ t('productStudio.export.download') }}
                </a>
                <a v-if="latestMerge.subtitleUrl" :href="latestMerge.subtitleUrl" download class="btn btn-sm">
                  <Captions :size="12" :stroke-width="2" />
                  {{ t('productStudio.captions.downloadSrt') }}
                </a>
                <span v-if="latestMerge.captioned" class="tag tag-success">{{ t('productStudio.captions.hasSubs') }}</span>
              </div>
            </div>
          </div>

          <div class="ps-checklist">
            <h3 class="mk-subhead">{{ t('productStudio.export.checklistTitle') }}</h3>
            <label v-if="detail.aiDisclosure" class="ps-check-item">
              <Check :size="13" :stroke-width="2.4" class="ps-check-ic" />
              <span>{{ t('productStudio.export.checkDisclosure') }}</span>
            </label>
            <p class="ps-check-item"><span>{{ t('productStudio.export.checkPrice') }}</span></p>
            <p class="ps-check-item"><span>{{ t('productStudio.export.checkClaims') }}</span></p>
          </div>
        </section>
      </main>
    </div>
  </div>

  <div v-else class="ps-ws ps-loading">
    <div v-if="loadFailed" class="step-empty">
      <CircleAlert :size="24" :stroke-width="1.5" />
      <p class="empty-note">{{ t('productStudio.workspace.notFound') }}</p>
      <button class="btn" type="button" @click="navigateTo('/studio')">{{ t('marketer.work.backToList') }}</button>
    </div>
    <Loader2 v-else :size="22" class="animate-spin" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import {
  ArrowLeft, ArrowRight, Ban, Captions, Check, ChevronDown, ChevronUp, CircleAlert, Clapperboard,
  Download, Film, ImageIcon, ImagePlus, Link2, Loader2, Megaphone, RefreshCw, ScrollText, Sparkles, UserRound,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import {
  studioAPI, uploadAPI,
  type StudioDetail, type StudioOptions, type StudioProject, type StudioShot, type StudioTemplate,
} from '~/composables/useApi'
import { mapError, toastError } from '~/composables/useToast'
import { UNSLOTH_PROVIDER, estimateRenderMinutes, shotsBelowMinDuration } from '../utils/unslothFlow'
import {
  STUDIO_STEPS, STUDIO_IMAGE_KINDS, STUDIO_DURATION_MIN,
  SCRIPT_POLL_INTERVAL_MS, RENDER_POLL_INTERVAL_MS,
  isScripting, isStepDone, nextIncompleteStep, clampStudioDuration, applyPlatformDefaults, studioErrorCodeOf,
  isAutoRenderActive, autoRenderProgress, shotsWithoutCaptions,
} from '../utils/studioFlow'

type StepId = typeof STUDIO_STEPS[number]

const { t, te } = useI18n()
const route = useRoute()
const projectId = Number(route.params.id)

// ===== data =====
const detail = ref<StudioDetail | null>(null)
const options = ref<StudioOptions | null>(null)
const templates = ref<StudioTemplate[]>([])
const avatars = ref<any[]>([])
const influencers = ref<any[]>([])
const loadFailed = ref(false)
const refreshing = ref(false)
const saving = ref(false)

const scripting = computed(() => isScripting(detail.value?.status))
const template = computed<StudioTemplate | null>(() => templates.value.find(tpl => tpl.id === detail.value?.templateId) || null)
const shots = computed<StudioShot[]>(() => detail.value?.shots || [])
const images = computed(() => detail.value?.images || [])
const latestMerge = computed(() => detail.value?.latestMerge || null)
const avatar = computed(() => detail.value?.avatar || null)
const influencer = computed(() => detail.value?.influencer || null)
// presenter ที่มีรูป = avatar หรือ AI influencer ตัวใดตัวหนึ่ง
const presenterMissing = computed(() => template.value?.avatarMode === 'required'
  && !((avatar.value && avatar.value.imageUrl) || (influencer.value && influencer.value.imageUrl)))
const processingMedia = computed(() => shots.value.some(s => s.keyframeStatus === 'processing' || s.videoStatus === 'processing'))
const mergeProcessing = computed(() => latestMerge.value?.status === 'processing')
const renderBlock = computed(() => processingMedia.value || mergeProcessing.value || autoRenderActive.value)
const allKeyframesDone = computed(() => shots.value.length > 0 && shots.value.every(s => s.keyframeStatus === 'completed'))
const anyVideoDone = computed(() => shots.value.some(s => s.videoStatus === 'completed'))
const audioQualityWarn = computed(() => settingsDraft.value.language && !['en', 'zh'].includes(settingsDraft.value.language))
const durationMax = computed(() => {
  const opt = options.value?.platforms.find(p => p.id === settingsDraft.value.platform)
  return opt ? Math.min(60, opt.maxDurationSec) : 60
})

const CAPTION_STYLES = ['clean', 'bold', 'boxed'] as const
// Phase Unsloth: ข้อมูลโมเดลวิดีโอ active (เช่น H3 local) — มาจาก GET /studio/options
const videoProvider = computed(() => options.value?.videoProvider || null)
const isLocalVideoProvider = computed(() => videoProvider.value?.provider === UNSLOTH_PROVIDER)
const estimatedRenderMinutes = computed(() => estimateRenderMinutes(shots.value.length, videoProvider.value?.estimatedSecondsPerClip || 0))
const queuedVideoCount = computed(() => shots.value.filter(s => (s.videoQueuePosition || 0) > 0).length)
const belowMinDuration = computed(() => shotsBelowMinDuration(shots.value, videoProvider.value?.minDurationSec || 0).length)

const statusTagClass = computed(() => {
  const s = detail.value?.status
  if (s === 'failed') return 'tag-error'
  if (scripting.value) return 'tag-info'
  if (s === 'script_ready') return 'tag-success'
  return ''
})

// ===== Phase 2: auto-render + captions =====
const autoRenderInfo = computed(() => detail.value?.autoRender || null)
const autoRenderActive = computed(() => isAutoRenderActive(detail.value))
const autoRenderProgress = computed(() => autoRenderProgress(detail.value))
const anyMediaDone = computed(() => shots.value.some(s => s.keyframeStatus === 'completed' || s.videoStatus === 'completed'))
const noCaptionCount = computed(() => shotsWithoutCaptions(shots.value).length)
const mergeCaptions = ref(true)
const autoRenderFailedText = computed(() => {
  const msg = autoRenderInfo.value?.errorMsg || ''
  const code = studioErrorCodeOf(msg)
  if (code && te(`errors.codes.${code}`)) return t(`errors.codes.${code}`)
  return mapError(new Error(msg))
})

const modelBanner = ref('')
function handleErr(e: unknown) {
  const code = (e as { errorCode?: string } | null)?.errorCode
  if (code && ['E_NO_TEXT_MODEL', 'E_NO_IMAGE_MODEL', 'E_NO_VIDEO_MODEL'].includes(code)) modelBanner.value = code
  toastError(e)
}

// ===== steps =====
const step = ref<StepId>('product')
const steps = computed(() => STUDIO_STEPS.map((id: StepId) => ({
  id,
  label: t(`productStudio.steps.${id}`),
  sub: t(`productStudio.steps.${id}Sub`),
  done: isStepDone(id, detail.value),
})))
const stepIdx = computed(() => Math.max(0, STUDIO_STEPS.indexOf(step.value)))
function goStep(id: StepId | null) {
  if (id) step.value = id
}

// ===== poll (timer เดียว: scripting 2s / มีงานสื่อ 3s) =====
let pollTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  // refresh ที่ค้างอยู่ตอนออกจากหน้าจะเรียกมาที่นี่อีก — ห้ามตั้ง timer ใหม่หลัง unmount
  if (disposed) pollTimer = null
  else if (scripting.value) pollTimer = setTimeout(poll, SCRIPT_POLL_INTERVAL_MS)
  else if (processingMedia.value || mergeProcessing.value || autoRenderActive.value) pollTimer = setTimeout(poll, RENDER_POLL_INTERVAL_MS)
  else pollTimer = null
}

async function poll() {
  const prev = detail.value?.status
  const prevAutoStage = detail.value?.autoRender?.stage
  await refresh(true)
  const now = detail.value?.status
  if (prev === 'scripting' && now !== 'scripting') {
    if (now === 'failed') toast.error(t('productStudio.workspace.scriptFailed'))
    else toast.success(t('productStudio.workspace.scriptDone'))
  }
  // auto-render: stage เปลี่ยนจากกำลังวิ่ง → done/failed/cancelled
  const nowAutoStage = detail.value?.autoRender?.stage
  if (prevAutoStage && ['keyframes', 'videos', 'merging'].includes(prevAutoStage)) {
    if (nowAutoStage === 'done') {
      toast.success(t('productStudio.autoRender.doneToast'))
      goStep('export')
    } else if (nowAutoStage === 'failed') {
      toast.error(t('productStudio.autoRender.failedToast'))
    } else if (nowAutoStage === 'cancelled') {
      toast.info(t('productStudio.autoRender.cancelledToast'))
    }
  }
}



async function refresh(silent = false) {
  if (!silent) refreshing.value = true
  try {
    const d = await studioAPI.get(projectId)
    const first = !detail.value
    detail.value = d
    // reset draft ต้อง reset snapshot ด้วย ไม่งั้น draft ≠ snapshot → ขึ้น "ยังไม่บันทึก" ทั้งที่ไม่ได้แก้
    if (first || !productDirty.value) { resetProduct(d); resetProductSnapshot() }
    if (first || !settingsDirty.value) { resetSettings(d); resetSettingsSnapshot() }
    if (first) step.value = nextIncompleteStep(d)
    loadFailed.value = false
  } catch (e: any) {
    if (!detail.value) loadFailed.value = true
    else if (!silent) toastError(e)
  } finally {
    refreshing.value = false
    schedulePoll()
  }
}

async function loadMeta() {
  try {
    const [opts, tpls, avs, infs] = await Promise.all([
      studioAPI.options(),
      studioAPI.templates(),
      studioAPI.avatars(),
      studioAPI.influencers(),
    ])
    options.value = opts
    templates.value = tpls || []
    avatars.value = avs || []
    influencers.value = infs || []
  } catch (e) {
    handleErr(e)
  }
}

// ===== 1 สินค้า =====
function resetProduct(d: StudioDetail) {
  productDraft.value = {
    productName: d.productName || '',
    productUrl: d.productUrl || '',
    productDescription: d.productDescription || '',
    productImages: [...(d.productImages || [])],
    templateId: d.templateId || '',
  }
}
const productDraft = ref({ productName: '', productUrl: '', productDescription: '', productImages: [] as string[], templateId: '' })
const productSnapshot = ref('')
const productDirty = computed(() => JSON.stringify(productDraft.value) !== productSnapshot.value)
const productValid = computed(() => !!(productDraft.value.productName.trim() || productDraft.value.productUrl.trim()))
const templateChangedWarn = computed(() =>
  !!shots.value.length && !!productDraft.value.templateId && productDraft.value.templateId !== (detail.value?.templateId || ''))

watch(productDraft, (v) => { productSnapshot.value === '' && (productSnapshot.value = JSON.stringify(v)) }, { deep: false })

function resetProductSnapshot() {
  productSnapshot.value = JSON.stringify(productDraft.value)
}
function resetSettings(d: StudioDetail) {
  settingsDraft.value = {
    language: d.language || 'th',
    market: d.market || 'TH',
    platform: d.platform || 'tiktok',
    aspectRatio: d.aspectRatio || '9:16',
    durationSec: d.durationSec || 30,
    avatarId: d.avatarId ?? null,
    influencerId: d.influencerId ?? null,
    tone: d.tone || '',
    notes: d.notes || '',
    budgetThb: d.budgetThb == null ? '' : String(d.budgetThb),
    aiDisclosure: d.aiDisclosure !== false,
    captions: d.captions !== false,
    captionStyle: d.captionStyle || 'bold',
    aiLabelBurnIn: !!d.aiLabelBurnIn,
  }
}
const settingsDraft = ref({
  language: 'th', market: 'TH', platform: 'tiktok', aspectRatio: '9:16',
  durationSec: 30, avatarId: null as number | null, influencerId: null as number | null,
  tone: '', notes: '', budgetThb: '', aiDisclosure: true,
  captions: true, captionStyle: 'bold' as 'clean' | 'bold' | 'boxed', aiLabelBurnIn: false,
})
const settingsSnapshot = ref('')
const settingsDirty = computed(() => JSON.stringify(settingsDraft.value) !== settingsSnapshot.value)
function resetSettingsSnapshot() {
  settingsSnapshot.value = JSON.stringify(settingsDraft.value)
}

const fileEl = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
async function uploadImages(ev: Event) {
  const files = (ev.target as HTMLInputElement).files
  if (!files?.length || uploading.value) return
  uploading.value = true
  try {
    for (const f of Array.from(files)) {
      const res = await uploadAPI.image(f)
      productDraft.value.productImages.push(res.url)
    }
    toast.success(t('productStudio.product.uploaded'))
  } catch (e) {
    handleErr(e)
  } finally {
    uploading.value = false
    if (fileEl.value) fileEl.value.value = ''
  }
}

function moveImage(i: number, dir: number) {
  const arr = productDraft.value.productImages
  const j = i + dir
  if (j < 0 || j >= arr.length) return
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

const ingesting = ref(false)
async function ingest() {
  const url = productDraft.value.productUrl.trim()
  if (!url || ingesting.value) return
  ingesting.value = true
  try {
    const res = await studioAPI.ingestUrl(url)
    if (res.productName && !productDraft.value.productName.trim()) productDraft.value.productName = res.productName
    if (res.productDescription && !productDraft.value.productDescription.trim()) productDraft.value.productDescription = res.productDescription
    for (const img of res.images || []) {
      if (!productDraft.value.productImages.includes(img)) productDraft.value.productImages.push(img)
    }
    toast.success(t('productStudio.product.ingested'))
  } catch (e) {
    handleErr(e)
  } finally {
    ingesting.value = false
  }
}

async function saveProduct(silent = false): Promise<boolean> {
  if (!detail.value || saving.value || !productValid.value) return false
  saving.value = true
  try {
    const p = productDraft.value
    const updated = await studioAPI.update(projectId, {
      productName: p.productName.trim() || p.productUrl.trim(),
      productUrl: p.productUrl.trim() || null,
      productDescription: p.productDescription.trim() || null,
      productImages: p.productImages,
      templateId: p.templateId,
    })
    detail.value = { ...detail.value, ...updated }
    resetProduct({ ...detail.value, ...updated } as StudioDetail)
    resetProductSnapshot()
    if (!silent) toast.success(t('productStudio.product.saved'))
    return true
  } catch (e) {
    handleErr(e)
    return false
  } finally {
    saving.value = false
  }
}
function productNext() {
  if (productDirty.value && productValid.value) saveProduct(true).then((ok) => { if (ok) goStep('template') })
  else goStep('template')
}

function selectTemplate(tpl: StudioTemplate) {
  productDraft.value.templateId = tpl.id
  if (settingsDraft.value) {
    // เทมเพลตกำหนดความยาวเริ่มต้น (ปรับสเกลตาม ceiling แพลตฟอร์มได้ในขั้นตั้งค่า)
    settingsDraft.value.durationSec = clampStudioDuration(tpl.defaultDurationSec, durationMax.value)
  }
}

// ===== 3 ตั้งค่า =====
function changePlatform(id: string) {
  const opt = options.value?.platforms.find(p => p.id === id)
  settingsDraft.value = applyPlatformDefaults(settingsDraft.value, opt) as typeof settingsDraft.value
}

async function saveSettings(silent = false): Promise<boolean> {
  if (!detail.value || saving.value) return false
  saving.value = true
  try {
    const s = settingsDraft.value
    const budgetRaw = String(s.budgetThb ?? '').trim()
    const updated = await studioAPI.update(projectId, {
      language: s.language,
      market: s.market,
      platform: s.platform,
      aspectRatio: s.aspectRatio,
      durationSec: clampStudioDuration(s.durationSec, durationMax.value),
      avatarId: s.avatarId,
      influencerId: s.influencerId,
      tone: s.tone.trim() || null,
      notes: s.notes.trim() || null,
      budgetThb: budgetRaw === '' ? null : Number(budgetRaw),
      aiDisclosure: s.aiDisclosure,
      captions: s.captions,
      captionStyle: s.captionStyle,
      aiLabelBurnIn: s.aiLabelBurnIn,
    })
    detail.value = { ...detail.value, ...updated }
    resetSettings(detail.value!)
    resetSettingsSnapshot()
    if (!silent) toast.success(t('productStudio.settings.saved'))
    return true
  } catch (e) {
    handleErr(e)
    return false
  } finally {
    saving.value = false
  }
}
function settingsNext() {
  if (settingsDirty.value) saveSettings(true).then((ok) => { if (ok) goStep('script') })
  else goStep('script')
}

// ===== 4 บท =====
const scriptInstruction = ref('')
function beatLabel(role: string) {
  const key = detail.value?.templateId ? `productStudio.templates.${detail.value.templateId}.beats.${role}` : ''
  return key && te(key) ? t(key) : role
}

async function generateScript() {
  if (scripting.value) return
  try {
    const res = await studioAPI.script(projectId, scriptInstruction.value.trim() || undefined)
    detail.value = { ...detail.value!, status: res.status || 'scripting', errorMsg: null }
    schedulePoll()
  } catch (e) {
    handleErr(e)
  }
}

function onShotUpdated(shot: StudioShot) {
  if (!detail.value || !shot) return
  detail.value = { ...detail.value, shots: detail.value.shots.map(s => s.id === shot.id ? shot : s) }
}

// ===== 5 สร้าง =====
async function renderStage(stage: 'keyframes' | 'videos', shotIds?: number[]) {
  if (renderBlock.value || presenterMissing.value) return
  try {
    const res = await studioAPI.render(projectId, { stage, ...(shotIds?.length ? { shotIds } : {}) })
    toast.success(t('productStudio.render.queued', { n: res.queued }))
    schedulePoll()
  } catch (e) {
    handleErr(e)
  }
}
async function startAutoRender(force = false) {
  if (renderBlock.value || presenterMissing.value || !shots.value.length) return
  try {
    const updated = await studioAPI.autoRender(projectId, { force })
    detail.value = { ...detail.value!, ...updated }
    toast.success(t('productStudio.autoRender.started'))
    schedulePoll()
  } catch (e) {
    handleErr(e)
  }
}

async function stopAutoRender() {
  try {
    const updated = await studioAPI.cancelAutoRender(projectId)
    detail.value = { ...detail.value!, ...updated }
    toast.info(t('productStudio.autoRender.cancelledToast'))
  } catch (e) {
    handleErr(e)
  }
}

// ===== 6 ส่งออก =====
const merging = ref(false)
async function merge() {
  if (merging.value || !anyVideoDone.value) return
  merging.value = true
  try {
    const m = await studioAPI.merge(projectId, { captions: mergeCaptions.value })
    detail.value = { ...detail.value!, latestMerge: m }
    toast.success(t('productStudio.export.merging'))
    schedulePoll()
  } catch (e) {
    handleErr(e)
  } finally {
    merging.value = false
  }
}

// ===== ภาพสินค้า (แผงรอง — ฟอร์มสร้างอยู่ใน StudioProductImages) =====
function onImagesGenerated(created) {
  if (!detail.value || !created?.length) return
  detail.value = { ...detail.value, images: [...created, ...detail.value.images] }
  schedulePoll()
}

function onImagePromoted({ project, image }: { project: StudioProject; image: any }) {
  if (!detail.value) return
  detail.value = {
    ...detail.value,
    ...project,
    images: detail.value.images.map(x => x.id === image.id ? { ...x, promoted: true } : x),
  }
  resetProduct(detail.value)
  resetProductSnapshot()
}
function onImageDeleted(id: number) {
  if (!detail.value) return
  detail.value = { ...detail.value, images: detail.value.images.filter(x => x.id !== id) }
}

const failedCode = computed(() => studioErrorCodeOf(detail.value?.errorMsg))
const failedText = computed(() => {
  const msg = detail.value?.errorMsg || ''
  const code = studioErrorCodeOf(msg)
  if (code && te(`errors.codes.${code}`)) return t(`errors.codes.${code}`)
  return mapError(new Error(msg))
})

onMounted(() => {
  refresh(true)
  loadMeta()
})
onBeforeUnmount(() => {
  disposed = true
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<style scoped>
.ps-ws {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ps-loading { align-items: center; justify-content: center; color: var(--text-3); }

/* === Topbar === */
.ps-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--header-bg);
  flex-shrink: 0;
}
.ps-topbar-main { display: flex; align-items: center; gap: 14px; min-width: 0; }
.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 8px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.back-btn:hover { background: var(--bg-hover); color: var(--text-0); }
.back-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.ps-identity { min-width: 0; }
.ps-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-0);
}
.ps-meta-row { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.ps-inline { font-size: 11.5px; color: var(--text-3); }
.ps-topbar-side { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* === Body layout === */
.ps-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.ps-sidebar {
  width: 230px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 12px;
  border-right: 1px solid var(--border);
  background: var(--header-bg);
  overflow-y: auto;
}
.ps-stages { display: flex; flex-direction: column; gap: 4px; }
.ps-stage {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
  transition: background 0.14s var(--ease-out), color 0.14s var(--ease-out);
}
.ps-stage:hover { background: var(--bg-hover); color: var(--text-0); }
.ps-stage:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.ps-stage.active { background: var(--accent-bg); color: var(--accent-text); }
.ps-stage-state {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px solid var(--border-strong);
  font-size: 10.5px;
  font-weight: 700;
}
.ps-stage.done .ps-stage-state { border-color: transparent; background: var(--success, #22c55e); color: #fff; }
.ps-stage.active .ps-stage-state { border-color: var(--accent); }
.ps-stage-copy { display: flex; flex-direction: column; min-width: 0; }
.ps-stage-label { font-size: 12.5px; font-weight: 600; }
.ps-stage-sub { font-size: 10.5px; color: var(--text-3); }
.ps-stage.active .ps-stage-sub { color: var(--accent-text); }
.ps-rail { margin-top: auto; }
.ps-rail-head { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--text-3); margin-bottom: 6px; }
.ps-rail-track { display: flex; gap: 4px; }
.ps-rail-seg {
  flex: 1; height: 6px; padding: 0;
  border: none; border-radius: 3px;
  background: var(--border); cursor: pointer; overflow: hidden;
}
.ps-rail-seg.done { background: var(--success, #22c55e); }
.ps-rail-seg.current { background: var(--accent); }

.ps-main { flex: 1; min-width: 0; padding: 22px 26px 40px; overflow-y: auto; }

/* === Banners / runs === */
.ps-alert {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 11px 14px; margin-bottom: 14px;
  border: 1px solid color-mix(in srgb, var(--action-danger, #dc2626) 35%, var(--border));
  border-radius: var(--radius); background: var(--action-danger-bg, color-mix(in srgb, #dc2626 6%, var(--surface-soft)));
  color: var(--text-1); font-size: 12.5px;
}
.ps-alert-copy { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.ps-alert-copy strong { font-size: 12.5px; }
.ps-alert .btn { flex-shrink: 0; }
.ps-running {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; margin-bottom: 14px;
  border-radius: var(--radius);
  background: var(--accent-bg); color: var(--accent-text); font-size: 12.5px; font-weight: 600;
}
.ps-run-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ps-run-input { flex: 1; min-width: 220px; }
.ps-run-warn { margin-bottom: 10px; }
.ps-keep-open {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 12px; margin-top: 10px;
  border-radius: var(--radius);
  background: var(--accent-bg); color: var(--accent-text); font-size: 12px; font-weight: 600;
}
.ps-warn-note { margin: 8px 0; font-size: 12px; color: var(--warning, #d97706); }
.ps-hint { font-size: 11.5px; color: var(--text-3); }
.ps-required { color: var(--accent-text); }
.ps-side-link { font-size: 11.5px; color: var(--accent-text); }

/* === Forms === */
.ps-url-row { display: flex; gap: 8px; align-items: flex-end; }
.ps-url-field { flex: 1; min-width: 0; }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; margin-bottom: 12px; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 11px; color: var(--text-3); line-height: 1.5; }
.ps-textarea, .field .textarea { resize: vertical; }
.ps-split {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  margin-top: 24px; padding: 14px 16px;
  border: 1px dashed var(--border-strong); border-radius: var(--radius-lg);
}
.ps-actions { display: flex; gap: 8px; }
.ps-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0 14px; }
.ps-duration { width: 100%; accent-color: var(--accent); }
.ps-check-field .field-label { margin-bottom: 4px; }
.ps-check { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--text-1); cursor: pointer; }
.ps-check input { accent-color: var(--accent); margin-top: 2px; }

/* === Product images manage === */
.ps-imgs-manage { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.ps-imgs-item { position: relative; width: 64px; height: 64px; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border); }
.ps-imgs-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ps-imgs-btns {
  position: absolute; inset: auto 0 0; display: flex; justify-content: center; gap: 2px;
  background: color-mix(in srgb, var(--bg-2, #000) 55%, transparent); padding: 2px;
}
.ps-icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: none; border-radius: 4px;
  background: transparent; color: #fff; cursor: pointer;
}
.ps-icon-btn:disabled { opacity: 0.35; cursor: default; }
.ps-icon-btn:not(:disabled):hover { background: var(--bg-hover); }
.ps-del-btn:hover:not(:disabled) { background: var(--action-danger, #dc2626); }

/* === Product images panel === */
.ps-pimages { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
.ps-pimages-form { display: flex; flex-direction: column; gap: 8px; }
.ps-filter-group { display: flex; flex-wrap: wrap; gap: 6px; }
.ps-pimages-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px;
}
.mk-subhead { margin: 0 0 4px; font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--text-1); }

/* === Avatar picker === */
.ps-avatar-pick { display: flex; flex-wrap: wrap; gap: 8px; }
.ps-avatar-opt {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px 6px 6px; border-radius: 999px;
  border: 2px solid var(--border); background: var(--surface-raised);
  font: 600 12px var(--font-body); color: var(--text-1); cursor: pointer; max-width: 160px;
  transition: border-color 0.15s var(--ease-out);
}
.ps-avatar-opt img, .ps-avatar-opt :not(span) { border-radius: 50%; }
.ps-avatar-opt img { width: 26px; height: 26px; object-fit: cover; }
.ps-avatar-opt.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--button-focus); }
.ps-avatar-opt.dim { opacity: 0.55; }
.ps-avatar-opt:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }

/* === Shots === */
.ps-shots-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px; margin-top: 6px; }
.stage-next { display: flex; justify-content: flex-end; margin-top: 22px; }
.step-empty {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 48px 20px; color: var(--text-3); text-align: center;
  border: 1px dashed var(--border); border-radius: var(--radius-lg);
}
.empty-note { margin: 0 0 8px; font-size: 12.5px; }

/* === Export === */
.ps-export-box { display: flex; flex-direction: column; gap: 12px; }
.ps-merge { display: flex; flex-direction: column; gap: 8px; }
.ps-merge-video {
  width: 100%; max-width: 320px; aspect-ratio: 9 / 16;
  border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-soft);
}
.ps-merge-status { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-2); }
.ps-checklist { margin-top: 20px; display: flex; flex-direction: column; gap: 8px; }
.ps-check-item {
  display: flex; align-items: flex-start; gap: 8px; margin: 0;
  font-size: 12.5px; color: var(--text-1); line-height: 1.55;
}
.ps-check-ic { flex-shrink: 0; margin-top: 2px; color: var(--success, #22c55e); }

@media (max-width: 860px) {
  .ps-topbar { flex-wrap: wrap; padding: 10px 14px; }
  .ps-body { flex-direction: column; }
  .ps-sidebar { width: 100%; flex-direction: row; align-items: center; border-right: none; border-bottom: 1px solid var(--border); padding: 8px; }
  .ps-stages { flex-direction: row; overflow-x: auto; flex: 1; }
  .ps-stage { flex-shrink: 0; }
  .ps-stage-sub { display: none; }
  .ps-rail { display: none; }
  .ps-main { padding: 18px 14px 36px; }
  .ps-url-row { flex-direction: column; align-items: stretch; }
  .ps-settings-grid { grid-template-columns: 1fr; }
  .ps-shots-grid { grid-template-columns: 1fr; }
  .ps-pimages-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
}
</style>
