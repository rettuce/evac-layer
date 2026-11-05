<script setup lang="ts">
import { CABINET_OFFICE_5, rgbCss } from '~~/layout/palette'
import { SHAPES } from '~~/layout/shapes'
import { sourceLines } from '~~/layout/sources'
import type { AlertLevel, EvacScreen, Shape } from '~~/layout/types'

interface CatalogEntry {
  issued_at: string
  bulletin_id: string
  raw_title: string
  screen: boolean
  template?: string
  display_level?: AlertLevel
  reason?: string
  approved: boolean
  stale?: boolean
  report?: { outcome: string; verifier: string; attempts: number; findings: unknown[]; screens_ok: Record<string, boolean> }
}
interface Catalog {
  municipalities: { id: string; name: string; writer_note?: string; entries: CatalogEntry[] }[]
  sites: { id: string; municipality_id: string; lat: number; lng: number; note?: string; auto_publish: boolean }[]
  approvals_file: string
}

const PREVIEW_SHAPES: Shape[] = ['16x9', '32x9', '9x16', '1x1']
const PREVIEW_HEIGHT_PX: Record<Shape, number> = { '16x9': 200, '32x9': 108, '9x16': 260, '1x1': 200, pillar: 300 }
const PREVIEW_AT_MS = 1000
const CLOCK_TICK_MS = 1000

const TOKEN_STORAGE_KEY = 'evac-admin-token'

const adminToken = ref('')
const tokenDraft = ref('')
const needsToken = ref(false)

function adminHeaders(): Record<string, string> {
  return adminToken.value ? { authorization: `Bearer ${adminToken.value}` } : {}
}

function readStoredToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberTokenForThisTab(token: string): boolean {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    return true
  } catch {
    return false
  }
}

function submitToken() {
  adminToken.value = tokenDraft.value.trim()
  rememberTokenForThisTab(adminToken.value)
  load()
}

const catalog = shallowRef<Catalog>()
const loadError = ref<string>()
const selected = ref<{ municipality: string; bulletin: string }>()
const municipalityId = ref<string>()

const visibleMunicipalities = computed(() =>
  (catalog.value?.municipalities ?? []).filter((m) => m.id === municipalityId.value),
)
const currentMunicipality = computed(() => visibleMunicipalities.value[0])

const screenEntries = computed(() => (catalog.value?.municipalities ?? []).flatMap((m) => m.entries.filter((e) => e.screen)))
const approvedCount = computed(() => screenEntries.value.filter((e) => e.approved).length)
const autoPublishCount = computed(() => (catalog.value?.sites ?? []).filter((s) => s.auto_publish).length)

function selectMunicipality(id: string) {
  municipalityId.value = id
  const first = catalog.value?.municipalities.find((m) => m.id === id)?.entries.find((e) => e.screen)
  selected.value = first ? { municipality: id, bulletin: first.bulletin_id } : undefined
}
const saving = ref<string>()

async function load() {
  try {
    catalog.value = await $fetch<Catalog>('/api/admin/catalog', { headers: adminHeaders() })
    needsToken.value = false
    loadError.value = undefined
    const firstMunicipality = catalog.value.municipalities[0]
    if (!municipalityId.value && firstMunicipality) selectMunicipality(firstMunicipality.id)
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    needsToken.value = status === 401
    loadError.value = needsToken.value ? undefined : (error as Error).message
  }
}

const current = computed(() => {
  const m = catalog.value?.municipalities.find((x) => x.id === selected.value?.municipality)
  return m?.entries.find((e) => e.bulletin_id === selected.value?.bulletin)
})

const sources = ref<string[]>([])
watch(
  selected,
  async (pick) => {
    sources.value = []
    if (!pick) return
    const layout = await $fetch<EvacScreen>('/api/admin/preview-layout', { headers: adminHeaders(), query: { municipality: pick.municipality, bulletin: pick.bulletin, shape: '16x9' } }).catch(() => undefined)
    if (layout && selected.value === pick) sources.value = sourceLines(layout)
  },
  { immediate: true },
)

function previewSrc(shape: Shape) {
  if (!selected.value) return ''
  const layout = `/api/admin/preview-layout?municipality=${selected.value.municipality}&bulletin=${selected.value.bulletin}&shape=${shape}`
  return `/screen?shape=${shape}&src=${encodeURIComponent(layout)}&clock=virtual&t=${PREVIEW_AT_MS}`
}

function previewStyle(shape: Shape) {
  const { width, height } = SHAPES[shape]
  const scale = PREVIEW_HEIGHT_PX[shape] / height
  return { frame: { width: `${width}px`, height: `${height}px`, transform: `scale(${scale})` }, box: { width: `${width * scale}px`, height: `${height * scale}px` } }
}

