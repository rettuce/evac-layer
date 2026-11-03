<script setup lang="ts">
import { COORD_GLYPHS, clockSweep, formatCoords, drawOverlay, formatClockJst, labelFont, overlayGeometry, pickAmbient, timeFont } from '~~/layout/ambient'
import type { AmbientFrame, AmbientRect } from '~~/layout/ambient/types'
import { PILLAR, pillarYForHeight, shapeForViewport } from '~~/layout/shapes'
import type { Shape } from '~~/layout/types'

const props = withDefaults(
  defineProps<{ seed: string; clockEpochMs: number; siteName: string; shape: Shape; scene?: string; active?: boolean; room?: { width: number; height: number }; crop?: AmbientRect; seam?: 'left' | 'right'; bare?: boolean; lat?: number; lng?: number }>(),
  { active: true },
)

const TIME_GLYPHS = '0123456789:'
const PILLAR_CLOCK_TOP_M = 2.0
const PILLAR_CLOCK_CORNER = 'top-left'
// On a portrait panel the clock block starts here, so the digits sit a little above mid-height (2026-11-04).
const PORTRAIT_CLOCK_TOP = 0.36
// Faces are laid front, right, back, left; a column whose seam must fall on its front-right edge draws
// the strip's last quarter on the front, so the picture continues round the three faces a viewer sees.
const SEAM_RIGHT_FRONT_QUARTER = 3

const canvas = ref<HTMLCanvasElement>()
const viewport = ref({ width: 0, height: 0 })
const fontsReady = ref(false)
const pick = computed(() => pickAmbient(props.seed, props.clockEpochMs, props.scene))
// The ambient pillar is one picture round the column: the field and the D21 rules run across all four
// faces at the face's scale, and the clock appears once, on the front face at eye height.
function overlayFor(width: number, height: number) {
  if (props.shape === 'pillar') {
    const front = overlayGeometry(width / PILLAR.faces, height, PILLAR_CLOCK_CORNER)
    const rules = overlayGeometry(width, height, PILLAR_CLOCK_CORNER, front.scale).rules
    const top = pillarYForHeight(PILLAR_CLOCK_TOP_M) * (height / PILLAR.height)
    return { ...front, rules, block: { ...front.block, top, bottom: undefined } }
  }
  const geometry = overlayGeometry(width, height, pick.value.corner)
  if (props.shape === '9x16') return { ...geometry, block: { ...geometry.block, top: Math.round(height * PORTRAIT_CLOCK_TOP), bottom: undefined } }
  return geometry
}

// A screen cut from a room draws the room's scene in room coordinates; the room is scaled so that the
// crop fills the screen's width, and the crop is snapped to whole pixels of that scale.
function roomFrame(width: number, height: number, room: { width: number; height: number }, crop: AmbientRect): AmbientFrame {
  const scale = width / crop.width
  return { width: room.width * scale, height: room.height * scale, view: { x: Math.round(crop.x * scale), y: Math.round(crop.y * scale), width, height } }
}

// The room is drawn in fixed whole tiles, each with the same transform and bounds whichever screen asks
// for it, then copied at whole-pixel offsets: shifting by each screen's own offset, or clipping to its
// edge, rounds curve and line edges differently, and neighbouring screens would not meet exactly.
const ROOM_TILE_PX = 512
let tileCanvas: HTMLCanvasElement | undefined

function drawRoom(ctx: CanvasRenderingContext2D, frame: AmbientFrame, shape: Shape, destX = 0) {
  tileCanvas ??= Object.assign(document.createElement('canvas'), { width: ROOM_TILE_PX, height: ROOM_TILE_PX })
  const tile = tileCanvas.getContext('2d', { willReadFrequently: true })!
  const { view } = frame
  for (let ty = Math.floor(view.y / ROOM_TILE_PX) * ROOM_TILE_PX; ty < view.y + view.height; ty += ROOM_TILE_PX) {
    for (let tx = Math.floor(view.x / ROOM_TILE_PX) * ROOM_TILE_PX; tx < view.x + view.width; tx += ROOM_TILE_PX) {
      const x = Math.max(view.x, tx)
      const y = Math.max(view.y, ty)
      const w = Math.min(view.x + view.width, tx + ROOM_TILE_PX) - x
      const h = Math.min(view.y + view.height, ty + ROOM_TILE_PX) - y
      if (w <= 0 || h <= 0) continue
      tile.save()
      tile.setTransform(1, 0, 0, 1, -tx, -ty)
      pick.value.scene.render(tile, props.clockEpochMs, pick.value.seed, shape, { ...frame, view: { x: tx, y: ty, width: ROOM_TILE_PX, height: ROOM_TILE_PX } })
      tile.restore()
      ctx.drawImage(tileCanvas, x - tx, y - ty, w, h, destX + x - view.x, y - view.y, w, h)
    }
  }
}

function drawPillarFaces(ctx: CanvasRenderingContext2D, frame: AmbientFrame, shape: Shape) {
  const faceWidth = Math.round(frame.view.width / PILLAR.faces)
  for (let face = 0; face < PILLAR.faces; face++) {
    const quarter = (face + SEAM_RIGHT_FRONT_QUARTER) % PILLAR.faces
    const view = { ...frame.view, x: frame.view.x + quarter * faceWidth, width: faceWidth }
    drawRoom(ctx, { ...frame, view }, shape, face * faceWidth)
  }
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
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (props.room && props.crop) {
    const frame = roomFrame(width, height, props.room, props.crop)
    const roomShape = shapeForViewport(props.room.width, props.room.height)
    if (props.shape === 'pillar' && props.seam === 'right') drawPillarFaces(ctx, frame, roomShape)
    else drawRoom(ctx, frame, roomShape)
  }
  else pick.value.scene.render(ctx, props.clockEpochMs, pick.value.seed, props.shape, { width, height, view: { x: 0, y: 0, width, height } })
  const content = {
    siteName: props.siteName,
    coords: props.lat !== undefined && props.lng !== undefined ? formatCoords(props.lat, props.lng) : undefined,
    time: formatClockJst(props.clockEpochMs),
    sweep: clockSweep(props.clockEpochMs),
    ink: pick.value.scene.ink,
  }
  if (!props.bare) drawOverlay(ctx, overlayFor(width, height), content)
}

// Canvas text does not wait for web fonts; drawing before they load would rasterise a fallback face.
async function loadFonts() {
  await Promise.all([
    document.fonts.load(labelFont(1), (props.siteName || '施設') + COORD_GLYPHS),
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
watch([() => props.clockEpochMs, () => props.shape, () => props.siteName, () => props.active, () => props.room, () => props.crop, () => props.seam, pick, viewport, fontsReady], draw, { flush: 'post' })
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
