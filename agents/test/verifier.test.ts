import { test } from "node:test";
import assert from "node:assert/strict";
import { countReversals, droppedCells, judgeContent, judgeFonts, judgeState, requiredPx, type TextSample, judgeDrill } from "../src/verifier/checks.js";
import { TYPE_PX } from "../../app/layout/typography";

const sample = (over: Partial<TextSample>): TextSample => ({ cell_id: "c", role: "action", step_class: "action", font_px: TYPE_PX.action, kind: "primary", text: "すぐ高いところへ", ...over });

test("the action line must meet the action viewing distance", () => {
  assert.deepEqual(judgeFonts([sample({})], 1), []);
  const [f] = judgeFonts([sample({ font_px: TYPE_PX.guide })], 1);
  assert.equal(f.check, "font-size");
  assert.match(f.detail, /action type step/);
});

test("labels are held to the fine distance, action sub-lines to the guide distance", () => {
  assert.equal(requiredPx("languages", 1, "label").step, "fine");
  assert.equal(requiredPx("action", 1, "secondary").step, "guide");
  assert.equal(requiredPx("source", 1, "primary").step, "fine");
  assert.equal(requiredPx("headline", 2, "primary").px, TYPE_PX.guide * 2);
});

test("state attributes turn into findings; drops are reported, not failed", () => {
  const state = { shape: "16x9", template: "evac-now", variant: "split", level: "4", dropped: "shelter:overflow", overflow: "action", missing_required: "languages" };
  assert.deepEqual(judgeState(state).map((f) => f.check), ["missing-required", "overflow"]);
  assert.deepEqual(droppedCells(state), [{ id: "shelter", reason: "overflow" }]);
  const withLang = judgeState({ ...state, missing_required: null, overflow: "headline:ja,action:en" });
  assert.deepEqual(withLang.map((f) => [f.cell_id, f.lang]), [["headline", "ja"], ["action", "en"]]);
});

test("flash counting follows WCAG 2.3.1 (10% luminance reversals)", () => {
  assert.equal(countReversals([0.2, 0.2, 0.2]), 0);
  assert.equal(countReversals([0.2, 0.25, 0.2]), 0);
  assert.equal(countReversals([0.1, 0.5, 0.1]), 1);
  assert.equal(countReversals([0.1, 0.5, 0.1, 0.5]), 2);
});

test("distance shown on both the direction and the shelter cell is flagged", () => {
  const shelter = { id: "shelter", role: "shelter" as const, text: "輪島中学校（指定緊急避難場所） 350 m" };
  assert.deepEqual(judgeContent([shelter, { id: "direction", role: "direction", text: "出口 B → 左 350m" }]).map((f) => f.cell_id), ["direction"]);
  assert.deepEqual(judgeContent([shelter, { id: "direction", role: "direction", text: "出口 B → 左" }]), []);
});

test("a drill bulletin is flagged for every headline language without a drill marker", () => {
  const cells = [{ id: "headline", role: "headline", text: { ja: "【訓練】津波注意報", ja_easy: "つなみ ちゅういほう", en: "DRILL: Tsunami Advisory", th: "ประกาศเฝ้าระวังสึนามิ" } }];
  assert.deepEqual(judgeDrill(cells, "drill").map((f) => f.lang), ["ja_easy", "th"]);
  assert.deepEqual(judgeDrill(cells, "normal"), []);
});
