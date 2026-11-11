import type Anthropic from "@anthropic-ai/sdk";
import type { Municipality, WriterOutput } from "../composer/compose.js";
import type { Situation } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import type { LoopResult } from "../loop/loop.js";
import { liveWriterReviser, writerApiReviser } from "../loop/revisers.js";
import type { Reviser } from "../loop/types.js";
import type { CallUsage } from "../reader/pricing.js";
import { placeholderWriter } from "./placeholder.js";
import { approvedWriterForClass, classWriterRecord } from "./class-cache.js";
import { cachedWriterRecord, recordedStatus, writerCacheFitsBulletin, saveWriter, screenClassFor, writeCellsUntilClean, type WriterModel } from "./live.js";
import { writerMatchFor, type WriterMatch } from "./match.js";

export interface LiveWriter { client: Anthropic; model: WriterModel }

export interface WriterStep { writer: WriterOutput; writerSource: string; reviser: Reviser; afterLoop(result: LoopResult): void; match?: WriterMatch }

export async function writeForBulletin(
  ctx: { alert: Alert; municipality: Municipality; situation: Situation; site: { id: string } },
  opts: { live?: LiveWriter; persist: boolean; usage: CallUsage[]; newAtSite?: boolean },
): Promise<WriterStep> {
  const { alert, municipality, situation } = ctx;
  const placeholder: WriterStep = { writer: placeholderWriter(alert, municipality.id, situation.level, situation.cleared), writerSource: "placeholder", reviser: liveWriterReviser, afterLoop: () => {} };
  const cls = screenClassFor(alert.hazard, situation);
  const match = writerMatchFor(alert, municipality.id, situation);
  const approved = approvedWriterForClass(ctx.site.id, municipality.id, cls);
  const approvedFits = approved && writerCacheFitsBulletin(approved, match) ? approved : undefined;
  // The bulletin's own record is shared by the municipality's sites; a site that has not shown the bulletin yet takes
  // the wording its own class approval was given to, or its screens could never match that approval.
  const shared = cachedWriterRecord(municipality.id, alert.bulletin_id);
  const own = opts.newAtSite && approvedFits ? undefined : shared;
  const cached = own && recordedStatus(own) === alert.status ? own.output : undefined;
  const classCached = cached ? undefined : approvedFits ?? [classWriterRecord(municipality.id, cls, { siteId: ctx.site.id })].find((r) => r && writerCacheFitsBulletin(r, match));
  const fixed = (writer: WriterOutput, writerSource: string): WriterStep => ({ writer, writerSource, reviser: liveWriterReviser, afterLoop: () => {} });
  if (classCached) {
    return {
      ...fixed(classCached.output, `writer-class-cache:${classCached.bulletin_id}`),
      match,
      afterLoop(result) {
        if (opts.persist && result.outcome === "pass" && !(shared && !own)) saveWriter(municipality.id, alert.bulletin_id, { model: classCached.model, output: classCached.output, usage: [], lint: [], status: alert.status, match });
      },
    };
  }
  const live = opts.live;
  if (!live) return cached ? { ...fixed(cached, "writer-cache"), ...(own?.match ? { match: own.match } : {}) } : placeholder;
  const usageStart = opts.usage.length;
  const call = { client: live.client, model: live.model, alert, municipality, municipalityId: municipality.id, situation };
  let writer: WriterOutput;
  let writerSource: string;
  if (cached) {
    writer = cached;
    writerSource = "writer-cache";
  } else {
    const used: CallUsage[] = [];
    const r = await writeCellsUntilClean(call, [], used);
    if (r.lint.length) throw new Error(`Writer output for ${alert.bulletin_id} still breaks the easy-Japanese rules: ${r.lint.map((f) => f.rule).join(", ")}`);
    writer = r.output;
    writerSource = `writer-api:${live.model}`;
    opts.usage.push(...used);
    if (opts.persist) saveWriter(municipality.id, alert.bulletin_id, { model: live.model, output: writer, usage: used, lint: r.lint, status: alert.status, match });
  }
  const written = writerSource !== "writer-cache";
  const keyOf = written ? { match } : own?.match ? { match: own.match } : {};
  return {
    writer, writerSource, ...keyOf,
    reviser: writerApiReviser({ ...call, usage: opts.usage }),
    afterLoop(result) {
      if (opts.persist && result.outcome === "pass" && result.writer && result.writer !== writer) {
        saveWriter(municipality.id, alert.bulletin_id, { model: live.model, output: result.writer, usage: opts.usage.slice(usageStart), lint: [], status: alert.status, match });
      }
    },
  };
}
