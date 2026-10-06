<template>
  <div class="page page-enter">
    <!-- ===== Header + status ===== -->
    <header class="lv-head">
      <div>
        <p class="eyebrow">{{ t('live.eyebrow') }}</p>
        <h1 class="lv-title">{{ t('live.title') }}</h1>
        <p class="lv-sub">{{ t('live.subtitle') }}</p>
      </div>
      <div class="lv-head-actions">
        <span class="tag" :class="online ? 'tag-success' : ''"><span class="lv-dot" :class="{ on: online }"></span>{{ online ? t('live.status.online') : t('live.status.offline') }}</span>
        <span class="tag" :class="running ? 'tag-success' : ''">{{ running ? t('live.status.avatarOn') : t('live.status.avatarOff') }}</span>
        <span class="tag" :class="pushing ? 'lv-tag-live' : ''">{{ pushing ? t('live.status.pushing') : t('live.status.notPushing') }}</span>
        <button class="btn btn-sm" type="button" @click="openSettings"><Settings2 :size="13" /> {{ t('live.settings.open') }}</button>
      </div>
    </header>

    <div v-if="!status?.config.configured && !loading" class="card lv-setup">
      <Radio :size="22" :stroke-width="1.7" />
      <div>
        <h3>{{ t('live.setup.title') }}</h3>
        <p>{{ t('live.setup.desc') }}</p>
      </div>
      <button class="btn btn-primary" type="button" @click="openSettings">{{ t('live.setup.cta') }}</button>
    </div>
    <p v-else-if="status && !online" class="lv-error">{{ t('live.status.unreachable') }} <span class="mono">{{ status.error }}</span></p>

    <div class="lv-grid">
      <!-- ===== Stage: preview + avatar + go live ===== -->
      <section class="card lv-col" aria-labelledby="lv-stage">
        <h2 id="lv-stage" class="lv-col-title">{{ t('live.stage.title') }}</h2>
        <div class="lv-screen">
          <video ref="videoEl" autoplay playsinline :muted="muted"></video>
          <div v-if="!previewOn" class="lv-screen-empty">
            <MonitorPlay :size="26" :stroke-width="1.5" />
            <span>{{ running ? t('live.stage.connecting') : t('live.stage.off') }}</span>
          </div>
          <button v-if="previewOn" class="lv-mute" type="button" :aria-label="muted ? t('live.stage.unmute') : t('live.stage.mute')" @click="muted = !muted">
            <VolumeX v-if="muted" :size="15" /><Volume2 v-else :size="15" />
          </button>
          <span v-if="speaking" class="lv-speaking">{{ t('live.stage.speaking') }}</span>
        </div>

        <div class="lv-row">
          <label class="field lv-flex">
            <span class="field-label">{{ t('live.stage.avatar') }}</span>
            <select v-model="avatarId" class="input" :disabled="running || busy">
              <option v-for="a in avatarOptions" :key="a" :value="a">{{ a }}</option>
            </select>
          </label>
          <label class="field lv-flex">
            <span class="field-label">{{ t('live.stage.voice') }}</span>
            <select v-model="voice" class="input" :disabled="running || busy">
              <option v-for="v in VOICES" :key="v.id" :value="v.id">{{ t(v.label) }}</option>
            </select>
          </label>
        </div>
        <div class="lv-row">
          <button v-if="!running" class="btn btn-primary" type="button" :disabled="!online || busy" @click="startAvatar">
            <Loader2 v-if="busy === 'start'" :size="13" class="animate-spin" /><Play v-else :size="13" />
            {{ busy === 'start' ? t('live.stage.starting') : t('live.stage.start') }}
          </button>
          <button v-else class="btn" type="button" :disabled="!!busy" @click="stopAvatar"><Square :size="13" /> {{ t('live.stage.stop') }}</button>
          <button class="btn btn-ghost btn-sm" type="button" :disabled="!!busy" :title="t('live.stage.freeGpuHint')" @click="freeGpu">
            <Loader2 v-if="busy === 'gpu'" :size="12" class="animate-spin" /><Cpu v-else :size="12" /> {{ t('live.stage.freeGpu') }}
          </button>
        </div>
        <p v-if="gpu" class="lv-hint mono">{{ gpu.name }} · {{ t('live.stage.vram', { free: (gpu.free_mb / 1024).toFixed(1), total: (gpu.total_mb / 1024).toFixed(0) }) }}</p>
        <p v-if="status?.agent && !status.agent.models_ready" class="lv-error">{{ t('live.stage.noModel') }}</p>

        <div class="lv-golive">
          <div>
            <strong>{{ t('live.push.title') }}</strong>
            <p class="lv-hint">{{ status?.config.hasRtmpUrl ? t('live.push.target', { host: status.config.rtmpHost }) : t('live.push.noTarget') }}</p>
          </div>
          <button v-if="!pushing" class="btn lv-btn-live" type="button" :disabled="!running || !status?.config.hasRtmpUrl || !!busy" @click="confirmPush = true">
            <Radio :size="13" /> {{ t('live.push.start') }}
          </button>
          <button v-else class="btn" type="button" :disabled="!!busy" @click="stopPush"><Square :size="13" /> {{ t('live.push.stop') }}</button>
        </div>

        <label class="field">
          <span class="field-label">{{ t('live.say.title') }}</span>
          <textarea v-model="quickText" class="input" rows="2" maxlength="600" :placeholder="t('live.say.placeholder')"></textarea>
        </label>
        <div class="lv-row">
          <button class="btn btn-primary btn-sm" type="button" :disabled="!running || !quickText.trim()" @click="sayNow(quickText, true); quickText = ''">
            <MessageSquare :size="12" /> {{ t('live.say.now') }}
          </button>
          <button class="btn btn-sm" type="button" :disabled="!running" @click="hush"><Hand :size="12" /> {{ t('live.say.hush') }}</button>
        </div>
      </section>

      <!-- ===== Script: product → host lines → queue ===== -->
      <section class="card lv-col" aria-labelledby="lv-script">
        <h2 id="lv-script" class="lv-col-title">{{ t('live.script.title') }}</h2>
        <label class="field"><span class="field-label">{{ t('live.product.name') }} *</span><input v-model="product.name" class="input" maxlength="200" :placeholder="t('live.product.namePh')" /></label>
        <label class="field"><span class="field-label">{{ t('live.product.details') }}</span><textarea v-model="product.details" class="input" rows="3" maxlength="3000" :placeholder="t('live.product.detailsPh')"></textarea></label>
        <div class="lv-row">
          <label class="field lv-flex"><span class="field-label">{{ t('live.product.price') }}</span><input v-model="product.price" class="input" maxlength="100" :placeholder="t('live.product.pricePh')" /></label>
          <label class="field lv-flex"><span class="field-label">{{ t('live.product.promo') }}</span><input v-model="product.promo" class="input" maxlength="300" :placeholder="t('live.product.promoPh')" /></label>
        </div>
        <label class="field"><span class="field-label">{{ t('live.product.shop') }}</span><input v-model="product.shop" class="input" maxlength="120" /></label>
        <button class="btn" type="button" :disabled="!product.name.trim() || writing" @click="writeScript">
          <Loader2 v-if="writing" :size="13" class="animate-spin" /><Sparkles v-else :size="13" />
          {{ writing ? t('live.script.writing') : lines.length ? t('live.script.rewrite') : t('live.script.write') }}
        </button>

        <ol v-if="lines.length" class="lv-lines">
          <li v-for="(line, i) in lines" :key="i" :class="{ current: playing && cursor === i }">
            <span class="lv-line-no mono">{{ i + 1 }}</span>
            <textarea v-model="lines[i]" class="input lv-line-input" rows="2" maxlength="240"></textarea>
            <button class="lv-icon-btn" type="button" :aria-label="t('live.script.sayLine')" :disabled="!running" @click="sayNow(line, true)"><Play :size="12" /></button>
            <button class="lv-icon-btn" type="button" :aria-label="t('live.script.removeLine')" @click="lines.splice(i, 1)"><X :size="12" /></button>
          </li>
        </ol>
        <div v-if="lines.length" class="lv-row">
          <button v-if="!playing" class="btn btn-primary btn-sm" type="button" :disabled="!running" @click="playQueue"><Play :size="12" /> {{ t('live.script.play') }}</button>
          <button v-else class="btn btn-sm" type="button" @click="pauseQueue"><Pause :size="12" /> {{ t('live.script.pause') }}</button>
          <label class="lv-check"><input v-model="loop" type="checkbox" /> {{ t('live.script.loop') }}</label>
          <button class="btn btn-ghost btn-sm" type="button" @click="lines.push('')"><Plus :size="12" /> {{ t('live.script.addLine') }}</button>
        </div>
      </section>

      <!-- ===== Comments: AI replies from shop facts ===== -->
      <section class="card lv-col" aria-labelledby="lv-comments">
        <h2 id="lv-comments" class="lv-col-title">{{ t('live.comments.title') }}</h2>
        <label class="field">
          <span class="field-label">{{ t('live.comments.faq') }}</span>
          <textarea v-model="faq" class="input" rows="3" maxlength="3000" :placeholder="t('live.comments.faqPh')"></textarea>
        </label>
        <form class="lv-comment-form" @submit.prevent="answer">
          <input v-model="viewer" class="input lv-viewer" maxlength="60" :placeholder="t('live.comments.viewerPh')" />
          <input v-model="comment" class="input lv-flex" maxlength="500" :placeholder="t('live.comments.commentPh')" />
          <button class="btn btn-primary btn-sm" type="submit" :disabled="!comment.trim() || !product.name.trim() || answering">
            <Loader2 v-if="answering" :size="12" class="animate-spin" /><Sparkles v-else :size="12" /> {{ t('live.comments.answer') }}
          </button>
        </form>
        <p v-if="!product.name.trim()" class="lv-hint">{{ t('live.comments.needProduct') }}</p>
        <label class="lv-check"><input v-model="autoSpeak" type="checkbox" /> {{ t('live.comments.autoSpeak') }}</label>

        <ul class="lv-thread">
          <li v-for="item in thread" :key="item.id" class="lv-msg">
            <p class="lv-msg-in"><strong>{{ item.viewer || t('live.comments.viewer') }}</strong> {{ item.comment }}</p>
            <p v-if="item.reply" class="lv-msg-out">{{ item.reply }}</p>
            <p v-else class="lv-hint">{{ t('live.comments.ignored') }}</p>
            <div class="lv-msg-foot">
              <span v-if="item.handoff" class="tag lv-tag-warn">{{ t('live.comments.handoff') }}</span>
              <span class="lv-hint">{{ item.reason }}</span>
              <span v-if="item.spoken" class="tag tag-success">{{ t('live.comments.spoken') }}</span>
              <button v-else-if="item.reply" class="btn btn-ghost btn-sm" type="button" :disabled="!running" @click="speakReply(item)"><Play :size="11" /> {{ t('live.comments.speak') }}</button>
            </div>
          </li>
        </ul>
      </section>
    </div>

    <!-- ===== Settings dialog ===== -->
    <div v-if="showSettings" class="overlay" @click.self="showSettings = false">
      <div class="dialog lv-dialog" role="dialog" aria-modal="true" :aria-label="t('live.settings.title')">
        <div class="dialog-head">
          <div class="dialog-head-copy">
            <h2 class="dialog-title">{{ t('live.settings.title') }}</h2>
            <p class="dialog-desc">{{ t('live.settings.desc') }}</p>
          </div>
        </div>
        <form @submit.prevent="saveSettings">
          <div class="dialog-body lv-dialog-body">
            <label class="field"><span class="field-label">{{ t('live.settings.agentUrl') }}</span><input v-model="form.agentUrl" class="input mono" placeholder="http://103.x.x.x:8020" /></label>
            <label class="field">
              <span class="field-label">{{ t('live.settings.token') }}</span>
              <input v-model="form.token" class="input mono" type="password" autocomplete="off" :placeholder="status?.config.hasToken ? t('live.settings.saved') : t('live.settings.tokenPh')" />
            </label>
            <label class="field">
              <span class="field-label">{{ t('live.settings.rtmp') }}</span>
              <input v-model="form.rtmpUrl" class="input mono" type="password" autocomplete="off" :placeholder="status?.config.hasRtmpUrl ? t('live.settings.rtmpSaved', { host: status.config.rtmpHost }) : 'rtmps://…/stream-key'" />
              <span class="field-hint">{{ t('live.settings.rtmpHint') }}</span>
            </label>
            <button v-if="status?.config.hasRtmpUrl" type="button" class="btn btn-ghost btn-sm lv-start" @click="form.rtmpUrl = null">{{ t('live.settings.rtmpClear') }}</button>
          </div>
          <div class="dialog-foot">
            <button type="button" class="btn" :disabled="saving" @click="showSettings = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">
              <Loader2 v-if="saving" :size="13" class="animate-spin" /> {{ t('live.settings.save') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <ConfirmDialog
      :open="confirmPush"
      :title="t('live.push.confirmTitle')"
      :message="t('live.push.confirmMessage', { host: status?.config.rtmpHost || '' })"
      :confirm-text="t('live.push.start')"
      :loading-text="t('live.push.starting')"
      :loading="busy === 'push'"
      @confirm="startPush"
      @cancel="confirmPush = false"
    />
  </div>
</template>

<script setup lang="ts">
import { Cpu, Hand, Loader2, MessageSquare, MonitorPlay, Pause, Play, Plus, Radio, Settings2, Sparkles, Square, Volume2, VolumeX, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import ConfirmDialog from '~/components/ConfirmDialog.vue'
import { toastError } from '~/composables/useToast'
import { liveAPI, type LiveStatus } from '~/composables/useApi'
import { LIVE_VOICES, nextQueueIndex, waitUntilQuiet } from '~/utils/liveFlow'

const { t } = useI18n()
const VOICES = LIVE_VOICES

// ---------- status ----------
const status = ref<LiveStatus | null>(null)
const loading = ref(true)
const busy = ref<'' | 'start' | 'stop' | 'gpu' | 'push'>('')
const online = computed(() => !!status.value?.online)
const running = computed(() => !!status.value?.agent?.livetalking.running)
const pushing = computed(() => !!status.value?.agent?.push.running)
const gpu = computed(() => status.value?.agent?.gpu || null)
const avatarId = ref('wav2lip256_avatar1')
const voice = ref<string>(LIVE_VOICES[0].id)
const avatarOptions = computed(() => {
  const list = status.value?.agent?.avatars || []
  return list.length ? list : [avatarId.value]
})

async function refresh() {
  try {
    const s = await liveAPI.status()
    const first = !status.value
    status.value = s
    if (first) {
      avatarId.value = s.config.avatarId || avatarId.value
      voice.value = s.config.voice || voice.value
    }
    if (running.value && !previewOn.value && !previewConnecting) connectPreview()
    if (!running.value && previewOn.value) closePreview()
  } catch (err) {
    toastError(err)
  } finally {
    loading.value = false
  }
}

let statusTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  loadDraft()
  refresh()
  statusTimer = setInterval(refresh, 5000)
})
onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
  playing.value = false
  closePreview()
})

