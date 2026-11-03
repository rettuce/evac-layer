<script setup lang="ts">
const props = defineProps<{ id: string; sizePx: number; rotation?: number; alignBottom?: boolean }>()

const SVG_BY_PATH = import.meta.glob<string>('../../public/picto/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
})

const PLACEHOLDER_LABEL_RATIO = 1 / 6
const PLACEHOLDER_LABEL_MIN_PX = 12

const svg = computed(() => SVG_BY_PATH[`../../public/picto/${props.id}.svg`])
const labelPx = computed(() => Math.max(PLACEHOLDER_LABEL_MIN_PX, Math.round(props.sizePx * PLACEHOLDER_LABEL_RATIO)))
const glyph = ref<HTMLElement>()
const ink = ref({ dx: 0, dy: 0 })

// Each symbol sits inside its viewBox with its own margin (and an arrow's changes as it turns), so the
// drawn ink, not the box, is moved onto the cell's left line (and onto its bottom line when asked).
function measureInk() {
  const svgEl = glyph.value?.querySelector('svg')
  if (!svgEl) return
  const vb = svgEl.viewBox.baseVal
  const box = svgEl.getBBox()
  const stroke = svgEl.getAttribute('stroke')
  const half = stroke && stroke !== 'none' ? Number(svgEl.getAttribute('stroke-width') ?? 0) / 2 : 0
  const angle = ((props.rotation ?? 0) * Math.PI) / 180
  const cx = vb.x + vb.width / 2
  const cy = vb.y + vb.height / 2
  const corners = [
    [box.x - half, box.y - half],
    [box.x + box.width + half, box.y - half],
    [box.x - half, box.y + box.height + half],
    [box.x + box.width + half, box.y + box.height + half],
  ].map(([x, y]) => [cx + (x! - cx) * Math.cos(angle) - (y! - cy) * Math.sin(angle), cy + (x! - cx) * Math.sin(angle) + (y! - cy) * Math.cos(angle)])
  const left = Math.min(...corners.map(([x]) => x!))
  const bottom = Math.max(...corners.map(([, y]) => y!))
  ink.value = {
    dx: -Math.max(0, (left - vb.x) / vb.width),
    dy: props.alignBottom ? Math.max(0, (vb.y + vb.height - bottom) / vb.height) : 0,
  }
}

onMounted(measureInk)
watch(() => [props.id, props.rotation, props.alignBottom], () => nextTick(measureInk))
</script>

<template>
  <div
    class="pictogram"
    :data-pictogram="id"
    :data-pictogram-missing="svg ? undefined : '1'"
    :style="{ '--size': sizePx, '--label': labelPx, '--rotation': `${rotation ?? 0}deg`, '--ink-dx': ink.dx, '--ink-dy': ink.dy }"
  >
    <div v-if="svg" ref="glyph" class="glyph" aria-hidden="true" v-html="svg" />
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
.glyph {
  width: 100%;
  height: 100%;
  transform: translate(calc(var(--ink-dx) * 100%), calc(var(--ink-dy) * 100%)) rotate(var(--rotation));
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
