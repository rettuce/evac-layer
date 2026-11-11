import type { PanelShape, Shape, TemplateId } from "../../../app/layout/types";
import type { Alert } from "../jma/parse.js";
import { tsunamiRegionsFor } from "../jma/regions.js";
import type { TsunamiCategory } from "../jma/codes.js";

export class ComposerStop extends Error {}
export class BudgetExceeded extends ComposerStop {
  constructor(readonly shape: string, readonly role: string, readonly lang: string, readonly length: number, readonly max: number, readonly text: string) {
    super(`${shape} ${role}.${lang} has ${length} chars, budget ${max}: "${text}"`);
  }
}
const stop = (msg: string): never => { throw new ComposerStop(msg); };

// pillar wraps four faces of a column, each face repeating a 9:16 screen (contract v0, 18:03), so it borrows the
// 9:16 cells, required roles and budgets; the renderer draws the faces.
export const CELLS_OF: Record<Shape, PanelShape> = { "16x9": "16x9", "9x16": "9x16", "32x9": "32x9", "1x1": "1x1", pillar: "9x16" };
export const SHAPE_ORDER: readonly Shape[] = ["16x9", "9x16", "32x9", "1x1", "pillar"];
export const LANGUAGES_REQUIRED_ON: readonly Shape[] = ["16x9", "9x16", "32x9", "1x1", "pillar"];

export const TSUNAMI_DISPLAY_LEVEL: Record<TsunamiCategory, number | null> = {
  major_warning: 4,
  warning: 3,
  advisory: 2,
  forecast: 1,
  cleared: 1,
  none: null,
};

export const HAZARD_PICTOGRAM: Record<string, string> = {
  tsunami: "tsunami",
  flood: "flood",
  inland_flood: "flood",
  landslide: "landslide",
  heavy_rain: "heavy_rain",
  storm_surge: "storm_surge",
  earthquake: "earthquake",
};

// The action pictogram shows what the screen asks people to do, never the hazard (the headline carries that):
// rising water or a tsunami means going up, levels 3 and 4 mean evacuating (level 3 is 高齢者等避難), and an
// all-clear asks for nothing. The Writer is told the meaning so the action text cannot contradict the pictogram
// (both mismatches were found by the Vision Verifier on the 2026-10 replay).
// The action pictogram shows the action only (contract 2026-11-02 17:22): every all-clear, including one that keeps a
// sea-level caution, uses safe_here; the hazard is the headline's pictogram.
export function actionPictogram(hazard: string, template: string): string {
  if (template === "all-clear") return "safe_here";
  if (hazard === "tsunami" || template === "secure-now") return "go_higher";
  return "directions_run";
}

export const ACTION_PICTOGRAM_MEANING_JA: Record<string, string> = {
  safe_here: "解除。避難の必要がなくなったことを伝える。注意や警戒の呼びかけは書かない",
  go_higher: "いまいる場所から高い所へ上がる",
  directions_run: "危険な場所から避難する（レベル3 では高齢者等が避難し、ほかの人は避難の準備をする）",
};

export function actionPictogramMeaning(pictogram: string, caution?: Situation["caution"]): string {
  if (pictogram === "safe_here" && caution === "sea_level_change") return "解除。避難は不要になったが海面変動が続くので、海に入らない・海岸に近づかないことを伝える";
  return ACTION_PICTOGRAM_MEANING_JA[pictogram];
}

// heavy_rain warnings drive inundation guidance, so shelters designated for inland flooding or floods qualify.
export const SHELTER_HAZARDS: Record<string, string[]> = {
  tsunami: ["tsunami"],
  flood: ["flood"],
  inland_flood: ["inland_flood"],
  heavy_rain: ["inland_flood", "flood"],
  landslide: ["landslide"],
  storm_surge: ["storm_surge"],
};

// caution: the warning ended but slight sea-level change continues; the all-clear tells people to stay off the coast.
export interface Situation { level: number; template: TemplateId; cleared: boolean; caution?: "sea_level_change" }

// Cabinet Office level 5 (緊急安全確保) says moving to a shelter may itself be dangerous; the screen still shows the
// nearest site and the way to it beside "go higher" (author, 2026-11-05, provisional until a real deployment revisits it).
export const NO_SHELTER_TEMPLATES = new Set<string>([]);

