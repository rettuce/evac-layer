import type { Role, Shape, ShapeLayout, TemplateDef, TemplateId, Track } from './types'
import { PILLAR } from './shapes'
import { SHELTER_PICTOGRAM_PX } from './typography'

const M = 48
const G = 24
const BAND = 176
// The source line is only the bulletin time and the municipality, so it sits close to the foot.
const SOURCE_GAP = 8
const FOOT = 32
export const STACKED_BAND_MIN_PX = 200

const LANDSCAPE: ShapeLayout = {
  id: 'split',
  columns: [M, '5fr', M, '4fr', M],
  rows: [BAND, M, '1fr', G, '1fr', G, 'auto', SOURCE_GAP, 'auto', FOOT],
  areas: [
    'headline headline headline headline headline',
    '. . . . .',
    '. action . shelter .',
    '. action . direction .',
    '. action . direction .',
    '. . . . .',
    '. languages languages languages .',
    '. . . . .',
    '. source source source .',
    '. . . . .',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'languages', 'source'],
  pictogramPx: { headline: 112, action: 192, direction: 192, shelter: SHELTER_PICTOGRAM_PX },
}

const PORTRAIT: ShapeLayout = {
  id: 'stack',
  columns: [M, '1fr', M],
  rows: [BAND, M, '1fr', G, 'auto', G, 'auto', G, 'auto', SOURCE_GAP, 'auto', FOOT],
  areas: [
    'headline headline headline',
    '. . .',
    '. action .',
    '. . .',
    '. direction .',
    '. . .',
    '. shelter .',
    '. . .',
    '. languages .',
    '. . .',
    '. source .',
    '. . .',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'languages', 'source'],
  pictogramPx: { headline: 112, action: 320, direction: 192, shelter: SHELTER_PICTOGRAM_PX },
}

const RIBBON: ShapeLayout = {
  id: 'columns',
  columns: [720, M, '4fr', M, '3fr', M, '3fr', M],
  rows: [M, 'auto', G, '1fr', M, 256],
  areas: [
    'headline . . . . . . .',
    'headline . source source source source source .',
    'headline . . . . . . .',
    'headline . action . direction . shelter .',
    'headline . . . . . . .',
    'headline languages languages languages languages languages languages languages',
  ],
  required: ['headline', 'action', 'direction', 'languages', 'source'],
  pictogramPx: { headline: 160, action: 288, direction: 288, shelter: SHELTER_PICTOGRAM_PX },
  darkBand: ['languages'],
}

const RIBBON_WIDE_DIRECTION: ShapeLayout = {
  id: 'wide-direction',
  columns: [720, M, '4fr', M, '6fr', M],
  rows: [M, 'auto', G, '1fr', M, 256],
  areas: [
    'headline . . . . .',
    'headline . source source source .',
    'headline . . . . .',
    'headline . action . direction .',
    'headline . . . . .',
    'headline shelter shelter languages languages languages',
  ],
  required: ['headline', 'action', 'direction', 'languages', 'source'],
  pictogramPx: { headline: 160, action: 288, direction: 320, shelter: SHELTER_PICTOGRAM_PX },
  darkBand: ['shelter', 'languages'],
  inline: ['direction', 'shelter'],
}

const SQUARE: ShapeLayout = {
  id: 'pictogram-first',
  columns: [M, '1fr', M],
  rows: [BAND, M, '1fr', G, 'auto', G, 'auto', G, 'auto', SOURCE_GAP, 'auto', FOOT],
  areas: [
    'headline headline headline',
    '. . .',
    '. action .',
    '. . .',
    '. languages .',
    '. . .',
    '. direction .',
    '. . .',
    '. shelter .',
    '. . .',
    '. source .',
    '. . .',
  ],
  required: ['headline', 'action', 'direction', 'source'],
  pictogramPx: { headline: 112, action: 136, direction: 128, shelter: SHELTER_PICTOGRAM_PX },
  inline: ['direction'],
}

