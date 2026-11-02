<script setup lang="ts">
import { D21_TYPE, clockSweep, CLOCK_SWEEP_LENGTH, formatClockJst, overlayGeometry, pickAmbient } from '~~/layout/ambient'
import type { Shape } from '~~/layout/types'

const props = defineProps<{ seed: string; clockEpochMs: number; siteName: string; shape: Shape; scene?: string }>()

const canvas = ref<HTMLCanvasElement>()
const viewport = ref({ width: 0, height: 0 })
const pick = computed(() => pickAmbient(props.seed, props.clockEpochMs, props.scene))
const geometry = computed(() => overlayGeometry(viewport.value.width, viewport.value.height, pick.value.corner))
const time = computed(() => formatClockJst(props.clockEpochMs))
const sweep = computed(() => clockSweep(props.clockEpochMs))

function draw() {
  const el = canvas.value
  const { width, height } = viewport.value
  if (!el || width === 0) return
  if (el.width !== width || el.height !== height) {
    el.width = width
    el.height = height
  }
  // CPU-backed canvas: the GPU path rasterised the same gradients slightly differently between runs.
  const ctx = el.getContext('2d', { willReadFrequently: true })!
  pick.value.scene.render(ctx, props.clockEpochMs, pick.value.seed, props.shape)
}

function onResize() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
}

onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
watch([() => props.clockEpochMs, () => props.shape, pick, viewport], draw, { flush: 'post' })
</script>

<template>
  <div
    class="ambient"
    :class="`ink-${pick.scene.ink}`"
    :style="{
      '--s': `${geometry.scale}px`,
      '--label-size': D21_TYPE.label.size,
      '--label-line': D21_TYPE.label.line,
      '--time-size': D21_TYPE.time.size,
      '--time-line': D21_TYPE.time.line,
      '--sweep-length': CLOCK_SWEEP_LENGTH,
    }"
    data-layer="ambient"
    :data-scene="pick.scene.id"
    :data-corner="pick.corner"
    :data-slot="pick.slot"
    :data-ready="viewport.width > 0 ? '1' : '0'"
  >
    <canvas ref="canvas" class="ambient-canvas" />
    <div v-for="x in geometry.rules" :key="x" class="rule" :style="{ left: `${x}px` }" />
    <div
      class="block"
      :class="pick.corner"
      :style="{
        left: `${geometry.block.left}px`,
        width: `${geometry.block.width}px`,
        top: geometry.block.top === undefined ? undefined : `${geometry.block.top}px`,
        bottom: geometry.block.bottom === undefined ? undefined : `${geometry.block.bottom}px`,
      }"
    >
      <p class="site">{{ siteName }}</p>
      <p class="time">{{ time }}</p>
      <div class="track"><div class="sweep" :style="{ left: `${sweep * 100}%` }" /></div>
    </div>
  </div>
</template>

<style scoped>
.ambient {
  position: fixed;
  inset: 0;
  overflow: hidden;
  --ink: rgb(21 24 28);
}
.ambient.ink-light {
  --ink: rgb(244 242 236);
}
.ambient-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.rule {
  position: absolute;
  top: calc(48 * var(--s));
  bottom: calc(48 * var(--s));
  width: 1px;
  background: var(--ink);
  opacity: 0.14;
}
.block {
  position: absolute;
  color: var(--ink);
}
.block.top-right,
.block.bottom-right {
  text-align: right;
}
.site {
  margin: 0 0 calc(8 * var(--s));
  font-size: calc(var(--label-size) * var(--s));
  line-height: calc(var(--label-line) * var(--s));
  font-weight: 400;
  letter-spacing: 0.04em;
  opacity: 0.8;
}
.time {
  margin: 0;
  font-family: 'Noto Sans', sans-serif;
  font-size: calc(var(--time-size) * var(--s));
  line-height: calc(var(--time-line) * var(--s));
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.track {
  position: relative;
  height: 1px;
  margin-top: calc(24 * var(--s));
  background: var(--ink);
  opacity: 0.4;
}
.sweep {
  position: absolute;
  top: -1px;
  height: 3px;
  width: calc(var(--sweep-length) * var(--s));
  margin-left: calc(var(--sweep-length) * var(--s) * -0.5);
  background: var(--ink);
}
</style>
