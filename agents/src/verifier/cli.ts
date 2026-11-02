import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import type { Shape } from "../../../app/layout/types";
import { TMP_DIR } from "../paths.js";
import { MAX_REVERSALS, countReversals, droppedCells, judgeFonts, judgeState, type Finding } from "./checks.js";
import { readScreen, sampleLuminance, type Clock } from "./browser.js";

const SHAPES: Shape[] = ["16x9", "9x16", "32x9", "1x1"];
const { values } = parseArgs({
  options: {
    layout: { type: "string", default: "wajima-tsunami" },
    variant: { type: "string", default: "0" },
    url: { type: "string", default: process.env.EVAC_URL ?? "http://127.0.0.1:3150" },
    clock: { type: "string", default: "realtime" },
    chrome: { type: "string", default: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
    out: { type: "string" },
  },
});
if (values.clock !== "realtime" && values.clock !== "virtual") {
  console.error("--clock must be realtime or virtual");
  process.exit(2);
}

const target = { baseUrl: values.url!, layout: values.layout!, variant: Number(values.variant) };
const browser = await puppeteer.launch({ executablePath: values.chrome, headless: true });
try {
  const screens = [];
  for (const shape of SHAPES) {
    const { state, samples, scale } = await readScreen(browser, target, shape);
    const luminances = await sampleLuminance(browser, target, shape, values.clock as Clock);
    const reversals = countReversals(luminances);
    const findings: Finding[] = [...judgeState(state), ...judgeFonts(samples, scale)];
    if (reversals > MAX_REVERSALS) findings.push({ check: "flicker", detail: `${reversals} luminance reversals of ≥10% within 1 s (${luminances.map((l) => l.toFixed(4)).join(", ")})` });
    screens.push({
      shape, template: state.template, variant: state.variant, level: state.level,
      ok: findings.length === 0, findings, dropped: droppedCells(state),
      fonts: samples.map((s) => ({ cell_id: s.cell_id, role: s.role, step_class: s.step_class, font_px: s.font_px, kind: s.kind })),
      flicker: { clock: values.clock, luminances, reversals },
    });
  }
  const report = { kind: "evac-inspection", version: "0.1", layout: target.layout, variant: target.variant, base_url: target.baseUrl, ok: screens.every((s) => s.ok), screens };
  const out = values.out ? path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out) : path.join(TMP_DIR, "verifier", `${target.layout}-v${target.variant}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  for (const s of screens) {
    console.log(`${s.ok ? "OK  " : "NG  "} ${s.shape.padEnd(5)} variant=${s.variant} dropped=${s.dropped.map((d) => `${d.id}:${d.reason}`).join(",") || "-"} reversals=${s.flicker.reversals}`);
    for (const f of s.findings) console.log(`       ${f.check}${f.cell_id ? ` [${f.cell_id}]` : ""}: ${f.detail}`);
  }
  console.log(out);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await browser.close();
}
