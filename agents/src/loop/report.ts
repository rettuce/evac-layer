import fs from "node:fs";
import path from "node:path";
import { LAYOUTS_DIR, REPORTS_DIR, REPO_ROOT } from "../paths.js";
import { layoutDigestOf } from "../delivery/gate.js";
import type { LoopResult } from "./loop.js";

export { LAYOUTS_DIR, REPORTS_DIR };

export function writeReport(args: { siteId: string; municipalityId: string; bulletinId: string; verifier: string; skippedShapes?: readonly string[]; reviser: string; maxAttempts: number; result: LoopResult; writerNote?: string; roots?: { reports: string; layouts: string } }) {
  const dir = path.join(args.roots?.reports ?? REPORTS_DIR, args.siteId, args.bulletinId);
  const layoutDir = path.join(args.roots?.layouts ?? LAYOUTS_DIR, args.siteId, args.bulletinId);
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(layoutDir, { recursive: true, force: true });
  fs.mkdirSync(layoutDir, { recursive: true });
  const layouts = args.result.screens.map((s) => {
    const file = path.join(layoutDir, `${s.shape}.json`);
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
    return path.relative(REPO_ROOT, file);
  });
  const report = {
    kind: "evac-loop-report",
    version: "0.1",
    site: args.siteId,
    municipality: args.municipalityId,
    bulletin_id: args.bulletinId,
    verifier: args.verifier,
    reviser: args.reviser,
    ...(args.writerNote ? { writer_note: args.writerNote } : {}),
    max_attempts: args.maxAttempts,
    outcome: args.result.outcome,
    ...(args.result.reason ? { reason: args.result.reason } : {}),
    attempts: args.result.attempts,
    layouts,
    ...(layouts.length ? { layout_digest: layoutDigestOf(layoutDir) } : {}),
    browser_skipped: (args.skippedShapes ?? []).filter((shape) => args.result.screens.some((s) => s.shape === shape)),
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return { dir, report };
}
