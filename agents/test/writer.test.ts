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
