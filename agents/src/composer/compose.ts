import type { LayoutCell, PanelShape } from "../../../app/layout/types";
import type { Alert } from "../jma/parse.js";
import { tsunamiRegionsFor } from "../jma/regions.js";
import type { Lang } from "../writer/request.js";
import { budgetsFor } from "./budgets.js";
import { shapeContract } from "./template.js";
import { actionPictogram, BudgetExceeded, CELLS_OF, ComposerStop, HAZARD_PICTOGRAM, DRILL_PREFIX_JA, LANGUAGES_REQUIRED_ON, MONTH_EN, MUNICIPALITY_EN, NO_SHELTER_TEMPLATES, SHAPE_ORDER, SHELTER_HAZARDS, situationFor } from "./rules.js";

export interface WriterCell { role: string; text: Partial<Record<Lang, string>> & { ja: string }; basis: string }
export interface WriterOutput { cells: WriterCell[] }

export interface Site {
  id: string;
  municipality_id: string;
  lat: number;
  lng: number;
  direction?: { text_ja: string; rotation: number };
  facing_deg?: number;
  note?: string;
}

const COMPASS_JA = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];

function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Screen rotation is clockwise from pointing right; facing_deg is the compass direction the viewer faces while
// reading the screen, so a target straight ahead points up (270).
export function directionToward(site: Site, target: { lat: number; lng: number }): { text_ja: string; rotation: number } {
  if (site.direction) return site.direction;
  if (site.facing_deg === undefined) stop(`site ${site.id} has neither a direction nor facing_deg`);
  const bearing = bearingDeg(site, target);
  const rotation = Math.round(((bearing - site.facing_deg! + 270) % 360) / 45) * 45 % 360;
  return { text_ja: `${COMPASS_JA[Math.round(bearing / 45) % 8]}へ`, rotation };
}

interface Shelter { name: string; kind: string; lat: number; lng: number; hazards_ok: string[]; source: { file: string; id: string } }
interface Citation { file: string; page: number; cited_text: string }
export interface Municipality {
  id: string;
  name: string;
  sources: { type: string; file: string; title: string; year: number | null }[];
  hazards: { type: string; source: Citation }[];
  shelters: Shelter[];
  conflicts: { gsi_candidates: string[] }[];
}

const stop = (msg: string): never => { throw new ComposerStop(msg); };
const EARTH_RADIUS_M = 6_371_000;
const DISTANCE_STEP_M = 10;

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function pickShelter(m: Municipality, site: Site, hazard: string) {
  const wanted = SHELTER_HAZARDS[hazard] ?? stop(`no shelter hazard mapping for ${hazard}`);
  const disputed = new Set(m.conflicts.flatMap((c) => c.gsi_candidates));
  const candidates = m.shelters
    .filter((s) => s.kind === "emergency_evacuation_site" && s.hazards_ok.some((h) => wanted.includes(h)) && !disputed.has(s.name))
    .map((s) => ({ s, d: distanceM(site, s) }))
    .sort((a, b) => a.d - b.d || a.s.source.id.localeCompare(b.s.source.id));
  const best = candidates[0] ?? stop(`no undisputed emergency evacuation site for ${hazard} in ${m.id}`);
  return { shelter: best.s, distance_m: Math.round(best.d / DISTANCE_STEP_M) * DISTANCE_STEP_M };
}

// The headline is the JMA warning name verbatim (Meteorological Service Act art. 23). A VPWW clearance keeps the
// warning's name and sets Status 解除, so the cleared state is shown by appending 解除 to that name.
export function headlineFor(alert: Alert, municipalityId: string): string {
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  const mine = alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === municipalityId : regions.has(a.code)));
  const live = mine.filter((a) => a.status !== "cleared" && a.status !== "none").sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  const prefix = alert.status === "drill" ? DRILL_PREFIX_JA : "";
  if (live.length) return prefix + live[0].kind_name;
  const cleared = mine.find((a) => a.status === "cleared");
  if (cleared) return prefix + (cleared.kind_name.endsWith("解除") ? cleared.kind_name : `${cleared.kind_name}解除`);
  return prefix + alert.raw_title;
}

// The screen names only the issuer, its time and the municipality; the PDF page, the GSI file and the bulletin id stay in
// layout.sources[] (and so in the feed, the export manifest and the admin screen), where a reader can follow them.
function sourceLine(issuedAt: string, m: Municipality): { ja: string; en?: string } {
  const t = issuedAt.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/) ?? stop(`issued_at ${issuedAt} has no date and time`);
  const [month, day, hhmm] = [Number(t[1]), Number(t[2]), `${t[3]}:${t[4]}`];
  const en = MUNICIPALITY_EN[m.id];
  return { ja: `気象庁 ${month}/${day} ${hhmm} 発表・${m.name}`, ...(en ? { en: `JMA ${hhmm}, ${MONTH_EN[month - 1]} ${day} · ${en}` } : {}) };
}

