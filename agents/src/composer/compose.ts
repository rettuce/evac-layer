import type { LayoutCell, Shape } from "../../../app/layout/types";
import type { Alert } from "../jma/parse.js";
import type { Lang } from "../writer/request.js";
import { CHAR_BUDGETS } from "./budgets.js";
import { shapeContract } from "./template.js";
import { ACTION_PICTOGRAM, BudgetExceeded, ComposerStop, HAZARD_PICTOGRAM, LANGUAGES_REQUIRED_ON, SHAPE_ORDER, SHELTER_HAZARDS, situationFor } from "./rules.js";

export interface WriterCell { role: string; text: Partial<Record<Lang, string>> & { ja: string }; basis: string }
export interface WriterOutput { cells: WriterCell[] }

export interface Site {
  id: string;
  municipality_id: string;
  lat: number;
  lng: number;
  direction: { text_ja: string; rotation: number };
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

function hhmm(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/) ?? stop(`issued_at ${iso} has no time`);
  return `${m[1]}:${m[2]}`;
}

function writerFor(writer: WriterOutput | Partial<Record<Shape, WriterOutput>>, shape: Shape): WriterOutput {
  if ("cells" in writer) return writer as WriterOutput;
  return (writer as Partial<Record<Shape, WriterOutput>>)[shape] ?? stop(`no Writer output for shape ${shape}`);
}

function checkBudget(shape: Shape, cell: WriterCell) {
  const budget = CHAR_BUDGETS[shape].find((b) => b.role === cell.role);
  for (const [lang, max] of Object.entries(budget?.max_chars ?? {})) {
    const t = cell.text[lang as Lang];
    if (t !== undefined && [...t].length > max!) throw new BudgetExceeded(shape, cell.role, lang, [...t].length, max!, t);
  }
}

export function compose(input: { alert: Alert; municipality: Municipality; site: Site; writer: WriterOutput | Partial<Record<Shape, WriterOutput>> }) {
  const { alert, municipality: m, site } = input;
  if (site.municipality_id !== m.id) stop(`site ${site.id} belongs to ${site.municipality_id}, not ${m.id}`);
  const situation = situationFor(alert, m.id);
  const { shelter, distance_m } = pickShelter(m, site, alert.hazard);
  const hazardEntry = m.hazards.find((h) => h.type === alert.hazard);
  const pdfTitle = hazardEntry ? m.sources.find((s) => s.file === hazardEntry.source.file)?.title ?? hazardEntry.source.file : null;
  const gsiFile = shelter.source.file;
  const sourceText = [
    pdfTitle ? `${m.name} ${pdfTitle} p.${hazardEntry!.source.page}` : null,
    "国土地理院 指定緊急避難場所データ",
    `気象庁 ${hhmm(alert.issued_at)}`,
  ].filter(Boolean).join(" / ");
  const sources = [
    ...(hazardEntry ? [{ type: "pdf" as const, file: hazardEntry.source.file, page: hazardEntry.source.page }] : []),
    { type: "gsi" as const, file: gsiFile },
    { type: "jma" as const, bulletin_id: alert.bulletin_id },
  ];

  return SHAPE_ORDER.map((shape) => {
    const { slots, required } = shapeContract(situation.template, shape);
    const w = writerFor(input.writer, shape);
    const text = (role: string) => {
      const c = w.cells.find((x) => x.role === role);
      if (c) checkBudget(shape, c);
      return c?.text;
    };
    const cells: LayoutCell[] = [];
    const add = (cell: LayoutCell) => { if (slots.has(cell.role)) cells.push(cell); };
    add({ id: "headline", role: "headline", priority: 1, text: text("headline") ?? stop("Writer output has no headline"), pictogram: HAZARD_PICTOGRAM[alert.hazard], motion: "scale-in" });
    add({ id: "action", role: "action", priority: 1, text: text("action") ?? stop("Writer output has no action"), pictogram: ACTION_PICTOGRAM[alert.hazard], motion: "pulse" });
    add({ id: "direction", role: "direction", priority: 2, text: text("direction") ?? { ja: site.direction.text_ja }, pictogram: "arrow_forward", rotation: site.direction.rotation, motion: "static" });
    add({ id: "shelter", role: "shelter", priority: 2, text: { ja: `${shelter.name}（指定緊急避難場所）` }, pictogram: "emergency_evacuation_site", distance_m, motion: "static" });
    const languages = text("languages");
    if (languages) add({ id: "languages", role: "languages", priority: 3, text: languages, motion: "static" });
    else if (LANGUAGES_REQUIRED_ON.includes(shape)) stop(`Writer output has no languages cell, required on ${shape}`);
    add({ id: "source", role: "source", priority: 9, text: { ja: `出典: ${sourceText}` }, motion: "static" });

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