async function startAvatar() {
  busy.value = 'start'
  try {
    const r = await liveAPI.start({ avatarId: avatarId.value, voice: voice.value })
    toast.success(r?.ready ? t('live.stage.started') : t('live.stage.startedSlow'))
    await refresh()
  } catch (err) { toastError(err) } finally { busy.value = '' }
}
async function stopAvatar() {
  busy.value = 'stop'
  playing.value = false
  try { await liveAPI.stop(); closePreview(); await refresh() } catch (err) { toastError(err) } finally { busy.value = '' }
}
async function freeGpu() {
  busy.value = 'gpu'
  try {
    const r = await liveAPI.freeGpu()
    toast.success(r.length ? t('live.stage.freedGpu', { n: r.length }) : t('live.stage.noUnsloth'))
    await refresh()
  } catch (err) { toastError(err) } finally { busy.value = '' }
}

// ---------- go live (RTMP relay on the GPU box) ----------
const confirmPush = ref(false)
async function startPush() {
  busy.value = 'push'
  try { await liveAPI.pushStart(); toast.success(t('live.push.started')); await refresh() } catch (err) { toastError(err) } finally { busy.value = ''; confirmPush.value = false }
}
async function stopPush() {
  busy.value = 'push'
  try { await liveAPI.pushStop(); await refresh() } catch (err) { toastError(err) } finally { busy.value = '' }
}

