import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { ENV_FILE, MUNICIPALITIES_DIR, RAW_DIR, TMP_DIR } from "../paths.js";
import { formatErrors, validateDoc } from "../schemas.js";
import { assemble, type SourceMeta } from "./assemble.js";
import { collectClaims, renderClaims } from "./claims.js";
import { EXTRACTION_SCHEMA, toStructuredSchema, type Extraction } from "./extraction.js";
import { readGsiCsv } from "./gsi.js";
import { PRESETS } from "./presets.js";
import { MODELS, costOf, estimateUsd, type CallUsage, type ModelKey } from "./pricing.js";
import { STAGE1_SYSTEM, STAGE2_SYSTEM, stage1User } from "./prompts.js";
import { checkTextLayer, type TextLayerReport } from "./textlayer.js";

const READER_VERSION = "0.1.0";
const BUDGET_USD = 5;
const STAGE1_MAX_TOKENS = 32_000;
const STAGE2_MAX_TOKENS = 32_000;

class ReaderStop extends Error {}
const stop = (msg: string): never => { throw new ReaderStop(msg); };

const { values } = parseArgs({
  options: {
    municipality: { type: "string", default: "17204" },
    model: { type: "string", default: "sonnet" },
    "dry-run": { type: "boolean", default: false },
    "skip-unusable": { type: "boolean", default: false },
    "allow-suspect": { type: "string", multiple: true, default: [] },
    out: { type: "string" },
  },
});

