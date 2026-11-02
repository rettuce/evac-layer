import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { judgeTextLayer, parsePdffonts } from "../src/reader/textlayer.js";
import { parseCsv, readGsiCsv } from "../src/reader/gsi.js";
import { collectClaims } from "../src/reader/claims.js";
import { assemble } from "../src/reader/assemble.js";
import { toStructuredSchema, EXTRACTION_SCHEMA } from "../src/reader/extraction.js";
import { costOf } from "../src/reader/pricing.js";
import { RAW_DIR } from "../src/paths.js";
import { formatErrors, validateDoc } from "../src/schemas.js";

const PDFFONTS = `name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
KozGoPro-Regular-Identity-H          CID Type 0C       Identity-H       yes no  no     979  0
Arial-BoldMT                         TrueType          WinAnsi          no  no  no     989  0
JEEIMP+MS-PGothic                    CID TrueType      Identity-H       yes yes yes    992  0
`;
const JA = "指定緊急避難場所の一覧です。津波のときは高台へ避難してください。".repeat(4);

test("pdffonts rows are parsed by column", () => {
  const rows = parsePdffonts(PDFFONTS);
  assert.deepEqual(rows.map((r) => [r.name, r.uni]), [["KozGoPro-Regular-Identity-H", false], ["Arial-BoldMT", false], ["JEEIMP+MS-PGothic", true]]);
});

test("text layer verdicts: ok, suspect, garbled, no_text", () => {
  const fonts = parsePdffonts(PDFFONTS);
  assert.equal(judgeTextLayer([fonts[2]], JA, 1).verdict, "ok");
  assert.equal(judgeTextLayer(fonts, JA, 1).verdict, "suspect");
  assert.equal(judgeTextLayer([fonts[2]], "➨㸴⦅㜵⅏ୖᚲ࡞᪋ཬࡧ".repeat(10), 1).verdict, "garbled");
  assert.equal(judgeTextLayer([fonts[2]], JA + "�", 1).verdict, "garbled");
  assert.equal(judgeTextLayer([], "短い", 3).verdict, "no_text");
});

test("csv parser handles BOM, quotes and CRLF", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x,1","y""z"\r\n'), [["a", "b"], ["x,1", 'y"z']]);
});

test("structured schema drops keywords the API rejects", () => {
  const s = JSON.stringify(toStructuredSchema({ type: "string", minLength: 1, pattern: "x", properties: { minimum: { type: "integer", minimum: 0 } } }));
  assert.equal(s, '{"type":"string","properties":{"minimum":{"type":"integer"}}}');
  assert.ok(!JSON.stringify(toStructuredSchema(EXTRACTION_SCHEMA)).includes("minLength"));
});

test("haiku switches to the long-prompt tier above 100K tokens", () => {
  const u = (input: number) => ({ input_tokens: input, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }) as Anthropic.Usage;
  assert.equal(costOf("haiku", "s", u(100_000)).usd.toFixed(6), ((100_000 * 0.1 + 1000 * 0.5) / 1e6).toFixed(6));
  assert.equal(costOf("haiku", "s", u(100_001)).usd.toFixed(6), ((100_001 * 0.5 + 1000 * 2.5) / 1e6).toFixed(6));
});

const block = (text: string, page: number, doc = 0) =>
  ({ type: "text", text, citations: [{ type: "page_location", cited_text: `${text} 原文`, document_index: doc, document_title: null, start_page_number: page, end_page_number: page + 1, file_id: null }] }) as unknown as Anthropic.ContentBlock;

test("stage 2 output is resolved to real citation pages and shelter names are cross-checked with GSI", () => {
  const { claims, citations } = collectClaims([block("[施設:河原田小学校] 津波", 1), block("[災害:津波] 海岸部", 2, 1)], ["a.pdf", "b.pdf"]);
  assert.equal(claims.length, 2);
  const shelters = [{ name: "旧輪島市立河原田小学校（体育館）", kind: "evacuation_shelter" as const, address: "x", lat: 37.37, lng: 136.9, hazards_ok: [], source: { type: "gsi" as const, file: "17204_1.csv", id: "E1" } }];
  const doc = assemble({
    id: "17204", name: "輪島市", prefecture: "石川県", model: "m", readerVersion: "t",
    extraction: {
      documents: [{ file: "a.pdf", title: "指定緊急避難場所", year: 2026 }],
      hazards: [{ type: "tsunami", areas: ["海岸部"], notes_ja: "", citation_id: "C2" }],
      routes: [], cautions: [], contacts: [],
      shelter_mentions: [{ name: "河原田小学校", hazards_ok: ["tsunami"], citation_id: "C1" }],
    },
    citations, shelters,
    pdfSources: [{ type: "pdf", file: "a.pdf", title: "a.pdf", year: null, pages: 1 }, { type: "pdf", file: "b.pdf", title: "b.pdf", year: null, pages: 3 }],
    gsiSources: [{ type: "gsi", file: "17204_1.csv", title: "国土地理院 指定避難所データ", year: null, pages: null }],
  });
  assert.equal(doc.hazards[0].source_page, 2);
  assert.equal(doc.hazards[0].source.file, "b.pdf");
  assert.equal(doc.conflicts.length, 1);
  assert.deepEqual(doc.conflicts[0].gsi_candidates, ["旧輪島市立河原田小学校（体育館）"]);
  assert.equal(doc.sources[0].year, 2026);
  const v = validateDoc(doc, "municipality");
  assert.ok(v.ok, formatErrors(v.errors));
});

test("an invented citation id stops assembly", () => {
  const { citations } = collectClaims([block("x", 1)], ["a.pdf"]);
  assert.throws(() => assemble({
    id: "17204", name: "n", prefecture: "p", model: "m", readerVersion: "t",
    extraction: { documents: [], hazards: [], routes: [{ text_ja: "高台へ", citation_id: "C9" }], cautions: [], contacts: [], shelter_mentions: [] },
    citations, shelters: [], pdfSources: [], gsiSources: [],
  }), /C9/);
});

test("Wajima GSI CSVs load with hazard columns", { skip: !fs.existsSync(path.join(RAW_DIR, "gsi-shelters/17204_2.csv")) && "raw data not available" }, () => {
  const sites = readGsiCsv(path.join(RAW_DIR, "gsi-shelters/17204_2.csv"));
  assert.equal(sites.length, 75);
  const route = sites.find((s) => s.name === "ホテル　ルートイン輪島")!;
  assert.deepEqual(route.hazards_ok, ["tsunami"]);
  assert.equal(readGsiCsv(path.join(RAW_DIR, "gsi-shelters/17204_1.csv")).length, 37);
});