type Tone = 'ok' | 'warn' | 'err' | 'orange' | 'off'

function entryState(entry: CatalogEntry): { label: string; tone: Tone } {
  if (!entry.screen) return { label: '画面なし', tone: 'off' }
  if (entry.stale) return { label: '要再承認', tone: 'warn' }
  if (entry.approved) return { label: '承認済み', tone: 'orange' }
  return entry.report?.outcome === 'pass' ? { label: '検査 OK', tone: 'ok' } : { label: '要確認', tone: 'err' }
}

function verifierLabel(verifier: string | undefined) {
  return verifier?.replace(/\s*\((https?:\/\/[^)]*)\)/g, '')
}

function hhmm(iso: string) {
  return iso.slice(5, 16).replace('T', ' ')
}

const approveBlockedReason = computed(() => {
  if (!current.value) return undefined
  if (saving.value === current.value.bulletin_id) return '保存中'
  if (current.value.report?.outcome !== 'pass') return '検査が pass でないため承認できません'
  return undefined
})

async function setApproved(entry: CatalogEntry, approved: boolean) {
  if (!selected.value) return
  saving.value = entry.bulletin_id
  await $fetch('/api/admin/approve', { method: 'POST', headers: adminHeaders(), body: { municipality: selected.value.municipality, bulletin_id: entry.bulletin_id, approved } })
  await load()
  saving.value = undefined
}

async function setAutoPublish(siteId: string, autoPublish: boolean) {
  saving.value = siteId
  await $fetch('/api/admin/site', { method: 'POST', headers: adminHeaders(), body: { site_id: siteId, auto_publish: autoPublish } })
  await load()
  saving.value = undefined
}

function scrollToSites() {
  document.getElementById('sites')?.scrollIntoView({ block: 'start' })
}

const clock = ref('')
let clockTimer: ReturnType<typeof setInterval> | undefined

function tickClock() {
  clock.value = new Date().toTimeString().slice(0, 8)
}

onMounted(() => {
  adminToken.value = readStoredToken()
  load()
  tickClock()
  clockTimer = setInterval(tickClock, CLOCK_TICK_MS)
})

onUnmounted(() => clearInterval(clockTimer))
</script>

