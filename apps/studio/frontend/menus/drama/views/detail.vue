<template>
  <div class="page ws" v-if="drama">
    <!-- 顶栏（参考 Topview Drama Studio 项目工作区）：返回 + 项目名 + 分区 Tab + 准备进度 -->
    <header class="ws-top">
      <div class="ws-top-left">
        <button class="back-btn" :title="t('common.back')" :aria-label="t('common.back')" @click="navigateTo('/drama')">
          <ArrowLeft :size="17" :stroke-width="2" />
        </button>
        <h1 class="ws-title truncate" :title="drama.title">{{ drama.title }}</h1>
        <span v-if="drama.style" class="ws-style-chip">{{ styleName(drama.style) }}</span>
      </div>
      <nav class="ws-tabs" role="tablist" :aria-label="t('detail.ws.tabsAria')">
        <button
          v-for="tb in wsTabs"
          :key="tb.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tb.id"
          :class="['ws-tab', { on: activeTab === tb.id }]"
          @click="activeTab = tb.id"
        >
          <span :class="['ws-dot', tb.done ? 'done' : 'todo']" aria-hidden="true"></span>
          {{ tb.label }}
          <span v-if="tb.count !== undefined" class="ws-tab-count">{{ tb.count }}</span>
        </button>
      </nav>
      <button class="ws-board-btn" type="button" :title="t('detail.ws.openBoard')" @click="navigateTo(`/drama/${drama.id}/board`)">
        <LayoutDashboard :size="13" :stroke-width="2" />
        {{ t('detail.ws.openBoard') }}
      </button>
      <div class="ws-prep" :title="prepMissing.length ? t('detail.ws.prepMissing', { list: prepMissing.join(', ') }) : ''">
        <span class="ws-prep-bar"><i :style="{ width: `${(prepDone / prepSteps.length) * 100}%` }"></i></span>
        <span>{{ t('detail.ws.prep', { done: prepDone, total: prepSteps.length }) }}</span>
        <span v-if="prepMissing.length" class="ws-prep-missing">— {{ t('detail.ws.prepMissing', { list: prepMissing.join(', ') }) }}</span>
      </div>
    </header>

    <div class="ws-body">
      <!-- ===== ตั้งค่าโปรเจกต์ ===== -->
      <section v-if="activeTab === 'settings'" class="ws-panel ws-settings">
        <div class="ws-panel-head">
          <h2 class="ws-panel-title">{{ t('detail.ws.settingsTitle') }}</h2>
          <button class="btn-white" type="button" :disabled="settingsSaving || !settingsDirty" @click="saveSettings">
            {{ settingsSaving ? t('detail.mat.saving') : t('common.save') }}
          </button>
        </div>
        <div class="ws-card ws-form">
          <label class="field">
            <span class="field-label">{{ t('index.createDialog.name') }}</span>
            <input v-model="settingsForm.title" class="input" />
          </label>
          <label class="field">
            <span class="field-label">{{ t('detail.ws.logline') }}</span>
            <textarea v-model="settingsForm.description" class="input ws-textarea" rows="5" :placeholder="t('detail.ws.loglinePlaceholder')"></textarea>
          </label>
          <label class="field">
            <span class="field-label">{{ t('detail.ws.genre') }}</span>
            <input v-model="settingsForm.genre" class="input" :placeholder="t('detail.ws.genrePlaceholder')" />
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.style') }}</span>
              <BaseSelect v-model="settingsForm.style" :options="styleOptions" searchable />
              <textarea v-if="settingsForm.style === 'custom'" v-model="positioningForm.customStyle" class="input" rows="3" maxlength="600"
                :placeholder="t('index.styleTabs.customPlaceholder')" :aria-label="t('index.styleTabs.customLabel')"></textarea>
            </label>
            <label class="field">
              <span class="field-label">{{ t('index.createDialog.aspectRatio') }}</span>
              <BaseSelect v-model="settingsForm.aspect_ratio" :options="ratioOptions" />
              <span class="field-hint">{{ t('index.createDialog.aspectRatioHint') }}</span>
            </label>
          </div>
          <label class="field">
            <span class="field-label">{{ t('productionGuard.projectBudget') }}</span>
            <input v-model="settingsForm.budget_thb" class="input" type="number" min="0" max="100000000" step="0.01" inputmode="decimal" :placeholder="t('productionGuard.noBudget')" />
            <span class="field-hint">{{ t('productionGuard.budgetHint') }}</span>
          </label>
          <div v-if="budgetSummary" class="field-hint" role="status">
            {{ t('productionGuard.allocatedCost') }}: {{ formatBudget(budgetSummary.estimated_total_thb) }}
            <template v-if="budgetSummary.remaining_thb != null"> · {{ t('productionGuard.remainingBudget') }}: {{ formatBudget(budgetSummary.remaining_thb) }}</template>
            <template v-if="budgetSummary.unpriced_tasks"> · {{ t('productionGuard.unpricedTasks', { n: budgetSummary.unpriced_tasks }) }}</template>
          </div>
        </div>

        <!-- ตั้งค่าพื้นฐาน（参考 Topview Basic Settings） -->
        <div class="ws-card ws-form">
          <h3 class="ws-form-section">{{ t('detail.ws.basicSettings') }}</h3>
          <div class="ws-settings-grid">
            <div class="field">
              <span class="field-label">{{ t('detail.ws.episodeMode') }}</span>
              <div class="ws-seg" role="radiogroup" :aria-label="t('detail.ws.episodeMode')">
                <button
                  type="button"
                  :class="['ws-seg-btn', { on: positioningForm.episode_mode === 'single' }]"
                  :aria-pressed="positioningForm.episode_mode === 'single'"
                  @click="positioningForm.episode_mode = 'single'"
                >{{ t('detail.ws.episodeSingle') }}</button>
                <button
                  type="button"
                  :class="['ws-seg-btn', { on: positioningForm.episode_mode === 'multi' }]"
                  :aria-pressed="positioningForm.episode_mode === 'multi'"
                  @click="positioningForm.episode_mode = 'multi'"
                >{{ t('detail.ws.episodeMulti') }}</button>
              </div>
            </div>
            <label class="field">
              <span class="field-label">{{ t('detail.ws.firstEpDuration') }}</span>
              <input v-model.number="positioningForm.first_episode_duration" class="input" type="number" min="15" max="600" step="5" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('detail.ws.laterEpDuration') }}</span>
              <input v-model.number="positioningForm.episode_duration" class="input" type="number" min="15" max="600" step="5" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('detail.ws.suggestiveness') }}</span>
              <BaseSelect v-model="positioningForm.suggestiveness" :options="suggestivenessOptions" />
            </label>
          </div>
        </div>

        <!-- ตั้งค่าระบบ（参考 Topview System Settings） -->
        <div class="ws-card ws-form">
          <h3 class="ws-form-section">{{ t('detail.ws.systemSettings') }}</h3>
          <div class="ws-switch-row">
            <div>
              <p class="ws-switch-title">{{ t('detail.ws.autoReview') }}</p>
              <p class="field-hint">{{ t('detail.ws.autoReviewHint') }}</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="positioningForm.auto_review"
              :class="['ws-switch', { on: positioningForm.auto_review }]"
              @click="positioningForm.auto_review = !positioningForm.auto_review"
            >
              <span class="ws-switch-knob"></span>
            </button>
          </div>
          <div class="ws-switch-row">
            <div>
              <p class="ws-switch-title">{{ t('detail.ws.autoPipeline') }}</p>
              <p class="field-hint">{{ t('detail.ws.autoPipelineHint') }}</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="positioningForm.auto_pipeline"
              :class="['ws-switch', { on: positioningForm.auto_pipeline }]"
              @click="positioningForm.auto_pipeline = !positioningForm.auto_pipeline"
            >
              <span class="ws-switch-knob"></span>
            </button>
          </div>
        </div>

        <!-- ทิศทางความคิดสร้างสรรค์（参考 Topview Creative Positioning） -->
        <div class="ws-card ws-form">
          <h3 class="ws-form-section">{{ t('detail.ws.creativePositioning') }}</h3>
          <p class="field-hint">{{ t('detail.ws.positioningHint') }}</p>
          <div v-for="grp in positioningGroups" :key="grp.key" class="field">
            <span class="field-label">{{ grp.label }}</span>
            <div class="ws-tags">
              <button
                v-for="tag in chipOptions(grp.key, grp.options)"
                :key="tag"
                type="button"
                :class="['ws-tag', { on: positioningForm[grp.key].includes(tag) }]"
                :aria-pressed="positioningForm[grp.key].includes(tag)"
                @click="toggleTag(grp.key, tag)"
              >{{ tag }}</button>
              <span v-if="customTag.group === grp.key" class="ws-tag-input">
                <input
                  v-model="customTag.text"
                  class="input"
                  :placeholder="t('detail.ws.customPlaceholder')"
                  @keydown.enter.prevent="commitCustom"
                  @blur="commitCustom"
                />
              </span>
              <button v-else type="button" class="ws-tag custom" @click="startCustom(grp.key)">+ {{ t('detail.ws.addCustom') }}</button>
            </div>
          </div>
        </div>
      </section>

      <!-- ===== โครงเรื่องและบท ===== -->
      <section v-else-if="activeTab === 'outline'" class="ws-panel">
        <div class="ws-panel-head">
          <h2 class="ws-panel-title">{{ t('detail.ws.outline') }}</h2>
          <div class="ws-actions">
            <div class="ws-view-toggle" role="tablist" :aria-label="t('detail.ws.viewToggleAria')">
              <button
                type="button"
                role="tab"
                :aria-selected="outlineView === 'list'"
                :class="['ws-view-btn', { on: outlineView === 'list' }]"
                @click="outlineView = 'list'"
              >{{ t('detail.ws.viewList') }}</button>
              <button
                type="button"
                role="tab"
                :aria-selected="outlineView === 'hook'"
                :class="['ws-view-btn', { on: outlineView === 'hook' }]"
                @click="outlineView = 'hook'"
              >{{ t('detail.ws.viewHook') }}</button>
            </div>
            <button
              class="btn ws-btn"
              type="button"
              :disabled="batchRunning"
              :title="t('detail.ws.batchRewriteHint')"
              @click="batchRewriteAll"
            >
              <Loader2 v-if="batchRunning" :size="14" :stroke-width="2" class="animate-spin" />
              <Sparkles v-else :size="14" :stroke-width="2" />
              {{ batchRunning ? t('detail.ws.batchRunning', batchProgress) : t('detail.ws.batchRewrite') }}
            </button>
            <button v-if="!isSingleMode" class="btn ws-btn" type="button" @click="openAddEpisode">
              <Plus :size="14" :stroke-width="2.2" />
              {{ t('detail.head.addEpisode') }}
            </button>
          </div>
        </div>

        <div class="ws-card ws-overview">
          <h3 class="ws-overview-title">{{ t('detail.ws.overview') }}</h3>
          <template v-if="loglineParts.logline">
            <p class="ws-label">LOGLINE</p>
            <p class="ws-text">{{ loglineParts.logline }}</p>
          </template>
          <template v-if="loglineParts.extra">
            <p class="ws-label">{{ t('detail.ws.grandExpectation') }}</p>
            <p class="ws-text">{{ loglineParts.extra }}</p>
          </template>
          <p v-if="!loglineParts.logline" class="ws-text dim">
            {{ t('detail.ws.noLogline') }}
            <button class="ws-link" type="button" @click="activeTab = 'settings'">{{ t('detail.ws.addLogline') }}</button>
          </p>
          <div class="ws-chips">
            <span class="ws-chip">{{ t('detail.head.epCount', { n: drama.episodes?.length || 0 }) }}</span>
            <span v-if="totalDuration" class="ws-chip">{{ fmtDuration(totalDuration) }}</span>
            <span class="ws-chip">{{ t('detail.head.charCount', { n: drama.characters?.length || 0 }) }}</span>
            <span class="ws-chip">{{ t('detail.ws.envCount', { n: drama.scenes?.length || 0 }) }}</span>
            <span class="ws-chip">{{ t('detail.ws.propCount', { n: drama.props?.length || 0 }) }}</span>
            <span v-if="drama.genre" class="ws-chip ws-chip-accent">{{ drama.genre }}</span>
          </div>
        </div>

        <template v-if="outlineView === 'list'">
          <article
            v-for="ep in sortedEpisodes"
            :key="ep.id"
            :class="['ws-card', 'ws-ep', { 'has-script': hasScript(ep) }]"
          >
          <div class="ws-ep-head">
            <span class="ws-ep-no">EP{{ epNumber(ep) }}</span>
            <h3 class="ws-ep-title truncate">{{ ep.title }}</h3>
            <div class="ws-ep-menu" @click.stop>
              <AppMenu
                :open="epMenuId === ep.id"
                placement="bottom-end"
                :min-width="170"
                @update:open="(v) => { epMenuId = v ? ep.id : null }"
              >
                <template #trigger>
                  <button type="button" class="ws-icon-btn" :title="t('common.more')" :aria-label="t('common.more')">
                    <MoreHorizontal :size="16" :stroke-width="2" />
                  </button>
                </template>
                <AppMenuItem
                  v-for="s in epStatusOptions"
                  :key="s.value"
                  :selected="epStatus(ep) === s.value"
                  @click="epMenuId = null; setEpisodeStatus(ep, s.value)"
                >{{ t('detail.ws.statusPrefix') }}{{ s.label }}</AppMenuItem>
                <AppMenuItem
                  v-for="r in resolutionOptions"
                  :key="r.value"
                  :selected="epResolution(ep) === r.value"
                  @click="epMenuId = null; setEpisodeResolution(ep, r.value)"
                >{{ r.label }}</AppMenuItem>
                <AppMenuItem danger @click="epMenuId = null; episodeToDelete = ep">{{ t('detail.ep.deleteTitle') }}</AppMenuItem>
              </AppMenu>
            </div>
          </div>
          <p v-if="epSummary(ep)" class="ws-ep-summary">{{ epSummary(ep) }}</p>
          <p v-else class="ws-ep-summary dim">{{ t('detail.ws.noSummary') }}</p>
          <div class="ws-chips">
            <span v-if="epDuration(ep)" class="ws-chip">{{ epDuration(ep) }}s</span>
            <span :class="['ws-chip', hasScript(ep) ? 'ok' : '']">{{ hasScript(ep) ? t('detail.ws.scriptDone') : t('detail.ws.scriptTodo') }}</span>
            <span :class="['ws-chip', (ep.video_url || ep.videoUrl) ? 'ok' : '']">{{ (ep.video_url || ep.videoUrl) ? t('detail.ep.merged') : t('detail.ws.noVideo') }}</span>
            <span class="ws-chip">{{ epStatusLabel(ep) }}</span>
            <span class="ws-chip">{{ epResolution(ep) }}</span>
          </div>
          <div class="ws-ep-actions">
            <button type="button" class="btn ws-btn ws-btn-wide" @click="openEpisode(ep, 'script')">
              <FileText :size="14" :stroke-width="1.9" />
              {{ hasScript(ep) ? t('detail.ws.viewScript') : t('detail.ws.editScript') }}
            </button>
            <button type="button" class="btn-white" @click="openEpisode(ep, 'production')">
              <Clapperboard :size="14" :stroke-width="1.9" />
              {{ t('detail.ws.enterVideo') }}
            </button>
          </div>
        </article>

        <button v-if="!isSingleMode" type="button" class="ws-add-ep" @click="openAddEpisode">
          <Plus :size="15" :stroke-width="2" />
          {{ drama.episodes?.length ? t('detail.ep.addNextText', { n: (drama.episodes?.length || 0) + 1 }) : t('detail.ep.emptyCreateText') }}
        </button>
        </template>

        <!-- โซ่ฮุค（参考 Topview Hook Chain view）：แก้ฮุคท้ายตอนได้ บันทึกเมื่อถอดโฟกัส -->
        <div v-else class="ws-hook-chain">
          <div v-if="!sortedEpisodes.length" class="empty-state">
            <p class="ws-text dim">{{ t('detail.ws.noEpisodesHook') }}</p>
            <button v-if="!isSingleMode" type="button" class="btn ws-btn" @click="openAddEpisode">
              <Plus :size="14" :stroke-width="2.2" />
              {{ t('detail.head.addEpisode') }}
            </button>
          </div>
          <article v-for="(ep, i) in sortedEpisodes" :key="ep.id" class="ws-card ws-hook-node">
            <span v-if="i" class="ws-hook-link" aria-hidden="true"></span>
            <div class="ws-ep-head">
              <span class="ws-ep-no">EP{{ epNumber(ep) }}</span>
              <h3 class="ws-ep-title truncate">{{ ep.title }}</h3>
            </div>
            <div class="field">
              <div class="ws-hook-label-row">
                <span class="field-label">{{ t('detail.ws.hookLabel') }}</span>
                <button
                  type="button"
                  class="ws-ai-btn"
                  :disabled="hookLoading.has(ep.id)"
                  @click="suggestHook(ep)"
                >
                  <Sparkles :size="12" :stroke-width="2" />
                  {{ hookLoading.has(ep.id) ? t('detail.ws.hookThinking') : t('detail.ws.suggestHook') }}
                </button>
              </div>
              <textarea
                v-model="ep.hook"
                class="input ws-hook-textarea"
                rows="3"
                :placeholder="t('detail.ws.hookPlaceholder')"
                @blur="saveHook(ep)"
              ></textarea>
            </div>
            <p class="field-hint">{{ t('detail.ws.hookHint') }}</p>
          </article>
        </div>
      </section>

    <!-- ===== ตัวละคร / สถานที่ / พร็อพ（คลังองค์ประกอบเดิม แยกตามแท็บ） ===== -->
    <div v-else class="assets-wrap ws-panel">
      <div class="ws-panel-head">
        <h2 class="ws-panel-title">{{ wsTabs.find(x => x.id === activeTab)?.label }}</h2>
        <span class="ws-panel-sub">{{ visibleAssets.length }}</span>
      </div>
      <!-- 全部素材为空 -->
      <div v-if="!materials.length" class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
        </div>
        <p class="empty-title">{{ t('detail.assets.emptyTitle') }}</p>
        <p class="empty-desc">{{ t('detail.assets.emptyDesc') }}</p>
      </div>

      <div v-else-if="materials.length" class="asset-groups">
        <template v-for="g in assetGroups" :key="g.kindKey">
          <template v-if="g.items.length">
            <div v-if="assetTab === 'all'" class="asset-group-head" :class="tagClass(g.kindKey)">
              <span class="group-icon">
                <svg v-if="g.kindKey === 'character'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <svg v-else-if="g.kindKey === 'scene'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.27 6.96 12 12l8.73-5.04M12 22.08V12"/></svg>
              </span>
              <span class="group-label">{{ g.label }}</span>
              <span class="group-count">{{ g.items.length }}</span>
            </div>

            <!-- 角色：横向布局卡片（头像 + 样貌/妆造 + 三视图提示词） -->
            <div v-if="g.kindKey === 'character'" class="character-asset-grid">
              <article
                v-for="m in g.items"
                :key="'character-' + m.id"
                class="card character-asset-card"
                tabindex="0"
                role="button"
                @click="openEdit(m)"
                @keydown.enter.prevent="openEdit(m)"
                @keydown.space.prevent="openEdit(m)"
              >
                <div class="character-asset-main">
                  <div class="character-asset-overview">
                    <div class="character-portrait">
                      <img v-if="matHasImage(m)" :src="thumbOf(assetSrc(m))" class="previewable-image" loading="lazy" @error="thumbFallback($event, assetSrc(m))" @click.stop="openAssetViewer(m)" />
                      <div v-else class="character-portrait-empty">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      </div>
                      <span class="asset-cover-badge" :class="matHasImage(m) ? 'is-ready' : (isPending(m) ? 'is-pending' : '')">
                        {{ matHasImage(m) ? t('episode.asset.portraitReady') : (isPending(m) ? t('episode.asset.portraitPending') : t('episode.asset.portraitTodo')) }}
                      </span>
                    </div>
                    <div class="character-asset-head">
                      <div class="character-title-block">
                        <div class="character-name-row">
                          <strong class="character-name">{{ m.name }}</strong>
                          <span class="tag">{{ m.role || t('common.role') }}</span>
                        </div>
                        <div class="character-visual-summary" :title="matDesc(m)">
                          <span>{{ t('episode.asset.appearance') }}{{ m.appearance || t('detail.assets.todoShort') }}</span>
                          <span>{{ t('episode.asset.styling') }}{{ m.styling || t('detail.assets.todoShort') }}</span>
                        </div>
                        <p v-if="m.description" class="character-traits" :title="m.description">{{ m.description }}</p>
                      </div>
                      <button class="btn btn-sm character-gen-btn" type="button" :disabled="isPending(m)" @click.stop="generateMaterial(m)">
                        <span v-if="isPending(m)" class="ring-spinner sm"></span>
                        {{ matHasImage(m) ? t('episode.asset.regen') : (isPending(m) ? t('episode.asset.generating') : t('episode.asset.generate')) }}
                      </button>
                      <button class="btn btn-sm" type="button" :title="t('episode.asset.uploadCharImage')" :disabled="isUploading(m)" @click.stop="uploadMaterial(m)">
                        <span v-if="isUploading(m)" class="ring-spinner sm"></span>
                        <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        {{ t('episode.asset.upload') }}
                      </button>
                    </div>
                  </div>
                  <div class="asset-final-prompt" :title="m.finalPrompt || ''">
                    <span class="afp-label">{{ t('episode.asset.finalPromptTurnaround') }}</span>
                    <span :class="['afp-text', !m.finalPrompt && 'dim']">{{ m.finalPrompt || t('episode.asset.finalPromptAutoTurnaround') }}</span>
                  </div>
                </div>
              </article>
            </div>

            <!-- 场景 / 道具：竖向布局卡片（封面 + 描述/光影/类型 + 最终提示词 + 底部状态） -->
            <div v-else class="asset-grid">
              <div
                v-for="m in g.items"
                :key="g.kindKey + '-' + m.id"
                :class="['card', 'asset-card', 'asset-click-card', g.kindKey === 'prop' ? 'prop-card' : '']"
                tabindex="0"
                role="button"
                @click="openEdit(m)"
                @keydown.enter.prevent="openEdit(m)"
                @keydown.space.prevent="openEdit(m)"
              >
                <div class="asset-cover wide">
                  <img v-if="matHasImage(m)" :src="thumbOf(assetSrc(m))" class="previewable-image" loading="lazy" @error="thumbFallback($event, assetSrc(m))" @click.stop="openAssetViewer(m)" />
                  <div v-else class="asset-cover-empty">
                    <svg v-if="g.kindKey === 'scene'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  </div>
                  <span class="asset-cover-badge" :class="matHasImage(m) ? 'is-ready' : (isPending(m) ? 'is-pending' : '')">
                    {{ matHasImage(m) ? t('episode.asset.ready') : (isPending(m) ? t('episode.asset.generating') : t('episode.asset.todo')) }}
                  </span>
                </div>
                <div class="asset-body">
                  <template v-if="g.kindKey === 'scene'">
                    <div class="asset-name" :title="m.location">{{ m.location }}</div>
                    <div class="asset-meta asset-desc dim" :title="matDesc(m)">{{ matDesc(m) || t('episode.asset.sceneDescTodo') }}</div>
                    <div v-if="m.lighting" class="asset-meta asset-light dim" :title="m.lighting">{{ t('episode.asset.lighting') }}{{ m.lighting }}</div>
                  </template>
                  <template v-else>
                    <div class="prop-name-row">
                      <span class="asset-name" :title="m.name">{{ m.name }}</span>
                      <span class="tag">{{ m.type || t('common.prop') }}</span>
                    </div>
                    <div class="asset-meta asset-desc dim" :title="m.description || ''">{{ m.description || t('episode.asset.noDescription') }}</div>
                  </template>
                  <div class="asset-meta asset-final" :class="{ dim: !m.finalPrompt }" :title="m.finalPrompt || ''">
                    <span class="afp-label">{{ g.kindKey === 'scene' ? t('episode.asset.finalPromptFixed') : t('episode.asset.finalPromptWhiteBg') }}</span>
                    {{ m.finalPrompt || (g.kindKey === 'scene' ? t('episode.asset.finalPromptAutoFixed') : t('episode.asset.finalPromptAutoWhiteBg')) }}
                  </div>
                </div>
                <div class="asset-foot">
                  <span :class="['dot', matHasImage(m) && 'ok', isPending(m) && 'pending']" />
                  <button class="btn btn-sm ml-auto" type="button" :title="t('episode.asset.uploadImage')" :disabled="isUploading(m)" @click.stop="uploadMaterial(m)">
                    <span v-if="isUploading(m)" class="ring-spinner sm"></span>
                    <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    {{ t('episode.asset.upload') }}
                  </button>
                  <button class="btn btn-sm" type="button" :disabled="isPending(m)" @click.stop="generateMaterial(m)">
                    <span v-if="isPending(m)" class="ring-spinner sm"></span>
                    {{ matHasImage(m) ? t('episode.asset.regen') : (isPending(m) ? t('episode.asset.generating') : t('episode.asset.generate')) }}
                  </button>
                </div>
              </div>
            </div>
          </template>
        </template>

        <!-- 筛选某一类但该类暂无素材 -->
        <div v-if="assetTab !== 'all' && !visibleAssets.length" class="empty-state">
          <div class="empty-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
          <p class="empty-title">{{ t('detail.assets.emptyKindTitle', { kind: tabLabel(assetTab) }) }}</p>
          <p class="empty-desc">{{ t('detail.assets.emptyKindDesc', { kind: tabLabel(assetTab) }) }}</p>
        </div>
      </div>

      <!-- 素材详情 / 编辑对话框（与工作台资产卡片同款布局） -->
      <div v-if="editDialog && editTarget" class="overlay mat-detail-overlay" @click.self="closeEdit">
        <section class="dialog mat-detail-dialog" :aria-label="t('detail.mat.dialogAria')">
          <header class="dialog-head mat-detail-head">
            <div class="mat-detail-title-block">
              <span class="mat-detail-kicker">{{ editTarget.kindKey === 'character' ? t('episode.asset.typeChar') : editTarget.kindKey === 'scene' ? t('episode.asset.typeScene') : t('episode.asset.typeProp') }}</span>
              <h2 class="mat-detail-title">{{ editTarget.name || t('detail.mat.unnamed') }}</h2>
            </div>
            <div class="mat-detail-head-actions">
              <span v-if="editTarget.kindKey === 'character'" class="tag">{{ editTarget.role || t('common.role') }}</span>
              <span v-else-if="editTarget.kindKey === 'prop'" class="tag">{{ editTarget.type || t('common.prop') }}</span>
              <span v-else class="tag">{{ editTarget.time || t('episode.asset.noTime') }}</span>
              <button class="btn btn-ghost btn-icon" @click="closeEdit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </header>

          <div class="dialog-body mat-detail-body">
            <div class="mat-detail-shell">
              <!-- 左侧：视觉预览 -->
              <aside class="mat-detail-preview-panel">
                <div class="mat-detail-section-title">
                  <span>{{ t('episode.asset.visualPreview') }}</span>
                  <span :class="['mat-detail-state', matHasImage(editTarget) ? 'is-ready' : '']">
                    {{ matHasImage(editTarget) ? t('episode.asset.ready') : t('episode.asset.todo') }}
                  </span>
                </div>

                <button
                  type="button"
                  class="mat-detail-media-frame"
                  :disabled="!matHasImage(editTarget)"
                  @click.stop="openAssetViewer(editTarget)"
                >
                  <img v-if="matHasImage(editTarget)" :src="thumbOf(assetSrc(editTarget))" @error="thumbFallback($event, assetSrc(editTarget))" />
                  <span v-else class="mat-detail-media-empty">
                    <svg v-if="editTarget.kindKey === 'character'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    <svg v-else-if="editTarget.kindKey === 'prop'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                    <svg v-else width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  </span>
                </button>

                <div class="mat-detail-meta-row">
                  <div class="mat-detail-meta-item">
                    <span>{{ t('episode.asset.kindLabel') }}</span>
                    <strong>{{ editTarget.kindKey === 'character' ? t('episode.asset.charPortrait') : editTarget.kindKey === 'prop' ? t('common.prop') : t('episode.asset.sceneImage') }}</strong>
                  </div>
                  <div class="mat-detail-meta-item">
                    <span>{{ editTarget.kindKey === 'character' ? t('episode.asset.roleLabel') : editTarget.kindKey === 'prop' ? t('episode.asset.propTypeLabel') : t('episode.asset.timeLabel') }}</span>
                    <strong>{{ editTarget.kindKey === 'character' ? (editTarget.role || t('common.role')) : editTarget.kindKey === 'prop' ? (editTarget.type || t('common.prop')) : (editTarget.time || t('episode.asset.noTime')) }}</strong>
                  </div>
                </div>
              </aside>

              <!-- 右侧：编辑信息 -->
              <section class="mat-detail-editor-panel">
                <div class="mat-detail-section-title">
                  <span>{{ t('episode.asset.editInfo') }}</span>
                  <span class="dim">{{ editTarget.kindKey === 'character' ? t('episode.asset.editHintChar') : editTarget.kindKey === 'prop' ? t('episode.asset.editHintProp') : t('episode.asset.editHintScene') }}</span>
                </div>

                <!-- 道具：单列物品外貌 -->
                <div v-if="editTarget.kindKey === 'prop'" class="mat-detail-edit-grid mat-detail-edit-grid--prop">
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.create.name') }}</span>
                    <input v-model="editDraft.name" class="input" :placeholder="t('episode.create.namePlaceholderProp')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.create.typeField') }}</span>
                    <input v-model="editDraft.type" class="input" :placeholder="t('detail.mat.propTypePlaceholder')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.asset.appearanceOfObject') }}</span>
                    <textarea v-model="editDraft.description" class="textarea mat-detail-textarea" rows="6" :placeholder="t('episode.asset.appearancePlaceholder')" />
                  </label>
                </div>

                <!-- 角色：样貌 + 妆造 -->
                <div v-else-if="editTarget.kindKey === 'character'" class="mat-detail-edit-grid mat-detail-edit-grid--character">
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.create.name') }}</span>
                    <input v-model="editDraft.name" class="input" :placeholder="t('episode.create.namePlaceholderChar')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.create.roleField') }}</span>
                    <input v-model="editDraft.role" class="input" :placeholder="t('episode.create.rolePlaceholder')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.asset.appearanceField') }}</span>
                    <textarea v-model="editDraft.appearance" class="textarea mat-detail-textarea" rows="5" :placeholder="t('episode.asset.appearanceFieldPlaceholder')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.asset.stylingField') }}</span>
                    <textarea v-model="editDraft.styling" class="textarea mat-detail-textarea" rows="5" :placeholder="t('episode.asset.stylingFieldPlaceholder')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('detail.mat.personaField') }}</span>
                    <textarea v-model="editDraft.description" class="textarea mat-detail-textarea" rows="4" :placeholder="t('detail.mat.personaPlaceholder')" />
                  </label>
                </div>

                <!-- 场景：描述 + 光影 -->
                <div v-else class="mat-detail-edit-grid mat-detail-edit-grid--scene">
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.create.location') }}</span>
                    <input v-model="editDraft.location" class="input" :placeholder="t('detail.mat.locationPlaceholder')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.create.time') }}</span>
                    <input v-model="editDraft.time" class="input" :placeholder="t('detail.mat.timePlaceholder')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.asset.sceneDescField') }}</span>
                    <textarea v-model="editDraft.prompt" class="textarea mat-detail-textarea" rows="5" :placeholder="t('episode.asset.sceneDescPlaceholder')" />
                  </label>
                  <label class="mat-detail-edit-field">
                    <span>{{ t('episode.asset.sceneLightField') }}</span>
                    <textarea v-model="editDraft.lighting" class="textarea mat-detail-textarea" rows="5" :placeholder="t('episode.asset.sceneLightPlaceholder')" />
                  </label>
                </div>
              </section>
            </div>

            <!-- 最终提示词：可生成 / 重新生成 / 手动编辑 -->
            <section class="mat-detail-prompt-panel">
              <div class="mat-detail-section-title">
                <span>{{ t('detail.mat.finalPromptLabel') }}</span>
                <span class="dim">{{ t('detail.mat.finalPromptSub') }}</span>
                <button
                  class="btn btn-sm mat-detail-prompt-gen"
                  :disabled="finalPromptGen || !firstEpisodeId"
                  :title="firstEpisodeId ? t('detail.mat.genPromptTitle') : t('detail.mat.needEpisodeFirst')"
                  @click="generateFinalPrompt(editTarget)"
                >
                  <svg v-if="!finalPromptGen" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m13.5-6.5L14 8m-4 8-2.5 2.5m11 0L16 16M8 8 5.5 5.5"/><circle cx="12" cy="12" r="3"/></svg>
                  {{ finalPromptGen ? t('episode.asset.generating') + '…' : (editDraft.finalPrompt ? t('episode.sb.regenPrompt') : t('episode.asset.genPrompt')) }}
                </button>
              </div>
              <textarea
                v-model="editDraft.finalPrompt"
                class="textarea mat-detail-prompt-text"
                rows="5"
                :placeholder="t('detail.mat.promptPlaceholder')"
              ></textarea>
            </section>
          </div>

          <footer class="dialog-foot mat-detail-foot">
            <div class="mat-detail-secondary-actions">
              <button class="btn" @click="closeEdit">{{ t('common.close') }}</button>
            </div>
            <div class="mat-detail-primary-actions">
              <button
                class="btn"
                :disabled="isUploading(editTarget)"
                @click="uploadMaterial(editTarget)"
              >
                <span v-if="isUploading(editTarget)" class="ring-spinner sm"></span>
                <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                {{ t('episode.asset.uploadImage') }}
              </button>
              <button
                class="btn"
                :disabled="isPending(editTarget)"
                @click="generateMaterial(editTarget)"
              >
                {{ matHasImage(editTarget) ? t('episode.sb.regenPrompt') : (isPending(editTarget) ? t('episode.asset.generating') + '…' : t('detail.mat.genImage')) }}
              </button>
              <button class="btn btn-primary" :disabled="editSaving" @click="saveEdit">
                {{ editSaving ? t('detail.mat.saving') : t('episode.asset.saveChanges') }}
              </button>
            </div>
          </footer>
        </section>
      </div>

      <!-- 图片查看器 -->
      <div v-if="assetViewer.open" class="overlay viewer-overlay" @click.self="closeAssetViewer">
        <div class="dialog viewer-dialog">
          <div class="viewer-head">
            <span class="viewer-title">{{ assetViewer.title }}</span>
            <button class="btn btn-icon btn-sm btn-ghost" @click="closeAssetViewer">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <img :src="assetViewer.src" :alt="assetViewer.title" class="viewer-img" />
        </div>
      </div>
    </div>
    </div>

    <div v-if="addDialog" class="overlay" @click.self="addDialog = false">
      <div class="dialog ep-dialog">
        <div class="dialog-head">
          <div class="dialog-title">{{ t('detail.epCreate.title') }}</div>
          <button class="btn btn-icon btn-sm btn-ghost ml-auto dialog-close" @click="addDialog = false">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="dialog-body">
          <label class="field">
            <span class="field-label">{{ t('detail.epCreate.titleField') }}</span>
            <input v-model="newEpisodeTitle" class="input" :placeholder="t('detail.epCreate.titlePlaceholder')" />
            <span class="field-hint">{{ t('detail.epCreate.titleHint', { example: t('detail.epCreate.example', { n: 3 }) }) }}</span>
          </label>
          <label class="field">
            <span class="field-label">{{ t('detail.epCreate.resolution') }}</span>
            <BaseSelect v-model="newEpisodeResolution" :options="resolutionOptions" :placeholder="t('detail.epCreate.resolutionPlaceholder')" />
            <span class="field-hint">{{ t('detail.epCreate.resolutionHint') }}</span>
          </label>
        </div>
        <div class="dialog-foot">
          <span class="dialog-foot-copy">{{ t('detail.epCreate.lockCopy') }}</span>
          <button class="btn" @click="addDialog = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="creatingEpisode" @click="addEpisode">
            {{ creatingEpisode ? t('detail.epCreate.creating') : t('detail.epCreate.create') }}
          </button>
        </div>
      </div>
    </div>
    <ConfirmDialog
      :open="!!episodeToDelete"
      :title="t('detail.ep.deleteTitle')"
      :message="t('detail.epDelete.message', { title: episodeToDelete?.title || t('detail.ep.episodeN', { n: episodeToDelete?.episode_number || episodeToDelete?.episodeNumber }) })"
      :loading="deletingEpisode"
      @confirm="confirmDelEpisode"
      @cancel="episodeToDelete = null"
    />
  </div>
