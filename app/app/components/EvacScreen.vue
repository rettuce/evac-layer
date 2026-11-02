<script setup lang="ts">
import { gridCss, initialPlacement, missingRequired, nextOverflowVictim } from '~~/layout/fit'
import { PULSE_MIN_OPACITY, PULSE_PERIOD_MS, SCALE_IN_FROM, SCALE_IN_MS } from '~~/layout/motion'
import { CABINET_OFFICE_5, DARK_BAND, PAGE_BACKGROUND, PAGE_INK, inkOn, rgbCss } from '~~/layout/palette'
import { SHAPES, designScale } from '~~/layout/shapes'
import { TEMPLATES } from '~~/layout/templates'
import type { DroppedCell, EvacScreen, LayoutCell, Shape } from '~~/layout/types'
import { LANGUAGE_ROTATION_MS, LINE_HEIGHT, TYPE_PX } from '~~/layout/typography'

const props = defineProps<{ screen: EvacScreen; shape: Shape; variant?: number }>()

const FONT_FAMILIES = ['Noto Sans JP', 'Noto Sans', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans KR']
const FONT_WEIGHTS = [400, 700]

const root = ref<HTMLElement>()
const scale = ref(1)
const overflowDropped = ref<DroppedCell[]>([])
const overflowing = ref<string[]>([])
const ready = ref(false)
const languageIndex = ref(0)

const layout = computed(() => {
  const template = TEMPLATES[props.screen.template]
  if (!template) throw new Error(`template not implemented: ${props.screen.template}`)
  const variants = template[props.shape]
  return variants[props.variant ?? 0] ?? variants[0]!
})

const initial = computed(() => initialPlacement(props.screen.cells, layout.value))
const placed = computed(() => {
  const gone = new Set(overflowDropped.value.map((d) => d.id))
  return initial.value.placed.filter((cell) => !gone.has(cell.id))
})
const dropped = computed(() => [...initial.value.dropped, ...overflowDropped.value])
const missing = computed(() => missingRequired(initial.value.placed, layout.value))

const band = computed(() => CABINET_OFFICE_5[props.screen.alert.level])

const rootStyle = computed(() => ({
  ...gridCss(layout.value),
  '--px': `${scale.value}px`,
  '--fs-action': TYPE_PX.action,
  '--fs-guide': TYPE_PX.guide,
  '--fs-fine': TYPE_PX.fine,
  '--lh-action': LINE_HEIGHT.action,
  '--lh-guide': LINE_HEIGHT.guide,
  '--lh-fine': LINE_HEIGHT.fine,
  '--bg': rgbCss(PAGE_BACKGROUND),
  '--ink': rgbCss(PAGE_INK),
  '--band': rgbCss(band.value),
  '--band-ink': rgbCss(inkOn(band.value)),
  '--dark-band': rgbCss(DARK_BAND),
  '--dark-band-ink': rgbCss(inkOn(DARK_BAND)),
  '--pulse-period': `${PULSE_PERIOD_MS}ms`,
  '--pulse-min': PULSE_MIN_OPACITY,
  '--scale-in-ms': `${SCALE_IN_MS}ms`,
  '--scale-in-from': SCALE_IN_FROM,
}))

function cellClass(cell: LayoutCell) {
  return {
    'is-band': cell.role === 'headline',
    'is-dark-band': layout.value.darkBand?.includes(cell.role),
    'is-inline': layout.value.inline?.includes(cell.role),
    [`m-${cell.motion}`]: ready.value,
  }
}

function allText(): string {
  return props.screen.cells.flatMap((cell) => Object.values(cell.text)).join('') + '0123456789 m'
}

async function loadFonts() {
  const text = allText()
  await Promise.all(
    FONT_FAMILIES.flatMap((family) =>
      FONT_WEIGHTS.map((weight) => document.fonts.load(`${weight} 64px "${family}"`, text)),
    ),
  )
  await document.fonts.ready
}

const OVERFLOW_TOLERANCE_PX = 1

// Box rects, not scrollHeight: Noto's ascent+descent exceed the line-height, so the inline
// content area pokes out of every line box and would read as overflow on any cell.
function cellOverflows(cellEl: HTMLElement): boolean {
  const bounds = cellEl.getBoundingClientRect()
  return [...cellEl.querySelectorAll<HTMLElement>('*')].some((child) => {
    const r = child.getBoundingClientRect()
    const outside =
      r.bottom > bounds.bottom + OVERFLOW_TOLERANCE_PX ||
      r.right > bounds.right + OVERFLOW_TOLERANCE_PX ||
      r.top < bounds.top - OVERFLOW_TOLERANCE_PX ||
      r.left < bounds.left - OVERFLOW_TOLERANCE_PX
    const textTooWide = child.tagName === 'P' && child.scrollWidth > child.clientWidth + OVERFLOW_TOLERANCE_PX
    return outside || textTooWide
  })
}

function measureOverflow(): string[] {
  const el = root.value
  if (!el) return []
  const ids = [...el.querySelectorAll<HTMLElement>('[data-cell-id]')]
    .filter(cellOverflows)
    .map((cellEl) => cellEl.dataset.cellId!)
  const screenOverflows = el.scrollHeight > el.clientHeight + OVERFLOW_TOLERANCE_PX
  return screenOverflows ? [...ids, 'screen'] : ids
}

let fitGeneration = 0

async function fit() {
  const generation = ++fitGeneration
  ready.value = false
  overflowDropped.value = []
  await loadFonts()
  for (;;) {
    await nextTick()
    await new Promise(requestAnimationFrame)
    if (generation !== fitGeneration) return
    const over = measureOverflow()
    if (!over.length) {
      overflowing.value = []
      break
    }
    const victim = nextOverflowVictim(placed.value, layout.value)
    if (!victim) {
      overflowing.value = over
      break
    }
    overflowDropped.value = [...overflowDropped.value, { id: victim.id, reason: 'overflow' }]
  }
  ready.value = true
  rotationTimer ??= setInterval(() => {
    languageIndex.value += 1
  }, LANGUAGE_ROTATION_MS)
}

function updateScale() {
  scale.value = designScale(window.innerWidth, window.innerHeight)
}

let rotationTimer: ReturnType<typeof setInterval> | undefined
let resizeFrame = 0

function onResize() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    updateScale()
    fit()
  })
}