<template>
  <div class="admin" :data-ready="catalog ? '1' : '0'">
    <header class="bar">
      <h1>EVAC LAYER 管理</h1>
      <template v-if="catalog">
        <span class="status"><span class="dot" :class="approvedCount ? 'is-orange' : 'is-off'" />承認済み <span class="mono">{{ approvedCount }} / {{ screenEntries.length }}</span></span>
        <span class="status"><span class="dot" :class="autoPublishCount ? 'is-ok' : 'is-off'" />自動配信 ON <span class="mono">{{ autoPublishCount }} / {{ catalog.sites.length }}</span></span>
        <span class="status mono">{{ catalog.approvals_file }}</span>
      </template>
      <span class="clock mono">{{ clock }}</span>
    </header>

    <nav class="side" aria-label="管理">
      <a class="nav-item is-current" href="#" aria-current="page" @click.prevent>承認</a>
      <a class="nav-item" href="#sites" @click.prevent="scrollToSites">施設</a>
      <NuxtLink class="nav-item" to="/dashboard">ダッシュボード</NuxtLink>
    </nav>

    <div class="workspace">
      <p v-if="loadError" class="error" data-error="catalog">{{ loadError }}</p>
      <form v-if="needsToken" class="token" data-auth="required" @submit.prevent="submitToken">
        <label for="admin-token">管理トークン</label>
        <input id="admin-token" v-model="tokenDraft" type="password" autocomplete="off" required>
        <button type="submit" class="secondary">開く</button>
      </form>

      <template v-if="catalog">
        <div class="page-head">
          <div>
            <h2 class="page-title">承認</h2>
            <p v-if="currentMunicipality" class="meta">
              {{ currentMunicipality.name }} <span class="mono">{{ currentMunicipality.id }}</span>・画面 {{ currentMunicipality.entries.filter((e) => e.screen).length }} / 電文 {{ currentMunicipality.entries.length }}
            </p>
          </div>
          <label class="picker">
            <span class="meta">自治体</span>
            <select :value="municipalityId" data-control="municipality" @change="selectMunicipality(($event.target as HTMLSelectElement).value)">
              <option v-for="m in catalog.municipalities" :key="m.id" :value="m.id">{{ m.name }}（{{ m.id }}・{{ m.entries.filter((e) => e.screen).length }} 画面）</option>
            </select>
          </label>
        </div>

        <div class="cards">
          <nav class="list card" aria-label="電文">
            <section v-for="m in visibleMunicipalities" :key="m.id">
              <p v-if="m.writer_note" class="note meta">{{ m.writer_note }}</p>
              <ol>
                <li v-for="e in m.entries" :key="e.bulletin_id">
                  <button
                    type="button"
                    class="entry"
                    :class="{ 'is-selected': selected?.bulletin === e.bulletin_id }"
                    :disabled="!e.screen"
                    :data-bulletin="e.bulletin_id"
                    @click="selected = { municipality: m.id, bulletin: e.bulletin_id }"
                  >
                    <span class="swatch" :style="{ background: e.display_level ? rgbCss(CABINET_OFFICE_5[e.display_level]) : 'transparent' }" />
                    <span class="when mono">{{ hhmm(e.issued_at) }}</span>
                    <span class="title">{{ e.raw_title }}</span>
                    <span class="state" :class="`is-${entryState(e).tone}`" :data-stale="e.stale ? '1' : undefined">
                      <span v-if="entryState(e).tone !== 'off'" class="dot" :class="`is-${entryState(e).tone}`" />{{ entryState(e).label }}
                    </span>
                  </button>
                </li>
              </ol>
            </section>
          </nav>

          <main class="previews card" aria-label="プレビュー">
            <figure v-for="shape in PREVIEW_SHAPES" :key="`${selected?.bulletin}-${shape}`" :style="previewStyle(shape).box">
              <iframe :src="previewSrc(shape)" :style="previewStyle(shape).frame" :title="`${shape} preview`" tabindex="-1" />
              <figcaption class="meta mono">{{ shape }}</figcaption>
            </figure>
          </main>

          <aside v-if="current" class="report card" aria-label="検査">
            <h2 class="card-title">{{ current.raw_title }}</h2>
            <dl>
              <dt>テンプレート</dt><dd>{{ current.template }} / 表示レベル {{ current.display_level }}</dd>
              <dt>Verifier</dt>
              <dd :data-outcome="current.report?.outcome">
                <span class="dot" :class="current.report?.outcome === 'pass' ? 'is-ok' : 'is-err'" />{{ current.report?.outcome ?? 'レポートなし' }}
                <span class="meta">（{{ verifierLabel(current.report?.verifier) }}・試行 <span class="mono">{{ current.report?.attempts }}</span>）</span>
              </dd>
              <dt>形状</dt>
              <dd>
                <span v-for="(ok, shape) in current.report?.screens_ok" :key="shape" class="chip" :class="ok ? 'ok' : 'ng'"><span v-if="ok" class="dot is-ok" />{{ shape }} {{ ok ? 'OK' : 'NG' }}</span>
              </dd>
              <dt>指摘</dt><dd>{{ current.report?.findings.length ? `${current.report.findings.length} 件` : 'なし' }}</dd>
              <dt>承認</dt>
              <dd :data-approval="current.stale ? 'stale' : current.approved ? 'approved' : 'none'">
                <template v-if="current.stale"><span class="dot is-warn" />内容が変わりました・再承認が必要</template>
                <template v-else-if="current.approved"><span class="dot is-orange" />承認済み・配信対象</template>
                <span v-else class="fg-2">未承認</span>
              </dd>
              <dt>出典</dt>
              <dd>
                <ul v-if="sources.length" class="sources" data-sources>
                  <li v-for="line in sources" :key="line">{{ line }}</li>
                </ul>
                <span v-else class="fg-2">画面なし</span>
              </dd>
            </dl>
            <button
              type="button"
              class="approve"
              :class="{ 'is-on': current.approved }"
              :disabled="saving === current.bulletin_id || current.report?.outcome !== 'pass'"
              :aria-pressed="current.approved"
              data-action="approve"
              @click="setApproved(current, !current.approved)"
            >
              {{ current.approved ? '承認済み（取り消す）' : current.stale ? '変更後の一式を再承認' : 'この一式を承認' }}
            </button>
            <p v-if="approveBlockedReason" class="meta fg-3 blocked">{{ approveBlockedReason }}</p>
          </aside>
        </div>

        <section id="sites" class="sites card" aria-label="施設">
          <h2 class="card-title">施設</h2>
          <table>
            <thead><tr><th>施設</th><th>自治体</th><th>緯度</th><th>経度</th><th>自動配信</th></tr></thead>
            <tbody>
              <tr v-for="s in catalog.sites" :key="s.id">
                <td><span class="mono">{{ s.id }}</span><br><span class="meta fg-2">{{ s.note }}</span></td>
                <td class="mono">{{ s.municipality_id }}</td>
                <td class="mono">{{ s.lat.toFixed(5) }}</td>
                <td class="mono">{{ s.lng.toFixed(5) }}</td>
                <td>
                  <label class="toggle">
                    <span class="switch" :class="{ 'is-on': s.auto_publish }">
                      <input
                        type="checkbox"
                        :checked="s.auto_publish"
                        :disabled="saving === s.id"
                        :data-site="s.id"
                        @change="setAutoPublish(s.id, ($event.target as HTMLInputElement).checked)"
                      >
                      <span class="track" />
                    </span>
                    <span class="meta">{{ s.auto_publish ? 'ON' : 'OFF' }}</span>
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.admin {
  --ev-bg: #0c0d0f;
  --ev-panel: #111316;
  --ev-panel-2: #171a1e;
  --ev-line: #23272d;
  --ev-fg: #e8e9eb;
  --ev-fg-2: #a6abb3;
  --ev-fg-3: #868c95;
  --ev-orange: #f5821f;
  --ev-ok: #3ecf8e;
  --ev-warn: #f2c94c;
  --ev-err: #ff5d5d;
  --ev-sans: 'Noto Sans JP', 'Hiragino Sans', system-ui, sans-serif;
  --ev-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  position: fixed;
  inset: 0;
  display: grid;
  grid-template-columns: 176px minmax(0, 1fr);
  grid-template-rows: 40px minmax(0, 1fr);
  grid-template-areas: 'bar bar' 'side workspace';
  background: var(--ev-bg);
  color: var(--ev-fg);
  color-scheme: dark;
  font: 400 13px/20px var(--ev-sans);
}
h1, h2, p, dl, dd, ol, ul, figure { margin: 0; }
.mono { font-family: var(--ev-mono); font-variant-numeric: tabular-nums; }
.meta { font-size: 11px; line-height: 16px; font-weight: 500; color: var(--ev-fg-2); }
.fg-2 { color: var(--ev-fg-2); }
.fg-3 { color: var(--ev-fg-3); }