</template>

<script setup>
import { toast } from 'vue-sonner'
import { toastError } from '~/composables/useToast'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Plus, MoreHorizontal, FileText, Clapperboard, Sparkles, LayoutDashboard, Loader2 } from 'lucide-vue-next'
import { api, dramaAPI, episodeAPI, characterAPI, sceneAPI, propAPI, uploadAPI, stylePresetAPI } from '~/composables/useApi'
import { GENRE_TAGS, BACKGROUND_TAGS, TROPE_TAGS } from '~/composables/useCreativeTags'
import BaseSelect from '~/components/BaseSelect.vue'

// 项目工作区全屏显示（与剧集工作台同为 studio 布局，参考 Topview 项目页）
definePageMeta({ layout: 'studio' })

const { t, te, locale } = useI18n()

const route = useRoute()
const drama = ref(null)
const budgetSummary = ref(null)
function formatBudget(value) { return `฿${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
const dramaId = Number(route.params.id)
const addDialog = ref(false)
const creatingEpisode = ref(false)
const newEpisodeTitle = ref('')
const episodeToDelete = ref(null)
const deletingEpisode = ref(false)

// 视频分辨率：创建集时固定（持久化到 episodes.resolution），集卡片上可修改
const resolutionOptions = computed(() => ([
  { label: t('detail.ep.res720'), value: '720p' },
  { label: t('detail.ep.res480'), value: '480p' },
]))
const newEpisodeResolution = ref('720p')
const epResMenuId = ref(null)

function epResolution(ep) { return ep.resolution === '480p' ? '480p' : '720p' }

async function setEpisodeResolution(ep, resolution) {
  epResMenuId.value = null
  if (epResolution(ep) === resolution) return
  const prev = ep.resolution
  ep.resolution = resolution
  try {
    await episodeAPI.update(ep.id, { resolution })
    toast.success(t('detail.ep.resSwitched', { res: resolution }))
  } catch (e) {
    ep.resolution = prev
    toastError(e)
  }
}

// 集状态由用户手动标记（持久化到 episodes.status），不再按剧本内容自动推算
const epStatusOptions = computed(() => ([
  { label: t('index.status.draft'), value: 'draft' },
  { label: t('index.status.active'), value: 'active' },
  { label: t('index.status.completed'), value: 'completed' },
]))
const epStatusMenuId = ref(null)

function epStatus(ep) { return ep.status || 'draft' }
function epStatusLabel(ep) { return epStatusOptions.value.find(s => s.value === epStatus(ep))?.label || t('index.status.draft') }
function epStatusDotClass(ep) { return epStatus(ep) === 'active' ? 'dot-active' : epStatus(ep) === 'completed' ? 'dot-done' : 'dot-pending' }

function formatEpTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60_000) return t('index.time.justNow')
  if (diff < 3600_000) return t('index.time.minutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400_000) return t('index.time.hoursAgo', { n: Math.floor(diff / 3600000) })
  return `${d.getMonth() + 1}/${d.getDate()}`
}

async function setEpisodeStatus(ep, status) {
  epStatusMenuId.value = null
  if (epStatus(ep) === status) return
  const prev = ep.status
  ep.status = status
  try {
    await episodeAPI.update(ep.id, { status })
  } catch (e) {
    ep.status = prev
    toastError(e)
  }
}

async function load() {
  try {
    drama.value = await dramaAPI.get(dramaId)
    budgetSummary.value = await dramaAPI.budget(dramaId)
  } catch (e) {
    toastError(e)
  }
}

function openAddEpisode() {
  newEpisodeTitle.value = ''
  newEpisodeResolution.value = '720p'
  addDialog.value = true
}

async function addEpisode() {
  try {
    creatingEpisode.value = true
    // 图片/视频生成配置由后端自动锁定为当前启用的最高优先级配置；分辨率随集固定
    await episodeAPI.create({
      drama_id: dramaId,
      title: newEpisodeTitle.value || undefined,
      resolution: newEpisodeResolution.value,
    })
    toast.success(t('detail.epCreate.added'))
    addDialog.value = false
    load()
  } catch (e) {
    toastError(e)
  } finally {
    creatingEpisode.value = false
  }
}

async function confirmDelEpisode() {
  const ep = episodeToDelete.value
  if (!ep) return
  try {
    deletingEpisode.value = true
    await episodeAPI.del(ep.id)
    toast.success(t('index.deleted'))
    episodeToDelete.value = null
    load()
  } catch (e) {
    toastError(e)
  } finally {
    deletingEpisode.value = false
  }
}

/* ===== 工作区 Tab：设置 / 大纲与剧本 / 角色 / 场景 / 道具 ===== */
const activeTab = ref('outline')
// 资产类 Tab 直接映射到素材库的分类过滤
const ASSET_TAB_KIND = { characters: 'character', scenes: 'scene', props: 'prop' }
const assetTab = computed(() => ASSET_TAB_KIND[activeTab.value] || 'all')

function hasScript(ep) { return !!(ep.script_content || ep.scriptContent) }
function epNumber(ep) { return ep.episode_number || ep.episodeNumber }
const sortedEpisodes = computed(() => [...(drama.value?.episodes || [])].sort((a, b) => epNumber(a) - epNumber(b)))
const allHaveImages = list => list.length > 0 && list.every(m => matHasImage(m))

// 准备进度（对应 Topview「Prep x/4」）：设置 / 剧本 / 角色形象 / 场景图
const prepSteps = computed(() => {
  const d = drama.value || {}
  return [
    { id: 'settings', label: t('detail.ws.tabSettings'), done: !!(d.style && d.description) },
    { id: 'outline', label: t('detail.ws.tabOutline'), done: (d.episodes || []).length > 0 && (d.episodes || []).every(hasScript) },
    { id: 'characters', label: t('detail.ws.tabCharacters'), done: allHaveImages(d.characters || []) },
    { id: 'scenes', label: t('detail.ws.tabScenes'), done: allHaveImages(d.scenes || []) },
  ]
})
const prepDone = computed(() => prepSteps.value.filter(s => s.done).length)
const prepMissing = computed(() => prepSteps.value.filter(s => !s.done).map(s => s.label))
const wsTabs = computed(() => {
  const d = drama.value || {}
  const done = id => prepSteps.value.find(s => s.id === id)?.done
  return [
    { id: 'settings', label: t('detail.ws.tabSettings'), done: done('settings') },
    { id: 'outline', label: t('detail.ws.tabOutline'), done: done('outline'), count: (d.episodes || []).length },
    { id: 'characters', label: t('detail.ws.tabCharacters'), done: done('characters'), count: (d.characters || []).length },
    { id: 'scenes', label: t('detail.ws.tabScenes'), done: done('scenes'), count: (d.scenes || []).length },
    { id: 'props', label: t('detail.ws.tabProps'), done: allHaveImages(d.props || []), count: (d.props || []).length },
  ]
})

// 项目概览：description 第一段作 logline，其余作补充（导入时的「คำถามใหญ่ของเรื่อง:」前缀去掉）
const loglineParts = computed(() => {
  const parts = String(drama.value?.description || '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
  return { logline: parts[0] || '', extra: parts.slice(1).join('\n\n').replace(/^คำถามใหญ่ของเรื่อง:\s*/, '') }
})
// 集概要：原文(content)第一段；时长取 duration 字段或原文里的「ความยาวโดยประมาณ: N วินาที」
function epSummary(ep) { return String(ep.content || '').split(/\n\s*\n/)[0].trim() }
function epDuration(ep) {
  if (ep.duration) return Number(ep.duration)
  const m = /ความยาวโดยประมาณ:\s*(\d+)/.exec(ep.content || '')
  return m ? Number(m[1]) : 0
}
const totalDuration = computed(() => (drama.value?.episodes || []).reduce((s, ep) => s + epDuration(ep), 0))
function fmtDuration(sec) { return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s` }

