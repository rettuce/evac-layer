import fs from "node:fs";
import path from "node:path";
import type { Municipality, Site, WriterOutput } from "../composer/compose.js";
import { ComposerStop, situationFor, type Situation } from "../composer/rules.js";
import type { ReplayEntry } from "../jma/replay.js";
import { REPO_ROOT } from "../paths.js";
import { isSyntheticBulletinId } from "../../../app/layout/replay";
import { isSiteId, SITE_ID } from "../sites.js";
import type { CallUsage } from "../reader/pricing.js";
import { writeForBulletin, type LiveWriter, type WriterStep } from "../writer/step.js";
import { MAX_ATTEMPTS, runLoop } from "./loop.js";
import { LAYOUTS_DIR, writeReport } from "./report.js";
import type { Reviser, Verifier } from "./types.js";

export type IndexRow = Record<string, unknown> & { issued_at: string; bulletin_id: string };

export const PLACEHOLDER_NOTE = "文言は仮: Writer は API キー未設定のため未実行。見出しは気象庁の警報名をそのまま使い、それ以外は【仮】/[draft] のプレースホルダ。";
export const READER_MISSING_NOTE = "自治体 PDF 由来の情報なし: Reader 未実行のため避難所（国土地理院）と警報だけで構成。";

export function bulletinRow(e: ReplayEntry) {
  return { issued_at: e.issued_at, bulletin_id: e.bulletin_id, wmo_code: e.wmo_code, raw_title: e.alert.raw_title, municipality_level: e.municipality_level, file: e.file, ...(isSyntheticBulletinId(e.bulletin_id) ? { synthetic: true } : {}), ...(e.alert.status === "normal" ? {} : { status: e.alert.status }) };
}

export function screenRow(row: ReturnType<typeof bulletinRow>, a: { situation: Situation; verifier: Verifier; dir: string; report: { outcome: string; reason?: string; layouts: string[] } }) {
  const browserChecked = a.verifier.rendersScreens;
  const skipped = (a.verifier.skippedShapes ?? []).filter((shape) => a.report.layouts.some((f) => f.endsWith(`/${shape}.json`)));
  const { report } = a;
  return {
    ...row, screen: report.outcome === "pass" && browserChecked, template: a.situation.template, display_level: a.situation.level, outcome: report.outcome, verified_by: a.verifier.name,
    ...(report.outcome === "pass" && !browserChecked ? { reason: "not browser-verified" } : report.reason ? { reason: report.reason } : {}),
    layouts: report.layouts, report: path.relative(REPO_ROOT, path.join(a.dir, "report.json")),
    ...(skipped.length ? { browser_skipped: skipped } : {}),
  };
}

export function clearanceSkipReason(situation: Situation, hazard: string, showing: ReadonlySet<string>): string | undefined {
  if (!situation.cleared || showing.has(hazard)) return undefined;
  return `all-clear for ${hazard} but no ${hazard} screen was shown before; nothing to clear`;
}

export type WriterChoice =
  | { kind: "placeholder" }
  | { kind: "live"; live: LiveWriter }
  | { kind: "fixture"; writer: WriterOutput; source: string; reviser: Reviser };

export interface Composed {
  row: IndexRow;
  outcome: "pass" | "fail" | "stopped" | "no-screen";
  reason?: string;
  situation?: Situation;
  dir?: string;
  attempts?: { n: number; writer_source: string; findings: { shape: string; check: string; cell_id?: string }[] }[];
}

