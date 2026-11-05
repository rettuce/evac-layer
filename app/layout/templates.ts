import type { Role, Shape, ShapeLayout, TemplateDef, TemplateId, Track } from './types'

export const STACKED_BAND_MIN_PX = 200

// 16:9 is 田中's Figma artboard (2026-11-05, file H213MoFcJtIZ96s6qdmBZ8 node 3223:4, 1920 × 1080): the band 172,
// the action in a 720 column from x 52 with the run pictogram's ink under the text, the direction and the shelter
// right-aligned in a column from x 971 to 1868 (the shelter's distance box reaches 1872), the languages across both
// columns from y 830, the source on the
// foot. Tracks are the artboard's px: the fr column takes a wider screen, the fr row above the languages a taller one.
// The shelter also owns the rows under it down to the languages, so a two-line name (司令官 2026-11-05: shrink → two lines → ellipsis,
// the direction and the distance never move) stays inside its cell.
const FIGMA_LANDSCAPE_TYPE = { headline: 64, level: 64, action: 120, direction: 122, shelter: 79, shelterNarrow: 63, kind: 32, distance: 92, label: 24, languages: 54, languagesNarrow: 46, source: 24 }
const LANDSCAPE: ShapeLayout = {
  id: 'figma-split',
  columns: [52, 720, '1fr', 897, 4, 48],
  rows: [172, 24, 27, 255, 90, 167, 49, '1fr', 170, 20, 29, 31],
  areas: [
    'headline headline headline headline headline headline',
    '. . . . . .',
    '. action . . . .',
    '. action . direction . .',
    '. action . . . .',
    '. action . shelter shelter .',
    '. action . shelter shelter .',
    '. . . shelter shelter .',
    '. languages languages languages . .',
    '. . . . . .',
    '. source source source . .',
    '. . . . . .',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'languages', 'source'],
  pictogramPx: { headline: 98, action: 225, direction: 129, shelter: 157 },
  figma: true,
  fixedTracks: true,
  type: FIGMA_LANDSCAPE_TYPE,
}

const LANDSCAPE_CLEAR: ShapeLayout = {
  ...LANDSCAPE,
  id: 'figma-split-clear',
  areas: LANDSCAPE.areas.map((row) => row.replace(/direction|shelter shelter/, (m) => (m === 'direction' ? '.' : '. .'))),
  required: ['headline', 'action', 'languages', 'source'],
  pictogramPx: { headline: 98, action: 225 },
}

// 9:16 is 田中's Figma artboard (2026-11-04, file H213MoFcJtIZ96s6qdmBZ8 node 3212:5, 1080 × 1920): one column
// from x 48 to 1043, the band 200, and the blocks placed so that every pictogram's ink and every text box start
// on x 48. Row gaps are the measured distances between the ink of one block and the box of the next (the site
// pictogram's box is its ink, 3 px shorter than wide); the source
// is anchored to the foot and the languages block takes the room that is left.
// Two steps written on the artboard's rules: a name that wraps at 90 is set at 72; a stack that still does not
// fit the frame (five language pairs reserve their tallest) sets the languages at 56.
const FIGMA_PORTRAIT_TYPE = { headline: 76, level: 66, action: 150, direction: 120, shelter: 90, shelterNarrow: 72, label: 30, languages: 66, languagesNarrow: 56, source: 30 }
const PORTRAIT: ShapeLayout = {
  id: 'figma-stack',
  columns: [48, '1fr', 37],
  rows: [200, 26, 'auto', 62, 'auto', 86, 'auto', 104, 'auto', '1fr', 'auto', 29],
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
  pictogramPx: { headline: 124, action: 333, direction: 109, shelter: 162 },
  figma: true,
  headlineLines: 1,
  distanceBelow: true,
  type: FIGMA_PORTRAIT_TYPE,
}

// The same column without the where-blocks (all-clear): the action keeps its pictogram size.
const PORTRAIT_CLEAR: ShapeLayout = {
  ...PORTRAIT,
  id: 'figma-stack-clear',
  rows: [200, 26, 'auto', 101, 'auto', '1fr', 'auto', 29],
  areas: ['headline headline headline', '. . .', '. action .', '. . .', '. languages .', '. . .', '. source .', '. . .'],
  required: ['headline', 'action', 'languages', 'source'],
  pictogramPx: { headline: 124, action: 333 },
}