const epMenuId = ref(null)
function openEpisode(ep, panel) {
  const q = panel === 'production' ? '?panel=production&tab=videos' : '?panel=script'
  navigateTo(`/drama/${drama.value.id}/episode/${epNumber(ep)}${q}`)
}

// 风格名称（内置风格按界面语言显示）
const stylePresets = ref([])
function styleName(key) {
  if (key && te(`index.styleNames.${key}`)) return t(`index.styleNames.${key}`)
  return stylePresets.value.find(p => p.value === key)?.name || key
}
// 'custom' = the author's own style description, kept in metadata.customStyle (backend style-preset.ts)
const styleOptions = computed(() => [
  ...stylePresets.value.map(p => ({ label: styleName(p.value), value: p.value })),
  { label: styleName('custom'), value: 'custom' },
])

// 项目设置表单（aspect_ratio 现可编辑，随表单保存）
const settingsForm = reactive({ title: '', description: '', genre: '', style: '', aspect_ratio: '16:9', budget_thb: '' })
const settingsSaving = ref(false)
const SETTINGS_KEYS = ['title', 'description', 'genre', 'style', 'aspect_ratio']
const ratioOptions = [
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
]

/* ===== ตั้งค่าพื้นฐาน + ทิศทางความคิดสร้างสรรค์（存 dramas.metadata JSON，参考 Topview） ===== */
const positioningForm = reactive({
  episode_mode: 'multi',
  first_episode_duration: 120,
  episode_duration: 60,
  suggestiveness: 'all',
  auto_review: false,
  auto_pipeline: false,
  genres: [],
  backgrounds: [],
  tropes: [],
  customStyle: '',
})
const METADATA_KEYS = ['episode_mode', 'first_episode_duration', 'episode_duration', 'suggestiveness', 'auto_review', 'auto_pipeline', 'genres', 'backgrounds', 'tropes', 'customStyle']
function metadataFromForm() {
  return Object.fromEntries(METADATA_KEYS.map(k => [k, positioningForm[k]]))
}
const positioningSnapshot = ref('')

