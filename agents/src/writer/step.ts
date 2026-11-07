import type Anthropic from "@anthropic-ai/sdk";
import type { Municipality, WriterOutput } from "../composer/compose.js";
import type { Situation } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import type { LoopResult } from "../loop/loop.js";
import { liveWriterReviser, writerApiReviser } from "../loop/revisers.js";
import type { Reviser } from "../loop/types.js";
import type { CallUsage } from "../reader/pricing.js";
import { placeholderWriter } from "./placeholder.js";
import { approvedWriterForClass } from "./class-cache.js";
import { cachedWriter, cachedWriterForClass, writerCacheFitsBulletin, saveWriter, screenClassFor, writeCellsUntilClean, type WriterModel } from "./live.js";

export interface LiveWriter { client: Anthropic; model: WriterModel }

export interface WriterStep { writer: WriterOutput; writerSource: string; reviser: Reviser; afterLoop(result: LoopResult): void }

export async function writeForBulletin(
  ctx: { alert: Alert; municipality: Municipality; situation: Situation; site: { id: string } },
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
  const cached = cachedWriter(municipality.id, alert.bulletin_id);
  const cls = screenClassFor(alert.hazard, situation);
  const classCached = cached
    ? undefined
    : [approvedWriterForClass(ctx.site.id, municipality.id, cls), cachedWriterForClass(municipality.id, cls)].find((r) => r && writerCacheFitsBulletin(r, alert, situation));
  if (cached) {
    writer = cached;
    writerSource = "writer-cache";
  } else if (classCached) {
    return { writer: classCached.output, writerSource: `writer-class-cache:${classCached.bulletin_id}`, reviser: liveWriterReviser, afterLoop: () => {} };
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
      if (opts.persist && result.outcome === "pass" && result.writer && result.writer !== writer) {
        saveWriter(municipality.id, alert.bulletin_id, { model: live.model, output: result.writer, usage: opts.usage.slice(usageStart), lint: [] });
      }
    },
  };
}
