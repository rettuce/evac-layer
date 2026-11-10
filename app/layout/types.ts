export type PanelShape = '16x9' | '9x16' | '32x9' | '1x1'
export type Shape = PanelShape | 'pillar'
export type ShapeClass = 'landscape' | 'portrait' | 'ribbon' | 'square' | 'pillar'
export type TemplateId = 'evac-now' | 'evac-prepare' | 'secure-now' | 'shelter-direction' | 'all-clear'
export type Role =
  | 'headline'
  | 'hazard'
  | 'action'
  | 'direction'
  | 'shelter'
  | 'languages'
  | 'source'
  | 'pictogram'
export type LangKey = 'ja' | 'ja_easy' | 'en' | 'zh_hans' | 'zh_hant' | 'ko' | 'th' | 'vi' | 'fil' | 'id'
export type Motion = 'scale-in' | 'pulse' | 'static'
export type AlertLevel = 1 | 2 | 3 | 4 | 5
export type Orientation = 'north-up'

export type LocalizedText = { ja: string } & Partial<Record<Exclude<LangKey, 'ja'>, string>>

export interface LayoutCell {
  id: string
  role: Role
  priority: number
  text: LocalizedText
  pictogram?: string
  rotation?: number
  distance_m?: number
  kind?: ShelterKind
  orientation?: Orientation
  motion: Motion
}

export type ShelterKind = 'emergency_evacuation_site' | 'evacuation_shelter'

export interface ScreenSource {
  type: 'pdf' | 'jma' | 'gsi'
  file?: string
  page?: number
  bulletin_id?: string
}

export interface EvacScreen {
  version: string
  kind: 'evac-screen'
  municipality: { id: string; name: string }
  alert: {
    source: string
    bulletin_id: string
    hazard: string
    level: AlertLevel
    issued_at: string
  }
  shape: Shape
  template: TemplateId
  cells: LayoutCell[]
  palette: 'cabinet-office-5'
  sources: ScreenSource[]
}

export type Track = number | `${number}fr` | 'auto'

export interface ShapeLayout {
  id: string
  columns: Track[]
  rows: Track[]
  areas: string[]
  required: Role[]
  pictogramPx: Partial<Record<Role, number>>
  darkBand?: Role[]
  inline?: Role[]
  hero?: { role: Role; px: number }
  bandRoles?: Role[]
  typeScale?: Partial<Record<Role, number>>
  // Figma-derived layouts: pictogram sizes are ink sizes (PictogramMark fitInk), type sizes are set per element
  // and the cells follow the rules written on the artboard (see templates.ts PORTRAIT).
  figma?: boolean
  type?: Record<string, number>
  fixedTracks?: boolean
  headlineLines?: number
  distanceBelow?: boolean
  // The artboard writes the distance as "570 m" (a space before the unit) instead of "570m".
  distanceUnitSpace?: boolean
  north?: NorthDial
  // Line-based grid areas for roles whose cells overlap (northUp.ts, 1:1); a role listed here is placeable.
  placement?: Partial<Record<Role, string>>
}

export interface NorthDial {
  dialPx: number
  markPx: number
  words: 'stack' | 'line'
  distanceOn: 'direction' | 'shelter'
  // A smaller dial, taken when the full one does not fit (EvacScreen fit).
  compact?: { dialPx: number; markPx: number }
}

export type TemplateDef = Record<PanelShape, ShapeLayout[]>

export type DropReason = 'no-slot' | 'duplicate-role' | 'overflow'
export interface DroppedCell {
  id: string
  reason: DropReason
}