.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 8px; vertical-align: middle; background: var(--ev-fg-3); }
.dot.is-ok { background: var(--ev-ok); }
.dot.is-warn { background: var(--ev-warn); }
.dot.is-err { background: var(--ev-err); }
.dot.is-orange { background: var(--ev-orange); }
.dot.is-off { background: var(--ev-fg-3); }

.bar {
  grid-area: bar;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 16px;
  background: var(--ev-panel);
  border-bottom: 1px solid var(--ev-line);
}
.bar h1 { font-size: 13px; line-height: 20px; font-weight: 500; }
.status { font-size: 11px; line-height: 16px; font-weight: 500; color: var(--ev-fg-2); white-space: nowrap; }
.clock { margin-left: auto; font-size: 13px; color: var(--ev-fg); }

.side {
  grid-area: side;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 8px;
  background: var(--ev-panel);
  border-right: 1px solid var(--ev-line);
}
.nav-item {
  display: block;
  padding: 6px 12px;
  border-radius: 4px;
  color: var(--ev-fg-2);
  text-decoration: none;
}
.nav-item.is-current { background: var(--ev-panel-2); color: var(--ev-fg); box-shadow: inset 2px 0 0 var(--ev-fg); }

.workspace {
  grid-area: workspace;
  overflow: auto;
  display: grid;
  grid-template-rows: auto minmax(auto, 1fr) auto;
  align-content: start;
  gap: 16px;
  padding: 16px 24px 24px;
}
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.page-title { font-size: 20px; line-height: 28px; font-weight: 600; }
.picker { display: grid; gap: 4px; min-width: 320px; }
.picker select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--ev-line);
  border-radius: 4px;
  background: var(--ev-bg);
  color: var(--ev-fg);
  font: 400 13px/20px var(--ev-sans);
}

.card { background: var(--ev-panel); border: 1px solid var(--ev-line); border-radius: 6px; }
.card-title { font-size: 15px; line-height: 22px; font-weight: 600; }

