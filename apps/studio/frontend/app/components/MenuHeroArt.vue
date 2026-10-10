<template>
  <!-- The photo behind a menu's top banner (public/studio-art/menus). The parent banner is the positioned,
       isolated, clipped box; this layer sits under its text. A missing file leaves the banner's own background. -->
  <span v-if="!failed" class="mha" :class="`mha-${fade}`" aria-hidden="true">
    <img :src="src" alt="" decoding="async" fetchpriority="high" draggable="false" @error="failed = true" />
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'

/** fade 'left': the photo's subject is on the right and the title sits on the faded left (banners);
 *  'center': an even veil so centered content stays readable over the whole photo. */
withDefaults(defineProps<{ src: string; fade?: 'left' | 'center' }>(), { fade: 'left' })
const failed = ref(false)
</script>

<style scoped>
.mha { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
.mha img { width: 100%; height: 100%; object-fit: cover; object-position: 75% 40%; display: block; }
.mha::after { content: ''; position: absolute; inset: 0; }
.mha-left::after {
  background: linear-gradient(90deg,
    var(--surface-soft) 0%,
    color-mix(in srgb, var(--surface-soft) 92%, transparent) 30%,
    color-mix(in srgb, var(--surface-soft) 45%, transparent) 58%,
    transparent 80%);
}
.mha-center::after {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--surface-soft) 55%, transparent) 0%,
    color-mix(in srgb, var(--surface-soft) 78%, transparent) 45%,
    var(--surface-soft) 100%);
}
/* phones: the title needs the whole width, so the veil covers the photo evenly */
@media (max-width: 720px) {
  .mha img { object-position: 70% 30%; }
  .mha-left::after { background: color-mix(in srgb, var(--surface-soft) 80%, transparent); }
}
</style>
