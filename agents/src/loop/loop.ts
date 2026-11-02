import { compose, type Municipality, type Site, type WriterOutput } from "../composer/compose.js";
import { BudgetExceeded, ComposerStop } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import { NoRevision, type LoopFinding, type Reviser, type Screen, type Verifier } from "./types.js";

export const MAX_ATTEMPTS = 3;
const WRITER_FIXABLE = new Set(["over-budget", "font-size", "overflow", "distance-duplicated", "bulletin-mismatch"]);
// The Composer writes the shelter and source cells from data, so a rewrite of Writer text cannot fix them.
const WRITER_CELLS = new Set(["headline", "action", "direction", "languages"]);
// The action pictogram is fixed by the template and its meaning is given to the Writer, so a mismatch on the
// action cell is the text's to fix; any other pictogram belongs to the Composer.
// Japanese that overflows passed the Composer's budget or was set by code (the headline is the JMA name), so a
// rewrite cannot help: the renderer's slot or the budget is wrong.
const renderOverflow = (f: LoopFinding) => f.check === "overflow" && f.lang === "ja";
const writerCanFix = (f: LoopFinding) =>
  !renderOverflow(f) &&
  ((f.check === "pictogram-misuse" && f.cell_id === "action") ||
    (WRITER_FIXABLE.has(f.check) && (f.cell_id === undefined || WRITER_CELLS.has(f.cell_id))));
const MAX_RESENDS = 2;
const findingKey = (f: LoopFinding) => `${f.shape} ${f.check}[${f.cell_id ?? ""}${f.lang ? `:${f.lang}` : ""}]`;
const blockingLabel = (f: LoopFinding) =>
  `${f.shape} ${renderOverflow(f) ? "render-overflow" : f.check}${f.cell_id ? `[${f.cell_id}${f.lang ? `:${f.lang}` : ""}]` : ""}`;

export interface Attempt { n: number; writer_source: string; findings: LoopFinding[]; screens_ok: Record<string, boolean>; notes?: Record<string, string> }
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
  const resends = new Map<string, number>();
  for (let n = 1; n <= max; n++) {
    let findings: LoopFinding[];
    const screensOk: Record<string, boolean> = {};
    const notes: Record<string, string> = {};
    try {
      screens = compose({ alert: args.alert, municipality: args.municipality, site: args.site, writer }) as Screen[];
      const verdicts = await args.verifier.verify(screens, { alert: args.alert, municipalityId: args.municipality.id });
      findings = verdicts.flatMap((v) => v.findings.map((f) => ({ shape: v.shape, ...f })));
      for (const v of verdicts) {
        screensOk[v.shape] = v.ok;
        if (v.note) notes[v.shape] = v.note;
      }
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) {
        if (e instanceof ComposerStop) return { outcome: "stopped", reason: e.message, attempts, screens: [] };
        throw e;
      }
      screens = [];
      findings = [{ shape: e.shape, check: "over-budget", cell_id: e.role, detail: e.message }];
    }
    attempts.push({ n, writer_source: source, findings, screens_ok: screensOk, ...(Object.keys(notes).length ? { notes } : {}) });
    if (!findings.length) return { outcome: "pass", attempts, screens, writer };
    const blocking = findings.filter((f) => !writerCanFix(f));
    if (blocking.length) return { outcome: "fail", reason: `not fixable by rewriting text: ${blocking.map(blockingLabel).join(", ")}`, attempts, screens };
    if (n === max) break;
    const exhausted = findings.filter((f) => (resends.get(findingKey(f)) ?? 0) >= MAX_RESENDS);
    if (exhausted.length) return { outcome: "fail", reason: `sent to the Writer ${MAX_RESENDS} times already: ${exhausted.map(findingKey).join(", ")}`, attempts, screens };
    for (const f of findings) resends.set(findingKey(f), (resends.get(findingKey(f)) ?? 0) + 1);
    try {
      ({ writer, source } = await args.reviser.revise(writer, findings, n));
    } catch (e) {
      if (e instanceof NoRevision) return { outcome: "fail", reason: e.message, attempts, screens };
      throw e;
    }
  }
  return { outcome: "fail", reason: `findings remain after ${max} attempts`, attempts, screens };
}
