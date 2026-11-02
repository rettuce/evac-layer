import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";

export interface Approvals {
  version: "0.1";
  layouts: Record<string, { approved: boolean; updated_at: string }>;
  sites: Record<string, { auto_publish: boolean; updated_at: string }>;
}

export const APPROVALS_FILE = path.join(REPO_ROOT, "data", "approvals.json");

export function readApprovals(file = APPROVALS_FILE): Approvals {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { version: "0.1", layouts: {}, sites: {} };
}

// Same rule as the renderer's live gate (app/server/utils/gate.ts): an operator approved the bulletin and the
// site has auto publish on. The export also reads screens through /api/live-layout, which enforces it again.
export function exportable(a: Approvals, site: string, municipality: string, bulletinId: string): "ok" | "auto-publish-off" | "unapproved" {
  if (!a.sites[site]?.auto_publish) return "auto-publish-off";
  if (!a.layouts[`${municipality}/${bulletinId}`]?.approved) return "unapproved";
  return "ok";
}
