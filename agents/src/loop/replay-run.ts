import path from "node:path";
import type { Site } from "../composer/compose.js";
import { ComposerStop, situationFor } from "../composer/rules.js";
import type { ReplayEntry } from "../jma/replay.js";
import { REPO_ROOT } from "../paths.js";
import { placeholderWriter } from "../writer/placeholder.js";
import { runLoop } from "./loop.js";
import { loadMunicipality } from "./municipality.js";
import { LAYOUTS_DIR, REPORTS_DIR, writeReport } from "./report.js";
import { liveWriterReviser } from "./revisers.js";
import { staticVerifier } from "./static-verifier.js";
import type { Verifier } from "./types.js";
import fs from "node:fs";

const PLACEHOLDER_NOTE = "文言は仮: Writer は API キー未設定のため未実行。見出しは気象庁の警報名をそのまま使い、それ以外は【仮】/[draft] のプレースホルダ。";

export interface ReplayEvent { municipality: string; issued_at: string; template?: string; level?: number | null; outcome: "pass" | "fail" | "stopped" | "no-screen"; reason?: string }

export interface ReplaySummary { municipality: string; name: string; bulletins: number; screens: number; pass: number; fail: number; no_screen: number; layouts: number; seconds: number }

export async function runReplay(args: { municipalityId: string; entries: ReplayEntry[]; site: Site; verifier: Verifier; onEvent?: (e: ReplayEvent) => void; persist?: boolean }): Promise<ReplaySummary> {
  const persist = args.persist ?? true;
  const t0 = Date.now();
  const { municipality, readerRan } = loadMunicipality(args.municipalityId);
  // A replay regenerates the municipality's whole output, so screens from an earlier run cannot linger.
  if (persist) {
    fs.rmSync(path.join(LAYOUTS_DIR, municipality.id), { recursive: true, force: true });
    if (fs.existsSync(REPORTS_DIR)) for (const d of fs.readdirSync(REPORTS_DIR)) if (d.startsWith(`${municipality.id}-`)) fs.rmSync(path.join(REPORTS_DIR, d), { recursive: true, force: true });
  }
  const notes = [PLACEHOLDER_NOTE, ...(readerRan ? [] : ["自治体 PDF 由来の情報なし: Reader 未実行のため避難所（国土地理院）と警報だけで構成。"])].join(" ");
  // Only a pass that went through the renderer may be shown; a static-only pass has not been seen on a screen.
  const browserChecked = args.verifier !== staticVerifier;
  const index = [];
  let pass = 0, fail = 0, noScreen = 0, layouts = 0;
  // A clearance only means something to people who saw the warning; per hazard, all-clear follows a shown screen.
  const showing = new Set<string>();
  for (const e of args.entries) {
    const row = { issued_at: e.issued_at, bulletin_id: e.bulletin_id, wmo_code: e.wmo_code, raw_title: e.alert.raw_title, municipality_level: e.municipality_level };
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
    if (situation.cleared && !showing.has(e.alert.hazard)) {
      const reason = `all-clear for ${e.alert.hazard} but no ${e.alert.hazard} screen was shown before; nothing to clear`;
      index.push({ ...row, screen: false, reason });
      noScreen++;
      args.onEvent?.({ municipality: municipality.id, issued_at: e.issued_at, outcome: "no-screen", reason });
      continue;
    }
    const result = await runLoop({
      alert: e.alert, municipality, site: args.site,
      writer: placeholderWriter(e.alert, municipality.id, situation.level, situation.cleared), writerSource: "placeholder",
      verifier: args.verifier, reviser: liveWriterReviser,
    });
    const { dir, report } = persist
      ? writeReport({ municipalityId: municipality.id, bulletinId: e.bulletin_id, verifier: args.verifier.name, reviser: liveWriterReviser.name, maxAttempts: 3, result, writerNote: notes })
      : { dir: "", report: { outcome: result.outcome, reason: result.reason, layouts: result.screens.map((x) => `${x.shape}.json`) } };
    const screen = report.outcome === "pass" && browserChecked;
    if (report.outcome === "pass") pass++; else fail++;
    if (screen) {
      if (situation.cleared) showing.delete(e.alert.hazard);
      else showing.add(e.alert.hazard);
    }
    layouts += report.layouts.length;
    index.push({
      ...row, screen, template: situation.template, display_level: situation.level, outcome: report.outcome, verified_by: args.verifier.name,
      ...(report.outcome === "pass" && !browserChecked ? { reason: "not browser-verified" } : report.reason ? { reason: report.reason } : {}),
      layouts: report.layouts, report: path.relative(REPO_ROOT, path.join(dir, "report.json")),
    });
    args.onEvent?.({ municipality: municipality.id, issued_at: e.issued_at, template: situation.template, level: situation.level, outcome: report.outcome, reason: report.reason });
  }
  const indexFile = path.join(LAYOUTS_DIR, municipality.id, "index.json");
  if (persist) fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  if (persist) fs.writeFileSync(indexFile, JSON.stringify({ municipality: municipality.id, name: municipality.name, site: args.site.id, writer_note: notes, entries: index }, null, 2) + "\n");
  return { municipality: municipality.id, name: municipality.name, bulletins: args.entries.length, screens: pass + fail, pass, fail, no_screen: noScreen, layouts, seconds: (Date.now() - t0) / 1000 };
}
