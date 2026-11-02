export const EASY_JA_SOURCE = {
  title: "在留支援のためのやさしい日本語ガイドライン",
  publisher: "出入国在留管理庁・文化庁",
  date: "2020-08",
  url: "https://www.moj.go.jp/isa/content/930006072.pdf",
};

export interface EasyJaRule { id: string; rule_ja: string; page: number }

// Quoted from step 2 of the guideline (printed pages 7-9).
export const EASY_JA_RULES: readonly EasyJaRule[] = [
  { id: "one-idea", rule_ja: "一文は短くする（一文に言いたいことは１つだけ）", page: 7 },
  { id: "list-three", rule_ja: "３つ以上のことを言うときは、箇条書きにする", page: 7 },
  { id: "no-roundabout", rule_ja: "回りくどい言い方や不要な繰り返しはしない", page: 7 },
  { id: "no-loanwords", rule_ja: "外来語（カタカナ語）はできる限り使わない", page: 7 },
  { id: "no-double-negative", rule_ja: "二重否定を使わない", page: 8 },
  { id: "no-passive-causative", rule_ja: "受身形や使役表現をできる限り使わない", page: 8 },
  { id: "simple-words", rule_ja: "簡単な言葉を使う（難しい言葉を使わない）", page: 8 },
  { id: "native-words", rule_ja: "和語を使う（漢語はできる限り使わない）", page: 8 },
  { id: "no-abstract", rule_ja: "抽象的な言葉は使わない", page: 8 },
  { id: "no-abbreviation", rule_ja: "略語は使わない", page: 8 },
  { id: "no-romaji", rule_ja: "ローマ字は使わない", page: 8 },
  { id: "no-vague", rule_ja: "曖昧な表現を多用しない（例:くらい、ごろ、など）", page: 8 },
  { id: "no-ambiguous-words", rule_ja: "複数の意味を持つ表現は使わない", page: 8 },
  { id: "no-conjecture", rule_ja: "「おそらく」「ようです」「ではないでしょうか」「可能性があります」「おそれがあります」などの推測表現は使用を避け、断定的な表現にします", page: 8 },
  { id: "desu-masu", rule_ja: "文末は「です」「ます」で統一する（尊敬語、謙譲語は使わず、敬語は丁寧語だけにします）", page: 9 },
  { id: "instruction-form", rule_ja: "指示 → 「～ましょう」は勧誘の意味もあるため「～してください」または「～しなければなりません」を使います", page: 9 },
  { id: "keep-key-terms", rule_ja: "重要な言葉はそのまま使い、＜＝･･･＞で書き換える（災害用語などは言葉の後に説明を加えます）", page: 9 },
  { id: "furigana", rule_ja: "漢字の量に注意し、ふりがなをつける", page: 9 },
  { id: "western-year", rule_ja: "元号は使わずに西暦を使う", page: 9 },
  { id: "twelve-hour", rule_ja: "12時間表示を原則とし、午前・午後を明記する", page: 9 },
  { id: "no-slash-date", rule_ja: "年月日の表記に「／」は使わない", page: 9 },
  { id: "kara-made", rule_ja: "「○○から△△まで」と表記する（「～」は誤解を生むため使用しない）", page: 9 },
];

// Project conventions layered on the guideline for signage, where ruby cannot be relied on at reading distance.
export const SIGNAGE_CONVENTIONS_JA: readonly string[] = [
  "ja_easy は ひらがな・カタカナ で書き、文節の あいだを 半角スペースで 区切る（契約 v0 の例「すぐ たかい ところへ にげて」）",
  "見出しの ja は気象庁の警報名をそのまま使う（気象業務法 23 条: 電文の本質を変えない）",
  "画面形状ごとの文字数予算を超えない（予算は Composer が渡す）",
  "警戒レベル5（緊急安全確保）では「にげる」「ひなん」を使わず、いまいる場所で命を守る行動（たかい ところへ・うえの かいへ）を書く。避難場所への移動がかえって危険な段階のため（内閣府の避難情報の考え方。プロジェクトの取り決め）",
];

export interface LintFinding { rule: string; match: string }

const LINT: ReadonlyArray<[string, RegExp]> = [
  ["no-double-negative", /ない(こと|わけ)(は|では)ない|以外は(必要)?(あり|ない)/],
  ["no-conjecture", /おそらく|ようです|でしょう|可能性があります|おそれがあります/],
  ["no-vague", /ごろ|くらい|ぐらい/],
  ["western-year", /令和|平成|昭和/],
  ["no-slash-date", /\d{1,4}\/\d{1,2}(\/\d{1,2})?/],
  ["kara-made", /[～〜]/],
  ["instruction-form", /ましょう/],
  ["no-romaji", /[A-Za-z]{2,}/],
];

export function lintEasyJapanese(text: string): LintFinding[] {
  return LINT.flatMap(([rule, re]) => {
    const m = text.match(re);
    return m ? [{ rule, match: m[0] }] : [];
  });
}

export function lintJaEasyScript(text: string): LintFinding[] {
  const kanji = text.match(/[一-鿿]/g);
  return kanji ? [{ rule: "signage-kana-only", match: kanji.join("") }] : [];
}

const LEVEL5_FORBIDDEN = /にげ|逃げ|避難|ひなん|evacuat/i;

export function lintLevel5(text: string): LintFinding[] {
  const m = text.match(LEVEL5_FORBIDDEN);
  return m ? [{ rule: "level5-no-evacuation-wording", match: m[0] }] : [];
}
