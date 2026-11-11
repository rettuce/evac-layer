import fs from "node:fs";
import path from "node:path";
import { headlineTables } from "../composer/headline.js";
import { situationFor } from "../composer/rules.js";
import { replayEntry } from "../jma/replay.js";
import { classListing, prefectureOf, type ClassListing, type SyntheticPlan } from "../jma/synthetic-classes.js";
import { saveSyntheticXml, synthesizeXml, syntheticBulletinId } from "../jma/synthetic.js";
import { LAYOUTS_DIR } from "../paths.js";
import type { CallUsage } from "../reader/pricing.js";
import { isSiteId, SITE_ID, siteMunicipality, type SiteFile } from "../sites.js";
import { cachedWriterRecord, saveWriterForClass, screenClassFor } from "../writer/live.js";
import { loadMunicipality } from "./municipality.js";
import { composeBulletin, type WriterChoice } from "./one.js";
import { migrateBulletinStatus } from "./status-migration.js";
import type { Verifier } from "./types.js";

export interface GenerationRow {
  class: string;
  outcome: "pass" | "fail" | "stopped" | "no-screen" | "unsupported" | "error";
  approvable: boolean;
  bulletin_id?: string;
  file?: string;
  writer_source?: string;
  screen?: boolean;
  reasons: string[];
}

// composable: every class this command composes for the municipality, so that a reader can tell a class it can remake
// from one only a real bulletin can, whichever classes a run was limited to.
export interface Generation { site: string; municipality: string; generated_at: string; verifier: string; writer: string; composable: string[]; classes: GenerationRow[] }

export const PLACEHOLDER_REASON = "placeholder wording ([draft]): compose again with --writer live, or once the class has wording, before approving";
export const UNREVIEWED_REASON = "the ja_easy headline table (data/jma/warning-names-ja-easy.json) is not reviewed: approving this bulletin writes its class approval, but the class approval opens no screen until the table is marked reviewed";

export function generationExitCode(rows: readonly GenerationRow[]): number {
  return rows.some((r) => r.outcome === "stopped" || r.outcome === "fail" || r.outcome === "error") ? 1 : 0;
}

export function generationFile(siteId: string, layoutsDir = LAYOUTS_DIR): string {
  return path.join(layoutsDir, siteId, "generation.json");
}

export function plansFor(municipalityId: string, wanted?: readonly string[]): ClassListing[] {
  const all = classListing(municipalityId);
  if (!wanted?.length) return all;
  const unknown = wanted.filter((cls) => !all.some((c) => c.cls === cls));
  if (unknown.length) throw new Error(`unknown class ${unknown.join(", ")}; known: ${all.map((c) => c.cls).join(", ")}`);
  return all.filter((c) => wanted.includes(c.cls));
}

async function generateClass(plan: SyntheticPlan, args: {
  site: SiteFile; municipalityId: string; verifier: Verifier; writer: WriterChoice; usage: CallUsage[]; roots?: { reports: string; layouts: string };
}): Promise<GenerationRow> {
  const { municipality, readerRan } = loadMunicipality(args.municipalityId);
  const prefecture = (municipality as { prefecture?: string }).prefecture ?? prefectureOf(args.municipalityId);
  const xml = synthesizeXml(plan, { municipalityId: municipality.id, municipalityName: municipality.name, prefecture });
  const bulletinId = syntheticBulletinId(xml);
  const file = saveSyntheticXml(municipality.id, bulletinId, xml);
  const entry = replayEntry(Buffer.from(xml, "utf8"), file, plan.code, municipality.id);
  const composedClass = screenClassFor(entry.alert.hazard, situationFor(entry.alert, municipality.id));
  if (composedClass !== plan.cls) throw new Error(`synthetic bulletin for ${plan.cls} composes as ${composedClass}`);

  const composed = await composeBulletin({ entry, municipality, readerRan, site: args.site, verifier: args.verifier, writer: args.writer, usage: args.usage, roots: args.roots });
  const writerSource = composed.attempts?.at(-1)?.writer_source;
  const screen = composed.row.screen === true;
  const reasons = [
    ...(composed.reason ? [composed.reason] : []),
    ...(composed.row.reason && composed.row.reason !== composed.reason ? [String(composed.row.reason)] : []),
    ...(writerSource === "placeholder" ? [PLACEHOLDER_REASON] : []),
    ...(composed.outcome === "pass" && !headlineTables().easy.reviewed ? [UNREVIEWED_REASON] : []),
  ];
  const record = cachedWriterRecord(municipality.id, bulletinId);
  if (composed.outcome === "pass" && writerSource !== "placeholder" && record?.match) {
    saveWriterForClass(municipality.id, plan.cls, {
      model: record.model, output: record.output, bulletin_id: bulletinId, issued_at: entry.alert.issued_at, raw_title: entry.alert.raw_title, status: entry.alert.status,
      ...(record.match.caution ? { caution: record.match.caution } : {}), match: record.match, ...(record.blind ? { blind: true as const } : {}),
    });
  }
  return {
    class: plan.cls, outcome: composed.outcome, approvable: screen && writerSource !== undefined && writerSource !== "placeholder",
    bulletin_id: bulletinId, file, ...(writerSource ? { writer_source: writerSource } : {}), screen, reasons,
  };
}

export async function generateSite(args: {
  site: SiteFile; classes?: readonly string[]; verifier: Verifier; writer: WriterChoice; usage?: CallUsage[];
  roots?: { reports: string; layouts: string }; log?: (m: string) => void; now?: () => Date;
}): Promise<Generation> {
  if (!isSiteId(args.site.id)) throw new Error(`site id "${args.site.id}" must match ${SITE_ID}`);
  const municipalityId = siteMunicipality(args.site);
  const out = generationFile(args.site.id, args.roots?.layouts);
  const relative = path.relative(args.roots?.layouts ?? LAYOUTS_DIR, out);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`site id "${args.site.id}" would write outside the layouts directory`);
  const log = args.log ?? (() => {});
  migrateBulletinStatus(args.site.id, { layoutsDir: args.roots?.layouts, log });
  const rows: GenerationRow[] = [];
  for (const plan of plansFor(municipalityId, args.classes)) {
    let row: GenerationRow;
    if (!plan.supported) {
      row = { class: plan.cls, outcome: "unsupported", approvable: false, reasons: [plan.reason] };
    } else {
      try {
        row = await generateClass(plan, { site: args.site, municipalityId, verifier: args.verifier, writer: args.writer, usage: args.usage ?? [], roots: args.roots });
      } catch (e) {
        row = { class: plan.cls, outcome: "error", approvable: false, reasons: [(e as Error).message] };
      }
    }
    rows.push(row);
    log(`  [${args.site.id}] ${row.class.padEnd(26)} ${row.outcome.padEnd(11)} ${row.approvable ? "approvable" : "-"} ${row.bulletin_id ?? ""}${row.reasons.length ? ` — ${row.reasons.join("; ")}` : ""}`);
  }
  const generation: Generation = {
    site: args.site.id, municipality: municipalityId, generated_at: (args.now ?? (() => new Date()))().toISOString(),
    verifier: args.verifier.name, writer: args.writer.kind, composable: classListing(municipalityId).filter((c) => c.supported).map((c) => c.cls), classes: rows,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.tmp`, JSON.stringify(generation, null, 2) + "\n");
  fs.renameSync(`${out}.tmp`, out);
  return generation;
}
