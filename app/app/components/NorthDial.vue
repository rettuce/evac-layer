<script setup lang="ts">
const props = defineProps<{ pictogram: string; rotation?: number; dialPx: number; markPx: number }>()

const ARROW_RATIO = 0.72
const arrowPx = computed(() => Math.round(props.dialPx * ARROW_RATIO))
</script>

<template>
  <div class="north-dial" data-north-dial :style="{ '--dial': dialPx, '--mark': markPx }">
    <svg class="north-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3.5" />
    </svg>
    <div class="north-arrow">
      <PictogramMark :id="pictogram" :size-px="arrowPx" :rotation="rotation" />
    </div>
    <div class="north-marks">
      <span />
      <p class="t-fine north-mark" lang="en">N</p>
    </div>
  </div>
</template>
