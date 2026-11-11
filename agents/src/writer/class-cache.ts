import fs from "node:fs";
import path from "node:path";
import { APPROVALS_FILE, LAYOUTS_DIR } from "../paths.js";
import { cachedWriterForClass, cachedWriterRecord, recordedStatus, saveWriterForClass, screenClassFor, type ClassWriterRecord } from "./live.js";
import { bulletinXmlPath, readIndexRows, restoreMatch } from "./restore.js";

export { bulletinXmlPath };

export function writerOfBulletin(siteId: string, municipalityId: string, bulletinId: string, opts: { layoutsDir?: string; xmlPath?: (file: string) => string } = {}): ClassWriterRecord | undefined {
  const record = cachedWriterRecord(municipalityId, bulletinId);
  if (!record) return undefined;
  const restored = restoreMatch(municipalityId, bulletinId, record.status, { siteId, ...opts });
  if (!restored) return undefined;
  return {
    model: record.model, output: record.output, bulletin_id: bulletinId, issued_at: restored.issued_at, raw_title: restored.raw_title, status: record.status,
    ...(restored.match.caution ? { caution: restored.match.caution } : {}),
    match: record.match ?? restored.match,
    ...(record.blind ? { blind: true as const } : {}),
  };
}

export function classWriterRecord(municipalityId: string, cls: string, opts: { siteId?: string; layoutsDir?: string } = {}): ClassWriterRecord | undefined {
  const record = cachedWriterForClass(municipalityId, cls);
  if (!record || record.match) return record;
  const restored = restoreMatch(municipalityId, record.bulletin_id, recordedStatus(record), { ...opts, caution: { known: true, value: record.caution } });
  return restored ? { ...record, match: restored.match } : record;
}

export function approvedWriterForClass(siteId: string, municipalityId: string, cls: string, approvalsFile = APPROVALS_FILE, layoutsDir?: string): ClassWriterRecord | undefined {
  if (!fs.existsSync(approvalsFile)) return undefined;
  const record = (JSON.parse(fs.readFileSync(approvalsFile, "utf8")) as { classes?: Record<string, { approved: boolean; approved_from: string }> }).classes?.[`${siteId}/${cls}`];
  return record?.approved ? writerOfBulletin(siteId, municipalityId, record.approved_from, { layoutsDir }) : undefined;
}

export function cacheLatestWriterPerClass(opts: { layoutsDir?: string; xmlPath?: (file: string) => string; log?: (m: string) => void; municipalities?: ReadonlySet<string> } = {}): string[] {
  const layoutsDir = opts.layoutsDir ?? LAYOUTS_DIR;
  const log = opts.log ?? (() => {});
  const latest = new Map<string, { municipality: string; cls: string; bulletinId: string; record: ClassWriterRecord }>();
  const seen = new Set<string>();
  for (const site of fs.existsSync(layoutsDir) ? fs.readdirSync(layoutsDir) : []) {
    const index = readIndexRows(layoutsDir, site);
    if (!index?.municipality || (opts.municipalities && !opts.municipalities.has(index.municipality))) continue;
    for (const entry of index.entries.filter((e) => e.screen)) {
      const id = `${index.municipality}/${entry.bulletin_id}`;
      if (seen.has(id) || !cachedWriterRecord(index.municipality, entry.bulletin_id)) continue;
      seen.add(id);
      if (entry.file && !fs.existsSync((opts.xmlPath ?? bulletinXmlPath)(entry.file))) {
        log(`[skip] ${id}: ${(opts.xmlPath ?? bulletinXmlPath)(entry.file)} not found`);
        continue;
      }
      const record = writerOfBulletin(site, index.municipality, entry.bulletin_id, { layoutsDir, xmlPath: opts.xmlPath });
      if (!record?.match) {
        log(`[skip] ${id}: no class for it`);
        continue;
      }
      const cls = screenClassFor(record.match.hazard, { template: record.match.template as never, level: record.match.level });
      const key = `${index.municipality}/${cls}`;
      const best = latest.get(key);
      if (!best || Date.parse(record.issued_at) > Date.parse(best.record.issued_at)) latest.set(key, { municipality: index.municipality, cls, bulletinId: entry.bulletin_id, record });
    }
  }
  return [...latest.values()].map(({ municipality, cls, bulletinId, record }) => {
    saveWriterForClass(municipality, cls, record);
    return `${municipality}/${cls} ← ${bulletinId}`;
  });
}