onMounted(() => {
  updateScale()
  fit()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  clearInterval(rotationTimer)
  cancelAnimationFrame(resizeFrame)
  window.removeEventListener('resize', onResize)
})

watch(() => [props.screen, props.shape, props.variant], fit)
</script>

<template>
  <main
    ref="root"
    class="evac-screen"
    :class="`shape-${SHAPES[shape].cls}`"
    :style="rootStyle"
    :data-shape="shape"
    :data-template="screen.template"
    :data-variant="layout.id"
    :data-level="screen.alert.level"
    :data-dropped="dropped.map((d) => `${d.id}:${d.reason}`).join(',')"
    :data-missing-required="missing.join(',') || undefined"
    :data-overflow="overflowing.join(',') || undefined"
    :data-ready="ready ? '1' : '0'"
    :data-bulletin-id="screen.alert.bulletin_id"
  >
    <section
      v-for="cell in placed"
      :key="cell.id"
      class="cell"
      :class="cellClass(cell)"
      :style="{ gridArea: cell.role }"
      :data-cell-id="cell.id"
      :data-role="cell.role"
      :data-priority="cell.priority"
      :data-motion="cell.motion"
    >
      <ScreenCell
        :cell="cell"
        :level="screen.alert.level"
        :pictogram-px="layout.pictogramPx[cell.role] ?? 0"
        :language-index="languageIndex"
      />
    </section>
  </main>
</template>
