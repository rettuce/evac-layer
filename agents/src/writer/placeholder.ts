import type { WriterOutput } from "../composer/compose.js";
import type { Lang } from "./request.js";

// Stand-in text while the Writer has no API key. Every line is marked 仮/draft so a rendered screen can never pass for
// real guidance; the headline is not the Writer's (the Composer sets it from the JMA dictionary table).
export const PLACEHOLDER_ACTION: Record<string, Record<Lang, string>> = {
  "5": { ja: "【仮】安全確保", ja_easy: "【かり】 うえの かいへ", en: "[draft] Act now", zh_hans: "[草稿]确保安全", zh_hant: "[草稿]確保安全", ko: "[초안] 안전 확보", th: "[ร่าง] ปลอดภัย", vi: "[nháp] Giữ an toàn", fil: "[burador] Ligtas", id: "[draf] Amankan diri" },
  "4": { ja: "【仮】全員避難", ja_easy: "【かり】 みんな にげて", en: "[draft] Evacuate", zh_hans: "[草稿]全员避难", zh_hant: "[草稿]全員避難", ko: "[초안] 전원 대피", th: "[ร่าง] อพยพ", vi: "[nháp] Sơ tán", fil: "[burador] Lumikas", id: "[draf] Mengungsi" },
  "3": { ja: "【仮】準備", ja_easy: "【かり】 じゅんび", en: "[draft] Prepare", zh_hans: "[草稿]准备避难", zh_hant: "[草稿]準備避難", ko: "[초안] 대피 준비", th: "[ร่าง] เตรียมพร้อม", vi: "[nháp] Chuẩn bị", fil: "[burador] Maghanda", id: "[draf] Bersiap" },
  cleared: { ja: "【仮】警報解除", ja_easy: "【かり】 おわり", en: "[draft] Lifted", zh_hans: "[草稿]警报解除", zh_hant: "[草稿]警報解除", ko: "[초안] 경보 해제", th: "[ร่าง] ยกเลิก", vi: "[nháp] Đã gỡ bỏ", fil: "[burador] Inalis", id: "[draf] Dicabut" },
};

export function placeholderWriter(level: number, cleared: boolean): WriterOutput {
  const action = PLACEHOLDER_ACTION[cleared ? "cleared" : String(Math.min(5, Math.max(3, level)))];
  return {
    cells: [
      { role: "action", text: action, basis: "placeholder: Writer not run (no API key)" },
      { role: "languages", text: action, basis: "placeholder: Writer not run (no API key)" },
    ],
  };
}
