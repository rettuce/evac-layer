import { execFileSync } from "node:child_process";
import path from "node:path";

export type TextLayerVerdict = "ok" | "suspect" | "garbled" | "no_text";

export interface TextLayerReport {
  file: string;
  pages: number;
  chars: number;
  verdict: TextLayerVerdict;
  reasons: string[];
}

export interface FontRow {
  name: string;
  type: string;
  encoding: string;
  uni: boolean;
}

const MIN_CHARS_PER_PAGE = 50;
const MIN_EXPECTED_RATIO = 0.95;

// Scripts expected in a Japanese municipal disaster document (Korean and Chinese editions included). CJK Extension A and stray symbol blocks are what
// a missing ToUnicode map produces (e.g. "➨㸴⦅" in the Suzu city PDF).
const EXPECTED = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}一-鿿　-〿＀-￯ -~ -ÿ‐-‧‰-⁞Ⅰ-ⅿ←-⇿①-⓿■-◿☀-⛿ー∀-⋿]/u;

export function parsePdffonts(output: string): FontRow[] {
  const lines = output.split("\n");
  const sep = lines.findIndex((l) => /^-{5,}/.test(l));
  if (sep < 0) return [];
  const header = lines[sep - 1];
  const cols = ["type", "encoding", "emb", "sub", "uni", "object"].map((c) => header.indexOf(c));
  return lines
    .slice(sep + 1)
    .filter((l) => l.trim())
    .map((l) => ({
      name: l.slice(0, cols[0]).trim(),
      type: l.slice(cols[0], cols[1]).trim(),
      encoding: l.slice(cols[1], cols[2]).trim(),
      uni: l.slice(cols[4], cols[5]).trim() === "yes",
    }));
}

export function judgeTextLayer(fonts: FontRow[], text: string, pages: number): { verdict: TextLayerVerdict; reasons: string[] } {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length < MIN_CHARS_PER_PAGE * pages) {
    return { verdict: "no_text", reasons: [`only ${chars.length} extractable characters over ${pages} page(s); likely a scanned image`] };
  }
  const reasons: string[] = [];
  const replacement = chars.filter((c) => c === "�").length;
  if (replacement) reasons.push(`${replacement} U+FFFD replacement characters in extracted text`);
  const unexpected = chars.filter((c) => !EXPECTED.test(c));
  const ratio = 1 - unexpected.length / chars.length;
  if (ratio < MIN_EXPECTED_RATIO) {
    reasons.push(`only ${(ratio * 100).toFixed(1)}% of characters are in expected Japanese scripts (sample: ${unexpected.slice(0, 12).join("")})`);
  }
  if (reasons.length) return { verdict: "garbled", reasons };
  // Unmapped CID fonts sometimes decode fine (Sakura guidebook) and sometimes silently drop glyphs (Wajima tsunami
  // map loses 大 in 最大津波). Text inspection cannot tell the two apart, so a human spot-check must clear the file.
  const cidNoUni = [...new Set(fonts.filter((f) => !f.uni && (f.type.includes("CID") || f.encoding.startsWith("Identity"))).map((f) => f.name))];
  if (cidNoUni.length) {
    return { verdict: "suspect", reasons: [`${cidNoUni.length} CID font(s) without ToUnicode map: ${cidNoUni.slice(0, 5).join(", ")}${cidNoUni.length > 5 ? ", ..." : ""}`] };
  }
  return { verdict: "ok", reasons: [] };
}

export function checkTextLayer(pdfPath: string): TextLayerReport {
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? NaN);
  if (!Number.isFinite(pages)) throw new Error(`pdfinfo did not report a page count for ${pdfPath}`);
  const fonts = parsePdffonts(execFileSync("pdffonts", [pdfPath], { encoding: "utf8" }));
  const text = execFileSync("pdftotext", ["-enc", "UTF-8", pdfPath, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const { verdict, reasons } = judgeTextLayer(fonts, text, pages);
  return { file: path.basename(pdfPath), pages, chars: text.replace(/\s/g, "").length, verdict, reasons };
}
