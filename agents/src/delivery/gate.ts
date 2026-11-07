import fs from "node:fs";
import path from "node:path";
import { APPROVALS_FILE } from "../paths.js";
import { readSites, siteMunicipality, type SiteFile } from "../sites.js";
import { type ClassApproval, type LayoutClass, classDigest, classKey, layoutDigest, liveLayoutGateWith, passedBrowserCheck, screenClass } from "../../../app/layout/gate";

export interface Approvals {
  version: "0.1";
  layouts: Record<string, { approved: boolean; updated_at: string; digest?: string }>;
  sites: Record<string, { auto_publish: boolean; updated_at: string }>;
  classes?: Record<string, ClassApproval>;
}

export { APPROVALS_FILE };

const LEGACY_KEY = /^(\d{5})\/(.+)$/;

export function migrateApprovalKeys(a: Approvals, sites: readonly SiteFile[], warn: (m: string) => void = console.warn): Approvals {
  const siteIds = new Set(sites.map((s) => s.id));
  const layouts: Approvals["layouts"] = {};
  for (const [key, record] of Object.entries(a.layouts)) {
    const m = key.match(LEGACY_KEY);
    if (!m || siteIds.has(m[1])) {
      layouts[key] = record;
      continue;
    }
    const owners = sites.filter((s) => siteMunicipality(s) === m[1]);
    if (owners.length !== 1) {
      warn(`[warn] approval ${key} uses the old <municipality>/<bulletin> key and municipality ${m[1]} has ${owners.length} sites; ignored. Approve it again per site.`);
      continue;
    }
    layouts[`${owners[0].id}/${m[2]}`] ??= record;
  }
  return { ...a, layouts };
}

export function readApprovals(file = APPROVALS_FILE, sites: readonly SiteFile[] = readSites()): Approvals {
  const raw: Approvals = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: "0.1", layouts: {}, sites: {} };
  return migrateApprovalKeys(raw, sites);
}

export function exportGate(a: Approvals, site: string, bulletinId: string, digest?: string, cls?: LayoutClass) {
  const { gate, by } = liveLayoutGateWith(a, site, bulletinId, digest, cls);
  const record = by === "bulletin" ? a.layouts[`${site}/${bulletinId}`] : by === "class" && cls ? a.classes?.[classKey(site, cls.key)] : undefined;
  return { gate, approved_at: record?.updated_at };
}

function layoutFilesOf(dir: string): { shape: string; body: string }[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /^[0-9x]+\.json$|^pillar\.json$/.test(f)).sort();
  return files.map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") }));
}

export function layoutDigestOf(dir: string): string | undefined {
  const files = layoutFilesOf(dir);
  return files.length ? layoutDigest(files) : undefined;
}

export function layoutClassOf(dir: string, reportFile: string): LayoutClass | undefined {
  const files = layoutFilesOf(dir);
  if (!files.length) return undefined;
  const report = fs.existsSync(reportFile) ? (JSON.parse(fs.readFileSync(reportFile, "utf8")) as { outcome?: string; verifier?: string }) : undefined;
  return { key: screenClass(JSON.parse(files[0].body)), digest: classDigest(files), checked: passedBrowserCheck(report) };
}
