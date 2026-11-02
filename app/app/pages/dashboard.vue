<script setup lang="ts">
import type { ClockMode } from '~/composables/useScreenClock'

interface DashboardRow {
  id: string
  name: string
  bulletins: number
  screens: number
  layouts: number
  languageVariants: number
  reports: number
  ngAttempts: number
  fixedAfterNg: number
}
interface Dashboard {
  totals: Record<'municipalities' | 'bulletins' | 'screens' | 'layouts' | 'languageVariants' | 'ngAttempts' | 'fixedAfterNg' | 'sources', number>
  rows: DashboardRow[]
}

const COUNT_UP_MS = 2400
const STAGGER_MS = 300

const route = useRoute()
const clockMode = computed<ClockMode>(() => (route.query.clock === 'virtual' ? 'virtual' : 'real'))
const virtualT = computed(() => Number(route.query.t ?? 0) || 0)
const { elapsed, start } = useScreenClock(clockMode, virtualT)

const data = shallowRef<Dashboard>()
const loadError = ref<string>()

const stats = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  return [
    { key: 'municipalities', label: '自治体', value: t.municipalities },
    { key: 'bulletins', label: '気象庁の電文', value: t.bulletins, sub: `うち画面あり ${t.screens}` },
    { key: 'layouts', label: 'レイアウト（形状別）', value: t.layouts },
    { key: 'languageVariants', label: '形状 × 言語', value: t.languageVariants },
    { key: 'ngAttempts', label: 'Verifier の NG', value: t.ngAttempts, sub: `修正して合格 ${t.fixedAfterNg}` },
    { key: 'sources', label: '出典（重複なし）', value: t.sources },
  ]
})

function easeOutCubic(x: number) {
  return 1 - (1 - x) ** 3
}

function shown(value: number, order: number) {
  const progress = Math.min(1, Math.max(0, (elapsed.value - order * STAGGER_MS) / COUNT_UP_MS))
  return Math.round(value * easeOutCubic(progress))
}

onMounted(async () => {
  try {
    data.value = await $fetch<Dashboard>('/api/dashboard')
    start()
  } catch (error) {
    loadError.value = (error as Error).message
  }
})
</script>

<template>
  <div class="dashboard" :data-ready="data ? '1' : '0'" :data-clock="clockMode">
    <h1>EVAC LAYER — 生成と検査の集計</h1>
    <p v-if="loadError" data-error="dashboard">{{ loadError }}</p>
    <section class="stats">
      <article v-for="(stat, i) in stats" :key="stat.key" :data-stat="stat.key">
        <p class="value">{{ shown(stat.value, i) }}</p>
        <p class="label">{{ stat.label }}</p>
        <p v-if="stat.sub" class="sub">{{ stat.sub }}</p>
      </article>
    </section>
    <table v-if="data">
      <thead>
        <tr><th>自治体</th><th>電文</th><th>画面あり</th><th>レイアウト</th><th>形状 × 言語</th><th>検査レポート</th><th>NG</th><th>修正して合格</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in data.rows" :key="row.id">
          <td>{{ row.name }} <span class="muted">{{ row.id }}</span></td>
          <td>{{ row.bulletins }}</td>
          <td>{{ row.screens }}</td>
          <td>{{ row.layouts }}</td>
          <td>{{ row.languageVariants }}</td>
          <td>{{ row.reports }}</td>
          <td>{{ row.ngAttempts }}</td>
          <td>{{ row.fixedAfterNg }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.dashboard {
  position: fixed;
  inset: 0;
  overflow: auto;
  padding: 48px;
  background: #fff;
  color: #111;
  font: 16px/1.5 'Noto Sans JP', 'Noto Sans', sans-serif;
}
h1 {
  font-size: 22px;
  margin: 0 0 40px;
}
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 40px 48px;
  margin-bottom: 56px;
}
.stats p {
  margin: 0;
}
.value {
  font-size: 128px;
  line-height: 1;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.label {
  font-size: 22px;
  margin-top: 8px;
}
.sub,
.muted {
  color: #666;
  font-size: 16px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
th,
td {
  text-align: right;
  padding: 10px 12px;
  border-bottom: 1px solid #ddd;
}
th:first-child,
td:first-child {
  text-align: left;
}
th {
  color: #666;
  font-weight: 400;
}
</style>
