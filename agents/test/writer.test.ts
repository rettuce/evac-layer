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

test("placeholder text fits the strictest character budget of every shape", async () => {
  const { PLACEHOLDER_ACTION } = await import("../src/writer/placeholder.js");
  const { strictestBudgets } = await import("../src/composer/budgets.js");
  const budgets = strictestBudgets(["16x9", "9x16", "32x9", "1x1"]);
  for (const [key, text] of Object.entries(PLACEHOLDER_ACTION)) {
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