const suggestivenessOptions = computed(() => ([
  { label: t('detail.ws.suggAll'), value: 'all' },
  { label: t('detail.ws.suggTeen'), value: 'teen' },
  { label: t('detail.ws.suggSixteen'), value: 'sixteen' },
  { label: t('detail.ws.suggAdult'), value: 'adult' },
]))

// แท็กอ้างอิงจาก Topview Drama Studio เวอร์ชันไทย（เก็บข้อความไทยลง metadata ตรง ๆ）— รายการอยู่ใน useCreativeTags
const positioningGroups = computed(() => ([
  { key: 'genres', label: t('detail.ws.genreTags'), options: GENRE_TAGS },
  { key: 'backgrounds', label: t('detail.ws.backgroundTags'), options: BACKGROUND_TAGS },
  { key: 'tropes', label: t('detail.ws.tropeTags'), options: TROPE_TAGS },
]))
// รวมแท็กกำหนดเองที่เลือกไว้แต่ไม่อยู่ในรายการมาตรฐาน
function chipOptions(key, options) {
  const selected = positioningForm[key] || []
  return [...options, ...selected.filter(tag => !options.includes(tag))]
}
function toggleTag(key, tag) {
  const arr = positioningForm[key]
  const idx = arr.indexOf(tag)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(tag)
}
const customTag = reactive({ group: null, text: '' })
function startCustom(key) {
  customTag.group = key
  customTag.text = ''
}
function commitCustom() {
  const value = customTag.text.trim()
  if (value && customTag.group && !positioningForm[customTag.group].includes(value)) {
    positioningForm[customTag.group].push(value)
  }
  customTag.group = null
  customTag.text = ''
}

