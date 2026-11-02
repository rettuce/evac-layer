<script setup lang="ts">
import type { LevelScale } from '~~/layout/levelScale'

const props = defineProps<{ scale: LevelScale; languageIndex: number }>()
const showEnglish = computed(() => props.languageIndex % 2 === 1)
</script>

<template>
  <div
    class="level-scale"
    :class="`kind-${scale.kind}`"
    role="img"
    :aria-label="`${scale.currentName.ja} / ${scale.currentName.en}`"
    :data-level-scale="`${scale.steps.length}:${scale.current}`"
  >
    <p class="scale-title">
      <span :class="{ 'is-shown': !showEnglish }" lang="ja">{{ scale.title.ja }}</span>
      <span :class="{ 'is-shown': showEnglish }" lang="en">{{ scale.title.en }}</span>
    </p>
    <ol class="scale-steps">
      <li
        v-for="(step, i) in scale.steps"
        :key="step.label"
        class="scale-step"
        :class="{ 'is-current': i + 1 === scale.current }"
        :style="{ '--step': step.color, '--step-ink': step.ink }"
      >
        {{ step.label }}
      </li>
    </ol>
  </div>
</template>

<style scoped>
.level-scale {
  display: flex;
  align-items: center;
  gap: calc(16 * var(--px));
}
.scale-title {
  display: grid;
  margin: 0;
  font-size: calc(var(--fs-fine) * var(--px));
  line-height: 1.2;
  font-weight: 700;
  white-space: nowrap;
}
.scale-title > span {
  grid-area: 1 / 1;
  text-align: right;
}
.scale-title > span:not(.is-shown) {
  visibility: hidden;
}
.scale-steps {
  display: flex;
  align-items: center;
  gap: calc(8 * var(--px));
  margin: 0;
  padding: calc(8 * var(--px));
  list-style: none;
  background: rgb(255 255 255);
}
.scale-step {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-width: calc(56 * var(--px));
  height: calc(56 * var(--px));
  padding: 0 calc(12 * var(--px));
  border: calc(2 * var(--px)) solid rgb(0 0 0 / 0.2);
  background: color-mix(in srgb, var(--step) 30%, rgb(255 255 255));
  color: rgb(0 0 0 / 0.55);
  font-size: calc(var(--fs-fine) * var(--px));
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}
.scale-step.is-current {
  min-width: calc(88 * var(--px));
  height: calc(88 * var(--px));
  border-color: rgb(0 0 0);
  background: var(--step);
  color: var(--step-ink);
  font-size: calc(var(--fs-guide) * var(--px));
}
.kind-tsunami .scale-step.is-current {
  font-size: calc(40 * var(--px));
}
</style>