// ---------- WHEP preview (browser ⇄ SRS media; SDP goes through the backend) ----------
const videoEl = ref<HTMLVideoElement | null>(null)
const previewOn = ref(false)
const muted = ref(true)
let pc: RTCPeerConnection | null = null
let previewConnecting = false
async function connectPreview() {
  previewConnecting = true
  try {
    closePreview()
    pc = new RTCPeerConnection()
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    const stream = new MediaStream()
    pc.ontrack = (e) => {
      stream.addTrack(e.track)
      if (videoEl.value) videoEl.value.srcObject = stream
      previewOn.value = true
    }
    pc.onconnectionstatechange = () => { if (pc && ['failed', 'closed'].includes(pc.connectionState)) previewOn.value = false }
    await pc.setLocalDescription(await pc.createOffer())
    const answer = await liveAPI.whep(pc.localDescription!.sdp)
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
  } catch (err) {
    closePreview()
    toastError(err, { fallback: t('live.stage.previewFailed') })
  } finally {
    previewConnecting = false
  }
}
function closePreview() {
  if (pc) { pc.ontrack = null; pc.close(); pc = null }
  if (videoEl.value) videoEl.value.srcObject = null
  previewOn.value = false
}

// ---------- speaking ----------
const speaking = ref(false)
const quickText = ref('')
async function sayNow(text: string, interrupt = false) {
  const clean = text.trim()
  if (!clean) return
  try { await liveAPI.say(clean, interrupt) } catch (err) { toastError(err) }
}
async function hush() {
  playing.value = false
  try { await liveAPI.interrupt() } catch (err) { toastError(err) }
}
async function isSpeakingNow() {
  try { const r = await liveAPI.speaking(); speaking.value = r.speaking; return r.speaking } catch { return false }
}