.cards {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr) 360px;
  gap: 16px;
}
.list { contain: size; overflow: auto; }
.list ol { list-style: none; padding: 0; }
.note { padding: 12px 12px 8px; }
.entry {
  width: 100%;
  display: grid;
  grid-template-columns: 12px 92px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border: 0;
  border-bottom: 1px solid var(--ev-line);
  background: none;
  color: var(--ev-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.entry.is-selected { background: var(--ev-panel-2); box-shadow: inset 2px 0 0 var(--ev-fg); }
.entry:disabled { color: var(--ev-fg-3); cursor: default; }
.swatch { width: 12px; height: 12px; border: 1px solid var(--ev-line); }
.when { color: var(--ev-fg-2); }
.entry:disabled .when { color: var(--ev-fg-3); }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state { font-size: 11px; line-height: 16px; font-weight: 500; white-space: nowrap; color: var(--ev-fg-2); }
.state.is-off { color: var(--ev-fg-3); }

.previews { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 16px; padding: 16px; }
.previews figure { position: relative; margin-bottom: 20px; background: var(--ev-bg); }
.previews iframe { display: block; border: 1px solid var(--ev-line); transform-origin: 0 0; }
.previews figcaption { position: absolute; top: calc(100% + 4px); left: 0; }

.report { display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.report dl { display: grid; grid-template-columns: 88px 1fr; gap: 8px; }
.report dt { color: var(--ev-fg-2); }
.chip {
  display: inline-flex;
  align-items: center;
  margin: 0 4px 4px 0;
  padding: 0 8px;
  border: 1px solid var(--ev-line);
  border-radius: 4px;
  font-size: 11px;
  line-height: 20px;
  font-weight: 500;
}
.chip.ng { border-color: var(--ev-err); color: var(--ev-err); }
.sources { padding-left: 1.2em; font-size: 11px; line-height: 16px; color: var(--ev-fg-2); }
.blocked { margin-top: -8px; }

button { font-family: var(--ev-sans); }
.approve, .secondary {
  height: 40px;
  padding: 0 16px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}
.approve { width: 100%; border: 1px solid var(--ev-orange); background: var(--ev-orange); color: var(--ev-bg); }
.approve.is-on, .secondary { border: 1px solid var(--ev-line); background: var(--ev-panel); color: var(--ev-fg); }
.approve:disabled { border-color: var(--ev-line); background: var(--ev-panel); color: var(--ev-fg-3); cursor: not-allowed; }

.sites { padding: 16px; }
.sites table { width: 100%; margin-top: 8px; border-collapse: collapse; }
.sites th, .sites td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--ev-line); vertical-align: top; }
.sites th { font-size: 11px; line-height: 16px; font-weight: 400; color: var(--ev-fg-2); }
.toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.switch { position: relative; display: inline-block; width: 36px; height: 20px; }
.switch input { position: absolute; inset: -6px; width: calc(100% + 12px); height: calc(100% + 12px); margin: 0; opacity: 0; cursor: pointer; }
.track { position: absolute; inset: 0; border-radius: 4px; background: var(--ev-line); pointer-events: none; }
.track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 4px; background: var(--ev-fg-2); }
.switch.is-on .track { background: var(--ev-fg); }
.switch.is-on .track::after { left: 18px; background: var(--ev-bg); }
.switch:has(input:disabled) .track { background: var(--ev-panel-2); }

.token {
  justify-self: center;
  width: 420px;
  display: grid;
  gap: 8px;
  margin-top: 24px;
  padding: 24px;
  background: var(--ev-panel);
  border: 1px solid var(--ev-line);
  border-radius: 6px;
}
.token label { color: var(--ev-fg-2); }
.token input { height: 32px; padding: 0 8px; border: 1px solid var(--ev-line); border-radius: 4px; background: var(--ev-bg); color: var(--ev-fg); font: inherit; }
.error { padding: 8px 12px; border: 1px solid var(--ev-err); border-radius: 4px; color: var(--ev-err); font-size: 11px; line-height: 16px; font-weight: 500; }

.entry:focus-visible, .approve:focus-visible, .secondary:focus-visible, .nav-item:focus-visible,
.picker select:focus-visible, .token input:focus-visible { outline: 2px solid var(--ev-fg); outline-offset: 2px; }
.switch:has(input:focus-visible) { outline: 2px solid var(--ev-fg); outline-offset: 2px; border-radius: 4px; }

@media (max-width: 1439px) {
  .cards { grid-template-columns: 320px minmax(0, 1fr); }
  .report { grid-column: 1 / -1; }
}
@media (hover: hover) and (pointer: fine) {
  .entry:hover:not(:disabled), .nav-item:hover { background: var(--ev-panel-2); }
  .approve.is-on:hover:not(:disabled), .secondary:hover { background: var(--ev-panel-2); }
}
@media (prefers-reduced-motion: no-preference) {
  .approve:active:not(:disabled), .secondary:active, .entry:active:not(:disabled) { transform: scale(0.98); }
}
</style>
