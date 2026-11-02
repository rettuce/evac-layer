import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

// Long edge 3136 px split into 1568 px tiles: 1568 is the largest edge the API takes without downscaling, and map
// labels are unreadable when a whole A4/A3 page is squeezed into one tile.
export const RENDER_LONG_EDGE_PX = 3136;
export const TILE_PX = 1568;
const PIXELS_PER_IMAGE_TOKEN = 750;

export interface Tile { page: number; x: number; y: number; w: number; h: number; path: string }

export function pageSizes(pdfPath: string): { page: number; w: number; h: number }[] {
  const info = execFileSync("pdfinfo", ["-f", "1", "-l", "9999", pdfPath], { encoding: "utf8" });
  return [...info.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)].map((m) => ({ page: Number(m[1]), w: Number(m[2]), h: Number(m[3]) }));
}

export function planTiles(sizes: { page: number; w: number; h: number }[], outDir: string): Tile[] {
  return sizes.flatMap(({ page, w, h }) => {
    const scale = RENDER_LONG_EDGE_PX / Math.max(w, h);
    const W = Math.round(w * scale);
    const H = Math.round(h * scale);
    const tiles: Tile[] = [];
    for (let y = 0; y < H; y += TILE_PX) {
      for (let x = 0; x < W; x += TILE_PX) {
        tiles.push({ page, x, y, w: Math.min(TILE_PX, W - x), h: Math.min(TILE_PX, H - y), path: path.join(outDir, `p${page}-x${x}-y${y}.png`) });
      }
    }
    return tiles;
  });
}

export function renderTiles(pdfPath: string, tiles: Tile[]) {
  for (const t of tiles) {
    if (fs.existsSync(t.path)) continue;
    fs.mkdirSync(path.dirname(t.path), { recursive: true });
    const prefix = t.path.replace(/\.png$/, "");
    execFileSync("pdftoppm", ["-f", String(t.page), "-l", String(t.page), "-scale-to", String(RENDER_LONG_EDGE_PX), "-x", String(t.x), "-y", String(t.y), "-W", String(t.w), "-H", String(t.h), "-png", "-singlefile", pdfPath, prefix]);
  }
}

export const imageTokens = (tiles: Tile[]) => tiles.reduce((n, t) => n + Math.ceil((t.w * t.h) / PIXELS_PER_IMAGE_TOKEN), 0);

export const VISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facts"],
  properties: { facts: { type: "array", items: { type: "string" } } },
} as const;

export const VISION_SYSTEM = `あなたは自治体の防災地図・防災冊子のページ画像を読む抽出係です。画像に印字されている文字と凡例から読み取れる事実だけを書き出します。読めない文字は推測で補わず、その事実を書きません。地図上の位置関係から推論した内容（「〜は浸水しそうだ」など）は書きません。`;

export function visionUser(municipality: string, file: string, page: number, tileCount: number): string {
  return `${municipality}の資料 ${file} の ${page} ページ目を ${tileCount} 枚に分割した画像です（左上から右へ、上から下の順）。次の分類のどれかで始まる 1 行 1 件の事実として facts に入れてください。

[文書] 資料の表題と発行・更新年
[災害:種別] 対象となる災害の種別、対象地区、想定（浸水深・想定最大規模など印字されている数値）、注意事項
[経路] 避難の方向・経路・避難の仕方
[注意] 住民への注意事項
[連絡先] 問い合わせ先の名称と電話番号
[施設:施設名] 避難所・避難場所の名称と、その施設が対応する災害種別

ページ番号はこちらで記録するので書かなくてよい。`;
}

export function visionRequest(model: string, municipality: string, file: string, page: number, tiles: Tile[]): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 16_000,
    system: VISION_SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: VISION_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{
      role: "user",
      content: [
        ...tiles.map((t) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: fs.readFileSync(t.path).toString("base64") } })),
        { type: "text" as const, text: visionUser(municipality, file, page, tiles.length) },
      ],
    }],
  };
}
