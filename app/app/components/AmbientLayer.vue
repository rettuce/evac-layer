<script setup lang="ts">
import { clockSweep, drawOverlay, formatClockJst, labelFont, overlayGeometry, pickAmbient, timeFont } from '~~/layout/ambient'
import type { AmbientFrame, AmbientRect } from '~~/layout/ambient/types'
import { PILLAR, pillarYForHeight, shapeForViewport } from '~~/layout/shapes'
import type { Shape } from '~~/layout/types'

const props = withDefaults(
  defineProps<{ seed: string; clockEpochMs: number; siteName: string; shape: Shape; scene?: string; active?: boolean; room?: { width: number; height: number }; crop?: AmbientRect }>(),
  { active: true },
)

const TIME_GLYPHS = '0123456789:'
const PILLAR_CLOCK_TOP_M = 2.0

const canvas = ref<HTMLCanvasElement>()
const viewport = ref({ width: 0, height: 0 })
const fontsReady = ref(false)
const pick = computed(() => pickAmbient(props.seed, props.clockEpochMs, props.scene))
// The ambient pillar is one picture round the column: the field and the D21 rules run across all four
// faces at the face's scale, and the clock appears once, on the front face at eye height.
function overlayFor(width: number, height: number) {
  const geometry = overlayGeometryFor(width, height)
  return pick.value.scene.drawsGrid ? { ...geometry, rules: [] } : geometry
}

function overlayGeometryFor(width: number, height: number) {
  if (props.shape !== 'pillar') return overlayGeometry(width, height, pick.value.corner)
  const front = overlayGeometry(width / PILLAR.faces, height, pick.value.corner)
  const rules = overlayGeometry(width, height, pick.value.corner, front.scale).rules
  const top = pillarYForHeight(PILLAR_CLOCK_TOP_M) * (height / PILLAR.height)
  return { ...front, rules, block: { ...front.block, top, bottom: undefined } }
}

// A screen cut from a room draws the room's scene in room coordinates, shifted so that only its own
// rectangle lands on the canvas; the room is scaled so that the crop fills the screen's width.
function sceneFrame(width: number, height: number): { frame: AmbientFrame; shape: Shape } {
  if (!props.room || !props.crop) return { frame: { width, height, view: { x: 0, y: 0, width, height } }, shape: props.shape }
  const scale = width / props.crop.width
  const frame = {
    width: props.room.width * scale,
    height: props.room.height * scale,
    view: { x: props.crop.x * scale, y: props.crop.y * scale, width, height },
  }
  return { frame, shape: shapeForViewport(props.room.width, props.room.height) }
}

// The backing store follows the device pixel ratio: a pillar captured at 0.5 is drawn at a quarter of
// the pixels it would take at full size, and a 1x panel keeps its full resolution.
function draw() {
  const el = canvas.value
  if (!el || viewport.value.width === 0 || !fontsReady.value || !props.active) return
  const ratio = window.devicePixelRatio || 1
  const width = Math.round(viewport.value.width * ratio)
  const height = Math.round(viewport.value.height * ratio)
  if (el.width !== width || el.height !== height) {
    el.width = width
    el.height = height
  }
  // CPU-backed canvas: the GPU path rasterised the same gradients slightly differently between runs.
  const ctx = el.getContext('2d', { willReadFrequently: true })!
  const { frame, shape } = sceneFrame(width, height)
  ctx.setTransform(1, 0, 0, 1, -frame.view.x, -frame.view.y)
  pick.value.scene.render(ctx, props.clockEpochMs, pick.value.seed, shape, frame)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const content = {
    siteName: props.siteName,
    time: formatClockJst(props.clockEpochMs),
    sweep: clockSweep(props.clockEpochMs),
    ink: pick.value.scene.ink,
  }
  drawOverlay(ctx, overlayFor(width, height), content)
}

// Canvas text does not wait for web fonts; drawing before they load would rasterise a fallback face.
async function loadFonts() {
  await Promise.all([
    document.fonts.load(labelFont(1), props.siteName || '施設'),
    document.fonts.load(timeFont(1), TIME_GLYPHS),
  ])
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
watch([() => props.clockEpochMs, () => props.shape, () => props.siteName, () => props.active, () => props.room, () => props.crop, pick, viewport, fontsReady], draw, { flush: 'post' })
watch(() => props.siteName, () => document.fonts.load(labelFont(1), props.siteName).then(draw))
</script>

<template>
  <div
    class="ambient"
    data-layer="ambient"
    :data-scene="pick.scene.id"
    :data-corner="pick.corner"
    :data-slot="pick.slot"
    :data-crop="crop && room ? `${room.width}x${room.height}:${crop.x},${crop.y},${crop.width},${crop.height}` : undefined"
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
