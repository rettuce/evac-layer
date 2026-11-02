import { test } from "node:test";
import assert from "node:assert/strict";
import { lintEasyJapanese, lintJaEasyScript, EASY_JA_RULES } from "../src/writer/rules.js";
import { writerSystem } from "../src/writer/request.js";

test("lint flags guideline violations", () => {
  const rules = (t: string) => lintEasyJapanese(t).map((f) => f.rule);
  assert.deepEqual(rules("津波が来るおそれがあります"), ["no-conjecture"]);
  assert.deepEqual(rules("令和8年11/2の9時ごろから"), ["no-vague", "western-year", "no-slash-date"]);
  assert.deepEqual(rules("高台へ逃げましょう"), ["instruction-form"]);
  assert.deepEqual(rules("避難しないわけではない"), ["no-double-negative"]);
  assert.deepEqual(rules("すぐ たかい ところへ にげて ください"), []);
});

test("ja_easy on signage is kana only", () => {
  assert.deepEqual(lintJaEasyScript("すぐ 高い ところへ"), [{ rule: "signage-kana-only", match: "高" }]);
  assert.deepEqual(lintJaEasyScript("つなみが きます"), []);
});

test("system prompt carries every guideline rule", () => {
  const sys = writerSystem();
  for (const r of EASY_JA_RULES) assert.ok(sys.includes(r.rule_ja), r.id);
});

test("placeholder text fits the strictest character budget of every shape for its template", async () => {
  const { PLACEHOLDER_ACTION } = await import("../src/writer/placeholder.js");
  const { strictestBudgets } = await import("../src/composer/budgets.js");
  const templateOf: Record<string, string> = { "5": "secure-now", "4": "evac-now", "3": "evac-prepare", cleared: "all-clear" };
  for (const [key, text] of Object.entries(PLACEHOLDER_ACTION)) {
    const budgets = strictestBudgets(templateOf[key], ["16x9", "9x16", "32x9", "1x1"]);
    for (const role of ["action", "languages"]) {
      for (const [lang, max] of Object.entries(budgets.find((b) => b.role === role)!.max_chars)) {
        const t = text[lang as keyof typeof text];
        assert.ok([...t].length <= max!, `${key} ${role}.${lang} "${t}" > ${max}`);
      }
    }
  }
});

test("level 5 placeholder and lint keep evacuation wording out", async () => {
  const { PLACEHOLDER_ACTION } = await import("../src/writer/placeholder.js");
  const { lintLevel5 } = await import("../src/writer/rules.js");
  for (const t of Object.values(PLACEHOLDER_ACTION["5"])) assert.deepEqual(lintLevel5(t), [], t);
  assert.equal(lintLevel5("すぐ にげて")[0].rule, "level5-no-evacuation-wording");
});

test("the action does not borrow a municipal evacuation order name", async () => {
  const { lintMunicipalOrderName } = await import("../src/writer/rules.js");
  assert.equal(lintMunicipalOrderName("高齢者等避難")[0]?.rule, "no-municipal-order-name");
  assert.deepEqual(lintMunicipalOrderName("高齢者等は避難"), []);
  assert.deepEqual(lintMunicipalOrderName("危険な場所から避難"), []);
});

test("English text carries no Japanese script", async () => {
  const { lintEnglishScript } = await import("../src/writer/rules.js");
  assert.equal(lintEnglishScript("Wajima(輪島市) lifted")[0]?.match, "輪島市");
  assert.deepEqual(lintEnglishScript("Wajima: advisory lifted"), []);
});
