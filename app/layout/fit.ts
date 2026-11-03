import { areaRoles } from './templates'
import type { DroppedCell, LayoutCell, ShapeLayout, Track } from './types'

export function byPriorityThenId(a: LayoutCell, b: LayoutCell): number {
  return a.priority - b.priority || a.id.localeCompare(b.id)
}

export function initialPlacement(cells: LayoutCell[], layout: ShapeLayout) {
  const slots = areaRoles(layout)
  const placed: LayoutCell[] = []
  const dropped: DroppedCell[] = []
  const taken = new Set<string>()
  for (const cell of [...cells].sort(byPriorityThenId)) {
    if (!slots.has(cell.role)) dropped.push({ id: cell.id, reason: 'no-slot' })
    else if (taken.has(cell.role)) dropped.push({ id: cell.id, reason: 'duplicate-role' })
    else {
      taken.add(cell.role)
      placed.push(cell)
    }
  }
  return { placed, dropped }
}

export function nextOverflowVictim(placed: LayoutCell[], layout: ShapeLayout): LayoutCell | undefined {
  const required = new Set(layout.required)
  return placed
    .filter((cell) => !required.has(cell.role))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0]
}

export function missingRequired(placed: LayoutCell[], layout: ShapeLayout): string[] {
  const present = new Set(placed.map((cell) => cell.role))
  return layout.required.filter((role) => !present.has(role))
}

export function trackCss(track: Track): string {
  if (track === 'auto') return 'auto'
  if (typeof track === 'number') return `calc(${track} * var(--px))`
  return `minmax(0, ${track})`
}

export function gridCss(layout: ShapeLayout) {
  return {
    gridTemplateColumns: layout.columns.map(trackCss).join(' '),
    gridTemplateRows: layout.rows.map(trackCss).join(' '),
    gridTemplateAreas: layout.areas.map((row) => `"${row}"`).join(' '),
  }
}

// A dropped cell leaves an empty row and the block gap before it; both go, so the space returns to the
// cells that remain. Names that also sit in other rows (a band or an action spanning rows) count as empty.
export function collapseAbsent(layout: ShapeLayout, present: ReadonlySet<string>): ShapeLayout {
  const rows = layout.areas.map((row) => row.split(/\s+/).map((name) => (name === '.' || present.has(name) ? name : '.')))
  const spans = (name: string, except: Set<number>) => rows.some((names, i) => !except.has(i) && names.includes(name))
  const removed = new Set<number>()
  const isEmpty = (i: number) => rows[i]!.every((name) => name === '.' || spans(name, new Set([...removed, i])))
  layout.areas.forEach((row, i) => {
    const hadAbsent = row.split(/\s+/).some((name) => name !== '.' && !present.has(name))
    if (!hadAbsent || !isEmpty(i)) return
    removed.add(i)
    if (i > 0 && !removed.has(i - 1) && isEmpty(i - 1)) removed.add(i - 1)
  })
  if (!removed.size) return { ...layout, areas: rows.map((names) => names.join(' ')) }
  const kept = rows.filter((_, i) => !removed.has(i))
  if ([...present].some((name) => rows.some((names) => names.includes(name)) && !kept.some((names) => names.includes(name)))) return layout
  return { ...layout, rows: layout.rows.filter((_, i) => !removed.has(i)), areas: kept.map((names) => names.join(' ')) }
}
