import path from "node:path";
import type { Site } from "../composer/compose.js";
import { ComposerStop, situationFor } from "../composer/rules.js";
import type { ReplayEntry } from "../jma/replay.js";
import { runLoop } from "./loop.js";
import { loadMunicipality } from "./municipality.js";
import { LAYOUTS_DIR, REPORTS_DIR, writeReport } from "./report.js";
import { PLACEHOLDER_NOTE, READER_MISSING_NOTE, bulletinRow, clearanceSkipReason, screenRow } from "./one.js";
import { writeForBulletin, type LiveWriter } from "../writer/step.js";
import type { CallUsage } from "../reader/pricing.js";
import type { Verifier } from "./types.js";
import fs from "node:fs";


export interface ReplayEvent { municipality: string; issued_at: string; template?: string; level?: number | null; outcome: "pass" | "fail" | "stopped" | "no-screen"; reason?: string }

export interface ReplaySummary { municipality: string; name: string; bulletins: number; screens: number; pass: number; fail: number; no_screen: number; layouts: number; seconds: number; writer_usd: number; writer_tokens: PromptTokens }

export interface PromptTokens { input: number; cache_write: number; cache_read: number }
export function promptTokens(usage: { input: number; cache_write: number; cache_read: number }[]): PromptTokens {
  return usage.reduce((a, u) => ({ input: a.input + u.input, cache_write: a.cache_write + u.cache_write, cache_read: a.cache_read + u.cache_read }), { input: 0, cache_write: 0, cache_read: 0 });
}

export async function runReplay(args: { municipalityId: string; entries: ReplayEntry[]; site: Site; verifier: Verifier; onEvent?: (e: ReplayEvent) => void; persist?: boolean; writer?: LiveWriter; roots?: { reports: string; layouts: string } }): Promise<ReplaySummary> {
  const persist = args.persist ?? true;
  const t0 = Date.now();
  const { municipality, readerRan } = loadMunicipality(args.municipalityId);
  const layoutsRoot = args.roots?.layouts ?? LAYOUTS_DIR;
  const reportsRoot = args.roots?.reports ?? REPORTS_DIR;
  if (persist) {
    fs.rmSync(path.join(layoutsRoot, args.site.id), { recursive: true, force: true });
    fs.rmSync(path.join(reportsRoot, args.site.id), { recursive: true, force: true });
  }
  const live = args.writer;
  const writerUsage: CallUsage[] = [];
  const notes = [...(live ? [] : [PLACEHOLDER_NOTE]), ...(readerRan ? [] : [READER_MISSING_NOTE])].join(" ");
  const index: unknown[] = [];
  let pass = 0, fail = 0, noScreen = 0, layouts = 0;
  const showing = new Set<string>();
  for (const e of args.entries) {
    const row = bulletinRow(e);
    let situation;
    try {
      situation = situationFor(e.alert, municipality.id);
    } catch (err) {
      if (!(err instanceof ComposerStop)) throw err;
      index.push({ ...row, screen: false, reason: err.message });
      noScreen++;
      args.onEvent?.({ municipality: municipality.id, issued_at: e.issued_at, outcome: "no-screen", reason: err.message });
      continue;
    }
    const reason = clearanceSkipReason(situation, e.alert.hazard, showing);
    if (reason) {
      index.push({ ...row, screen: false, reason });
      noScreen++;
      args.onEvent?.({ municipality: municipality.id, issued_at: e.issued_at, outcome: "no-screen", reason });
      continue;
    }
    const step = await writeForBulletin({ alert: e.alert, municipality, situation }, { live, persist, usage: writerUsage });
    const result = await runLoop({
      alert: e.alert, municipality, site: args.site,
      writer: step.writer, writerSource: step.writerSource,
      verifier: args.verifier, reviser: step.reviser,
    });
    step.afterLoop(result);
    const { dir, report } = persist
      ? writeReport({ siteId: args.site.id, municipalityId: municipality.id, roots: args.roots, bulletinId: e.bulletin_id, verifier: args.verifier.name, reviser: step.reviser.name, maxAttempts: 3, result, writerNote: notes || undefined })
      : { dir: "", report: { outcome: result.outcome, reason: result.reason, layouts: result.screens.map((x) => `${x.shape}.json`) } };
    const indexRow = screenRow(row, { situation, verifier: args.verifier, dir, report });
    const screen = indexRow.screen;
    if (report.outcome === "pass") pass++; else fail++;
    if (screen) {
      if (situation.cleared) showing.delete(e.alert.hazard);
      else showing.add(e.alert.hazard);
    }
    layouts += report.layouts.length;
    index.push(indexRow);
    args.onEvent?.({ municipality: municipality.id, issued_at: e.issued_at, template: situation.template, level: situation.level, outcome: report.outcome, reason: report.reason });
  }
  const indexFile = path.join(layoutsRoot, args.site.id, "index.json");
  if (persist) fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  if (persist) fs.writeFileSync(indexFile, JSON.stringify({ municipality: municipality.id, name: municipality.name, site: args.site.id, writer_note: notes, entries: index }, null, 2) + "\n");
  return { municipality: municipality.id, name: municipality.name, bulletins: args.entries.length, screens: pass + fail, pass, fail, no_screen: noScreen, layouts, seconds: (Date.now() - t0) / 1000, writer_usd: writerUsage.reduce((n, u) => n + u.usd, 0), writer_tokens: promptTokens(writerUsage) };
}
