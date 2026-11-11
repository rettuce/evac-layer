import type { Role } from "../../../app/layout/types";
import { TYPE_PX } from "../../../app/layout/typography";

export type TypeStep = keyof typeof TYPE_PX;

// The Verifier holds its own expectation per role instead of trusting the renderer's class choice: the main action
// line must read at the action distance, guidance at the guide distance, the source line at the fine distance.
export const ROLE_MIN_STEP: Record<Role, TypeStep> = {
  action: "action",
  headline: "guide",
  hazard: "guide",
  direction: "guide",
  shelter: "guide",
  languages: "guide",
  pictogram: "guide",
  source: "fine",
};

const FONT_TOLERANCE_PX = 0.5;
// WCAG 2.3.1: a flash is a pair of opposing changes in relative luminance of 10% or more; three or more flashes
// within one second fail. With three frames per second at most one reversal can be observed between them.
export const FLASH_LUMINANCE_DELTA = 0.1;
export const MAX_REVERSALS = 1;

export type TextKind = "primary" | "secondary" | "label";
export interface TextSample { cell_id: string; role: Role; step_class: TypeStep | null; font_px: number; kind: TextKind; text: string }
export interface ScreenState { shape: string; template: string; variant: string; level: string; dropped: string; overflow: string | null; missing_required: string | null }
export interface Finding { check: "missing-required" | "overflow" | "dropped" | "font-size" | "flicker" | "distance-duplicated" | "bulletin-mismatch" | "pictogram-misuse" | "missing-source" | "drill-marker" | "drill-word-outside-drill" | "direction-dropped" | "direction-mismatch" | "north-missing"; cell_id?: string; lang?: string; detail: string }
export interface CellText { id: string; role: Role; text: string }

// The author's artboards (L-4/L-5, 2026-11-05) set these lines below the viewing-distance floor; the floor follows the
// design, in the shape's own pixels, until a real deployment revisits the distances (agents/FINDINGS.md).
export const ARTBOARD_FLOOR_PX: Partial<Record<string, Partial<Record<`${Role}:${TextKind}`, number>>>> = {
  "16x9": { "action:primary": 120, "languages:primary": 54, "languages:label": 24, "source:primary": 24, "shelter:primary": 53 },
  "1x1": { "languages:primary": 56, "source:primary": 24, "shelter:primary": 43 },
};

// A label (language name, shelter designation) only names what the text beside it is, so it is held to the fine distance.
export function requiredPx(role: Role, scale: number, kind: TextKind, shape?: string): { step: TypeStep | "artboard"; px: number } {
  const artboard = shape === undefined ? undefined : ARTBOARD_FLOOR_PX[shape]?.[`${role}:${kind}`];
  if (artboard !== undefined) return { step: "artboard", px: artboard };
  const step = kind === "label" ? "fine" : role === "action" && kind === "secondary" ? "guide" : ROLE_MIN_STEP[role];
  return { step, px: TYPE_PX[step] * scale };
}

export function judgeFonts(samples: TextSample[], scale: number, shape?: string): Finding[] {
  return samples.flatMap((s) => {
    const need = requiredPx(s.role, scale, s.kind, shape);
    if (s.font_px + FONT_TOLERANCE_PX >= need.px) return [];
    return [{
      check: "font-size" as const,
      cell_id: s.cell_id,
      detail: `${s.role} text "${s.text.slice(0, 24)}" is ${s.font_px}px; the ${need.step === "artboard" ? `${shape} artboard floor` : `${need.step} type step`} needs ${need.px.toFixed(1)}px`,
    }];
  });
}

export function judgeState(state: ScreenState): Finding[] {
  const out: Finding[] = [];
  if (state.missing_required) out.push({ check: "missing-required", detail: `required cells not placed: ${state.missing_required}` });
  if (state.overflow) for (const token of state.overflow.split(",")) {
    const [id, lang] = token.split(":");
    out.push({ check: "overflow", cell_id: id, ...(lang ? { lang } : {}), detail: `cell ${id}${lang ? ` (${lang})` : ""} overflows its slot` });
  }
  return out;
}

export function droppedCells(state: ScreenState): { id: string; reason: string }[] {
  return state.dropped ? state.dropped.split(",").map((d) => { const [id, reason] = d.split(":"); return { id, reason }; }) : [];
}

// The arrow is the core of the guidance, so a direction cell the Composer placed may never be dropped by the renderer.
export function judgeDropped(cells: { id: string; role: Role }[], state: ScreenState): Finding[] {
  const roles = new Map(cells.map((c) => [c.id, c.role]));
  return droppedCells(state)
    .filter((d) => roles.get(d.id) === "direction")
    .map((d) => ({ check: "direction-dropped", cell_id: d.id, detail: `direction cell ${d.id} was dropped by the renderer (${d.reason}); the arrow must stay on the screen` }));
}

export function countReversals(luminances: number[]): number {
  const steps = luminances.slice(1).map((l, i) => l - luminances[i]).filter((d) => Math.abs(d) >= FLASH_LUMINANCE_DELTA).map(Math.sign);
  return steps.slice(1).filter((s, i) => s !== steps[i]).length;
}

