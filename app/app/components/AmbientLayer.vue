<script setup lang="ts">
import { clockSweep, drawOverlay, formatClockJst, labelFont, overlayGeometry, pickAmbient, timeFont } from '~~/layout/ambient'
import type { Shape } from '~~/layout/types'

const props = defineProps<{ seed: string; clockEpochMs: number; siteName: string; shape: Shape; scene?: string }>()

const TIME_GLYPHS = '0123456789:'

const canvas = ref<HTMLCanvasElement>()
const viewport = ref({ width: 0, height: 0 })
const fontsReady = ref(false)
const pick = computed(() => pickAmbient(props.seed, props.clockEpochMs, props.scene))
const geometry = computed(() => overlayGeometry(viewport.value.width, viewport.value.height, pick.value.corner))

function draw() {
  const el = canvas.value
  const { width, height } = viewport.value
  if (!el || width === 0 || !fontsReady.value) return
  if (el.width !== width || el.height !== height) {
    el.width = width
    el.height = height
  }
  // CPU-backed canvas: the GPU path rasterised the same gradients slightly differently between runs.
  const ctx = el.getContext('2d', { willReadFrequently: true })!
  pick.value.scene.render(ctx, props.clockEpochMs, pick.value.seed, props.shape)
  drawOverlay(ctx, geometry.value, {
    siteName: props.siteName,
    time: formatClockJst(props.clockEpochMs),
    sweep: clockSweep(props.clockEpochMs),
    ink: pick.value.scene.ink,
  })
}

// Canvas text does not wait for web fonts; drawing before they load would rasterise a fallback face.
async function loadFonts() {
  await Promise.all([document.fonts.load(labelFont(1), props.siteName || '施設'), document.fonts.load(timeFont(1), TIME_GLYPHS)])
  fontsReady.value = true
}

function onResize() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
}

onMounted(() => {
  onResize()
  window.addEventListener('resize', onResize)
  loadFonts()
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
watch([() => props.clockEpochMs, () => props.shape, () => props.siteName, pick, viewport, fontsReady], draw, { flush: 'post' })
watch(() => props.siteName, () => document.fonts.load(labelFont(1), props.siteName).then(draw))
</script>

<template>
  <div
    class="ambient"
    data-layer="ambient"
    :data-scene="pick.scene.id"
    :data-corner="pick.corner"
    :data-slot="pick.slot"
    :data-ready="viewport.width > 0 && fontsReady ? '1' : '0'"
  >
    <canvas ref="canvas" class="ambient-canvas" />
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
</style>