function requireShelterInsteadOfDirection(layout: ShapeLayout): ShapeLayout {
  const required: Role[] = layout.required.map((role) => (role === 'direction' ? 'shelter' : role))
  return { ...layout, required: [...new Set(required)] }
}

const CLEAR_STACK: ShapeLayout = {
  id: 'clear-stack',
  columns: [M, '1fr', M],
  rows: [BAND, M, '1fr', G, 'auto', SOURCE_GAP, 'auto', FOOT],
  areas: [
    'headline headline headline',
    '. . .',
    '. action .',
    '. . .',
    '. languages .',
    '. . .',
    '. source .',
    '. . .',
  ],
  required: ['headline', 'action', 'languages', 'source'],
  pictogramPx: { headline: 112, action: 192 },
}

const CLEAR_RIBBON: ShapeLayout = {
  id: 'clear-columns',
  columns: [720, M, '1fr', M],
  rows: [M, 'auto', G, '1fr', M, 256],
  areas: [
    'headline . . .',
    'headline . source .',
    'headline . . .',
    'headline . action .',
    'headline . . .',
    'headline languages languages languages',
  ],
  required: ['headline', 'action', 'languages', 'source'],
  pictogramPx: { headline: 160, action: 288 },
  darkBand: ['languages'],
}

const CLEAR_SQUARE: ShapeLayout = {
  ...CLEAR_STACK,
  id: 'clear-square',
  required: ['headline', 'action', 'source'],
  pictogramPx: { headline: 112, action: 160 },
}

// Level 5 (secure safety now) is the stage where leaving may itself be dangerous, so the
// screen drops shelter and direction and gives the whole body to the action.
const SECURE_LANDSCAPE: ShapeLayout = { ...CLEAR_STACK, id: 'secure-stack', pictogramPx: { headline: 112, action: 320 } }
const SECURE_PORTRAIT: ShapeLayout = { ...CLEAR_STACK, id: 'secure-stack', pictogramPx: { headline: 112, action: 480 } }
const SECURE_RIBBON: ShapeLayout = { ...CLEAR_RIBBON, id: 'secure-columns', pictogramPx: { headline: 160, action: 384 } }
const SECURE_SQUARE: ShapeLayout = { ...CLEAR_SQUARE, id: 'secure-square', pictogramPx: { headline: 112, action: 240 } }

// 9:16 and 1:1 put the level label under the headline: the band is at least STACKED_BAND_MIN_PX
// (one headline line + label with room above and below) and grows further for a two-line headline.
function stackedBand(layout: ShapeLayout): ShapeLayout {
  return { ...layout, rows: ['auto', ...layout.rows.slice(1)] }
}

export const TEMPLATES: Partial<Record<TemplateId, TemplateDef>> = {
  'evac-now': {
    '16x9': [LANDSCAPE],
    '9x16': [stackedBand(PORTRAIT)],
    '32x9': [RIBBON, RIBBON_WIDE_DIRECTION],
    '1x1': [stackedBand(SQUARE)],
  },
  'evac-prepare': {
    '16x9': [requireShelterInsteadOfDirection(LANDSCAPE)],
    '9x16': [stackedBand(requireShelterInsteadOfDirection(PORTRAIT))],
    '32x9': [requireShelterInsteadOfDirection(RIBBON), requireShelterInsteadOfDirection(RIBBON_WIDE_DIRECTION)],
    '1x1': [stackedBand(requireShelterInsteadOfDirection(SQUARE))],
  },
  'secure-now': {
    '16x9': [SECURE_LANDSCAPE],
    '9x16': [stackedBand(SECURE_PORTRAIT)],
    '32x9': [SECURE_RIBBON],
    '1x1': [stackedBand(SECURE_SQUARE)],
  },
  'all-clear': {
    '16x9': [CLEAR_STACK],
    '9x16': [stackedBand(CLEAR_STACK)],
    '32x9': [CLEAR_RIBBON],
    '1x1': [stackedBand(CLEAR_SQUARE)],
  },
}

