import { compose, type Municipality, type Site, type WriterOutput } from "../composer/compose.js";
import { BudgetExceeded, ComposerStop } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import { NoRevision, type LoopFinding, type Reviser, type Screen, type Verifier } from "./types.js";

export const MAX_ATTEMPTS = 3;
const WRITER_FIXABLE = new Set(["over-budget", "font-size", "overflow", "distance-duplicated"]);
// The Composer writes the shelter and source cells from data, so a rewrite of Writer text cannot fix them.
const WRITER_CELLS = new Set(["headline", "action", "direction", "languages"]);
const writerCanFix = (f: LoopFinding) => WRITER_FIXABLE.has(f.check) && (f.cell_id === undefined || WRITER_CELLS.has(f.cell_id));

export interface Attempt { n: number; writer_source: string; findings: LoopFinding[]; screens_ok: Record<string, boolean> }
export interface LoopResult {
  outcome: "pass" | "fail" | "stopped";
  writer?: WriterOutput;
  reason?: string;
  attempts: Attempt[];
  screens: Screen[];
}

export async function runLoop(args: {
  alert: Alert; municipality: Municipality; site: Site; writer: WriterOutput; writerSource: string;
  verifier: Verifier; reviser: Reviser; maxAttempts?: number;
}): Promise<LoopResult> {
  const max = args.maxAttempts ?? MAX_ATTEMPTS;
  const attempts: Attempt[] = [];
  let writer = args.writer;
  let source = args.writerSource;
  let screens: Screen[] = [];
  for (let n = 1; n <= max; n++) {
    let findings: LoopFinding[];
    const screensOk: Record<string, boolean> = {};
    try {
      screens = compose({ alert: args.alert, municipality: args.municipality, site: args.site, writer }) as Screen[];
      const verdicts = await args.verifier.verify(screens);
      findings = verdicts.flatMap((v) => v.findings.map((f) => ({ shape: v.shape, ...f })));
      for (const v of verdicts) screensOk[v.shape] = v.ok;
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) {
        if (e instanceof ComposerStop) return { outcome: "stopped", reason: e.message, attempts, screens: [] };
        throw e;
      }
      screens = [];
      findings = [{ shape: e.shape, check: "over-budget", cell_id: e.role, detail: e.message }];
    }
    attempts.push({ n, writer_source: source, findings, screens_ok: screensOk });
    if (!findings.length) return { outcome: "pass", attempts, screens, writer };
    const blocking = findings.filter((f) => !writerCanFix(f));
    if (blocking.length) return { outcome: "fail", reason: `not fixable by rewriting text: ${blocking.map((f) => `${f.shape} ${f.check}${f.cell_id ? `[${f.cell_id}]` : ""}`).join(", ")}`, attempts, screens };
    if (n === max) break;
    try {
      ({ writer, source } = await args.reviser.revise(writer, findings, n));
    } catch (e) {
      if (e instanceof NoRevision) return { outcome: "fail", reason: e.message, attempts, screens };
      throw e;
    }
  }
  return { outcome: "fail", reason: `findings remain after ${max} attempts`, attempts, screens };
}
