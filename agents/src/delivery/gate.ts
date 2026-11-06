import fs from "node:fs";
import path from "node:path";
import { APPROVALS_FILE } from "../paths.js";
import { readSites, siteMunicipality, type SiteFile } from "../sites.js";
import { layoutDigest } from "../../../app/layout/gate";

export interface Approvals {
  version: "0.1";
  layouts: Record<string, { approved: boolean; updated_at: string; digest?: string }>;
  sites: Record<string, { auto_publish: boolean; updated_at: string }>;
}

export { APPROVALS_FILE };

const LEGACY_KEY = /^(\d{5})\/(.+)$/;

// Approvals made before layouts moved under site ids are keyed <municipality>/<bulletin>. Such a key still means
// "this screen" only while the municipality has exactly one site; with two or more it is ambiguous and dropped.
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

// Same rule as the renderer's live gate (app/server/utils/gate.ts): an operator approved the bulletin and the
// site has auto publish on. The export also reads screens through /api/live-layout, which enforces it again.
export function exportable(a: Approvals, site: string, bulletinId: string, digest?: string): "ok" | "auto-publish-off" | "unapproved" | "stale" {
  if (!a.sites[site]?.auto_publish) return "auto-publish-off";
  const record = a.layouts[`${site}/${bulletinId}`];
  if (!record?.approved) return "unapproved";
  if (digest !== undefined && record.digest !== digest) return "stale";
  return "ok";
}

// The digest the renderer's approval is bound to: the bulletin's shape files, byte for byte.
export function layoutDigestOf(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => /^[0-9x]+\.json$|^pillar\.json$/.test(f)).sort();
  if (!files.length) return undefined;
  return layoutDigest(files.map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") })));
}