// ---------- script queue ----------
const product = reactive({ name: '', details: '', price: '', promo: '', shop: '' })
const lines = ref<string[]>([])
const writing = ref(false)
const playing = ref(false)
const loop = ref(true)
const cursor = ref(0)
async function writeScript() {
  writing.value = true
  try {
    const r = await liveAPI.script({ ...product })
    lines.value = r.lines
    cursor.value = 0
  } catch (err) { toastError(err) } finally { writing.value = false }
}
async function playQueue() {
  if (!lines.value.length) return
  playing.value = true
  while (playing.value && running.value) {
    const line = (lines.value[cursor.value] || '').trim()
    if (line) {
      await sayNow(line)
      await waitUntilQuiet(isSpeakingNow, () => playing.value)
    }
    if (!playing.value) break
    const next = nextQueueIndex(cursor.value, lines.value.length, loop.value)
    if (next === null) { playing.value = false; cursor.value = 0; break }
    cursor.value = next
  }
  speaking.value = false
}
function pauseQueue() { playing.value = false }

// ---------- comments ----------
interface ThreadItem { id: number; viewer: string; comment: string; reply: string | null; handoff: boolean; reason: string; spoken: boolean }
const faq = ref('')
const viewer = ref('')
const comment = ref('')
const autoSpeak = ref(true)
const answering = ref(false)
const thread = ref<ThreadItem[]>([])
let threadId = 0
async function answer() {
  answering.value = true
  try {
    const r = await liveAPI.answer({ comment: comment.value.trim(), viewer: viewer.value.trim(), product: { ...product }, faq: faq.value })
    const item: ThreadItem = { id: ++threadId, viewer: viewer.value.trim(), comment: comment.value.trim(), ...r, spoken: false }
    thread.value.unshift(item)
    thread.value = thread.value.slice(0, 50)
    comment.value = ''
    viewer.value = ''
    if (autoSpeak.value && item.reply && running.value) await speakReply(item)
  } catch (err) { toastError(err) } finally { answering.value = false }
}
/** a reply cuts in front of the script: interrupt the current line, speak, the queue then carries on */
async function speakReply(item: ThreadItem) {
  if (!item.reply) return
  await sayNow(item.reply, true)
  item.spoken = true
}

