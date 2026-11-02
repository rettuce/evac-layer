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