export function situationFor(alert: Alert, municipalityId: string): Situation {
  if (alert.info_type === "cancelled") stop(`bulletin ${alert.bulletin_id} is a cancellation; nothing to compose`);
  if (alert.hazard === "tsunami") {
    const regions = new Set(tsunamiRegionsFor(municipalityId));
    if (!regions.size) stop(`no tsunami forecast region is mapped for municipality ${municipalityId} (agents/src/jma/regions.ts)`);
    const mine = alert.areas.filter((a) => regions.has(a.code));
    if (!mine.length) stop(`bulletin ${alert.bulletin_id} does not cover the tsunami forecast region of ${municipalityId}`);
    const rank: TsunamiCategory[] = ["major_warning", "warning", "advisory", "forecast", "cleared", "none"];
    const kinds = mine.map((a) => (a.status === "cleared" ? "cleared" : categoryOfKind(a.kind_code)));
    const top = rank.find((r) => kinds.includes(r))!;
    if (top === "none") stop(`bulletin ${alert.bulletin_id} lists no tsunami category for ${municipalityId}`);
    if (top === "cleared") return { level: 1, template: "all-clear", cleared: true };
    if (top === "forecast") {
      if (tsunamiDowngradedFrom(mine)) return { level: 1, template: "all-clear", cleared: true, caution: "sea_level_change" };
      stop(`tsunami forecast (slight sea-level change) for ${municipalityId}: no evacuation screen`);
    }
    return { level: TSUNAMI_DISPLAY_LEVEL[top]!, template: "evac-now", cleared: false };
  }
  const mine = alert.areas.filter((a) => a.code_type === "city" && a.code.slice(0, 5) === municipalityId);
  if (!mine.length) stop(`bulletin ${alert.bulletin_id} does not list municipality ${municipalityId}`);
  if (mine.every((a) => a.status === "cleared")) return { level: 1, template: "all-clear", cleared: true };
  const unknown = mine.filter((a) => a.level === null && a.status !== "cleared" && a.status !== "none");
  if (unknown.length && alert.level !== null) {
    stop(`bulletin ${alert.bulletin_id} is level ${alert.level} but gives no level for ${unknown.map((a) => a.name).join(", ")}; not composing a screen from a guess`);
  }
  const level = Math.max(...mine.map((a) => a.level ?? 0));
  if (level >= 5) return { level, template: "secure-now" as TemplateId, cleared: false };
  if (level === 4) return { level, template: "evac-now", cleared: false };
  if (level === 3) return { level, template: "evac-prepare", cleared: false };
  return stop(`level ${level} for ${municipalityId}: below the evacuation threshold, no screen`);
}

const TSUNAMI_KIND_CATEGORY: Record<string, TsunamiCategory> = {
  "51": "warning", "52": "major_warning", "53": "major_warning", "62": "advisory", "71": "forecast", "72": "forecast", "73": "forecast", "50": "cleared", "60": "cleared", "00": "none",
};
function categoryOfKind(code: string): TsunamiCategory {
  return TSUNAMI_KIND_CATEGORY[code] ?? stop(`unknown tsunami kind code ${code}`);
}

// English for the source line only; the Writer never sees the municipality name, so romanisation lives here.
export const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

// A JMA drill bulletin (Control/Status 訓練) is shown with the drill word in every language of the headline (code
// writes them all, headlineTable.ts) and in every language but ja of the Writer's cells; the Verifier checks both
// (verifier/checks.ts DRILL_MARKERS).
export { DRILL_PREFIX_JA } from "../../../app/layout/gate";

// A region that drops from a warning or advisory to a forecast (slight sea-level change) has its warning ended:
// the screen it was shown must be cleared, and the headline names what ended. A forecast that arrives on its own
// never showed anything, so it clears nothing (situationFor stops).
export function tsunamiDowngradedFrom(mine: Alert["areas"]): string | null {
  const dropped = mine.find((a) => a.status === "downgraded" && categoryOfKind(a.kind_code) === "forecast" && a.last_kind_name);
  return dropped?.last_kind_name?.replace(/：発表$/, "") ?? null;
}

export function tsunamiClearedFrom(alert: Alert, municipalityId: string): string | null {
  if (alert.hazard !== "tsunami") return null;
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  const mine = alert.areas.filter((a) => regions.has(a.code));
  const rank: TsunamiCategory[] = ["major_warning", "warning", "advisory", "forecast", "cleared", "none"];
  const kinds = mine.map((a) => (a.status === "cleared" ? "cleared" : categoryOfKind(a.kind_code)));
  return rank.find((r) => kinds.includes(r)) === "forecast" ? tsunamiDowngradedFrom(mine) : null;
}