function sha256(file: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadApiKey(): boolean {
  if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function selectPdfs(reports: { rel: string; report: TextLayerReport }[]) {
  const allowed = new Set(values["allow-suspect"]);
  const usable = reports.filter(({ rel, report }) => report.verdict === "ok" || (report.verdict === "suspect" && allowed.has(path.basename(rel))));
  const unusable = reports.filter((r) => !usable.includes(r));
  for (const { rel, report } of reports) {
    const mark = usable.some((u) => u.rel === rel) ? "use " : "SKIP";
    console.error(`[text layer] ${mark} ${report.verdict.padEnd(7)} ${rel} pages=${report.pages} chars=${report.chars} ${report.reasons.join(" / ")}`);
  }
  if (unusable.length && !values["skip-unusable"]) {
    stop(`text layer check failed for ${unusable.map((u) => u.rel).join(", ")}. Inspect them; pass --skip-unusable to exclude them or --allow-suspect <file> after a manual spot-check.`);
  }
  if (!usable.length) stop("no PDF passed the text layer check");
  return usable.map((u) => u.rel);
}

async function uploadCached(client: Anthropic, abs: string, cache: Record<string, string>): Promise<string> {
  const digest = sha256(abs);
  if (cache[digest]) return cache[digest];
  const meta = await client.files.upload({ file: await toFile(fs.createReadStream(abs), path.basename(abs), { type: "application/pdf" }) });
  cache[digest] = meta.id;
  return meta.id;
}

function assertFinished(msg: Anthropic.Message, stage: string) {
  if (msg.stop_reason === "refusal") stop(`${stage}: model refused (${msg.stop_details?.category ?? "no category"}): ${msg.stop_details?.explanation ?? ""}`);
  if (msg.stop_reason === "max_tokens") stop(`${stage}: hit max_tokens; output is truncated`);
}

async function main() {
  const preset = PRESETS[values.municipality!] ?? stop(`no preset for municipality ${values.municipality}; known: ${Object.keys(PRESETS).join(", ")}`);
  const modelKey = values.model as ModelKey;
  const model = MODELS[modelKey] ?? stop(`--model must be sonnet or haiku, got ${values.model}`);

  const reports = preset.pdfs.map((rel) => ({ rel, report: checkTextLayer(path.join(RAW_DIR, rel)) }));
  const pdfs = selectPdfs(reports);
  const files = pdfs.map((rel) => rel.replace(/^municipal-pdfs\//, ""));
  const shelters = preset.gsi.flatMap((rel) => readGsiCsv(path.join(RAW_DIR, rel)));
  console.error(`[gsi] ${shelters.length} shelters from ${preset.gsi.join(", ")}`);

  const userText = stage1User(preset.name, files);
  const stage2Schema = toStructuredSchema(EXTRACTION_SCHEMA);
  const hasKey = loadApiKey();

  if (values["dry-run"]) {
    console.log(JSON.stringify({
      dry_run: true,
      api_key_present: hasKey,
      municipality: { id: preset.id, name: preset.name },
      model: model.id,
      text_layer: reports.map((r) => ({ path: r.rel, ...r.report })),
      pdfs_to_upload: files,
      gsi_shelters: shelters.length,
      stage1: { system: STAGE1_SYSTEM, user: userText, documents: files.map((f) => ({ type: "document", source: { type: "file", file_id: `<upload ${f}>` }, title: f, citations: { enabled: true } })) },
      stage2: { system: STAGE2_SYSTEM, output_schema: stage2Schema },
      output: `data/municipalities/${preset.id}.json (validated against schema/municipality.schema.json)`,
    }, null, 2));
    return;
  }
  if (!hasKey) stop(`ANTHROPIC_API_KEY not found (${ENV_FILE} absent or empty). Run with --dry-run until the key is set.`);

  const client = new Anthropic();
  fs.mkdirSync(path.join(TMP_DIR, "reader"), { recursive: true });
  const cacheFile = path.join(TMP_DIR, "reader", "file-ids.json");
  const fileCache: Record<string, string> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
  const fileIds: string[] = [];
  for (const rel of pdfs) fileIds.push(await uploadCached(client, path.join(RAW_DIR, rel), fileCache));
  fs.writeFileSync(cacheFile, JSON.stringify(fileCache, null, 2));

  const stage1Params = {
    model: model.id,
    system: STAGE1_SYSTEM,
    messages: [{
      role: "user" as const,
      content: [
        ...fileIds.map((id, i) => ({ type: "document" as const, source: { type: "file" as const, file_id: id }, title: files[i], citations: { enabled: true } })),
        { type: "text" as const, text: userText },
      ],
    }],
  };
  const counted = await client.messages.countTokens(stage1Params);
  const estimate = estimateUsd(modelKey, counted.input_tokens, STAGE1_MAX_TOKENS) + estimateUsd(modelKey, counted.input_tokens, STAGE2_MAX_TOKENS);
  console.error(`[budget] stage 1 input ${counted.input_tokens} tokens; worst case for both stages $${estimate.toFixed(3)} (limit $${BUDGET_USD})`);
  if (estimate > BUDGET_USD) stop(`worst-case cost $${estimate.toFixed(2)} exceeds $${BUDGET_USD} for one municipality`);

  const usage: CallUsage[] = [];
  const t1 = Date.now();
  const s1 = await client.messages.stream({ ...stage1Params, max_tokens: STAGE1_MAX_TOKENS, output_config: { effort: "medium" } }).finalMessage();
  assertFinished(s1, "stage 1");
  usage.push(costOf(modelKey, "stage1-citations", s1.usage));
  const { claims, citations } = collectClaims(s1.content, files);
  console.error(`[stage 1] ${claims.length} cited claims, ${citations.size} citations, ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  if (!claims.length) stop("stage 1 returned no cited claims");

  const t2 = Date.now();
  const s2 = await client.messages.stream({
    model: model.id,
    max_tokens: STAGE2_MAX_TOKENS,
    system: STAGE2_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: stage2Schema as Record<string, unknown> } },
    messages: [{ role: "user", content: `資料ファイル: ${files.join(", ")}\n\n${renderClaims(claims, citations)}` }],
  }).finalMessage();
  assertFinished(s2, "stage 2");
  usage.push(costOf(modelKey, "stage2-structured", s2.usage));
  console.error(`[stage 2] ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  const text = s2.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? stop("stage 2 returned no text block");
  const extraction = JSON.parse(text) as Extraction;

  const pdfSources: SourceMeta[] = pdfs.map((rel, i) => ({
    type: "pdf", file: files[i], title: files[i], year: null, pages: reports.find((r) => r.rel === rel)!.report.pages, sha256: sha256(path.join(RAW_DIR, rel)),
  }));
  const gsiSources: SourceMeta[] = preset.gsi.map((rel) => ({
    type: "gsi", file: path.basename(rel), title: /_2\.csv$/.test(rel) ? "国土地理院 指定緊急避難場所データ" : "国土地理院 指定避難所データ", year: null, pages: null, sha256: sha256(path.join(RAW_DIR, rel)),
  }));
  const doc = assemble({ id: preset.id, name: preset.name, prefecture: preset.prefecture, model: model.id, readerVersion: READER_VERSION, extraction, citations, shelters, pdfSources, gsiSources });
  const v = validateDoc(doc, "municipality");

  const base = path.join(TMP_DIR, "reader", `${preset.id}.${modelKey}`);
  fs.writeFileSync(`${base}.stage1.json`, JSON.stringify({ claims, citations: Object.fromEntries(citations) }, null, 2));
  fs.writeFileSync(`${base}.extraction.json`, JSON.stringify(extraction, null, 2));
  const total = usage.reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output, usd: a.usd + u.usd }), { input: 0, output: 0, usd: 0 });
  const summary = { model: model.id, usage, total, counts: { claims: claims.length, hazards: doc.hazards.length, routes: doc.routes.length, cautions: doc.cautions.length, contacts: doc.contacts.length, shelter_mentions: extraction.shelter_mentions.length, conflicts: doc.conflicts.length, shelters: doc.shelters.length } };
  fs.writeFileSync(`${base}.usage.json`, JSON.stringify(summary, null, 2));
  if (!v.ok) {
    fs.writeFileSync(`${base}.invalid.json`, JSON.stringify(doc, null, 2));
    stop(`assembled file fails municipality.schema.json (written to ${base}.invalid.json):\n${formatErrors(v.errors)}`);
  }
  const out = values.out ? path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out) : `${base}.json`;
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  console.log(JSON.stringify({ ...summary, out, default_publish_path: path.join(MUNICIPALITIES_DIR, `${preset.id}.json`) }, null, 2));
}

main().catch((e) => {
  if (e instanceof ReaderStop) {
    console.error(`[reader stopped] ${e.message}`);
    process.exit(3);
  }
  throw e;
});
