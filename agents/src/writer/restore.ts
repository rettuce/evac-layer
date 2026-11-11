import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DRILL_PREFIX_JA, isSyntheticBulletinId, layoutStatus } from "../../../app/layout/gate";
import { ComposerStop, situationFor, type Situation } from "../composer/rules.js";
import { parseJmaXml, type Alert } from "../jma/parse.js";
import { syntheticFile, syntheticXmlPath } from "../jma/synthetic.js";
import { FEED_DIR, LAYOUTS_DIR, SAMPLES_DIR } from "../paths.js";
import type { BulletinStatus } from "./live.js";
import { writerMatchFor, type WriterMatch } from "./match.js";

export interface IndexRow { bulletin_id: string; file?: string; raw_title?: string; screen?: boolean; status?: string; synthetic?: boolean }

export function bulletinXmlPath(file: string): string {
  if (file.startsWith("synthetic/")) return syntheticXmlPath(file);
  return file.startsWith("jma-samples/") ? path.join(SAMPLES_DIR, file.slice("jma-samples/".length)) : path.join(FEED_DIR, file);
}

export function readIndexRows(layoutsDir: string, siteId: string): { municipality?: string; entries: IndexRow[] } | undefined {
  const file = path.join(layoutsDir, siteId, "index.json");
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as { municipality?: string; entries: IndexRow[] }) : undefined;
}

function sitesFirst(layoutsDir: string, siteId?: string): string[] {
  const all = fs.existsSync(layoutsDir) ? fs.readdirSync(layoutsDir).filter((s) => s !== siteId) : [];
  return siteId ? [siteId, ...all] : all;
}

const BULLETIN_ID = /^([A-Z0-9a-z]{6})-(\d{4})(\d{2})(\d{2})(\d{2})\d{2}-([0-9a-f]{12})$/;

// Without an index row the bulletin is looked for where it was read from: the recorded feed (a body is stored under
// the UTC day it was published) or the official samples, and recognised by the hash its id ends with.
function recordedXml(bulletinId: string): string | undefined {
  const m = bulletinId.match(BULLETIN_ID);
  if (!m) return undefined;
  const [, code, y, mo, d, h, sha] = m;
  const stream = code === "VXKOii" ? /_VXKO(\d\d|ii)[_.]/ : new RegExp(`_${code}[_.]`);
  const utc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9));
  const days = [0, 1].map((n) => new Date(utc.getTime() + n * 86_400_000).toISOString().slice(0, 10).replaceAll("-", ""));
  const dirs = [...days.map((day) => path.join(FEED_DIR, "bodies", day)), SAMPLES_DIR];
  for (const dir of dirs.filter((x) => fs.existsSync(x))) {
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".xml") && stream.test(n))) {
      const file = path.join(dir, name);
      if (crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 12) === sha) return file;
    }
  }
  return undefined;
}

export interface Restored { match: WriterMatch; alert?: Alert; situation?: Situation; issued_at: string; raw_title: string }

function fromXml(xmlFile: string, municipalityId: string, status: BulletinStatus): Restored | undefined {
  const alert = parseJmaXml(fs.readFileSync(xmlFile));
  let situation: Situation;
  try {
    situation = situationFor(alert, municipalityId);
  } catch (e) {
    if (e instanceof ComposerStop) return undefined;
    throw e;
  }
  return { match: writerMatchFor({ ...alert, status }, municipalityId, situation), alert, situation, issued_at: alert.issued_at, raw_title: alert.raw_title };
}

interface StoredLayout { template?: string; alert?: { hazard?: string; level?: number; issued_at?: string; status?: string }; cells?: { role?: string; text?: Record<string, unknown> }[] }

// The screens keep what the Writer wrote from: the headline the Composer set is the warning (or what ended), and the
// template and level are the class. A tsunami all-clear's caution and a flood forecast's river need more than that.
function fromLayout(dir: string, row: IndexRow | undefined, status: BulletinStatus, caution: { known: boolean; value?: Situation["caution"] }): Restored | undefined {
  const shape = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.endsWith(".json")) : undefined;
  if (!shape) return undefined;
  const layout = JSON.parse(fs.readFileSync(path.join(dir, shape), "utf8")) as StoredLayout;
  const warning = layout.cells?.find((c) => c.role === "headline")?.text?.ja;
  const hazard = layout.alert?.hazard;
  if (typeof warning !== "string" || !hazard || !layout.template || typeof layout.alert?.level !== "number") return undefined;
  if (hazard === "tsunami" && layout.template === "all-clear" && !caution.known) return undefined;
  let river: string | undefined;
  if (hazard === "flood") {
    const title = row?.raw_title;
    if (!title) return undefined;
    const kind = warning.startsWith(DRILL_PREFIX_JA) ? warning.slice(DRILL_PREFIX_JA.length) : warning;
    river = title.endsWith(kind) && title.length > kind.length ? title.slice(0, -kind.length) : title;
  }
  if (layoutStatus(layout) !== status && layoutStatus(layout) !== "normal") return undefined;
  return {
    match: { hazard, template: layout.template, level: layout.alert.level, status, warning, ...(caution.value ? { caution: caution.value } : {}), ...(river !== undefined ? { river } : {}) },
    issued_at: layout.alert.issued_at ?? "", raw_title: row?.raw_title ?? "",
  };
}

// The match of a Writer record written before matches were kept, read back from the bulletin it was written for. The
// status is the record's own; everything else comes from the bulletin's XML, or else from its stored screens.
export function restoreMatch(municipalityId: string, bulletinId: string, status: BulletinStatus, opts: {
  siteId?: string; layoutsDir?: string; caution?: { known: boolean; value?: Situation["caution"] }; xmlPath?: (file: string) => string;
} = {}): Restored | undefined {
  const layoutsDir = opts.layoutsDir ?? LAYOUTS_DIR;
  const xmlPath = opts.xmlPath ?? bulletinXmlPath;
  const found = sitesFirst(layoutsDir, opts.siteId).flatMap((site) => {
    const index = readIndexRows(layoutsDir, site);
    if (!index || (index.municipality && index.municipality !== municipalityId)) return [];
    const row = index.entries.find((e) => e.bulletin_id === bulletinId);
    return row ? [{ site, row }] : [];
  });
  const files = [
    ...found.flatMap(({ row }) => (row.file ? [xmlPath(row.file)] : [])),
    ...(isSyntheticBulletinId(bulletinId) ? [syntheticXmlPath(syntheticFile(municipalityId, bulletinId))] : []),
  ];
  const xml = files.find((f) => fs.existsSync(f)) ?? (isSyntheticBulletinId(bulletinId) ? undefined : recordedXml(bulletinId));
  if (xml) return fromXml(xml, municipalityId, status);
  for (const site of sitesFirst(layoutsDir, opts.siteId)) {
    const restored = fromLayout(path.join(layoutsDir, site, bulletinId), found.find((f) => f.site === site)?.row, status, opts.caution ?? { known: false });
    if (restored) return restored;
  }
  return undefined;
}
