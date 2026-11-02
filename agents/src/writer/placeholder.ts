import type { WriterOutput } from "../composer/compose.js";
import type { Alert } from "../jma/parse.js";
import { tsunamiRegionsFor } from "../jma/regions.js";

// Stand-in text while the Writer has no API key. Every line except the headline is marked 仮/draft so a
// rendered screen can never pass for real guidance; the headline is the JMA warning name, used verbatim.
export const PLACEHOLDER_ACTION: Record<string, { ja: string; ja_easy: string; en: string; zh_hans: string; zh_hant: string; ko: string }> = {
  "5": { ja: "【仮】安全確保", ja_easy: "【かり】 にげて", en: "[draft] Act now", zh_hans: "[草稿]确保安全", zh_hant: "[草稿]確保安全", ko: "[초안] 안전 확보" },
  "4": { ja: "【仮】全員避難", ja_easy: "【かり】 みんな にげて", en: "[draft] Evacuate", zh_hans: "[草稿]全员避难", zh_hant: "[草稿]全員避難", ko: "[초안] 전원 대피" },
  "3": { ja: "【仮】高齢者避難", ja_easy: "【かり】 じゅんび", en: "[draft] Prepare", zh_hans: "[草稿]准备避难", zh_hant: "[草稿]準備避難", ko: "[초안] 대피 준비" },
  cleared: { ja: "【仮】警報解除", ja_easy: "【かり】 おわり", en: "[draft] Lifted", zh_hans: "[草稿]警报解除", zh_hant: "[草稿]警報解除", ko: "[초안] 경보 해제" },
};

export function placeholderWriter(alert: Alert, municipalityId: string, level: number, cleared: boolean): WriterOutput {
  const regions = new Set(tsunamiRegionsFor(municipalityId));
  const mine = alert.areas.filter((a) => (a.code_type === "city" ? a.code.slice(0, 5) === municipalityId : regions.has(a.code)));
  const top = [...mine].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
  const headline = top?.kind_name || alert.raw_title;
  const action = PLACEHOLDER_ACTION[cleared ? "cleared" : String(Math.min(5, Math.max(3, level)))];
  return {
    cells: [
      { role: "headline", text: { ja: headline, ja_easy: "【かり】", en: "[draft]", zh_hans: "[草稿]", zh_hant: "[草稿]", ko: "[초안]" }, basis: "alert kind name (verbatim)" },
      { role: "action", text: action, basis: "placeholder: Writer not run (no API key)" },
      { role: "languages", text: action, basis: "placeholder: Writer not run (no API key)" },
    ],
  };
}