function fillPositioning() {
  const d = drama.value
  if (!d) return
  const m = d.metadata || {}
  // topview_settings มาจาก import-topview.mjs — ใช้เป็นค่าเริ่มต้นถ้ายังไม่ได้ตั้งค่าเอง
  const tv = m.topview_settings || {}
  const tvMode = typeof tv.episode_mode === 'string' && tv.episode_mode.toLowerCase().includes('single') ? 'single' : null
  const tvSugg = typeof tv.suggestiveness === 'string' && tv.suggestiveness.toLowerCase().includes('all') ? 'all' : null
  positioningForm.episode_mode = m.episode_mode === 'single' || m.episode_mode === 'multi' ? m.episode_mode : (tvMode || 'multi')
  positioningForm.first_episode_duration = Number(m.first_episode_duration) || 120
  positioningForm.episode_duration = Number(m.episode_duration) || 60
  positioningForm.suggestiveness = m.suggestiveness || (tvSugg || 'all')
  positioningForm.auto_review = m.auto_review === true || tv.auto_review === true
  positioningForm.auto_pipeline = m.auto_pipeline === true
  positioningForm.genres = [...(Array.isArray(m.genres) ? m.genres : [])]
  positioningForm.backgrounds = [...(Array.isArray(m.backgrounds) ? m.backgrounds : [])]
  positioningForm.tropes = [...(Array.isArray(m.tropes) ? m.tropes : [])]
  positioningForm.customStyle = typeof m.customStyle === 'string' ? m.customStyle : ''
  positioningSnapshot.value = JSON.stringify(metadataFromForm())
}

function fillSettings() {
  const d = drama.value
  if (!d) return
  for (const k of SETTINGS_KEYS) settingsForm[k] = d[k] || ''
  settingsForm.budget_thb = d.budget_thb ?? ''
  if (!d.aspect_ratio && !d.aspectRatio) settingsForm.aspect_ratio = '16:9'
  fillPositioning()
}
const positioningDirty = computed(() => JSON.stringify(metadataFromForm()) !== positioningSnapshot.value)
const settingsDirty = computed(() =>
  !!drama.value && (SETTINGS_KEYS.some(k => (settingsForm[k] || '') !== (drama.value[k] || '')) || String(settingsForm.budget_thb ?? '') !== String(drama.value.budget_thb ?? '') || positioningDirty.value),
)
async function saveSettings() {
  if (!settingsForm.title.trim()) { toast.error(t('episode.create.nameRequired')); return }
  if (settingsForm.style === 'custom' && !positioningForm.customStyle.trim()) { toast.error(t('index.styleTabs.customRequired')); return }
  const budget = settingsForm.budget_thb === '' ? null : Number(settingsForm.budget_thb)
  if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > 100000000)) {
    toast.warning(t('productionGuard.budgetInvalid')); return
  }
  settingsSaving.value = true
  try {
    // merge ทับ metadata เดิม (เช่น topview_settings / source จาก import) ด้วยค่าที่ตั้งเอง
    await dramaAPI.update(dramaId, {
      ...settingsForm,
      budget_thb: budget,
      title: settingsForm.title.trim(),
      metadata: { ...(drama.value?.metadata || {}), ...metadataFromForm() },
    })
    toast.success(t('common.saved'))
    await load()
    fillSettings()
  } catch (e) {
    toastError(e)
  } finally {
    settingsSaving.value = false
  }
}

/* ===== โซ่ฮุค（Hook Chain）：แก้ ep.hook แล้วบันทึกเมื่อถอดโฟกัส + AI ช่วยเสนอฮุค ===== */
const outlineView = ref('list')
const savingHooks = ref(new Set())
const hookLoading = ref(new Set())
async function saveHook(ep) {
  const value = String(ep.hook || '')
  if (value === (ep.__hookOriginal || '')) return
  const key = `ep-${ep.id}`
  if (savingHooks.value.has(key)) return
  savingHooks.value = new Set(savingHooks.value).add(key)
  const prev = ep.__hookOriginal || ''
  ep.__hookOriginal = value
  try {
    await episodeAPI.update(ep.id, { hook: value || null })
    toast.success(t('detail.ws.hookSaved'))
  } catch (e) {
    ep.hook = prev
    ep.__hookOriginal = prev
    toastError(e)
  } finally {
    savingHooks.value = new Set([...savingHooks.value].filter(k => k !== key))
  }
}

// AI เสนอฮุค：เติมลงช่องแล้วบันทึกทันที（ผู้ใช้ยังแก้ต่อได้）
async function suggestHook(ep) {
  if (hookLoading.value.has(ep.id)) return
  hookLoading.value = new Set(hookLoading.value).add(ep.id)
  try {
    const res = await episodeAPI.suggestHook(ep.id)
    if (res?.suggestion) {
      ep.hook = res.suggestion
      await saveHook(ep)
    }
  } catch (e) {
    toastError(e)
  } finally {
    hookLoading.value = new Set([...hookLoading.value].filter(x => x !== ep.id))
  }
}

// โหมดตอนเดียว：ซ่อนปุ่มเพิ่มตอนทั้งหมด
const isSingleMode = computed(() => (drama.value?.metadata?.episode_mode || '') === 'single')

/* ===== แต่งบทอัตโนมัติทั้งโปรเจกต์：ไล่ทุกตอนที่ยังไม่มีบท (rewrite → review → extract ตามตั้งค่า) ===== */
const batchRunning = ref(false)
const batchProgress = ref({ done: 0, total: 0, current: '' })
const PIPELINE_TARGETS = ['characters', 'scenes', 'props']
async function waitExtraction(epId, maxMs = 300000) {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    await new Promise(r => setTimeout(r, 2500))
    try {
      const st = await episodeAPI.extractStatus(epId)
      const busy = PIPELINE_TARGETS.some(t => st?.[t]?.status === 'running')
      if (!busy) return true
    } catch { /* ข้ามรอบ ลองใหม่ */ }
  }
  return false
}
async function batchRewriteAll() {
  if (batchRunning.value) return
  const targets = sortedEpisodes.value.filter(ep => !hasScript(ep) && String(ep.content || '').trim())
  if (!targets.length) { toast.info(t('detail.ws.batchNone')); return }
  batchRunning.value = true
  batchProgress.value = { done: 0, total: targets.length, current: '' }
  const meta = drama.value?.metadata || {}
  let ok = 0
  for (const ep of targets) {
    batchProgress.value.current = `EP${epNumber(ep)} · ${ep.title}`
    try {
      await api.post('/agent/script_rewriter/chat', {
        message: '请读取剧本并改写为格式化剧本，然后保存',
        drama_id: dramaId,
        episode_id: ep.id,
      })
      if (meta.auto_review) {
        try { await episodeAPI.reviewScript(ep.id) } catch (e) { toastError(e) }
      }
      if (meta.auto_pipeline) {
        for (const t of PIPELINE_TARGETS) episodeAPI.extract(ep.id, t).catch(() => {})
        await waitExtraction(ep.id)
      }
      ok++
    } catch (e) {
      toastError(e)
    }
    batchProgress.value.done++
  }
  batchRunning.value = false
  toast.success(t('detail.ws.batchDone', { n: ok }))
  await load()
}
// 首次加载时填表；之后的轮询刷新（生图进度）不覆盖正在编辑的内容
watch(drama, (d, prev) => { if (d && !prev) fillSettings() })
onMounted(async () => {
  try { stylePresets.value = await stylePresetAPI.list(true) || [] } catch { /* 风格列表失败不阻塞页面 */ }
})

/* ===== 素材库 ===== */
const assetViewer = ref({ open: false, src: '', title: '' })
const pendingMaterials = ref(new Set())
const assetTabs = computed(() => ([
  { label: t('index.status.all'), value: 'all' },
  { label: t('common.role'), value: 'character' },
  { label: t('common.scene'), value: 'scene' },
  { label: t('common.prop'), value: 'prop' },
]))
const KIND_ORDER = { character: 0, scene: 1, prop: 2 }

// 素材库以 characters / scenes / props 三张资产表为源（后端生图会写回其 imageUrl）
function matImage(m) { return m.image_url || m.imageUrl || m.localPath || m.local_path || '' }
function matHasImage(m) { return !!matImage(m) }
function assetSrc(m) {
  const raw = matImage(m)
  if (!raw) return ''
  return /^https?:\/\//i.test(raw) || raw.startsWith('/') ? raw : `/${raw}`
}
function matCreatedAt(m) { return m.created_at || m.updated_at || m.createdAt || m.updatedAt }
function matDesc(m) {
  if (m.kindKey === 'character') return m.appearance || m.description || ''
  if (m.kindKey === 'scene') return m.prompt || m.description || ''
  return m.description || ''
}
function tagClass(kindKey) {
  return kindKey === 'character' ? 'is-character' : kindKey === 'scene' ? 'is-scene' : 'is-prop'
}
function tabLabel(v) { return assetTabs.value.find(x => x.value === v)?.label || '' }

