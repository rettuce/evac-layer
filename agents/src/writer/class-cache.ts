import fs from "node:fs";
import path from "node:path";
import { ComposerStop, situationFor, type Situation } from "../composer/rules.js";
import { parseJmaXml, type Alert } from "../jma/parse.js";
import { APPROVALS_FILE, FEED_DIR, LAYOUTS_DIR, SAMPLES_DIR } from "../paths.js";
import { cachedWriterRecord, saveWriterForClass, screenClassFor, type ClassWriterRecord } from "./live.js";

export function bulletinXmlPath(file: string): string {
  return file.startsWith("jma-samples/") ? path.join(SAMPLES_DIR, file.slice("jma-samples/".length)) : path.join(FEED_DIR, file);
}

interface IndexEntry { bulletin_id: string; file: string; screen?: boolean }

export function writerOfBulletin(siteId: string, municipalityId: string, bulletinId: string, opts: { layoutsDir?: string; xmlPath?: (file: string) => string } = {}): ClassWriterRecord | undefined {
  const record = cachedWriterRecord(municipalityId, bulletinId);
  const indexFile = path.join(opts.layoutsDir ?? LAYOUTS_DIR, siteId, "index.json");
  if (!record || !fs.existsSync(indexFile)) return undefined;
  const row = (JSON.parse(fs.readFileSync(indexFile, "utf8")) as { entries: IndexEntry[] }).entries.find((e) => e.bulletin_id === bulletinId);
  const xml = row && (opts.xmlPath ?? bulletinXmlPath)(row.file);
  if (!xml || !fs.existsSync(xml)) return undefined;
  const alert = parseJmaXml(fs.readFileSync(xml));
  let situation: Situation;
  try {
    situation = situationFor(alert, municipalityId);
  } catch (e) {
    if (e instanceof ComposerStop) return undefined;
    throw e;
  }
  return {
    model: record.model, output: record.output, bulletin_id: bulletinId, issued_at: alert.issued_at, raw_title: alert.raw_title, status: alert.status,
    ...(situation.caution ? { caution: situation.caution } : {}),
    ...(record.match ? { match: record.match } : {}),
  };
}

export function approvedWriterForClass(siteId: string, municipalityId: string, cls: string, approvalsFile = APPROVALS_FILE): ClassWriterRecord | undefined {
  if (!fs.existsSync(approvalsFile)) return undefined;
  const record = (JSON.parse(fs.readFileSync(approvalsFile, "utf8")) as { classes?: Record<string, { approved: boolean; approved_from: string }> }).classes?.[`${siteId}/${cls}`];
  return record?.approved ? writerOfBulletin(siteId, municipalityId, record.approved_from) : undefined;
}

export function cacheLatestWriterPerClass(opts: { layoutsDir?: string; xmlPath?: (file: string) => string; log?: (m: string) => void; municipalities?: ReadonlySet<string> } = {}): string[] {
  const layoutsDir = opts.layoutsDir ?? LAYOUTS_DIR;
  const xmlPath = opts.xmlPath ?? bulletinXmlPath;
  const log = opts.log ?? (() => {});
  const latest = new Map<string, { municipality: string; cls: string; alert: Alert; situation: Situation }>();
  const seen = new Set<string>();
  for (const site of fs.existsSync(layoutsDir) ? fs.readdirSync(layoutsDir) : []) {
    const indexFile = path.join(layoutsDir, site, "index.json");
    if (!fs.existsSync(indexFile)) continue;
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { municipality: string; entries: IndexEntry[] };
    if (opts.municipalities && !opts.municipalities.has(index.municipality)) continue;
    for (const entry of index.entries.filter((e) => e.screen)) {
      const id = `${index.municipality}/${entry.bulletin_id}`;
      if (seen.has(id) || !cachedWriterRecord(index.municipality, entry.bulletin_id)) continue;
      seen.add(id);
      const xml = xmlPath(entry.file);
      if (!fs.existsSync(xml)) {
        log(`[skip] ${id}: ${xml} not found`);
        continue;
      }
      const alert = parseJmaXml(fs.readFileSync(xml));
      let situation: Situation;
      try {
        situation = situationFor(alert, index.municipality);
      } catch (e) {
        if (!(e instanceof ComposerStop)) throw e;
        log(`[skip] ${id}: ${e.message}`);
        continue;
      }
      const cls = screenClassFor(alert.hazard, situation);
      const key = `${index.municipality}/${cls}`;
      const best = latest.get(key);
      if (!best || Date.parse(alert.issued_at) > Date.parse(best.alert.issued_at)) latest.set(key, { municipality: index.municipality, cls, alert, situation });
    }
  }
  return [...latest.values()].map(({ municipality, cls, alert, situation }) => {
    const record = cachedWriterRecord(municipality, alert.bulletin_id)!;
    saveWriterForClass(municipality, cls, {
      model: record.model, output: record.output, bulletin_id: alert.bulletin_id, issued_at: alert.issued_at, raw_title: alert.raw_title, status: alert.status,
      ...(situation.caution ? { caution: situation.caution } : {}),
      ...(record.match ? { match: record.match } : {}),
    });
    return `${municipality}/${cls} ← ${alert.bulletin_id}`;
  });
}
