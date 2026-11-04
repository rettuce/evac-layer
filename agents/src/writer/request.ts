import type { Alert } from "../jma/parse.js";
import { EASY_JA_RULES, EASY_JA_SOURCE, SIGNAGE_CONVENTIONS_JA } from "./rules.js";

export type CellRole = "headline" | "action" | "direction" | "shelter" | "languages" | "hazard";
// Order is the order the languages band cycles in; the first six were the 2026-11-02 set, the last four come from
// JNTO's 2025 visitor ranking (th, vi, fil, id).
export type Lang = "ja" | "ja_easy" | "en" | "zh_hans" | "zh_hant" | "ko" | "th" | "vi" | "fil" | "id";
export const LANGS: readonly Lang[] = ["ja", "ja_easy", "en", "zh_hans", "zh_hant", "ko", "th", "vi", "fil", "id"];

export interface CellBudget { role: CellRole; max_chars: Partial<Record<Lang, number>> }

export const WRITER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cells"],
  properties: {
    cells: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "text", "basis"],
        properties: {
          role: { enum: ["headline", "action", "direction", "shelter", "languages", "hazard"] },
          text: {
            type: "object",
            additionalProperties: false,
            required: [...LANGS],
            properties: Object.fromEntries(LANGS.map((l) => [l, { type: "string" }])),
          },
          basis: { type: "string", description: "Which alert field or municipality entry (with its source page) this text rests on" },
        },
      },
    },
  },
} as const;

export function writerSystem(): string {
  return [
    "あなたは避難案内サイネージの文案係です。気象庁の警報と自治体の知識ファイルにある事実だけから、画面のセルごとの文を書きます。事実を足したり、警報の内容を強めたり弱めたりしません。",
    `ja_easy は「${EASY_JA_SOURCE.title}」（${EASY_JA_SOURCE.publisher}、${EASY_JA_SOURCE.date}）の次の規則に従います。`,
    ...EASY_JA_RULES.map((r) => `- ${r.rule_ja}`),
    "サイネージ向けの取り決め:",
    ...SIGNAGE_CONVENTIONS_JA.map((c) => `- ${c}`),
    "en・zh_hans・zh_hant・ko・th・vi・fil・id は ja の内容を同じ情報量で訳します。固有名詞（施設名・地名）はその言語の文字で転写し、日本語の文字を混ぜません。",
    "th はタイ文字だけで書き、分かち書きをしません（数字・記号は可）。vi はベトナム語の声調記号・ダイアクリティカルを必ず付けます。fil はフィリピン語（Filipino）の表記で書きます。id は標準インドネシア語（bahasa Indonesia baku）で書きます。",
    "alert.status が drill（気象庁の訓練電文）のときは、headline の全言語と、action（＝languages）の ja 以外の全言語を、訓練語で始めます。訓練語は必ず文の先頭に置き、後ろや括弧には置きません: ja_easy「くんれん 」、en「DRILL: 」、zh_hans「演习：」、zh_hant「演習：」、ko「훈련: 」、th「ฝึกซ้อม: 」、vi「Diễn tập: 」、fil「Pagsasanay: 」、id「Latihan: 」。ja の action には入れません（ja は見出しの【訓練】で示し、字数予算が小さいため）。",
    "津波の警報名の英語は気象庁の公式表記を使います: 大津波警報 = Major Tsunami Warning、津波警報 = Tsunami Warning、津波注意報 = Tsunami Advisory。",
    "解除の action は、各言語で『もう避難しなくてよい／安全になった』の意味を残します。『終わった』『完了』だけの語（例: fil Tapos na、id Selesai）にはしません。",
    "basis には、その文の根拠（警報のどの項目か、知識ファイルのどの項目と出典ページか）を書きます。",
  ].join("\n");
}

// The municipality block comes first and is the same for every bulletin of a municipality and hazard, so the live
// Writer puts a cache breakpoint after it; the bulletin and budgets follow.
export function writerMunicipalityBlock(municipality: unknown): string {
  return ["## 自治体知識ファイル（municipality.schema.json）", JSON.stringify(municipality, null, 2)].join("\n\n");
}

export function writerAlertBlock(alert: Alert, budgets: CellBudget[]): string {
  return ["## 警報（alert.schema.json）", JSON.stringify(alert, null, 2), "## 書くセルと文字数予算", JSON.stringify(budgets, null, 2)].join("\n\n");
}

export function writerUser(alert: Alert, municipality: unknown, budgets: CellBudget[]): string {
  return [writerMunicipalityBlock(municipality), writerAlertBlock(alert, budgets)].join("\n\n");
}