// kind 为显示名（渲染时求值），kindKey 为逻辑值
const materials = computed(() => {
  const d = drama.value
  if (!d) return []
  const list = []
  for (const c of d.characters || []) list.push({ ...c, kind: t('common.role'), kindKey: 'character' })
  for (const s of d.scenes || []) list.push({ ...s, kind: t('common.scene'), kindKey: 'scene' })
  for (const p of d.props || []) list.push({ ...p, kind: t('common.prop'), kindKey: 'prop' })
  return list.sort((a, b) => (KIND_ORDER[a.kindKey] - KIND_ORDER[b.kindKey]) || (a.id - b.id))
})
const visibleAssets = computed(() =>
  assetTab.value === 'all' ? materials.value : materials.value.filter(m => m.kindKey === assetTab.value),
)
const assetTotal = computed(() => materials.value.length)
// 按类型分组：全部模式下分成 角色 / 场景 / 道具 三个分区；筛选单类时只保留该类
const assetGroups = computed(() => {
  const groups = [
    { kindKey: 'character', label: t('common.role'), items: materials.value.filter(m => m.kindKey === 'character') },
    { kindKey: 'scene', label: t('common.scene'), items: materials.value.filter(m => m.kindKey === 'scene') },
    { kindKey: 'prop', label: t('common.prop'), items: materials.value.filter(m => m.kindKey === 'prop') },
  ]
  return assetTab.value === 'all'
    ? groups
    : groups.filter(g => g.kindKey === assetTab.value)
})

function pendingKey(m) { return `${m.kindKey}:${m.id}` }
function isPending(m) { return pendingMaterials.value.has(pendingKey(m)) }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function generateMaterial(m) {
  const epId = drama.value?.episodes?.[0]?.id
  if (!epId) { toast.error(t('detail.mat.needEpisodeForImage')); return }
  const key = pendingKey(m)
  if (pendingMaterials.value.has(key)) return
  pendingMaterials.value = new Set(pendingMaterials.value).add(key)
  try {
    if (m.kindKey === 'character') await characterAPI.generateImage(m.id, epId)
    else if (m.kindKey === 'scene') await sceneAPI.generateImage(m.id, epId)
    else await propAPI.generateImage(m.id, epId)
    toast.success(t('detail.mat.generating', { kind: m.kind, name: m.name }))
    pollMaterial(m)
  } catch (e) {
    pendingMaterials.value = new Set([...pendingMaterials.value].filter(k => k !== key))
    toastError(e)
  }
}

// 生图为异步任务：轮询重新加载 drama，直到该素材 imageUrl 出现
async function pollMaterial(m) {
  const key = pendingKey(m)
  for (let i = 0; i < 40; i++) {
    await sleep(2500)
    await load()
    const d = drama.value
    const list = m.kindKey === 'character' ? d?.characters : m.kindKey === 'scene' ? d?.scenes : d?.props
    const rec = list?.find(x => x.id === m.id)
    if (rec && matImage(rec)) {
      pendingMaterials.value = new Set([...pendingMaterials.value].filter(k => k !== key))
      return
    }
  }
  pendingMaterials.value = new Set([...pendingMaterials.value].filter(k => k !== key))
  toast.info(t('detail.mat.genTimeout', { kind: m.kind, name: m.name }))
}

function switchToAssets() {
  activeTab.value = 'characters'
}

/* ===== 素材图片手动上传（角色形象 / 场景图 / 道具图） ===== */
const uploadingMaterials = ref(new Set())
function isUploading(m) { return uploadingMaterials.value.has(pendingKey(m)) }

function uploadMaterial(m) {
  const key = pendingKey(m)
  if (uploadingMaterials.value.has(key)) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    uploadingMaterials.value = new Set(uploadingMaterials.value).add(key)
    try {
      const res = await uploadAPI.image(file)
      // 与生图回写保持一致：存相对路径（static/...），展示时补前导斜杠
      const payload = { image_url: res.path, local_path: res.path }
      if (m.kindKey === 'character') await characterAPI.update(m.id, payload)
      else if (m.kindKey === 'scene') await sceneAPI.update(m.id, payload)
      else await propAPI.update(m.id, payload)
      toast.success(t('detail.mat.uploaded', { kind: m.kind, name: m.name }))
      await load()
      // 详情弹窗打开时同步刷新预览
      if (editTarget.value && editTarget.value.kindKey === m.kindKey && editTarget.value.id === m.id) {
        editTarget.value = { ...editTarget.value, image_url: res.path, local_path: res.path }
      }
    } catch (e) {
      toastError(e)
    } finally {
      uploadingMaterials.value = new Set([...uploadingMaterials.value].filter(k => k !== key))
    }
  }
  input.click()
}

function openAssetViewer(m) {
  assetViewer.value = { open: true, src: assetSrc(m), title: `${m.kind} · ${m.name}` }
}
function closeAssetViewer() {
  assetViewer.value = { open: false, src: '', title: '' }
}

function fmtDate(s) {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale.value === 'th' ? 'th-TH' : 'en-US', { month: 'short', day: 'numeric' })
}

/* ===== 素材信息编辑 ===== */
const editDialog = ref(false)
const editSaving = ref(false)
const editTarget = ref(null)
const editDraft = reactive({})

function openEdit(m) {
  editTarget.value = m
  // 按类型初始化 draft
  Object.keys(editDraft).forEach(k => delete editDraft[k])
  if (m.kindKey === 'character') {
    Object.assign(editDraft, { name: m.name || '', role: m.role || '', appearance: m.appearance || '', description: m.description || '', styling: m.styling || '' })
  } else if (m.kindKey === 'scene') {
    Object.assign(editDraft, { location: m.location || '', time: m.time || '', prompt: m.prompt || '', lighting: m.lighting || '' })
  } else {
    Object.assign(editDraft, { name: m.name || '', type: m.type || '', description: m.description || '' })
  }
  editDraft.finalPrompt = m.finalPrompt || m.final_prompt || ''
  editDialog.value = true
}

// 生成/重新生成最终提示词（不生图）：调用各类型 generate-prompt 接口，结果写回 draft
const finalPromptGen = ref(false)
const firstEpisodeId = computed(() => drama.value?.episodes?.[0]?.id || null)
async function generateFinalPrompt(m) {
  const epId = firstEpisodeId.value
  if (!epId) { toast.error(t('detail.mat.needEpisodeForPrompt')); return }
  finalPromptGen.value = true
  try {
    let res
    if (m.kindKey === 'character') res = await characterAPI.generatePrompt(m.id, epId, true)
    else if (m.kindKey === 'scene') res = await sceneAPI.generatePrompt(m.id, epId, true)
    else res = await propAPI.generatePrompt(m.id, epId, true)
    const fp = res?.final_prompt || res?.finalPrompt
    if (!fp) throw new Error(t('episode.asset.promptGenFailedRetry'))
    editTarget.value = { ...m, finalPrompt: fp }
    editDraft.finalPrompt = fp
    toast.success(t('episode.asset.promptGenerated'))
  } catch (e) {
    toastError(e)
  } finally {
    finalPromptGen.value = false
  }
}

function closeEdit() {
  editDialog.value = false
  editTarget.value = null
}

async function saveEdit() {
  const target = editTarget.value
  if (!target) return
  // 必填校验
  if (target.kindKey === 'character' && !String(editDraft.name ?? '').trim()) { toast.error(t('episode.create.nameRequired')); return }
  if (target.kindKey === 'scene' && !String(editDraft.location ?? '').trim()) { toast.error(t('detail.mat.locationRequired')); return }
  if (target.kindKey === 'prop' && !String(editDraft.name ?? '').trim()) { toast.error(t('episode.create.nameRequired')); return }
  editSaving.value = true
  try {
    const fp = editDraft.finalPrompt || null
    if (target.kindKey === 'character') await characterAPI.update(target.id, { name: editDraft.name, role: editDraft.role, appearance: editDraft.appearance, description: editDraft.description, styling: editDraft.styling, finalPrompt: fp })
    else if (target.kindKey === 'scene') await sceneAPI.update(target.id, { location: editDraft.location, time: editDraft.time, prompt: editDraft.prompt, lighting: editDraft.lighting, finalPrompt: fp })
    else await propAPI.update(target.id, { name: editDraft.name, type: editDraft.type, description: editDraft.description, finalPrompt: fp })
    toast.success(t('common.saved'))
    closeEdit()
    load()
  } catch (e) {
    toastError(e)
  } finally {
    editSaving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page {
  padding: 20px 28px 40px;
  overflow-y: auto;
  height: 100%;
  animation: fadeUp 0.35s var(--ease-out) both;
}

/* Header card：单行紧凑 */
.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-lg);
  margin-bottom: 14px;
}
.head-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.head-action { flex-shrink: 0; }

.back-btn {
  width: 30px; height: 30px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%;
  background: var(--overlay-track); color: var(--text-1);
  cursor: pointer;
  transition: background 0.16s var(--ease-out), color 0.16s var(--ease-out), box-shadow 0.16s var(--ease-out);
}
.back-btn:hover { background: var(--bg-active); color: var(--text-0); }
.back-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px var(--button-focus);
}

.page-title {
  font-size: 17px; font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.meta-item {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--text-2);
}

/* 主 Tab 导航 */
.page-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}
.tab-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  padding: 8px 4px 10px;
  margin-right: 20px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-2);
  cursor: pointer;
  transition: color 0.16s var(--ease-out);
}
.tab-btn svg { opacity: 0.75; }
.tab-btn::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.16s var(--ease-out);
}
.tab-btn:hover { color: var(--text-0); }
.tab-btn.on { color: var(--text-0); font-weight: 650; }
.tab-btn.on::after { background: var(--accent); }
.tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono);
  background: var(--bg-2);
  color: var(--text-2);
}
.tab-btn.on .tab-count { background: var(--accent-bg); color: var(--accent-text); }

/* Episode Grid — 横向紧凑卡片，多列 */
.ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 10px;
}

/* 卡片主体 — 上信息区 + 下常驻操作条 */
.ep-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 10px;
  cursor: pointer;
  animation: fadeUp 0.35s var(--ease-out) both;
  transition: border-color 0.18s var(--ease-out), background 0.18s var(--ease-out);
}
.ep-card:hover {
  border-color: var(--border-strong);
}

/* 上区：编号 + 标题元数据 + 状态 */
.ep-card-top { display: flex; align-items: center; gap: 12px; min-width: 0; }

/* 编号徽标：统一中性，状态由圆点表达 */
.ep-number {
  width: 40px; height: 40px; flex-shrink: 0;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-family: var(--font-mono);
  background: var(--bg-2); color: var(--text-1);
}
.ep-num-label {
  font-size: 7.5px; letter-spacing: 0.18em; font-weight: 600;
  opacity: 0.55; line-height: 1; margin-bottom: 1px;
}
.ep-number b {
  font-size: 15px; font-weight: 600; line-height: 1;
}

