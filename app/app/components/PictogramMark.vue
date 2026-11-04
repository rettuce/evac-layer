<script setup lang="ts">
import { pictogramInk } from '~/composables/usePictogramInk'
const props = defineProps<{ id: string; sizePx: number; rotation?: number; alignBottom?: boolean; fitInk?: boolean }>()

const SVG_BY_PATH = import.meta.glob<string>('../../public/picto/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const PLACEHOLDER_LABEL_RATIO = 1 / 6
const PLACEHOLDER_LABEL_MIN_PX = 12

const source = computed(() => SVG_BY_PATH[`../../public/picto/${props.id}.svg`])
// The rotation is written into the SVG so the same markup is drawn on screen and rasterised for its ink bounds.
const svg = computed(() => {
  const markup = source.value
  if (!markup || !props.rotation) return markup
  const vb = /viewBox="([^"]+)"/.exec(markup)?.[1]?.split(/\s+/).map(Number)
  if (!vb || vb.length !== 4) return markup
  const cx = vb[0]! + vb[2]! / 2
  const cy = vb[1]! + vb[3]! / 2
  return markup.replace(/^(<svg[^>]*>)/, `$1<g transform="rotate(${props.rotation} ${cx} ${cy})">`).replace(/<\/svg>\s*$/, '</g></svg>')
})
const labelPx = computed(() => Math.max(PLACEHOLDER_LABEL_MIN_PX, Math.round(props.sizePx * PLACEHOLDER_LABEL_RATIO)))
const glyph = ref<HTMLElement>()
const ink = ref({ dx: 0, dy: 0, scale: 1 })

// Each symbol sits inside its viewBox with its own margin (and an arrow's changes as it turns), so the
// drawn ink, not the box, is moved onto the cell's left line (and onto its bottom line when asked).
// With fitInk the box *is* the ink: sizePx is the ink's longer side and the ink starts at the box's top-left.
async function measureInk() {
  const svgEl = glyph.value?.querySelector('svg')
  const markup = svg.value
  if (!svgEl || !markup) return
  const vb = svgEl.viewBox.baseVal
  const bounds = await pictogramInk(`${props.id}:${props.rotation ?? 0}`, markup)
  if (!bounds) return
  const { left, top, right, bottom } = bounds
  if (props.fitInk) {
    ink.value = { dx: -(left - vb.x) / vb.width, dy: -(top - vb.y) / vb.height, scale: vb.width / Math.max(right - left, bottom - top) }
    return
  }
  ink.value = {
    dx: -Math.max(0, (left - vb.x) / vb.width),
    dy: props.alignBottom ? Math.max(0, (vb.y + vb.height - bottom) / vb.height) : 0,
    scale: 1,
  }
}

onMounted(measureInk)
watch(() => [props.id, props.rotation, props.alignBottom, props.fitInk], () => nextTick(measureInk))
</script>

<template>
  <div
    class="pictogram"
    :data-pictogram="id"
    :data-pictogram-missing="svg ? undefined : '1'"
    :class="{ 'is-ink': fitInk }"
    :style="{ '--size': sizePx, '--label': labelPx, '--ink-dx': ink.dx, '--ink-dy': ink.dy, '--ink-scale': ink.scale }"
  >
    <div v-if="svg" class="ink" aria-hidden="true"><div ref="glyph" class="glyph" v-html="svg" /></div>
    <span v-else class="placeholder">{{ id }}</span>
  </div>
</template>

<style scoped>
.pictogram {
  flex: none;
  width: calc(var(--size) * var(--px));
  height: calc(var(--size) * var(--px));
  display: grid;
  place-items: center;
  overflow: hidden;
}
.ink {
  width: 100%;
  height: 100%;
}
.pictogram.is-ink {
  overflow: visible;
}
.pictogram.is-ink .ink {
  transform-origin: 0 0;
  transform: scale(var(--ink-scale)) translate(calc(var(--ink-dx) * 100%), calc(var(--ink-dy) * 100%));
}
.glyph {
  width: 100%;
  height: 100%;
  transform: translate(calc(var(--ink-dx) * 100%), calc(var(--ink-dy) * 100%));
}
.pictogram.is-ink .glyph {
  transform: none;
}
.glyph :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}
.placeholder {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: calc(4 * var(--px));
  border: calc(4 * var(--px)) solid currentColor;
  font-size: calc(var(--label) * var(--px));
  line-height: 1.2;
  font-weight: 400;
  text-align: center;
  word-break: break-all;
}
</style>
