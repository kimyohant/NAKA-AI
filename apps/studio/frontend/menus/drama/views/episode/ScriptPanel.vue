<template>
  <div class="content-panel">
    <!-- Step 0: Raw Content -->
    <div v-if="scriptStep === 0" class="step-editor">
      <div class="step-toolbar">
        <div class="toolbar-left">
          <div class="step-indicator">
            <span class="step-num">01</span>
            <span class="step-name">{{ t('episode.script.raw') }}</span>
          </div>
        </div>
        <div class="toolbar-right">
          <span v-if="rawLen" class="char-count">{{ t('episode.script.charCount', { n: rawLen }) }}</span>
          <button class="btn btn-sm" @click="saveRaw(); toast.success(t('episode.script.saved'))">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {{ t('common.save') }}
          </button>
        </div>
      </div>
      <textarea
        class="fill-textarea"
        v-model="localRaw"
        :placeholder="t('episode.script.rawPlaceholder')"
      />
    </div>

    <!-- Step 1: Rewrite -->
    <div v-else-if="scriptStep === 1" class="step-editor">
      <div class="step-toolbar">
        <div class="toolbar-left">
          <div class="step-indicator">
            <span class="step-num">02</span>
            <span class="step-name">{{ t('episode.script.rewrite') }}</span>
          </div>
        </div>
        <div class="toolbar-right">
          <span v-if="scriptLen" class="char-count">{{ t('episode.script.charCount', { n: scriptLen }) }}</span>
          <button v-if="rawContent" class="btn btn-sm" @click="skipRewrite">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/><path d="M13 18l6-6-6-6"/></svg>
            {{ t('episode.script.skipRewrite') }}
          </button>
          <button v-if="scriptContent" class="btn btn-sm" @click="doRewrite" :disabled="rn">
            <Loader2 v-if="rn && rt === 'script_rewriter'" :size="11" class="animate-spin" />
            <svg v-else width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            {{ t('episode.script.rewriteAgain') }}
          </button>
        </div>
      </div>

      <div v-if="!scriptContent && !rn" class="step-empty">
        <div class="empty-visual">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
        </div>
        <div class="empty-title">{{ t('episode.script.emptyTitle') }}</div>
        <div class="empty-desc">{{ t('episode.script.emptyDesc') }}</div>
        <div class="step-empty-actions">
          <button class="btn btn-primary" @click="doRewrite">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            {{ t('episode.script.startRewrite') }}
          </button>
          <button class="btn" @click="skipRewrite">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14"/><path d="M13 18l6-6-6-6"/></svg>
            {{ t('episode.script.skipRewrite') }}
          </button>
        </div>
      </div>
      <div v-else-if="rn && rt === 'script_rewriter'" class="step-loading">
        <Loader2 :size="24" class="animate-spin" style="color:var(--accent)" />
        <div class="loading-text">{{ t('episode.script.rewriting') }}</div>
      </div>
      <textarea v-else class="fill-textarea" v-model="localScript" :placeholder="t('episode.script.scriptPlaceholder')" />
    </div>
  </div>
</template>

<script setup>
// Episode workbench · script panel: raw content + rewrite. Markup only: lazy-loaded by views/episode.vue, which owns
// the state (inject EPISODE_WORKBENCH) and loads the styles (./workbench.css).
import { inject } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { EPISODE_WORKBENCH } from '../../utils/episodeWorkbench.js'

const {
  doRewrite, episode, localRaw, localScript, panel, rawContent, rawLen, rn, rt, saveRaw, scriptContent,
  scriptLen, scriptStep, skipRewrite, t,
} = inject(EPISODE_WORKBENCH)
</script>