/* 中部：标题 + 元数据（单行不换行，防止卡片被撑高错位） */
.ep-main { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px; }
.ep-title {
  font-size: 13.5px; font-weight: 600; color: var(--text-0);
  line-height: 1.35; margin: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ep-meta-row {
  display: flex; align-items: center; gap: 8px;
  flex-wrap: nowrap; overflow: hidden;
  white-space: nowrap;
}
.ep-meta {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; color: var(--text-3);
  white-space: nowrap; flex-shrink: 0;
}
.ep-meta svg { opacity: 0.7; flex-shrink: 0; }
.ep-meta-ok { color: var(--text-2); }
.ep-time { flex-shrink: 1; overflow: hidden; text-overflow: ellipsis; }

/* 状态胶囊：中性底 + 彩色圆点，颜色只出现在点上 */
.ep-badges { display: flex; align-items: center; flex-shrink: 0; }

/* 下区：常驻操作条 */
.ep-card-foot {
  display: flex; align-items: center; gap: 6px;
  padding-top: 9px;
  border-top: 1px solid var(--border);
}
.ep-foot-spacer { flex: 1; }

/* 进入制作 — 卡片主操作 */
.ep-enter {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px;
  border: none; border-radius: var(--radius);
  background: var(--accent-bg); color: var(--accent-text);
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}
.ep-enter:hover {
  background: var(--accent-gradient); color: var(--on-accent, #fff);
  box-shadow: 0 2px 8px var(--accent-glow);
}
.ep-enter svg { transition: transform 0.18s var(--ease-out); }
.ep-enter:hover svg { transform: translateX(2px); }
.ep-status-btn {
  cursor: pointer; border: none; font: inherit;
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 20px;
  background: var(--bg-2); color: var(--text-2);
  font-size: 11px; font-weight: 500;
  transition: background 0.14s, color 0.14s;
  white-space: nowrap;
}
.ep-status-btn:hover { color: var(--text-0); background: var(--bg-3); }

/* 分辨率标签 */
.ep-res-btn {
  cursor: pointer; border: none; font: inherit;
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 6px;
  font-size: 11px; font-weight: 600;
  background: var(--bg-2); color: var(--text-2);
  transition: background 0.14s, color 0.14s;
}
.ep-res-btn:hover { background: var(--bg-hover); color: var(--text-1); }

/* 状态圆点 */
.status-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
}
.dot-active { background: var(--success); }
.dot-done { background: var(--accent); }
.dot-pending { background: var(--text-3); }

/* 删除按钮 */
.ep-delete {
  color: var(--text-3);
  transition: color 0.15s;
}
.ep-delete:hover { color: var(--action-danger); }

/* Empty / 添加卡片：与剧集卡片等高的虚线条 */
.ep-empty {
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px;
  min-height: 104px;
  padding: 8px; text-align: center; color: var(--text-3); font-size: 12.5px;
  border-style: dashed;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}
.ep-empty:hover { border-color: var(--accent-text); color: var(--accent-text); background: var(--accent-bg); }
.ep-empty-icon {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--bg-2); color: var(--text-3);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: transform 0.2s, background 0.2s, color 0.2s;
}
.ep-empty:hover .ep-empty-icon { background: var(--accent-bg); color: var(--accent-text); }

/* Create Episode Dialog (on top of global .dialog skeleton) */
.ep-dialog { width: min(480px, 100%); }
.dialog-close { flex-shrink: 0; color: var(--text-2); }
.dialog-body { display: flex; flex-direction: column; gap: 20px; }

.field { display: flex; flex-direction: column; gap: 8px; }
.field-label { font-size: 12.5px; font-weight: 600; color: var(--text-1); }
.field-hint { font-size: 12px; color: var(--text-3); }

.dialog-foot-copy {
  margin-right: auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
}

/* ===== 素材库 ===== */
.asset-filter { margin-bottom: 16px; }

.asset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; align-items: stretch; }
.character-asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  justify-content: start;
  gap: 10px;
}
/* 分组标题：角色 / 场景 / 道具，彩色左条 + 图标 + 数量 */
.asset-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  margin: 4px 0 14px;
  border-radius: var(--radius);
  border-left: 3px solid var(--text-3);
  background: var(--bg-1);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text-1);
}
.asset-group-head .group-icon { display: inline-flex; color: var(--text-2); }
.asset-group-head .group-label { letter-spacing: 0.02em; }
.asset-group-head .group-count {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-3);
  background: var(--bg-2);
  border-radius: 99px;
  padding: 1px 9px;
}
.asset-group-head.is-character { border-left-color: var(--accent); background: var(--accent-bg); color: var(--accent-text); }
.asset-group-head.is-character .group-icon { color: var(--accent-text); }
.asset-group-head.is-scene { border-left-color: var(--success); background: var(--success-bg); color: var(--tag-success-text); }
.asset-group-head.is-scene .group-icon { color: var(--tag-success-text); }
.asset-group-head.is-prop { border-left-color: var(--warning); background: var(--warning-bg); color: var(--warn-text); }
.asset-group-head.is-prop .group-icon { color: var(--warn-text); }
.asset-card {
  display: flex; flex-direction: column; overflow: hidden;
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
}
.asset-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
.asset-click-card,
.character-asset-card {
  cursor: pointer;
}
.asset-click-card:focus-visible,
.character-asset-card:focus-visible {
  outline: none;
  border-color: var(--accent-glow);
  box-shadow: 0 0 0 3px var(--button-focus), var(--shadow-panel);
}
.character-asset-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  transition: transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out), border-color 0.18s var(--ease-out);
}
.character-asset-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lift);
  border-color: var(--border-strong);
}
.character-portrait {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  align-self: start;
  margin: 0;
  border: 1px solid var(--surface-outline);
  border-radius: var(--radius);
  background: var(--bg-2);
  overflow: hidden;
}
.character-portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.character-portrait-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
}
.character-asset-main {
  min-width: 0;
  width: 100%;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.character-asset-overview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.character-asset-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.character-title-block {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.character-name-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex-wrap: wrap;
}
.character-name {
  font-size: 13px;
  line-height: 1.25;
  color: var(--text-0);
}
.character-gen-btn { flex-shrink: 0; align-self: center; }
.asset-final-prompt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 7px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  line-height: 1.5;
}
.afp-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-3);
}
.afp-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
  color: var(--text-2);
}
.afp-text.dim { color: var(--text-3); }
.asset-final {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
  color: var(--text-2);
}
.asset-final .afp-label { margin-right: 4px; }
.character-visual-summary {
  max-width: 100%;
  display: flex;
  gap: 8px;
  overflow: hidden;
  color: var(--text-3);
  font-size: 10.5px;
  line-height: 1.45;
  white-space: nowrap;
}
.character-visual-summary span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-cover { position: relative; aspect-ratio: 1; background: var(--bg-2); overflow: hidden; }
.asset-cover.wide { aspect-ratio: 16/9; }
.asset-cover img { width: 100%; height: 100%; object-fit: cover; }
.previewable-image { cursor: zoom-in; transition: transform 0.18s var(--ease-out), filter 0.18s var(--ease-out); }
.previewable-image:hover { transform: scale(1.015); filter: saturate(1.04); }
.asset-cover-badge {
  position: absolute;
  top: 7px;
  left: 7px;
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--header-bg);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: var(--shadow-xs);
  color: var(--text-2);
  font-size: 9.5px;
  font-weight: 700;
}
.asset-cover-badge.is-ready {
  background: var(--success-bg);
  color: var(--tag-success-text);
}
.asset-cover-badge.is-pending {
  background: var(--accent-bg);
  color: var(--accent-text);
}
.asset-cover-empty { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-3); }
.asset-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px 8px;
  min-width: 0;
}
.asset-name {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-meta { font-size: 11px; line-height: 1.5; }
.asset-desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
}
.asset-light {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-foot { display: flex; align-items: center; gap: 4px; padding: 7px 11px; border-top: 1px solid var(--border); }
.prop-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.prop-name-row .asset-name { min-width: 0; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bg-3); flex-shrink: 0; }
.dot.ok { background: var(--success); }
.dot.pending { background: var(--accent); }
.ring-spinner {
  width: 22px; height: 22px;
  border: 2.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.ring-spinner.sm { width: 13px; height: 13px; border-width: 2px; }
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
  text-align: center;
}
.empty-icon {
  width: 56px; height: 56px; border-radius: var(--radius-lg);
  background: var(--bg-2); color: var(--text-3);
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 4px;
}
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-1); }
.empty-desc { font-size: 12px; color: var(--text-3); max-width: 260px; line-height: 1.6; }

.viewer-overlay { align-items: center; }
.viewer-dialog { width: min(960px, calc(100vw - 48px)); padding: 14px; }
.viewer-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.viewer-title { font-size: 13px; font-weight: 600; color: var(--text-1); }
.viewer-img { width: 100%; max-height: 76vh; object-fit: contain; border-radius: var(--radius); background: var(--bg-2); display: block; }

/* ===== 素材详情 / 编辑对话框（与工作台资产卡片同款布局） ===== */
.mat-detail-overlay { z-index: 118; padding: 28px; }
.mat-detail-dialog {
  width: min(1040px, calc(100vw - 56px));
  max-height: calc(100vh - 56px);
}
.mat-detail-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 14px 16px;
  border-bottom: 1px solid var(--surface-outline);
}
.mat-detail-title-block { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.mat-detail-kicker {
  color: var(--text-3); font-size: 10px; font-weight: 800;
  letter-spacing: 0.12em; text-transform: uppercase;
}
.mat-detail-title {
  margin: 0; color: var(--text-0); font-size: 18px;
  line-height: 1.2; font-family: var(--font-display);
}
.mat-detail-head-actions {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0;
}
.mat-detail-body { min-height: 0; overflow: auto; padding: 16px; }
.mat-detail-shell {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: 14px; align-items: start;
}
.mat-detail-preview-panel,
.mat-detail-editor-panel {
  min-width: 0; display: flex; flex-direction: column; gap: 12px;
}
.mat-detail-preview-panel { position: sticky; top: 0; }

.mat-detail-section-title {
  min-height: 24px; display: flex; align-items: center;
  justify-content: space-between; gap: 10px;
  color: var(--text-1); font-size: 12px; font-weight: 820; letter-spacing: 0.02em;
}
.mat-detail-section-title .dim {
  font-size: 11px; font-weight: 560; letter-spacing: 0; text-align: right;
}

/* 最终提示词面板 */
.mat-detail-prompt-panel {
  margin-top: 18px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.mat-detail-prompt-gen {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.mat-detail-prompt-text {
  width: 100%;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-0);
  font-size: 12.5px;
  line-height: 1.6;
  resize: vertical;
  min-height: 112px;
  font-family: inherit;
}
.mat-detail-prompt-text:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
.mat-detail-prompt-text::placeholder { color: var(--text-3); }

/* 状态标签 */
.mat-detail-state {
  min-height: 20px; display: inline-flex; align-items: center;
  padding: 0 7px; border-radius: 999px;
  background: var(--overlay-track); color: var(--text-3);
  font-size: 10px; font-weight: 760; white-space: nowrap;
}
.mat-detail-state.is-ready { color: var(--success); background: var(--success-bg); }

/* 图片预览框 */
.mat-detail-media-frame {
  position: relative; width: 100%; aspect-ratio: 16/9;
  display: block; padding: 0;
  border: 1px solid var(--surface-outline);
  border-radius: var(--radius); background: var(--bg-2);
  color: var(--text-3); overflow: hidden; cursor: zoom-in;
}
.mat-detail-media-frame:disabled { cursor: default; opacity: 1; }
.mat-detail-media-frame:focus-visible {
  outline: none; border-color: var(--action-primary);
  box-shadow: 0 0 0 3px var(--button-focus);
}
.mat-detail-media-frame img { width: 100%; height: 100%; display: block; object-fit: cover; }
.mat-detail-media-empty {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3);
}

/* 元数据行（类型 + 定位） */
.mat-detail-meta-row {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;
}
.mat-detail-meta-item {
  min-width: 0; padding: 9px 10px;
  border: 1px solid var(--surface-outline);
  border-radius: var(--radius); background: var(--surface-muted);
}
.mat-detail-meta-item span {
  display: block; color: var(--text-3);
  font-size: 10px; font-weight: 780; letter-spacing: 0.04em;
}
.mat-detail-meta-item strong {
  display: block; margin-top: 4px; min-width: 0;
  color: var(--text-0); font-size: 12px;
  line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 编辑区域 */
.mat-detail-edit-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
}
.mat-detail-edit-grid--character,
.mat-detail-edit-grid--scene { grid-template-columns: 1fr; }
.mat-detail-edit-field {
  min-width: 0; display: flex; flex-direction: column; gap: 7px;
}
.mat-detail-edit-field > span,
.mat-detail-edit-field > input::placeholder,
.mat-detail-textarea::placeholder {
  color: var(--text-3); font-size: 10px; font-weight: 780; letter-spacing: 0.04em;
}
.mat-detail-textarea { min-height: 138px; resize: vertical; }
.mat-detail-edit-grid--character .mat-detail-textarea,
.mat-detail-edit-grid--scene .mat-detail-textarea { min-height: 164px; }

/* 底部操作栏 */
.mat-detail-foot {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--surface-outline);
}
.mat-detail-secondary-actions,
.mat-detail-primary-actions { display: flex; align-items: center; gap: 8px; }

