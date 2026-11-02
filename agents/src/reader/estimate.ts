import path from "node:path";
import { RAW_DIR } from "../paths.js";
import { estimateUsd, type ModelKey } from "./pricing.js";
import type { Preset } from "./presets.js";
import { checkTextLayer } from "./textlayer.js";
import { imageTokens, pageSizes, planTiles, TILE_PX } from "./vision.js";

// platform.claude.com PDF support, "Estimate your costs" (checked 2026-11-02): each page costs 1,500-3,000 text
// tokens plus the page rendered as an image under the vision formula.
const PDF_TEXT_TOKENS_PER_PAGE = { low: 1_500, high: 3_000 };
const PIXELS_PER_IMAGE_TOKEN = 750;
// Output sizes are assumptions until the first live run measures them.
const STAGE1_OUTPUT_TOKENS = 8_000;
const STAGE2_OUTPUT_TOKENS = 8_000;
const VISION_PROMPT_TOKENS_PER_PAGE = 1_500;
const VISION_OUTPUT_TOKENS_PER_PAGE = 1_500;

function pageImageTokens(pdf: string): number {
  return pageSizes(pdf).reduce((n, { w, h }) => {
    const scale = TILE_PX / Math.max(w, h);
    return n + Math.ceil((w * scale * h * scale) / PIXELS_PER_IMAGE_TOKEN);
  }, 0);
}

export function estimatePreset(preset: Preset) {
  const reports = preset.pdfs.map((rel) => ({ rel, abs: path.join(RAW_DIR, rel), r: checkTextLayer(path.join(RAW_DIR, rel)) }));
  const text = reports.filter((x) => x.r.verdict === "ok");
  const vision = reports.filter((x) => x.r.verdict !== "ok");
  const textPages = text.reduce((n, x) => n + x.r.pages, 0);
  const textImage = text.reduce((n, x) => n + pageImageTokens(x.abs), 0);
  const stage1 = { low: textPages * PDF_TEXT_TOKENS_PER_PAGE.low + textImage, high: textPages * PDF_TEXT_TOKENS_PER_PAGE.high + textImage };
  const visionPages = vision.map((x) => {
    const tiles = planTiles(pageSizes(x.abs), "/dev/null");
    return [...new Set(tiles.map((t) => t.page))].map((p) => imageTokens(tiles.filter((t) => t.page === p)) + VISION_PROMPT_TOKENS_PER_PAGE);
  }).flat();
  const usd = (model: ModelKey, s1: number) =>
    (text.length ? estimateUsd(model, s1, STAGE1_OUTPUT_TOKENS) : 0)
    + estimateUsd(model, Math.max(10_000, Math.round(s1 / 4)), STAGE2_OUTPUT_TOKENS)
    + visionPages.reduce((u, inTok) => u + estimateUsd(model, inTok, VISION_OUTPUT_TOKENS_PER_PAGE), 0);
  return {
    id: preset.id,
    name: preset.name,
    text_pdfs: text.length,
    text_pages: textPages,
    stage1_input_tokens: stage1,
    vision_pdfs: vision.length,
    vision_pages: visionPages.length,
    vision_input_tokens: visionPages.reduce((a, b) => a + b, 0),
    usd: {
      sonnet: { low: usd("sonnet", stage1.low), high: usd("sonnet", stage1.high) },
      haiku: { low: usd("haiku", stage1.low), high: usd("haiku", stage1.high) },
    },
  };
}
