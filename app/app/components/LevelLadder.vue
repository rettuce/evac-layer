<script setup lang="ts">
import { LADDER_CURRENT_GROWTH, type LadderMode } from '~~/layout/ladder'
import type { LevelScale } from '~~/layout/levelScale'

const props = defineProps<{ scale: LevelScale; mode: LadderMode; sizePx: number; languageIndex: number; caption: boolean }>()
const showEnglish = computed(() => props.languageIndex % 2 === 1)
</script>

<template>
  <div
    class="ladder"
    :class="`mode-${mode}`"
    role="img"
    :aria-label="`${scale.currentName.ja} / ${scale.currentName.en}`"
    :style="{ '--ladder': sizePx, '--growth': LADDER_CURRENT_GROWTH }"
    :data-level-scale="`${scale.steps.length}:${scale.current}`"
  >
    <div
      v-for="(step, i) in scale.steps"
      :key="step.label"
      class="rung"
      :class="{ 'is-current': i + 1 === scale.current }"
      :style="{ '--step': step.color, '--step-ink': step.ink }"
    >
      <span class="num">{{ step.label }}</span>
      <span v-if="caption && i + 1 === scale.current" class="caption">
        <span :class="{ 'is-shown': !showEnglish }" lang="ja">{{ scale.title.ja }}</span>
        <span :class="{ 'is-shown': showEnglish }" lang="en">{{ scale.title.en }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.ladder {
  display: flex;
  gap: calc(4 * var(--px));
  background: rgb(255 255 255);
}
.mode-h {
  align-items: flex-end;
  height: 100%;
}
.mode-v {
  flex-direction: column-reverse;
  align-items: flex-start;
  width: 100%;
  height: 100%;
}
.rung {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(16 * var(--px));
  flex: 1 1 0;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--step) 35%, rgb(255 255 255));
  box-shadow: inset 0 0 0 calc(2 * var(--px)) rgb(0 0 0 / 0.1);
  color: rgb(0 0 0 / 0.6);
  font-weight: 400;
  line-height: 1;
}
.mode-h .rung {
  height: 100%;
}
.mode-v .rung {
  flex-direction: column;
  gap: calc(8 * var(--px));
  width: 100%;
}
.num {
  font-size: calc(var(--ladder) * 0.5 * var(--px));
}
.rung.is-current {
  background: var(--step);
  box-shadow: none;
  color: var(--step-ink);
  font-weight: 700;
  border-top: calc(8 * var(--px)) solid var(--step-ink);
}
.mode-h .rung.is-current {
  height: calc(100% * var(--growth));
}
.mode-v .rung.is-current {
  width: calc(100% * var(--growth));
  border-top: none;
  border-right: calc(8 * var(--px)) solid var(--step-ink);
}
.rung.is-current .num {
  font-size: calc(var(--ladder) * 0.7 * var(--px));
}
.caption {
  display: grid;
  font-size: calc(var(--fs-fine) * 1.4 * var(--px));
  white-space: nowrap;
}
.mode-v .caption {
  font-size: calc(var(--fs-fine) * var(--px));
}
.caption > span {
  grid-area: 1 / 1;
}
.caption > span:not(.is-shown) {
  visibility: hidden;
}
</style>
