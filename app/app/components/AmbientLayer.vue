<script setup lang="ts">
import { ambientOffset, ambientPalette, formatClockJst } from '~~/layout/ambient'
import { designScale } from '~~/layout/shapes'
import { TYPE_PX } from '~~/layout/typography'

const props = defineProps<{ seed: string; elapsedMs: number; clockEpochMs: number; siteName: string }>()

const canvas = ref<HTMLCanvasElement>()
const scale = ref(1)
const palette = computed(() => ambientPalette(props.seed))
const label = computed(() => `${props.siteName}　${formatClockJst(props.clockEpochMs)}`)

function draw() {
  const el = canvas.value
  if (!el) return
  const width = window.innerWidth
  const height = window.innerHeight
  if (el.width !== width || el.height !== height) {
    el.width = width
    el.height = height
  }
  const ctx = el.getContext('2d')!
  const { colors } = palette.value
  const tile = height * 2
  const gradient = ctx.createLinearGradient(0, 0, 0, tile)
  colors.forEach((color, i) => gradient.addColorStop(i / colors.length, color))
  gradient.addColorStop(1, colors[0]!)
  const shift = ambientOffset(palette.value, props.elapsedMs) * tile
  ctx.fillStyle = gradient
  ctx.save()
  ctx.translate(0, -shift)
  ctx.fillRect(0, 0, width, tile)
  ctx.fillRect(0, tile, width, tile)
  ctx.restore()
}

function onResize() {
  scale.value = designScale(window.innerWidth, window.innerHeight)
  draw()
}

onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
watch(() => [props.elapsedMs, props.seed], draw)
</script>

<template>
  <div class="ambient" :style="{ '--px': `${scale}px`, '--fs-fine': TYPE_PX.fine }" data-layer="ambient" data-ready="1">
    <canvas ref="canvas" class="ambient-canvas" />
    <p class="ambient-label">{{ label }}</p>
  </div>
</template>

<style scoped>
.ambient {
  position: fixed;
  inset: 0;
  overflow: hidden;
}
.ambient-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.ambient-label {
  position: absolute;
  right: calc(48 * var(--px));
  bottom: calc(40 * var(--px));
  margin: 0;
  font-size: calc(var(--fs-fine) * var(--px));
  font-weight: 400;
  color: rgb(0 0 0 / 0.55);
  font-variant-numeric: tabular-nums;
}
</style>
