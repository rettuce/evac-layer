import fs from "node:fs";
import path from "node:path";
import { LAYOUTS_DIR, LIVE_DIR, REPORTS_DIR } from "../paths.js";
import { exportable, layoutClassOf, layoutDigestOf, readApprovals } from "./gate.js";

export const REPLAY_SITE_MESSAGE = (siteId: string) => `site ${siteId} replays a recorded record; remove "replay" from its site file to drive it live`;

export function writeLive(siteId: string, bulletinId: string | null, dir = LIVE_DIR): { file: string; doc: { bulletin_id: string | null; updated_at: string } } {
  const file = path.join(dir, `${siteId}.json`);
  const doc = { bulletin_id: bulletinId, updated_at: new Date().toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
  return { file, doc };
}

export function liveGateWarning(siteId: string, bulletinId: string, roots: { layouts: string; reports: string } = { layouts: LAYOUTS_DIR, reports: REPORTS_DIR }): string | undefined {
  const dir = path.join(roots.layouts, siteId, bulletinId);
  const gate = exportable(readApprovals(), siteId, bulletinId, layoutDigestOf(dir), layoutClassOf(dir, path.join(roots.reports, siteId, bulletinId, "report.json")));
  if (gate === "ok") return undefined;
  return `[warn] ${bulletinId} is ${gate} for ${siteId}; the site stays ambient until it is approved in /admin and auto publish is on`;
}
