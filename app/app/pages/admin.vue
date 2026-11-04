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
const PREVIEW_HEIGHT_PX: Record<Shape, number> = { '16x9': 216, '32x9': 108, '9x16': 300, '1x1': 216, pillar: 300 }
const PREVIEW_AT_MS = 1000

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

function entryState(entry: CatalogEntry) {
  if (!entry.screen) return '画面なし'
  if (entry.stale) return '要再承認'
  if (entry.approved) return '承認済み'
  return entry.report?.outcome === 'pass' ? '検査 OK' : '要確認'
}

function hhmm(iso: string) {
  return iso.slice(5, 16).replace('T', ' ')
}

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

onMounted(() => {
  adminToken.value = readStoredToken()
  load()
})
</script>

<template>
  <div class="admin" :data-ready="catalog ? '1' : '0'">
    <header class="bar">
      <h1>EVAC LAYER 管理</h1>
      <p v-if="catalog">承認は {{ catalog.approvals_file }} に記録</p>
    </header>
    <p v-if="loadError" class="error" data-error="catalog">{{ loadError }}</p>
    <form v-if="needsToken" class="token" data-auth="required" @submit.prevent="submitToken">
      <label for="admin-token">管理トークン</label>
      <input id="admin-token" v-model="tokenDraft" type="password" autocomplete="off" required>
      <button type="submit">開く</button>
    </form>

    <template v-if="catalog">
      <nav class="list" aria-label="電文">
        <label class="picker">
          <span>自治体</span>
          <select :value="municipalityId" data-control="municipality" @change="selectMunicipality(($event.target as HTMLSelectElement).value)">
            <option v-for="m in catalog.municipalities" :key="m.id" :value="m.id">{{ m.name }}（{{ m.id }}・{{ m.entries.filter((e) => e.screen).length }} 画面）</option>
          </select>
        </label>
        <section v-for="m in visibleMunicipalities" :key="m.id">
          <h2>{{ m.name }} <span class="muted">{{ m.id }}</span></h2>
          <p v-if="m.writer_note" class="note">{{ m.writer_note }}</p>
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
                <span class="when">{{ hhmm(e.issued_at) }}</span>
                <span class="title">{{ e.raw_title }}</span>
                <span class="state" :class="{ 'is-stale': e.stale }" :data-stale="e.stale ? '1' : undefined">{{ entryState(e) }}</span>
              </button>
            </li>
          </ol>
        </section>
      </nav>

      <main class="previews" aria-label="プレビュー">
        <figure v-for="shape in PREVIEW_SHAPES" :key="`${selected?.bulletin}-${shape}`" :style="previewStyle(shape).box">
          <iframe :src="previewSrc(shape)" :style="previewStyle(shape).frame" :title="`${shape} preview`" tabindex="-1" />
          <figcaption>{{ shape }}</figcaption>
        </figure>
      </main>

      <aside v-if="current" class="report" aria-label="検査">
        <h2>{{ current.raw_title }}</h2>
        <dl>
          <dt>テンプレート</dt><dd>{{ current.template }} / 表示レベル {{ current.display_level }}</dd>
          <dt>Verifier</dt><dd :data-outcome="current.report?.outcome">{{ current.report?.outcome ?? 'レポートなし' }}（{{ current.report?.verifier }}・試行 {{ current.report?.attempts }}）</dd>
          <dt>形状</dt>
          <dd>
            <span v-for="(ok, shape) in current.report?.screens_ok" :key="shape" class="chip" :class="ok ? 'ok' : 'ng'">{{ shape }} {{ ok ? 'OK' : 'NG' }}</span>
          </dd>
          <dt>指摘</dt><dd>{{ current.report?.findings.length ? `${current.report.findings.length} 件` : 'なし' }}</dd>
          <dt>承認</dt>
          <dd :data-approval="current.stale ? 'stale' : current.approved ? 'approved' : 'none'">
            <span v-if="current.stale" class="chip ng">内容が変わりました・再承認が必要</span>
            <template v-else>{{ current.approved ? '承認済み' : '未承認' }}</template>
          </dd>
          <dt>出典</dt>
          <dd>
            <ul v-if="sources.length" class="sources" data-sources>
              <li v-for="line in sources" :key="line">{{ line }}</li>
            </ul>
            <span v-else class="muted">画面なし</span>
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
      </aside>

      <section class="sites" aria-label="施設">
        <h2>施設</h2>
        <table>
          <thead><tr><th>施設</th><th>自治体</th><th>緯度</th><th>経度</th><th>自動配信</th></tr></thead>
          <tbody>
            <tr v-for="s in catalog.sites" :key="s.id">
              <td>{{ s.id }}<br><span class="muted">{{ s.note }}</span></td>
              <td>{{ s.municipality_id }}</td>
              <td>{{ s.lat.toFixed(5) }}</td>
              <td>{{ s.lng.toFixed(5) }}</td>
              <td>
                <label class="toggle">
                  <input
                    type="checkbox"
                    :checked="s.auto_publish"
                    :disabled="saving === s.id"
                    :data-site="s.id"
                    @change="setAutoPublish(s.id, ($event.target as HTMLInputElement).checked)"
                  >
                  <span>{{ s.auto_publish ? 'ON' : 'OFF' }}</span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin {
  --ink: #111;
  --muted: #666;
  --line: #ddd;
  --accent: #111;
  position: fixed;
  inset: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr) 360px;
  grid-template-rows: auto auto auto;
  align-content: start;
  grid-template-areas: 'bar bar bar' 'list previews report' 'sites sites sites';
  gap: 0 24px;
  padding: 0 24px 24px;
  background: #fff;
  color: var(--ink);
  font: 14px/1.5 'Noto Sans JP', 'Noto Sans', sans-serif;
}
h1 { font-size: 18px; margin: 0; }
h2 { font-size: 15px; margin: 16px 0 8px; }
.bar { grid-area: bar; display: flex; align-items: baseline; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.bar p, .muted, .note { color: var(--muted); margin: 0; font-size: 12px; }
.error { color: #c00; }
.token { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; padding: 24px 0; }
.token input { padding: 6px 8px; border: 1px solid var(--line); font: inherit; }
.token input:focus-visible { outline: 2px solid var(--accent); }
.token button { padding: 6px 16px; border: 2px solid var(--accent); background: #fff; font: inherit; cursor: pointer; }
.token button:hover { background: #f0f0f0; }
.list { grid-area: list; overflow: auto; }
.picker { display: grid; gap: 4px; padding-top: 16px; color: var(--muted); font-size: 12px; }
.picker select { padding: 6px 8px; border: 1px solid var(--line); background: #fff; font: 15px 'Noto Sans JP', sans-serif; color: var(--ink); }
.picker select:focus-visible { outline: 2px solid var(--accent); }
.list ol { list-style: none; margin: 0; padding: 0; }
.entry {
  width: 100%;
  display: grid;
  grid-template-columns: 12px 92px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.entry:hover:not(:disabled) { background: #f5f5f5; }
.entry:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.entry.is-selected { background: #eee; font-weight: 700; }
.entry:disabled { color: var(--muted); cursor: default; }
.swatch { width: 12px; height: 12px; border: 1px solid var(--line); }
.when { font-variant-numeric: tabular-nums; color: var(--muted); }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state { font-size: 12px; }
.state.is-stale { color: #c00; }
.previews { grid-area: previews; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 16px; padding-top: 16px; }
.previews figure { margin: 0 0 20px; position: relative; }
.previews iframe { border: 1px solid var(--line); transform-origin: 0 0; display: block; }
.previews figcaption { position: absolute; top: 100%; left: 0; font-size: 12px; color: var(--muted); }
.report { grid-area: report; padding-top: 16px; }
.report dl { display: grid; grid-template-columns: 88px 1fr; gap: 6px 8px; margin: 0 0 16px; }
.report dt { color: var(--muted); }
.report dd { margin: 0; }
.chip { display: inline-block; margin: 0 4px 4px 0; padding: 0 6px; border: 1px solid var(--line); font-size: 12px; }
.chip.ng { border-color: #c00; color: #c00; }
.sources { margin: 0; padding-left: 1.2em; font-size: 13px; }
.approve { width: 100%; padding: 12px; border: 2px solid var(--accent); background: #fff; color: var(--accent); font: 700 15px 'Noto Sans JP', sans-serif; cursor: pointer; }
.approve:hover:not(:disabled) { background: #f0f0f0; }
.approve:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.approve.is-on { background: var(--accent); color: #fff; }
.approve.is-on:hover:not(:disabled) { background: var(--accent); opacity: 0.85; }
.approve:disabled { opacity: 0.4; cursor: not-allowed; }
.sites { grid-area: sites; border-top: 1px solid var(--line); }
.sites table { width: 100%; border-collapse: collapse; }
.sites th, .sites td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.sites th { color: var(--muted); font-weight: 400; }
.toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.toggle input { width: 18px; height: 18px; accent-color: var(--accent); }
.toggle input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
