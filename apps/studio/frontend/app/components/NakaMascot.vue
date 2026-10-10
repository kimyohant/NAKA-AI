<template>
  <!-- Naka, the naka-ai plush naga (same art as naka-ai.com: apps/landing/public/assets/naka-plush-320.png).
       Decorative: the surrounding heading carries the meaning, so screen readers skip it. -->
  <img
    class="naka-mascot"
    src="/naka-plush.webp"
    alt=""
    aria-hidden="true"
    :width="size"
    :height="size"
    decoding="async"
    draggable="false"
  />
</template>

<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 88 })
</script>

<style scoped>
.naka-mascot { display: block; flex-shrink: 0; object-fit: contain; user-select: none; pointer-events: none; }
</style>
