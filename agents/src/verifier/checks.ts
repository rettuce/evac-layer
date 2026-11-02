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
export interface Finding { check: "missing-required" | "overflow" | "dropped" | "font-size" | "flicker" | "distance-duplicated" | "bulletin-mismatch" | "pictogram-misuse" | "missing-source"; cell_id?: string; lang?: string; detail: string }
export interface CellText { id: string; role: Role; text: string }

// A label (language name, shelter designation) only names what the text beside it is, so it is held to the fine distance.
export function requiredPx(role: Role, scale: number, kind: TextKind): { step: TypeStep; px: number } {
  const step = kind === "label" ? "fine" : role === "action" && kind === "secondary" ? "guide" : ROLE_MIN_STEP[role];
  return { step, px: TYPE_PX[step] * scale };
}

export function judgeFonts(samples: TextSample[], scale: number): Finding[] {
  return samples.flatMap((s) => {
    const need = requiredPx(s.role, scale, s.kind);
    if (s.font_px + FONT_TOLERANCE_PX >= need.px) return [];
    return [{
      check: "font-size" as const,
      cell_id: s.cell_id,
      detail: `${s.role} text "${s.text.slice(0, 24)}" is ${s.font_px}px; the ${need.step} type step needs ${need.px.toFixed(1)}px`,
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

export function countReversals(luminances: number[]): number {
  const steps = luminances.slice(1).map((l, i) => l - luminances[i]).filter((d) => Math.abs(d) >= FLASH_LUMINANCE_DELTA).map(Math.sign);
  return steps.slice(1).filter((s, i) => s !== steps[i]).length;
}

const DISTANCE = /\d[\d,.]*\s*(m|km|メートル)(?![a-z])/i;

// Contract: the distance to the shelter is shown once, on the shelter cell; the direction cell carries only the way to go.
export function judgeContent(cells: CellText[]): Finding[] {
  const shelterHasDistance = cells.some((c) => c.role === "shelter" && DISTANCE.test(c.text));
  return cells
    .filter((c) => c.role === "direction" && shelterHasDistance && DISTANCE.test(c.text))
    .map((c) => ({ check: "distance-duplicated" as const, cell_id: c.id, detail: `direction text "${c.text}" repeats the distance already shown on the shelter cell` }));
}
