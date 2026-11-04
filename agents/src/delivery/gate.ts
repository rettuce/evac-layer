import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";
import { layoutDigest } from "../../../app/layout/gate";

export interface Approvals {
  version: "0.1";
  layouts: Record<string, { approved: boolean; updated_at: string; digest?: string }>;
  sites: Record<string, { auto_publish: boolean; updated_at: string }>;
}

export const APPROVALS_FILE = path.join(REPO_ROOT, "data", "approvals.json");

export function readApprovals(file = APPROVALS_FILE): Approvals {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: "0.1", layouts: {}, sites: {} };
}

// Same rule as the renderer's live gate (app/server/utils/gate.ts): an operator approved the bulletin and the
// site has auto publish on. The export also reads screens through /api/live-layout, which enforces it again.
export function exportable(a: Approvals, site: string, municipality: string, bulletinId: string, digest?: string): "ok" | "auto-publish-off" | "unapproved" | "stale" {
  if (!a.sites[site]?.auto_publish) return "auto-publish-off";
  const record = a.layouts[`${municipality}/${bulletinId}`];
  if (!record?.approved) return "unapproved";
  if (digest !== undefined && record.digest !== undefined && record.digest !== digest) return "stale";
  return "ok";
}

// The digest the renderer's approval is bound to: the bulletin's shape files, byte for byte.
export function layoutDigestOf(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => /^[0-9x]+\.json$|^pillar\.json$/.test(f)).sort();
  if (!files.length) return undefined;
  return layoutDigest(files.map((f) => ({ shape: f.slice(0, -5), body: fs.readFileSync(path.join(dir, f), "utf8") })));
}