@media (max-width: 860px) {
  .page { padding: 16px 16px 32px; }
  .page-head { flex-wrap: wrap; }
  .ep-grid { grid-template-columns: 1fr; }
  .ep-actions { opacity: 1; } /* 移动端始终显示操作按钮 */
  .dialog-foot { flex-wrap: wrap; gap: 10px; }
  .dialog-foot-copy { display: none; }
}
.character-traits { margin: 6px 0 0; font-size: 12px; line-height: 1.55; color: var(--accent-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ===== 项目工作区（参考 Topview Drama Studio 项目页） ===== */
.page.ws { padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.ws-top {
  display: flex; align-items: center; gap: 18px;
  min-height: 56px; padding: 8px 20px; flex-shrink: 0; flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
  background: var(--surface-soft);
}
.ws-top-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 0 1 auto; }
.ws-top .back-btn {
  width: 34px; height: 34px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 9px; background: transparent; color: var(--text-1); cursor: pointer;
}
.ws-top .back-btn:hover { background: var(--bg-hover); color: var(--text-0); }
.ws-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--text-0); max-width: 260px; }
.ws-style-chip {
  padding: 2px 9px; border-radius: 6px; font-size: 11.5px; font-weight: 600;
  background: var(--accent-bg); color: var(--accent-text); white-space: nowrap;
}
.ws-tabs { display: flex; align-items: center; gap: 2px; margin: 0 auto; flex-wrap: wrap; }
.ws-tab {
  position: relative; display: inline-flex; align-items: center; gap: 7px;
  height: 36px; padding: 0 12px; border: none; background: transparent;
  color: var(--text-2); font: 600 13.5px var(--font-body); cursor: pointer; white-space: nowrap;
}
.ws-tab:hover { color: var(--text-0); }
.ws-tab.on { color: var(--text-0); }
.ws-tab.on::after { content: ''; position: absolute; left: 10px; right: 10px; bottom: -9px; height: 2px; border-radius: 2px; background: var(--text-0); }
.ws-tab:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); border-radius: 8px; }
.ws-dot { width: 6px; height: 6px; border-radius: 50%; }
.ws-dot.todo { background: #facc15; }
.ws-dot.done { background: #4ade80; }
.ws-tab-count { font-size: 11px; color: var(--text-3); font-weight: 500; }
.ws-prep { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3); white-space: nowrap; max-width: 360px; overflow: hidden; }
.ws-prep-bar { width: 56px; height: 4px; border-radius: 4px; background: var(--bg-active); overflow: hidden; flex-shrink: 0; }
.ws-prep-bar i { display: block; height: 100%; background: #4ade80; border-radius: 4px; transition: width 0.3s var(--ease-out); }
.ws-prep-missing { overflow: hidden; text-overflow: ellipsis; }

.ws-body { flex: 1; min-height: 0; overflow-y: auto; }
.ws-panel { max-width: 1120px; margin: 0 auto; padding: 20px 24px 64px; display: flex; flex-direction: column; gap: 14px; }
.ws-panel-head { display: flex; align-items: center; gap: 12px; }
.ws-panel-title { margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--text-0); }
.ws-panel-sub { font-size: 13px; color: var(--text-3); }
.ws-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.ws-panel-head .btn-white { margin-left: auto; }

.ws-card {
  border: 1px solid var(--border); border-radius: 14px;
  background: var(--surface-raised); padding: 18px 20px;
}
.ws-overview { border-left: 3px solid var(--accent); }
.ws-overview-title { margin: 0 0 12px; font-size: 15px; font-weight: 700; color: var(--text-0); }
.ws-label { margin: 12px 0 4px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--accent-text); text-transform: uppercase; }
.ws-text { margin: 0; font-size: 14px; line-height: 1.75; color: var(--text-1); white-space: pre-line; }
.ws-link { border: none; background: none; color: var(--accent-text); font: inherit; font-weight: 600; cursor: pointer; padding: 0 0 0 4px; }
.ws-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.ws-chip {
  padding: 3px 10px; border-radius: 7px; border: 1px solid var(--border);
  font-size: 12px; color: var(--text-2); background: var(--bg-hover); white-space: nowrap;
}
.ws-chip.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 40%, transparent); background: var(--success-bg); }
.ws-chip-accent { color: var(--accent-text); background: var(--accent-bg); border-color: transparent; }

.ws-ep { border-left: 3px solid transparent; transition: border-color 0.16s var(--ease-out); }
.ws-ep.has-script { border-left-color: var(--success); }
.ws-ep:hover { border-color: var(--border-strong); }
.ws-ep.has-script:hover { border-left-color: var(--success); }
.ws-ep-head { display: flex; align-items: center; gap: 10px; }
.ws-ep-no { font-size: 12px; font-weight: 700; color: var(--text-3); font-family: var(--font-mono); }
.ws-ep-title { margin: 0; font-family: var(--font-display); font-size: 16.5px; font-weight: 700; color: var(--text-0); }
.ws-ep-menu { margin-left: auto; }
.ws-icon-btn {
  width: 30px; height: 30px; border: none; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; color: var(--text-2); cursor: pointer;
}
.ws-icon-btn:hover { background: var(--bg-hover); color: var(--text-0); }
.ws-ep-summary {
  margin: 10px 0 0; font-size: 13.5px; line-height: 1.75; color: var(--text-1);
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.ws-ep-actions { display: flex; gap: 8px; margin-top: 14px; }
.ws-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; border-radius: 9px; }
.ws-btn-wide { flex: 1; }
.btn-white {
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  height: 36px; padding: 0 14px; border-radius: 9px;
  border: 1px solid var(--inverse-surface); background: var(--inverse-surface); color: var(--on-inverse);
  font: 600 13px var(--font-body); cursor: pointer; white-space: nowrap;
}
.btn-white:hover { filter: brightness(0.94); }
.btn-white:disabled { opacity: 0.5; cursor: default; filter: none; }
.btn-white:focus-visible, .ws-add-ep:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--button-focus); }
.ws-add-ep {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 48px; border-radius: 14px; border: 1px dashed var(--border-strong);
  background: transparent; color: var(--text-2); font: 600 13.5px var(--font-body); cursor: pointer;
}
.ws-add-ep:hover { color: var(--text-0); background: var(--bg-hover); }

.ws-form { display: flex; flex-direction: column; gap: 16px; }
.ws-textarea { min-height: 120px; resize: vertical; line-height: 1.7; }
.ws-readonly { height: 38px; display: flex; align-items: center; padding: 0 12px; border-radius: var(--radius); background: var(--bg-hover); color: var(--text-1); font-family: var(--font-mono); font-size: 13px; }
.ws-settings .field { display: flex; flex-direction: column; gap: 6px; }
.ws-settings .field-label { font-size: 12.5px; font-weight: 600; color: var(--text-1); }
.ws-settings .field-hint { font-size: 11.5px; color: var(--text-3); }
.ws-settings .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

/* ===== ตั้งค่าพื้นฐาน + Creative Positioning + Hook Chain ===== */
.ws-form-section { margin: 0; font: 700 14px var(--font-body); color: var(--text-0); }
.ws-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.ws-settings-grid .field { display: flex; flex-direction: column; gap: 6px; }
.ws-seg { display: inline-flex; padding: 3px; gap: 3px; border-radius: 10px; background: var(--bg-hover); width: fit-content; }
.ws-seg-btn {
  border: none; border-radius: 8px; padding: 6px 14px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 600 12.5px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.ws-seg-btn.on { background: var(--bg-active); color: var(--text-0); box-shadow: inset 0 0 0 1px var(--border-strong); }
.ws-tags { display: flex; flex-wrap: wrap; gap: 8px; }
.ws-tag {
  border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 500 12.5px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.ws-tag:hover { color: var(--text-0); background: var(--bg-hover); }
.ws-tag.on { background: var(--accent-bg); border-color: var(--accent); color: var(--accent-text); }
.ws-tag.custom { border-style: dashed; color: var(--text-3); }
.ws-tag-input .input { height: 32px; border-radius: 999px; padding: 0 12px; min-width: 180px; font-size: 12.5px; }
.ws-view-toggle { display: inline-flex; padding: 3px; gap: 3px; border-radius: 10px; background: var(--bg-hover); }
.ws-view-btn {
  border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 600 12.5px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}
.ws-view-btn.on { background: var(--bg-active); color: var(--text-0); box-shadow: inset 0 0 0 1px var(--border-strong); }
.ws-hook-chain { display: flex; flex-direction: column; gap: 12px; }
.ws-hook-node { position: relative; }
.ws-hook-link {
  position: absolute; left: 26px; top: -13px; width: 2px; height: 12px;
  background: var(--border-strong);
}
.ws-hook-textarea { min-height: 72px; resize: vertical; line-height: 1.6; }
.ws-hook-chain .empty-state { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.ws-hook-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ws-ai-btn {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px; cursor: pointer;
  background: transparent; color: var(--text-2); font: 600 11.5px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.ws-ai-btn:hover { color: var(--accent-text); border-color: var(--accent); background: var(--accent-bg); }
.ws-ai-btn:disabled { opacity: 0.6; cursor: default; }
.ws-switch-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ws-switch-title { margin: 0 0 4px; font: 600 13px var(--font-body); color: var(--text-0); }
.ws-switch {
  flex-shrink: 0; width: 40px; height: 22px; border-radius: 999px; border: none; cursor: pointer;
  background: var(--bg-hover); position: relative; transition: background 0.18s var(--ease-out);
}
.ws-switch.on { background: var(--accent); }
.ws-switch-knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform 0.18s var(--ease-out);
}
.ws-switch.on .ws-switch-knob { transform: translateX(18px); }
.ws-board-btn {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; cursor: pointer;
  background: transparent; color: var(--text-1); font: 600 12px var(--font-body);
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out), border-color 0.15s var(--ease-out);
}
.ws-board-btn:hover { color: var(--text-0); border-color: var(--border-strong); background: var(--bg-hover); }

@media (max-width: 760px) {
  .ws-settings-grid { grid-template-columns: 1fr; }
}

@media (max-width: 1100px) {
  .ws-prep-missing { display: none; }
}
@media (max-width: 760px) {
  .ws-top { padding: 8px 12px; gap: 8px; }
  .ws-tabs { order: 3; width: 100%; margin: 0; overflow-x: auto; flex-wrap: nowrap; }
  .ws-tab.on::after { bottom: -2px; }
  .ws-prep { margin-left: auto; }
  .ws-panel { padding: 14px 12px 48px; }
  .ws-ep-actions { flex-direction: column; }
  .ws-settings .field-row { grid-template-columns: 1fr; }
}
</style>