function writerFor(writer: WriterOutput | Partial<Record<PanelShape, WriterOutput>>, shape: PanelShape): WriterOutput {
  if ("cells" in writer) return writer as WriterOutput;
  return (writer as Partial<Record<PanelShape, WriterOutput>>)[shape] ?? stop(`no Writer output for shape ${shape}`);
}

function checkBudget(template: string, shape: PanelShape, cell: WriterCell) {
  const budget = budgetsFor(template, shape).find((b) => b.role === cell.role);
  for (const [lang, max] of Object.entries(budget?.max_chars ?? {})) {
    const t = cell.text[lang as Lang];
    if (t !== undefined && [...t].length > max!) throw new BudgetExceeded(shape, cell.role, lang, [...t].length, max!, t);
  }
}

export function compose(input: { alert: Alert; municipality: Municipality; site: Site; writer: WriterOutput | Partial<Record<PanelShape, WriterOutput>> }) {
  const { alert, municipality: m, site } = input;
  if (site.municipality_id !== m.id) stop(`site ${site.id} belongs to ${site.municipality_id}, not ${m.id}`);
  const situation = situationFor(alert, m.id);
  const headline = headlineFor(alert, m.id);
  const guide = NO_SHELTER_TEMPLATES.has(situation.template) ? null : pickShelter(m, site, alert.hazard);
  const way = guide ? directionToward(site, guide.shelter) : null;
  const hazardEntry = m.hazards.find((h) => h.type === alert.hazard);

  const sourceText = sourceLine(alert.issued_at, m);
  const sources = [
    ...(hazardEntry ? [{ type: "pdf" as const, file: hazardEntry.source.file, page: hazardEntry.source.page }] : []),
    ...(guide ? [{ type: "gsi" as const, file: guide.shelter.source.file }] : []),
    { type: "jma" as const, bulletin_id: alert.bulletin_id },
  ];

  return SHAPE_ORDER.map((shape) => {
    const cellShape = CELLS_OF[shape];
    const { slots, required } = shapeContract(situation.template, cellShape);
    const w = writerFor(input.writer, cellShape);
    const text = (role: string) => {
      const c = w.cells.find((x) => x.role === role);
      if (c) checkBudget(situation.template, cellShape, c);
      return c?.text;
    };
    const cells: LayoutCell[] = [];
    const add = (cell: LayoutCell) => { if (slots.has(cell.role)) cells.push(cell); };
    const headlineText = text("headline") ?? stop("Writer output has no headline");
    add({ id: "headline", role: "headline", priority: 1, text: { ...headlineText, ja: headline }, pictogram: HAZARD_PICTOGRAM[alert.hazard], motion: "scale-in" });
    add({ id: "action", role: "action", priority: 1, text: text("action") ?? stop("Writer output has no action"), pictogram: actionPictogram(alert.hazard, situation.template), motion: "pulse" });
    if (guide && way) {
      add({ id: "direction", role: "direction", priority: 2, text: text("direction") ?? { ja: way.text_ja }, pictogram: "arrow_forward", rotation: way.rotation, motion: "static" });
      add({ id: "shelter", role: "shelter", priority: 2, text: { ja: guide.shelter.name }, kind: guide.shelter.kind, pictogram: "emergency_evacuation_site", distance_m: guide.distance_m, motion: "static" } as LayoutCell);
    }
    const languages = text("languages");
    if (languages) add({ id: "languages", role: "languages", priority: 3, text: languages, motion: "static" });
    else if (LANGUAGES_REQUIRED_ON.includes(shape)) stop(`Writer output has no languages cell, required on ${shape}`);
    add({ id: "source", role: "source", priority: 9, text: sourceText, motion: "static" });

    const present = new Set(cells.map((c) => c.role));
    const missing = [...required].filter((r) => !present.has(r));
    if (missing.length) stop(`${shape}: required cells missing: ${missing.join(", ")}`);
    return {
      version: "0.1",
      kind: "evac-screen" as const,
      municipality: { id: m.id, name: m.name },
      alert: { source: "jma", bulletin_id: alert.bulletin_id, hazard: alert.hazard, level: situation.level, issued_at: alert.issued_at },
      shape,
      template: situation.template,
      cells,
      palette: "cabinet-office-5" as const,
      sources,
    };
  });
}
