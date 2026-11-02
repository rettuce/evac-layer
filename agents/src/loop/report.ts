import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";
import type { LoopResult } from "./loop.js";

export const REPORTS_DIR = path.join(REPO_ROOT, "data", "reports");
export const LAYOUTS_DIR = path.join(REPO_ROOT, "data", "layouts");

export function writeReport(args: { municipalityId: string; bulletinId: string; verifier: string; reviser: string; maxAttempts: number; result: LoopResult; writerNote?: string }) {
  const dir = path.join(REPORTS_DIR, `${args.municipalityId}-${args.bulletinId}`);
  const layoutDir = path.join(LAYOUTS_DIR, args.municipalityId, args.bulletinId);
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
  };
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  return { dir, report };
}
