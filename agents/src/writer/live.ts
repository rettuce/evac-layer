import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Municipality, WriterOutput } from "../composer/compose.js";
import { strictestBudgets } from "../composer/budgets.js";
import { actionPictogramMeaning, actionPictogram, type Situation } from "../composer/rules.js";
import type { Alert } from "../jma/parse.js";
import { tsunamiRegionsFor } from "../jma/regions.js";
import { WRITER_DIR } from "../paths.js";
import { MODELS, costOf, type CallUsage } from "../reader/pricing.js";
import { toStructuredSchema } from "../reader/extraction.js";
import { WRITER_OUTPUT_SCHEMA, writerAlertBlock, writerMunicipalityBlock, writerSystem } from "./request.js";
import { lintEasyJapanese, lintEnglishScript, lintLatinScript, lintThaiScript, lintTraditionalScript, lintJaEasyScript, lintLevel5, lintMunicipalOrderName, type LintFinding } from "./rules.js";

export { WRITER_DIR };
const WRITER_ROLES = ["headline", "action", "languages"] as const;
const MAX_TOKENS = 16_000;

export type WriterModel = "opus" | "sonnet";

export class WriterStop extends Error {}

function areasFor(alert: Alert, municipalityId: string) {
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  return alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === municipalityId : regions.has(a.code)));
}

// The Writer sees only what concerns this municipality: its own areas of the bulletin and the PDF-derived facts
// for the alert's hazard, each with its source page.
function writerContext(alert: Alert, m: Municipality, municipalityId: string) {
  const mine = areasFor(alert, municipalityId);
  const facts = m as unknown as { hazards: unknown[]; cautions?: unknown[]; name: string };
  return {
    alert: { ...alert, areas: mine },
    municipality: {
      name: facts.name,
      hazards: (m.hazards as { type: string }[]).filter((h) => h.type === alert.hazard),
      cautions: facts.cautions ?? [],
    },
  };
}

// The languages cell repeats the action in every language by contract; copying it in code keeps the two from
// drifting apart between runs.
export function normalizeWriter(out: WriterOutput): WriterOutput {
  const action = out.cells.find((c) => c.role === "action");
  return action ? { cells: out.cells.map((c) => (c.role === "languages" ? { ...c, text: { ...action.text } } : c)) } : out;
}

export function lintWriter(out: WriterOutput, level: number): LintFinding[] {
  return out.cells.flatMap((c) => {
    const easy = c.text.ja_easy ?? "";
    return [
      ...lintEasyJapanese(easy).map((f) => ({ ...f, rule: `${c.role}.ja_easy ${f.rule}` })),
      ...lintJaEasyScript(easy).map((f) => ({ ...f, rule: `${c.role}.ja_easy ${f.rule}` })),
      ...lintEnglishScript(c.text.en ?? "").map((f) => ({ ...f, rule: `${c.role}.en ${f.rule}` })),
      ...lintTraditionalScript(c.text.zh_hant ?? "").map((f) => ({ ...f, rule: `${c.role}.zh_hant ${f.rule}` })),
      ...lintThaiScript(c.text.th ?? "").map((f) => ({ ...f, rule: `${c.role}.th ${f.rule}` })),
      ...(["vi", "fil", "id"] as const).flatMap((lang) => lintLatinScript(c.text[lang] ?? "").map((f) => ({ ...f, rule: `${c.role}.${lang} ${f.rule}` }))),
      ...(c.role === "action" ? lintMunicipalOrderName(c.text.ja ?? "").map((f) => ({ ...f, rule: `action.ja ${f.rule}` })) : []),
      ...(level >= 5 ? Object.entries(c.text).flatMap(([lang, t]) => lintLevel5(t ?? "").map((f) => ({ ...f, rule: `${c.role}.${lang} ${f.rule}` }))) : []),
    ];
  });
}

export async function writeCells(args: {
  client: Anthropic; model: WriterModel; alert: Alert; municipality: Municipality; municipalityId: string; situation: Situation; feedback?: string[];
}): Promise<{ output: WriterOutput; usage: CallUsage; lint: LintFinding[] }> {
  const budgets = strictestBudgets(args.situation.template, ["16x9", "9x16", "32x9", "1x1"]).filter((b) => (WRITER_ROLES as readonly string[]).includes(b.role));
  const ctx = writerContext(args.alert, args.municipality, args.municipalityId);
  const picto = actionPictogram(args.alert.hazard, args.situation.template);
  const instructions = [
    `テンプレート: ${args.situation.template}（表示レベル ${args.situation.level}${args.situation.cleared ? "・解除" : ""}）。書くセルは ${WRITER_ROLES.join("・")} だけ。languages は action と同じ内容を各言語で。`,
    `action セルには図記号 ${picto}（${actionPictogramMeaning(picto, args.situation.caution)}）が付く。action はこの図記号と同じ意味の行動として書く。`,
    ...(args.situation.caution === "sea_level_change" ? ["この電文で警報・注意報は津波予報（若干の海面変動）に下がった。headline は解除、action は「海に入らない・海岸に近づかない」の意味で書く。"] : []),
    ...(args.feedback?.length ? ["前回の出力への指摘（すべて直すこと）:", ...args.feedback.map((f) => `- ${f}`)] : []),
  ].join("\n");
  const msg = await args.client.messages.stream({
    model: MODELS[args.model].id,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: writerSystem(), cache_control: { type: "ephemeral" as const } }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: toStructuredSchema(WRITER_OUTPUT_SCHEMA) as Record<string, unknown> } },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: writerMunicipalityBlock(ctx.municipality), cache_control: { type: "ephemeral" as const } },
        { type: "text", text: `${writerAlertBlock(ctx.alert, budgets)}\n\n${instructions}` },
      ],
    }],
  }).finalMessage();
  if (msg.stop_reason === "refusal") throw new WriterStop(`Writer refused (${msg.stop_details?.category ?? "no category"})`);
  if (msg.stop_reason === "max_tokens") throw new WriterStop("Writer hit max_tokens");
  const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? (() => { throw new WriterStop("Writer returned no text"); })();
  const raw = JSON.parse(text) as WriterOutput;
  const cells = WRITER_ROLES.map((role) => raw.cells.find((c) => c.role === role) ?? (() => { throw new WriterStop(`Writer output has no ${role} cell`); })());
  // The headline is the JMA warning name verbatim (Meteorological Service Act art. 23); code sets it, not the model.
  const top = [...areasFor(args.alert, args.municipalityId)].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
  cells[0] = { ...cells[0], text: { ...cells[0].text, ja: top?.kind_name || args.alert.raw_title } };
  const output = normalizeWriter({ cells });
  return { output, usage: costOf(args.model, `writer ${args.alert.bulletin_id}`, msg.usage), lint: lintWriter(output, args.situation.level) };
}

export function cachedWriter(municipalityId: string, bulletinId: string): WriterOutput | undefined {
  const f = path.join(WRITER_DIR, municipalityId, `${bulletinId}.json`);
  return fs.existsSync(f) ? normalizeWriter((JSON.parse(fs.readFileSync(f, "utf8")) as { output: WriterOutput }).output) : undefined;
}

export function saveWriter(municipalityId: string, bulletinId: string, record: { model: string; output: WriterOutput; usage: CallUsage[]; lint: LintFinding[] }) {
  const f = path.join(WRITER_DIR, municipalityId, `${bulletinId}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(record, null, 2) + "\n");
}