// Pillar faces read best at eye height: the reading rows end 1.0 m above the floor, a level-colour band
// with the source runs round the foot of the column (0.40–0.75 m), and the top band and one large
// action pictogram take the upper column. Rows are in design px, so metres are divided by the face scale.
const PILLAR_EYE_LOW_M = 1.0
const PILLAR_EYE_HIGH_M = 2.2
const PILLAR_FOOT_BAND_TOP_M = 0.75
const PILLAR_HERO_PX = 800
const PILLAR_BODY_ORDER: Role[] = ['action', 'languages', 'direction', 'shelter']

function pillarDesignPx(fromMetres: number, toMetres: number): number {
  return ((toMetres - fromMetres) * PILLAR.pxPerMetre) / PILLAR.faceScale
}

function pillarFace(layout: ShapeLayout): ShapeLayout {
  const roles = areaRoles(layout)
  const topMetres = PILLAR.floorMetres + PILLAR.height / PILLAR.pxPerMetre
  const heroRow = pillarDesignPx(PILLAR_EYE_HIGH_M, topMetres) - STACKED_BAND_MIN_PX
  const rows: Track[] = [layout.rows[0]!, heroRow, '1fr']
  const areas = ['headline headline headline', '. hero .', '. . .']
  PILLAR_BODY_ORDER.filter((role) => roles.has(role)).forEach((role, i) => {
    if (i > 0) {
      rows.push(G)
      areas.push('. . .')
    }
    rows.push('auto')
    areas.push(`. ${role} .`)
  })
  rows.push(pillarDesignPx(PILLAR_FOOT_BAND_TOP_M, PILLAR_EYE_LOW_M), pillarDesignPx(PILLAR.floorMetres, PILLAR_FOOT_BAND_TOP_M))
  areas.push('. . .', 'source source source')
  return {
    ...layout,
    id: `pillar-${layout.id}`,
    columns: [M, '1fr', M],
    rows,
    areas,
    pictogramPx: { ...layout.pictogramPx, action: 0 },
    hero: { role: 'action', px: PILLAR_HERO_PX },
    bandRoles: ['source'],
  }
}

export function areaRoles(layout: ShapeLayout): Set<string> {
  return new Set(layout.areas.flatMap((row) => row.split(/\s+/)).filter((name) => name !== '.'))
}

const ROLE_ORDER: Role[] = ['headline', 'hazard', 'action', 'direction', 'shelter', 'languages', 'source', 'pictogram']

export interface ResolvedTemplate {
  required: Role[]
  slots: Role[]
  variant?: string
}

export class TemplateNotDefinedError extends Error {
  constructor(templateId: TemplateId, shape: Shape) {
    super(`template ${templateId} has no layout for shape ${shape} in app/layout/templates.ts`)
    this.name = 'TemplateNotDefinedError'
  }
}

export function definedTemplates(): TemplateId[] {
  return (Object.keys(TEMPLATES) as TemplateId[]).sort()
}

export function resolveLayout(templateId: TemplateId, shape: Shape, variant = 0): ShapeLayout {
  const variants = TEMPLATES[templateId]?.[shape === 'pillar' ? PILLAR.faceShape : shape]
  if (!variants?.length) throw new TemplateNotDefinedError(templateId, shape)
  const layout = variants[variant] ?? variants[0]!
  return shape === 'pillar' ? pillarFace(layout) : layout
}

export function resolveTemplate(templateId: TemplateId, shape: Shape): ResolvedTemplate {
  const layout = resolveLayout(templateId, shape)
  const placeable = areaRoles(layout)
  return {
    required: ROLE_ORDER.filter((role) => layout.required.includes(role)),
    slots: ROLE_ORDER.filter((role) => placeable.has(role)),
    variant: layout.id,
  }
}
