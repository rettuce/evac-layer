import type Anthropic from "@anthropic-ai/sdk";
import type { Municipality, WriterOutput } from "../composer/compose.js";
import type { Situation } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import type { LoopResult } from "../loop/loop.js";
import { liveWriterReviser, writerApiReviser } from "../loop/revisers.js";
import type { Reviser } from "../loop/types.js";
import type { CallUsage } from "../reader/pricing.js";
import { placeholderWriter } from "./placeholder.js";
import { cachedWriter, saveWriter, writeCells, type WriterModel } from "./live.js";

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
  const cached = cachedWriter(municipality.id, alert.bulletin_id);
  if (cached) {
    writer = cached;
    writerSource = "writer-cache";
  } else {
    const used: CallUsage[] = [];
    let r = await writeCells(call);
    used.push(r.usage);
    // The guideline lint is cheap and deterministic, so its findings go back to the Writer before rendering.
    for (let i = 0; i < 2 && r.lint.length; i++) {
      r = await writeCells({ ...call, feedback: r.lint.map((f) => `${f.rule}: 「${f.match}」`) });
      used.push(r.usage);
    }
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