// 32:9 is 田中's Figma artboard (2026-11-05, node 3223:80, 3840 × 1080): the level colour fills a 780 panel on the
// left with the hazard pictogram, the two-line headline and the level label; the source sits on the top of the white
// field, the action and the run pictogram's ink in a 1369 column from x 887, the direction from x 2979 and the
// shelter from x 2256, both ending at x 3748, and the languages side by side in a 294 band at the foot with their labels above the text.
// The fr column takes a wider screen, the fr row above the band a taller one.
const FIGMA_RIBBON_TYPE = { headline: 96, level: 96, action: 150, direction: 170, shelter: 140, shelterNarrow: 112, kind: 32, distance: 150, label: 30, languages: 90, languagesNarrow: 76, source: 30 }
const RIBBON: ShapeLayout = {
  id: 'figma-ribbon',
  columns: [780, 107, 1369, '1fr', 769, 92],
  rows: [40, 83, 185, 53, 24, 30, 275, 39, '1fr', 294],
  areas: [
    'headline . . . . .',
    'headline . source . direction .',
    'headline . action . direction .',
    'headline . action . direction .',
    'headline . action . . .',
    'headline . action . . .',
    'headline . action shelter shelter .',
    'headline . action shelter shelter .',
    'headline . . shelter shelter .',
    'headline languages languages languages languages languages',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'languages', 'source'],
  pictogramPx: { headline: 310, action: 344, direction: 166, shelter: 253 },
  darkBand: ['languages'],
  figma: true,
  fixedTracks: true,
  headlineLines: 2,
  type: FIGMA_RIBBON_TYPE,
}

// Without the where-blocks the action may run across the whole field, so a two-line all-clear keeps its pictogram.
const RIBBON_CLEAR: ShapeLayout = {
  ...RIBBON,
  id: 'figma-ribbon-clear',
  areas: [
    'headline . . . . .',
    'headline . source . . .',
    'headline . action action action .',
    'headline . action action action .',
    'headline . action action action .',
    'headline . action action action .',
    'headline . action action action .',
    'headline . action action action .',
    'headline . . . . .',
    'headline languages languages languages languages languages',
  ],
  required: ['headline', 'action', 'languages', 'source'],
  pictogramPx: { headline: 310, action: 344 },
}

// 1:1 is 田中's Figma artboard (2026-11-05 L-5, node 3230:4 with the 3266:25 parts, 1080 × 1080): the band 200, the
// two-line action from x 48, the run pictogram's ink 144 × 193 at (51, 590) as the hero beside the shelter group
// (site ink at (275, 602), texts from x 398, the distance "570 m" anchored at x 833) and the direction under it
// from x 766, and a black language band from y 820 with white labels above the text. No source line on the face
// (the document footer carries the sources). The fr row above the band takes a taller screen.
const FIGMA_SQUARE_TYPE = { headline: 76, level: 66, action: 150, direction: 70, shelter: 64, shelterNarrow: 51, kind: 30, distance: 72, label: 30, languages: 56, languagesNarrow: 47 }
const SQUARE: ShapeLayout = {
  id: 'figma-square',
  columns: [48, 202, 14, 502, 314],
  rows: [200, 27, 335, 26, 2, 122, 71, 17, '1fr', 260],
  areas: [
    'headline headline headline headline headline',
    '. . . . .',
    '. action action action action',
    '. . . . .',
    '. . . shelter shelter',
    '. hero . shelter shelter',
    '. hero . . direction',
    '. . . . direction',
    '. . . . .',
    'languages languages languages languages languages',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'languages'],
  pictogramPx: { headline: 112, action: 0, direction: 56, shelter: 92 },
  hero: { role: 'action', px: 193 },
  darkBand: ['languages'],
  figma: true,
  fixedTracks: true,
  headlineLines: 1,
  distanceUnitSpace: true,
  type: FIGMA_SQUARE_TYPE,
}

const SQUARE_CLEAR: ShapeLayout = {
  ...SQUARE,
  id: 'figma-square-clear',
  areas: SQUARE.areas.map((row) => row.replace('shelter shelter', '. .').replace('direction', '.')),
  required: ['headline', 'action', 'languages'],
  pictogramPx: { headline: 112, action: 0 },
}

