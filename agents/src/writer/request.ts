import type { Alert } from "../jma/parse.js";
import { EASY_JA_RULES, EASY_JA_SOURCE, SIGNAGE_CONVENTIONS_JA } from "./rules.js";

export type CellRole = "headline" | "action" | "direction" | "shelter" | "languages" | "hazard";
export type Lang = "ja" | "ja_easy" | "en" | "zh_hans" | "zh_hant" | "ko";
export const LANGS: readonly Lang[] = ["ja", "ja_easy", "en", "zh_hans", "zh_hant", "ko"];

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
    "en・zh_hans・zh_hant・ko は ja の内容を同じ情報量で訳します。固有名詞（施設名・地名）は ja の表記を併記します。",
    "basis には、その文の根拠（警報のどの項目か、知識ファイルのどの項目と出典ページか）を書きます。",
  ].join("\n");
}

export function writerUser(alert: Alert, municipality: unknown, budgets: CellBudget[]): string {
  return [
    "## 警報（alert.schema.json）",
    JSON.stringify(alert, null, 2),
    "## 自治体知識ファイル（municipality.schema.json）",
    JSON.stringify(municipality, null, 2),
    "## 書くセルと文字数予算",
    JSON.stringify(budgets, null, 2),
  ].join("\n\n");
}