// ---------- drafts (per browser; product/FAQ/lines survive a reload) ----------
const DRAFT_KEY = 'naka-ai-live-draft'
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    Object.assign(product, d.product || {})
    faq.value = d.faq || ''
    lines.value = Array.isArray(d.lines) ? d.lines : []
  } catch { /* no draft */ }
}
watch([product, faq, lines], () => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ product, faq: faq.value, lines: lines.value })) } catch { /* storage full/blocked */ }
}, { deep: true })

// ---------- settings ----------
const showSettings = ref(false)
const saving = ref(false)
const form = reactive<{ agentUrl: string; token: string; rtmpUrl: string | null }>({ agentUrl: '', token: '', rtmpUrl: '' })
function openSettings() {
  form.agentUrl = status.value?.config.agentUrl || ''
  form.token = ''
  form.rtmpUrl = ''
  showSettings.value = true
}
async function saveSettings() {
  saving.value = true
  try {
    await liveAPI.saveConfig({ agentUrl: form.agentUrl, token: form.token, rtmpUrl: form.rtmpUrl, avatarId: avatarId.value, voice: voice.value })
    showSettings.value = false
    toast.success(t('live.settings.savedToast'))
    status.value = null
    await refresh()
  } catch (err) { toastError(err) } finally { saving.value = false }
}
</script>