function requireShelterInsteadOfDirection(layout: ShapeLayout): ShapeLayout {
  const required: Role[] = layout.required.map((role) => (role === 'direction' ? 'shelter' : role))
  return { ...layout, required: [...new Set(required)] }
}

export const TEMPLATES: Partial<Record<TemplateId, TemplateDef>> = {
  'evac-now': {
    '16x9': [LANDSCAPE],
    '9x16': [PORTRAIT],
    '32x9': [RIBBON],
    '1x1': [SQUARE],
  },
  'evac-prepare': {
    '16x9': [requireShelterInsteadOfDirection(LANDSCAPE)],
    '9x16': [requireShelterInsteadOfDirection(PORTRAIT)],
    '32x9': [requireShelterInsteadOfDirection(RIBBON)],
    '1x1': [SQUARE],
  },
  // Level 5 keeps the shelter and the direction on screen (田中 2026-11-05): the same slots as evac-now.
  'secure-now': {
    '16x9': [LANDSCAPE],
    '9x16': [PORTRAIT],
    '32x9': [RIBBON],
    '1x1': [SQUARE],
  },
  'all-clear': {
    '16x9': [LANDSCAPE_CLEAR],
    '9x16': [PORTRAIT_CLEAR],
    '32x9': [RIBBON_CLEAR],
    '1x1': [SQUARE_CLEAR],
  },
}

// The pillar is 田中's Figma artboard (2026-11-05, node 3230:68, 6616 × 5046: four faces of 1654, the colour band 320
// across the top and the foot band from 4500 with the source in white). A face in strip px: the run pictogram's ink
// 842 × 1132 from (353, 627) above the two-line action from y 2182, the languages from y 2834 with labels centred on
// their lines, the shelter group from y 3496 (the 32:9 group), the direction from y 3892, every text from x 80 and
// the distance ending at x 1572. The fr row above the foot band takes a taller face.
const FIGMA_PILLAR_TYPE = { headline: 90, level: 90, action: 190, direction: 270, shelter: 140, shelterNarrow: 112, kind: 32, distance: 150, label: 40, languages: 88, languagesNarrow: 74, source: 70 }
const PILLAR_FACE: ShapeLayout = {
  id: 'figma-face',
  columns: [80, 273, 842, 377, 82],
  rows: [320, 307, 1132, 417, 442, 216, 406, 256, 275, 121, 383, '1fr', 546],
  areas: [
    'headline headline headline headline headline',
    '. . . . .',
    '. . hero . .',
    '. . . . .',
    '. action action action .',
    '. . . . .',
    '. languages languages languages .',
    '. languages languages languages .',
    '. shelter shelter shelter .',
    '. shelter shelter shelter .',
    '. direction direction direction .',
    '. . . . .',
    'source source source source source',
  ],
  required: ['headline', 'action', 'direction', 'shelter', 'languages', 'source'],
  pictogramPx: { headline: 186, action: 0, direction: 261, shelter: 253 },
  hero: { role: 'action', px: 1132 },
  bandRoles: ['source'],
  figma: true,
  fixedTracks: true,
  headlineLines: 1,
  type: FIGMA_PILLAR_TYPE,
}

const PILLAR_FACE_CLEAR: ShapeLayout = {
  ...PILLAR_FACE,
  id: 'figma-face-clear',
  areas: PILLAR_FACE.areas.map((row) => row.replace(/(direction|shelter) \1 \1/, '. . .')),
  required: ['headline', 'action', 'languages', 'source'],
  pictogramPx: { headline: 186, action: 0 },
}

const PILLAR_FACE_LAYOUTS: Partial<Record<TemplateId, ShapeLayout>> = {
  'evac-now': PILLAR_FACE,
  'evac-prepare': requireShelterInsteadOfDirection(PILLAR_FACE),
  'secure-now': PILLAR_FACE,
  'all-clear': PILLAR_FACE_CLEAR,
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
  if (shape === 'pillar') {
    const face = PILLAR_FACE_LAYOUTS[templateId]
    if (!face) throw new TemplateNotDefinedError(templateId, shape)
    return face
  }
  const variants = TEMPLATES[templateId]?.[shape]
  if (!variants?.length) throw new TemplateNotDefinedError(templateId, shape)
  return variants[variant] ?? variants[0]!
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
