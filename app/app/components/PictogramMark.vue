<script setup lang="ts">
import { pictogramInk } from '~/composables/usePictogramInk'
const props = defineProps<{ id: string; sizePx: number; rotation?: number; fitInk?: boolean }>()

const SVG_BY_PATH = import.meta.glob<string>('../../public/picto/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const PLACEHOLDER_LABEL_RATIO = 1 / 6
const PLACEHOLDER_LABEL_MIN_PX = 12

const source = computed(() => SVG_BY_PATH[`../../public/picto/${props.id}.svg`])
// With fitInk the rotation is written into the SVG so the same markup is drawn on screen and rasterised for
// its ink bounds; otherwise the glyph turns with CSS, as it always did.
const svg = computed(() => {
  const markup = source.value
  if (!markup || !props.rotation || !props.fitInk) return markup
  const vb = /viewBox="([^"]+)"/.exec(markup)?.[1]?.split(/\s+/).map(Number)
  if (!vb || vb.length !== 4) return markup
  const cx = vb[0]! + vb[2]! / 2
  const cy = vb[1]! + vb[3]! / 2
  return markup.replace(/^(<svg[^>]*>)/, `$1<g transform="rotate(${props.rotation} ${cx} ${cy})">`).replace(/<\/svg>\s*$/, '</g></svg>')
})
const labelPx = computed(() => Math.max(PLACEHOLDER_LABEL_MIN_PX, Math.round(props.sizePx * PLACEHOLDER_LABEL_RATIO)))
const glyph = ref<HTMLElement>()
const ink = ref({ dx: 0, dy: 0, scale: 1, w: 1, h: 1 })

// With fitInk the box *is* the ink: sizePx is the ink's longer side, the box has the ink's proportions and the ink
// starts at the box's top-left.
async function measureInk() {
  const svgEl = glyph.value?.querySelector('svg')
  const markup = svg.value
  if (!props.fitInk || !svgEl || !markup) return
  const vb = svgEl.viewBox.baseVal
  const bounds = await pictogramInk(`${props.id}:${props.rotation ?? 0}`, markup)
  if (!bounds) return
  const { left, top, right, bottom } = bounds
  const longer = Math.max(right - left, bottom - top)
  ink.value = { dx: -(left - vb.x) / vb.width, dy: -(top - vb.y) / vb.height, scale: vb.width / longer, w: (right - left) / longer, h: (bottom - top) / longer }
}

onMounted(measureInk)
watch(() => [props.id, props.rotation, props.fitInk], () => nextTick(measureInk))
</script>

<template>
  <div
    class="pictogram"
    :data-pictogram="id"
    :data-pictogram-missing="svg ? undefined : '1'"
    :class="{ 'is-ink': fitInk }"
    :style="{ '--size': sizePx, '--label': labelPx, '--rotation': `${rotation ?? 0}deg`, '--ink-dx': ink.dx, '--ink-dy': ink.dy, '--ink-scale': ink.scale, '--ink-w': ink.w, '--ink-h': ink.h }"
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
  width: calc(var(--size) * var(--ink-w) * var(--px));
  height: calc(var(--size) * var(--ink-h) * var(--px));
  overflow: visible;
}
.pictogram.is-ink .ink {
  width: calc(var(--size) * var(--px));
  height: calc(var(--size) * var(--px));
  transform-origin: 0 0;
  transform: scale(var(--ink-scale)) translate(calc(var(--ink-dx) * 100%), calc(var(--ink-dy) * 100%));
}
.glyph {
  width: 100%;
  height: 100%;
  transform: rotate(var(--rotation));
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
