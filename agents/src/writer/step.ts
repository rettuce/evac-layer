import type Anthropic from "@anthropic-ai/sdk";
import type { Municipality, WriterOutput } from "../composer/compose.js";
import type { Situation } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import type { LoopResult } from "../loop/loop.js";
import { liveWriterReviser, writerApiReviser } from "../loop/revisers.js";
import type { Reviser } from "../loop/types.js";
import type { CallUsage } from "../reader/pricing.js";
import { placeholderWriter } from "./placeholder.js";
import { cachedWriter, cachedWriterForClass, classWriterFits, saveWriter, saveWriterForClass, screenClassFor, writeCellsUntilClean, type WriterModel } from "./live.js";

export interface LiveWriter { client: Anthropic; model: WriterModel }

export interface WriterStep { writer: WriterOutput; writerSource: string; reviser: Reviser; afterLoop(result: LoopResult): void }

export async function writeForBulletin(
  ctx: { alert: Alert; municipality: Municipality; situation: Situation },
  opts: { live?: LiveWriter; persist: boolean; usage: CallUsage[] },
): Promise<WriterStep> {
  const { alert, municipality, situation } = ctx;
  const placeholder: WriterStep = { writer: placeholderWriter(alert, municipality.id, situation.level, situation.cleared), writerSource: "placeholder", reviser: liveWriterReviser, afterLoop: () => {} };
  const live = opts.live;
  if (!live) return placeholder;
  const usageStart = opts.usage.length;
  const call = { client: live.client, model: live.model, alert, municipality, municipalityId: municipality.id, situation };
  let writer: WriterOutput;
  let writerSource: string;
  const cls = screenClassFor(alert.hazard, situation);
  const cached = cachedWriter(municipality.id, alert.bulletin_id);
  const classCached = cached ? undefined : cachedWriterForClass(municipality.id, cls);
  if (cached) {
    writer = cached;
    writerSource = "writer-cache";
  } else if (classCached && classWriterFits(classCached, alert, situation)) {
    writer = classCached.output;
    writerSource = `writer-class-cache:${classCached.bulletin_id}`;
  } else {
    const used: CallUsage[] = [];
    const r = await writeCellsUntilClean(call, [], used);
    if (r.lint.length) throw new Error(`Writer output for ${alert.bulletin_id} still breaks the easy-Japanese rules: ${r.lint.map((f) => f.rule).join(", ")}`);
    writer = r.output;
    writerSource = `writer-api:${live.model}`;
    opts.usage.push(...used);
    if (opts.persist) saveWriter(municipality.id, alert.bulletin_id, { model: live.model, output: writer, usage: used, lint: r.lint });
  }
  return {
    writer, writerSource,
    reviser: writerApiReviser({ ...call, usage: opts.usage }),
    afterLoop(result) {
      if (!opts.persist || result.outcome !== "pass") return;
      const revised = result.writer && result.writer !== writer ? result.writer : undefined;
      if (revised) saveWriter(municipality.id, alert.bulletin_id, { model: live.model, output: revised, usage: opts.usage.slice(usageStart), lint: [] });
      if (revised || !writerSource.startsWith("writer-class-cache")) {
        saveWriterForClass(municipality.id, cls, { model: live.model, output: revised ?? writer, bulletin_id: alert.bulletin_id, issued_at: alert.issued_at, raw_title: alert.raw_title, ...(situation.caution ? { caution: situation.caution } : {}) });
      }
    },
  };
}
