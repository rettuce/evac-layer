<script setup lang="ts">
import { collapseAbsent, gridCss, initialPlacement, missingRequired, nextOverflowVictim } from '~~/layout/fit'
import { frameStyle, languageStep, motionFrame } from '~~/layout/motion'
import { CABINET_OFFICE_5, DARK_BAND, LANG_LABEL_OPACITY, PAGE_BACKGROUND, PAGE_INK, SHELTER_KIND_OPACITY, contrastRatio, inkOn, levelLabelFor, rgbCss } from '~~/layout/palette'
import { SHAPES, designScale } from '~~/layout/shapes'
import { STACKED_BAND_MIN_PX, resolveLayout } from '~~/layout/templates'
import { OVERFLOW_PICTOGRAM, overflowAttr, type CellOverflow } from '~~/layout/overflow'
import type { DroppedCell, EvacScreen, LayoutCell, Shape } from '~~/layout/types'
import { HEADLINE_STEP_DOWN, LINE_HEIGHT, TYPE_PX } from '~~/layout/typography'
import { pictogramsSettled } from '~/composables/usePictogramInk'

const props = defineProps<{
  screen: EvacScreen
  shape: Shape
  variant?: number
  elapsedMs: number
  reducedMotion?: boolean
  box?: { width: number; height: number; scale: number }
  hideSources?: boolean
}>()
const emit = defineEmits<{ ready: [] }>()