const DISTANCE = /\d[\d,.]*\s*(m|km|メートル)(?![a-z])/i;

// Contract: the distance to the shelter is shown once: on the shelter cell, or on a north-up direction cell that took it.
export function judgeContent(cells: CellText[]): Finding[] {
  const shelterHasDistance = cells.some((c) => c.role === "shelter" && DISTANCE.test(c.text));
  return cells
    .filter((c) => c.role === "direction" && shelterHasDistance && DISTANCE.test(c.text))
    .map((c) => ({ check: "distance-duplicated" as const, cell_id: c.id, detail: `direction text "${c.text}" repeats the distance already shown on the shelter cell` }));
}

// The drill word opens the text in every language, so a reader meets it before the warning; a marker elsewhere
// (a suffix, brackets) is sent back.
export const DRILL_MARKERS: Record<string, RegExp> = {
  ja: /^【訓練】/, ja_easy: /^くんれん/, en: /^drill\b/i, zh_hans: /^(演习|演练|训练)/, zh_hant: /^(演習|演練|訓練)/, ko: /^훈련/,
  th: /^ฝึกซ้อม/, vi: /^diễn tập/i, fil: /^pagsasanay/i, id: /^latihan/i,
};

// A drill bulletin must be recognisable as one in every language on the headline, or a reader of one language
// takes a drill for the real thing.
// The headline says it in every language; action and languages (the band a reader of one language watches) say it
// in every language but ja, whose reader has the headline and whose action budget is the smallest.
export function judgeDrill(cells: { id: string; role: string; text: Record<string, string | undefined> }[], status: string): Finding[] {
  if (status !== "drill") return [];
  return cells
    .filter((c) => c.role === "headline" || c.role === "action" || c.role === "languages")
    .flatMap((c) => Object.entries(c.text)
      .filter(([lang, text]) => text !== undefined && DRILL_MARKERS[lang] && !(c.role !== "headline" && lang === "ja") && !DRILL_MARKERS[lang].test(text))
      .map(([lang]) => ({ check: "drill-marker" as const, cell_id: c.id, lang, detail: `drill bulletin, but the ${lang} ${c.role} does not open with the drill word` })));
}

export function drillWordLangs(cells: { text: Record<string, string | undefined> }[]): string[] {
  return cells.flatMap((c) => Object.entries(c.text).filter(([lang, text]) => text !== undefined && DRILL_MARKERS[lang]?.test(text)).map(([lang]) => lang));
}

// A real warning read as a drill is not acted on. Drill text on a screen of a bulletin that is not a drill comes from
// reused wording, which a rewrite of the same cells does not undo, so the loop stops on it.
export function judgeDrillWordOutsideDrill(cells: { id: string; role: string; text: Record<string, string | undefined> }[], status: string): Finding[] {
  if (status === "drill") return [];
  return cells.flatMap((c) => drillWordLangs([c]).map((lang) => ({
    check: "drill-word-outside-drill" as const, cell_id: c.id, lang, detail: `${status} bulletin, but the ${lang} ${c.role} opens with the drill word`,
  })));
}

// Screen angles (clockwise from pointing right) of the eight words on a north-up dial; the Verifier keeps its own table
// instead of the Composer's bearing so that a word and an arrow that disagree are caught whoever wrote them.
export const NORTH_UP_ROTATION: Record<string, number> = {
  北へ: 270, 北東へ: 315, 東へ: 0, 南東へ: 45, 南へ: 90, 南西へ: 135, 西へ: 180, 北西へ: 225,
};
const ANGLE_TOLERANCE_DEG = 1;

const NORTH_MARK = "N";

export interface NorthMark { text: string; visible: boolean; onDial: boolean }
export interface NorthUpRead { id: string; word: string; rotation: number | undefined; marks?: NorthMark[] }

// A north-up arrow read as "ahead of me" sends people the wrong way, so the dial must carry its N where it is seen
// with it, and the arrow must point the way its word says. marks is what the browser saw; the static layer has none.
export function judgeNorthUp(cells: NorthUpRead[]): Finding[] {
  return cells.flatMap((c) => {
    const out: Finding[] = [];
    const want = NORTH_UP_ROTATION[c.word];
    const off = want === undefined || c.rotation === undefined ? Infinity : Math.abs((((c.rotation - want) % 360) + 540) % 360 - 180);
    if (off > ANGLE_TOLERANCE_DEG) out.push({ check: "direction-mismatch", cell_id: c.id, detail: `north-up arrow at ${c.rotation ?? "no"}° does not point ${JSON.stringify(c.word)}${want === undefined ? " (not one of the eight words)" : ` (${want}°)`}` });
    if (c.marks) {
      if (!c.marks.some((m) => m.text === NORTH_MARK && m.visible && m.onDial)) out.push({ check: "north-missing", cell_id: c.id, detail: `north-up dial does not show ${NORTH_MARK} on the circle` });
    }
    return out;
  });
}