export async function composeBulletin(args: {
  entry: ReplayEntry; municipality: Municipality; readerRan: boolean; site: Site; verifier: Verifier; writer: WriterChoice;
  persistWriter?: boolean; usage?: CallUsage[]; maxAttempts?: number; roots?: { reports: string; layouts: string };
  skipIf?: (situation: Situation) => string | undefined;
}): Promise<Composed> {
  if (!isSiteId(args.site.id)) throw new Error(`site id "${args.site.id}" must match ${SITE_ID}`);
  const { entry: e, municipality } = args;
  const row = bulletinRow(e);
  let situation: Situation;
  try {
    situation = situationFor(e.alert, municipality.id);
  } catch (err) {
    if (!(err instanceof ComposerStop)) throw err;
    return noScreen(args, row, err.message);
  }
  const skipped = args.skipIf?.(situation);
  if (skipped) return { ...noScreen(args, row, skipped), situation };
  const step: WriterStep = args.writer.kind === "fixture"
    ? { writer: args.writer.writer, writerSource: args.writer.source, reviser: args.writer.reviser, afterLoop: () => {} }
    : await writeForBulletin({ alert: e.alert, municipality, situation, site: args.site }, {
      live: args.writer.kind === "live" ? args.writer.live : undefined, persist: args.persistWriter ?? true, usage: args.usage ?? [],
      newAtSite: !fs.existsSync(path.join(args.roots?.layouts ?? LAYOUTS_DIR, args.site.id, e.bulletin_id)),
    });
  const maxAttempts = args.maxAttempts ?? MAX_ATTEMPTS;
  const result = await runLoop({ alert: e.alert, municipality, site: args.site, writer: step.writer, writerSource: step.writerSource, verifier: args.verifier, reviser: step.reviser, maxAttempts });
  step.afterLoop(result);
  const notes = [...(step.writerSource === "placeholder" ? [PLACEHOLDER_NOTE] : []), ...(args.readerRan ? [] : [READER_MISSING_NOTE])].join(" ");
  const { dir, report } = writeReport({ siteId: args.site.id, municipalityId: municipality.id, roots: args.roots, bulletinId: e.bulletin_id, verifier: args.verifier.name, skippedShapes: args.verifier.skippedShapes, reviser: step.reviser.name, maxAttempts, result, writerNote: notes || undefined });
  const indexRow = screenRow(row, { situation, verifier: args.verifier, dir, report });
  upsertIndexRow({ layoutsRoot: args.roots?.layouts, site: args.site, municipality, row: indexRow });
  return { row: indexRow, outcome: report.outcome, reason: report.reason, situation, dir, attempts: report.attempts };
}

function noScreen(args: { roots?: { layouts: string }; site: Site; municipality: Municipality }, row: ReturnType<typeof bulletinRow>, reason: string): Composed {
  const composed: Composed = { row: { ...row, screen: false, reason }, outcome: "no-screen", reason };
  upsertIndexRow({ layoutsRoot: args.roots?.layouts, site: args.site, municipality: args.municipality, row: composed.row });
  return composed;
}

export function upsertIndexRow(args: { layoutsRoot?: string; site: Site; municipality: Municipality; row: IndexRow }): string {
  const file = path.join(args.layoutsRoot ?? LAYOUTS_DIR, args.site.id, "index.json");
  const doc = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as { entries: IndexRow[] })
    : { municipality: args.municipality.id, name: args.municipality.name, site: args.site.id, writer_note: "", entries: [] as IndexRow[] };
  const entries = [...doc.entries.filter((r) => r.bulletin_id !== args.row.bulletin_id), args.row].sort(byIssue);
  const partial = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(partial, JSON.stringify({ ...doc, entries }, null, 2) + "\n");
  fs.renameSync(partial, file);
  return file;
}

export function byIssue(a: { issued_at: string; file?: unknown }, b: { issued_at: string; file?: unknown }): number {
  return Date.parse(a.issued_at) - Date.parse(b.issued_at) || String(a.file ?? "").localeCompare(String(b.file ?? ""));
}

export function indexedBulletins(siteId: string, layoutsRoot = LAYOUTS_DIR): Set<string> {
  const file = path.join(layoutsRoot, siteId, "index.json");
  if (!fs.existsSync(file)) return new Set();
  return new Set((JSON.parse(fs.readFileSync(file, "utf8")) as { entries: IndexRow[] }).entries.map((r) => r.bulletin_id));
}
