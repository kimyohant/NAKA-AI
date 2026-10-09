<template>
  <span ref="root" class="mm" :class="{ 'mm-ready': !!still }">
    <img v-if="still" class="mm-still" :src="still" :alt="alt" loading="lazy" decoding="async" draggable="false" />
    <video
      v-if="clip && active"
      ref="player"
      class="mm-clip"
      :class="{ on: playing }"
      :src="clip"
      :poster="still || undefined"
      muted
      loop
      playsinline
      preload="metadata"
      aria-hidden="true"
      @playing="playing = true"
      @pause="playing = false"
    />
    <span v-if="badge && still" class="mm-badge">{{ badge }}</span>
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { mkImage, mkPoster, mkVideo } from '../utils/marketerMedia'

/**
 * MarketerMedia — ภาพ/คลิปประกอบที่สร้างด้วย AI (utils/marketerMedia.js) ถ้ายังไม่มีไฟล์จะไม่แสดงอะไร
 * ให้พื้นหลังเดิมของการ์ด (gradient) โชว์ต่อ. play: 'hover' เล่นเมื่อชี้ (ทั้งการ์ดถ้าบรรพบุรุษมี data-mm-hover),
 * 'visible' เล่นเมื่ออยู่ในจอ
 * ไม่เล่นอัตโนมัติเมื่อผู้ใช้ตั้ง prefers-reduced-motion หรือ save-data
 */
const props = withDefaults(defineProps<{ id: string; alt?: string; play?: 'hover' | 'visible' | 'none'; badge?: string }>(), {
  alt: '', play: 'hover', badge: '',
})

const root = ref<HTMLElement | null>(null)
const player = ref<HTMLVideoElement | null>(null)
const active = ref(false)
const playing = ref(false)

const still = computed(() => mkImage(props.id) || mkPoster(props.id))
const clip = computed(() => (props.play === 'none' ? null : mkVideo(props.id)))

const calm = () => typeof window !== 'undefined' && (
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || (navigator as any).connection?.saveData === true)

async function start() {
  if (!clip.value || calm()) return
  active.value = true
  await nextTick()
  player.value?.play().catch(() => {})
}
function stop() {
  player.value?.pause()
}

let observer: IntersectionObserver | null = null
let hoverEl: HTMLElement | null = null
onMounted(() => {
  if (!root.value) return
  if (props.play === 'hover') {
    hoverEl = root.value.closest<HTMLElement>('[data-mm-hover]') || root.value
    hoverEl.addEventListener('mouseenter', start)
    hoverEl.addEventListener('mouseleave', stop)
    hoverEl.addEventListener('focusin', start)
    hoverEl.addEventListener('focusout', stop)
  } else if (props.play === 'visible' && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(([e]) => (e?.isIntersecting ? start() : stop()), { threshold: 0.35 })
    observer.observe(root.value)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  hoverEl?.removeEventListener('mouseenter', start)
  hoverEl?.removeEventListener('mouseleave', stop)
  hoverEl?.removeEventListener('focusin', start)
  hoverEl?.removeEventListener('focusout', stop)
})
</script>

<style scoped>
.mm { display: block; position: relative; overflow: hidden; }
.mm-still, .mm-clip { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.mm-clip { opacity: 0; transition: opacity .35s var(--ease-out, ease); }
.mm-clip.on { opacity: 1; }
.mm-badge {
  position: absolute; right: 8px; bottom: 8px; z-index: 2; padding: 2px 7px; border-radius: 999px;
  font-size: 9.5px; font-weight: 700; letter-spacing: .02em; color: rgba(255, 255, 255, .9);
  background: rgba(0, 0, 0, .5); backdrop-filter: blur(4px); pointer-events: none;
}
</style>