<style scoped>
.page { padding: 32px 40px 48px; overflow-y: auto; height: 100%; }
.lv-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.lv-title { margin: 2px 0 4px; font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--text-0); }
.lv-sub { margin: 0; font-size: 13px; color: var(--text-2); max-width: 640px; }
.lv-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.lv-dot { display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--text-3); }
.lv-dot.on { background: var(--success, #22c55e); }
.lv-tag-live { background: #ef4444; color: #fff; border-color: #ef4444; }
.lv-tag-warn { background: color-mix(in srgb, #f59e0b 18%, transparent); color: #f59e0b; border-color: color-mix(in srgb, #f59e0b 40%, transparent); }
.lv-setup { display: flex; align-items: center; gap: 14px; padding: 16px 18px; margin-bottom: 14px; }
.lv-setup h3 { margin: 0 0 2px; font-size: 15px; }
.lv-setup p { margin: 0; font-size: 12.5px; color: var(--text-2); }
.lv-setup .btn { margin-left: auto; }
.lv-error { margin: 0 0 12px; font-size: 12.5px; color: var(--danger, #ef4444); }
.lv-grid { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(300px, 1.15fr) minmax(280px, 1fr); gap: 14px; align-items: start; }
.lv-col { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
.lv-col-title { margin: 0; font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text-0); }
.lv-screen { position: relative; aspect-ratio: 9 / 16; max-height: 520px; border-radius: var(--radius-lg); overflow: hidden; background: #05070d; border: 1px solid var(--border); }
.lv-screen video { width: 100%; height: 100%; object-fit: contain; display: block; }
.lv-screen-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-3); font-size: 12.5px; text-align: center; padding: 16px; }
.lv-mute { position: absolute; right: 10px; bottom: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); background: rgba(0, 0, 0, .55); color: #fff; display: grid; place-items: center; cursor: pointer; }
.lv-speaking { position: absolute; left: 10px; top: 10px; padding: 3px 9px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; }
.lv-row { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.lv-flex { flex: 1; min-width: 0; }
.lv-hint { margin: 0; font-size: 11.5px; color: var(--text-3); }
.lv-golive { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: var(--radius); border: 1px dashed var(--border-strong); }
.lv-golive strong { font-size: 13px; }
.lv-btn-live { background: #ef4444; border-color: #ef4444; color: #fff; }
.lv-btn-live:disabled { opacity: .45; }
.lv-lines { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; max-height: 420px; overflow-y: auto; }
.lv-lines li { display: grid; grid-template-columns: 22px 1fr auto auto; gap: 6px; align-items: start; padding: 4px; border-radius: var(--radius); border: 1px solid transparent; }
.lv-lines li.current { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.lv-line-no { padding-top: 8px; font-size: 11px; color: var(--text-3); text-align: right; }
.lv-line-input { min-height: 0; resize: vertical; font-size: 12.5px; }
.lv-icon-btn { width: 26px; height: 26px; margin-top: 4px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--border); background: var(--surface-raised); color: var(--text-1); cursor: pointer; }
.lv-icon-btn:disabled { opacity: .4; cursor: default; }
.lv-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-1); }
.lv-comment-form { display: flex; gap: 6px; flex-wrap: wrap; }
.lv-comment-form .lv-flex { flex: 1 1 100%; order: -1; }
.lv-viewer { flex: 1; min-width: 0; }
.lv-thread { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; max-height: 520px; overflow-y: auto; }
.lv-msg { padding: 10px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-soft); }
.lv-msg p { margin: 0 0 4px; font-size: 12.5px; line-height: 1.5; }
.lv-msg-in { color: var(--text-1); }
.lv-msg-out { color: var(--text-0); padding-left: 10px; border-left: 2px solid var(--accent); }
.lv-msg-foot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lv-dialog { width: min(520px, 94vw); }
.lv-dialog-body { display: flex; flex-direction: column; gap: 12px; }
.lv-start { align-self: flex-start; }
@media (max-width: 1180px) { .lv-grid { grid-template-columns: 1fr 1fr; } .lv-grid > :last-child { grid-column: 1 / -1; } }
@media (max-width: 760px) { .page { padding: 20px 16px 32px; } .lv-grid { grid-template-columns: 1fr; } .lv-screen { max-height: 440px; } }
</style>