const FONT_FAMILIES = ['Noto Sans JP', 'Noto Sans', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans KR', 'Noto Sans Thai']
const FONT_WEIGHTS = [400, 700]
const BAND_RULE_MIN_CONTRAST = 1.5
const BAND_RULE_PX = 4

const root = ref<HTMLElement>()
const scale = ref(1)
const overflowDropped = ref<DroppedCell[]>([])
const overflow = ref('')
const levelLabel = computed(() => levelLabelFor(props.screen.template, props.screen.alert.level))
const headlineScale = ref(1)
const shelterNarrow = ref(false)
const distanceBelow = ref(false)
const languagesNarrow = ref(false)
const stackedHeadline = computed(() => ['portrait', 'square', 'pillar'].includes(SHAPES[props.shape].cls))
// 32:9 sets the headline in a narrow column, so it gets the same two-line limit as the stacked bands.
const headlineLimited = computed(() => stackedHeadline.value || SHAPES[props.shape].cls === 'ribbon')
const ready = ref(false)

const layout = computed(() => resolveLayout(props.screen.template, props.shape, props.variant))

const initial = computed(() => initialPlacement(props.screen.cells, layout.value))
const placed = computed(() => {
  const gone = new Set(overflowDropped.value.map((d) => d.id))
  return initial.value.placed.filter((cell) => !gone.has(cell.id))
})
const dropped = computed(() => [...initial.value.dropped, ...overflowDropped.value])
const missing = computed(() => missingRequired(initial.value.placed, layout.value))
const easyInAction = computed(() => !placed.value.some((cell) => cell.role === 'languages'))
const heroCell = computed(() => (layout.value.hero ? placed.value.find((cell) => cell.role === layout.value.hero!.role) : undefined))

const band = computed(() => CABINET_OFFICE_5[props.screen.alert.level])

const rootStyle = computed(() => ({
  ...gridCss(collapseAbsent(layout.value, new Set([...placed.value.map((cell) => cell.role), ...(layout.value.hero ? ['hero'] : [])]))),
  ...(props.box ? { width: `${props.box.width}px`, height: `${props.box.height}px` } : {}),
  '--px': `${scale.value}px`,
  '--fs-action': TYPE_PX.action,
  '--fs-guide': TYPE_PX.guide,
  '--fs-fine': TYPE_PX.fine,
  '--stacked-band-min': STACKED_BAND_MIN_PX,
  '--shelter-kind-opacity': SHELTER_KIND_OPACITY,
  '--lang-label-opacity': LANG_LABEL_OPACITY,
  '--lh-action': LINE_HEIGHT.action,
  '--lh-guide': LINE_HEIGHT.guide,
  '--lh-fine': LINE_HEIGHT.fine,
  '--bg': rgbCss(PAGE_BACKGROUND),
  '--ink': rgbCss(PAGE_INK),
  '--band': rgbCss(band.value),
  '--band-ink': rgbCss(inkOn(band.value)),
  '--band-rule': contrastRatio(band.value, PAGE_BACKGROUND) < BAND_RULE_MIN_CONTRAST ? BAND_RULE_PX : 0,
  '--dark-band': rgbCss(DARK_BAND),
  '--dark-band-ink': rgbCss(inkOn(DARK_BAND)),
  ...Object.fromEntries(Object.entries(layout.value.type ?? {}).map(([key, px]) => [`--type-${key}`, px])),
  ...(shelterNarrow.value && layout.value.type?.shelterNarrow ? { '--type-shelter': layout.value.type.shelterNarrow } : {}),
  ...(languagesNarrow.value && layout.value.type?.languagesNarrow ? { '--type-languages': layout.value.type.languagesNarrow } : {}),
}))

const language = computed(() => languageStep(props.elapsedMs))
const languageStyle = computed(() =>
  frameStyle(motionFrame('scale-in', language.value.sinceAppearMs, props.reducedMotion ?? false)),
)

function cellStyle(cell: LayoutCell) {
  const base = { gridArea: cell.role, '--type-scale': layout.value.typeScale?.[cell.role] ?? 1 }
  if (!ready.value) return base
  return {
    ...base,
    ...frameStyle(motionFrame(cell.motion, props.elapsedMs, props.reducedMotion ?? false)),
  }
}

function cellClass(cell: LayoutCell) {
  return {
    'is-band': cell.role === 'headline' || layout.value.bandRoles?.includes(cell.role),
    'is-band-row': layout.value.bandRoles?.includes(cell.role),
    'is-dark-band': layout.value.darkBand?.includes(cell.role),
    'is-inline': layout.value.inline?.includes(cell.role),
    'is-figma': layout.value.figma === true,
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
// Only the pictogram box itself is measured: it clips its contents, while a rotated glyph or an
// SVG clipPath child reports a larger axis-aligned rect than what is drawn.
function overflowingBoxes(cellEl: HTMLElement): HTMLElement[] {
  const bounds = cellEl.getBoundingClientRect()
  const boxes = [...cellEl.querySelectorAll<HTMLElement>('*')].filter(
    (child) => child.classList.contains('pictogram') || !child.closest('.pictogram'),
  )
  return boxes.filter((child) => {
    const r = child.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    const outside =
      r.bottom > bounds.bottom + OVERFLOW_TOLERANCE_PX ||
      r.right > bounds.right + OVERFLOW_TOLERANCE_PX ||
      r.top < bounds.top - OVERFLOW_TOLERANCE_PX ||
      r.left < bounds.left - OVERFLOW_TOLERANCE_PX
    const textTooWide = child.tagName === 'P' && child.scrollWidth > child.clientWidth + OVERFLOW_TOLERANCE_PX
    return outside || textTooWide || exceedsMaxLines(child)
  })
}

function exceedsMaxLines(el: HTMLElement): boolean {
  const maxLines = Number(el.dataset.maxLines)
  if (!maxLines) return false
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
  return el.getBoundingClientRect().height > maxLines * lineHeight + OVERFLOW_TOLERANCE_PX
}

// The headline and fixed labels are written by code in ja; Writer languages carry data-lang.
function overflowLang(cellEl: HTMLElement, box: HTMLElement): string | undefined {
  if (box.classList.contains('pictogram')) return OVERFLOW_PICTOGRAM
  if (box.tagName !== 'P') return undefined
  if (cellEl.dataset.role === 'headline') return 'ja'
  return box.closest<HTMLElement>('[data-lang]')?.dataset.lang ?? 'ja'
}

function measureOverflow(): { cells: CellOverflow[]; screen: boolean } {
  const el = root.value
  if (!el) return { cells: [], screen: false }
  const cells: CellOverflow[] = []
  for (const cellEl of el.querySelectorAll<HTMLElement>('[data-cell-id]')) {
    const boxes = overflowingBoxes(cellEl)
    if (!boxes.length) continue
    const langs = boxes.map((box) => overflowLang(cellEl, box)).filter((lang) => lang !== undefined)
    cells.push({ cellId: cellEl.dataset.cellId!, langs })
  }
  return { cells, screen: el.scrollHeight > el.clientHeight + OVERFLOW_TOLERANCE_PX }
}

let fitGeneration = 0

// A name that needs more than one line, or runs past its row (a segment that must not break inside).
function shelterNameWraps(): boolean {
  const name = root.value?.querySelector<HTMLElement>('.shelter-name-text')
  if (!name) return false
  const twoLines = name.getBoundingClientRect().height > parseFloat(getComputedStyle(name).lineHeight) + OVERFLOW_TOLERANCE_PX
  return twoLines || name.scrollWidth > name.clientWidth + OVERFLOW_TOLERANCE_PX
}

async function fit() {
  const generation = ++fitGeneration
  ready.value = false
  overflowDropped.value = []
  headlineScale.value = 1
  shelterNarrow.value = false
  distanceBelow.value = false
  languagesNarrow.value = false
  await loadFonts()
  for (;;) {
    await nextTick()
    await pictogramsSettled()
    await nextTick()
    if (generation !== fitGeneration) return
    // Artboard rules for a long facility name: 90 → 72, then the distance moves under the name.
    if (layout.value.figma && !shelterNarrow.value && shelterNameWraps()) {
      shelterNarrow.value = true
      continue
    }
    if (layout.value.figma && !distanceBelow.value && shelterNameWraps()) {
      distanceBelow.value = true
      continue
    }
    const over = measureOverflow()
    if (!over.cells.length && !over.screen) {
      overflow.value = ''
      break
    }
    const headlineOver = over.cells.some((cell) => placed.value.find((c) => c.id === cell.cellId)?.role === 'headline')
    if (headlineOver && headlineLimited.value && headlineScale.value === 1) {
      headlineScale.value = HEADLINE_STEP_DOWN
      continue
    }
    if (layout.value.figma && !languagesNarrow.value) {
      languagesNarrow.value = true
      continue
    }
    const victim = nextOverflowVictim(placed.value, layout.value)
    if (!victim) {
      overflow.value = overflowAttr(over.cells, over.screen)
      break
    }
    overflowDropped.value = [...overflowDropped.value, { id: victim.id, reason: 'overflow' }]
  }
  ready.value = true
  emit('ready')
}

function updateScale() {
  scale.value = props.box?.scale ?? designScale(window.innerWidth, window.innerHeight, props.shape)
}

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
    :data-overflow="overflow || undefined"
    :data-headline-scale="headlineScale !== 1 ? headlineScale : undefined"
    :data-shelter-scale="shelterNarrow ? 'narrow' : undefined"
    :data-distance="distanceBelow ? 'below' : undefined"
    :data-languages-scale="languagesNarrow ? 'narrow' : undefined"
    :data-ready="ready ? '1' : '0'"
    :data-bulletin-id="screen.alert.bulletin_id"
  >
    <div v-if="layout.hero && heroCell?.pictogram" class="hero-pictogram" :style="{ gridArea: 'hero' }">
      <PictogramMark :id="heroCell.pictogram" :size-px="layout.hero.px" />
    </div>
    <section
      v-for="cell in placed"
      :key="cell.id"
      class="cell"
      :class="cellClass(cell)"
      :style="cellStyle(cell)"
      :data-cell-id="cell.id"
      :data-role="cell.role"
      :data-priority="cell.priority"
      :data-motion="cell.motion"
    >
      <ScreenCell
        :cell="cell"
        :level-label="levelLabel"
        :stacked-headline="stackedHeadline"
        :headline-limited="headlineLimited"
        :easy-in-action="easyInAction"
        :headline-scale="headlineScale"
        :pictogram-px="layout.pictogramPx[cell.role] ?? 0"
        :figma-rules="layout.figma === true"
        :distance-below="distanceBelow"
        :language-index="language.index"
        :language-style="languageStyle"
      />
    </section>
    <EvacSources v-if="!hideSources" :screen="screen" />
  </main>
</template>

<style scoped>
.hero-pictogram {
  display: grid;
  place-items: center;
}
</style>
