import crypto from "node:crypto";
import type { LayoutCell } from "../../../app/layout/types";
import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import type { Shape } from "../../../app/layout/types";
import { TMP_DIR, chromePath } from "../paths.js";
import { readScreen, sampleLuminance, type Clock } from "../verifier/browser.js";
import { MAX_REVERSALS, countReversals, judgeContent, judgeDrill, judgeDrillWordOutsideDrill, judgeDropped, judgeFonts, judgeState, type Finding } from "../verifier/checks.js";
import type { Screen, ScreenVerdict, Verifier, VerifyContext } from "./types.js";
import type Anthropic from "@anthropic-ai/sdk";
import { visionCheck } from "../verifier/vision.js";
import type { CallUsage, ModelKey } from "../reader/pricing.js";
import { staticVerifier } from "./static-verifier.js";

// The renderer's /api/layout only serves .json files under its own repository root, so layouts are staged in
// this worktree's tmp/ and the renderer must run from the same worktree.
export function browserVerifier(opts: { baseUrl: string; clock?: Clock; chrome?: string; skipShapes?: readonly string[]; vision?: { client: Anthropic; model: ModelKey; usage: CallUsage[] } }): Verifier & { close(): Promise<void> } {
  let browser: Browser | undefined;
  const stageDir = path.join(TMP_DIR, "verifier-src");
  return {
    name: `static+browser${opts.vision ? `+vision(${opts.vision.model})` : ""}(${opts.baseUrl})`,
    rendersScreens: true,
    skippedShapes: opts.skipShapes ?? [],
    async verify(screens: Screen[], ctx?: VerifyContext) {
      const base = await staticVerifier.verify(screens);
      browser ??= await puppeteer.launch({ executablePath: opts.chrome ?? chromePath(), headless: true, args: ["--disable-gpu-rasterization"] });
      fs.mkdirSync(stageDir, { recursive: true });
      const out: ScreenVerdict[] = [];
      for (const [i, s] of screens.entries()) {
        if (opts.skipShapes?.includes(s.shape)) {
          out.push({ ...base[i], note: `browser and vision checks skipped for ${s.shape}; static checks only` });
          continue;
        }
        const body = JSON.stringify(s);
        const file = path.join(stageDir, `${crypto.createHash("sha256").update(body).digest("hex").slice(0, 16)}.json`);
        fs.writeFileSync(file, body);
        const target = { baseUrl: opts.baseUrl, srcFile: file, variant: 0 };
        const shape = s.shape as Shape;
        const { state, samples, cells, scale, pngs } = await readScreen(browser, target, shape, { capture: Boolean(opts.vision) });
        const luminances = await sampleLuminance(browser, target, shape, opts.clock ?? "realtime");
        const reversals = countReversals(luminances);
        const findings: Finding[] = [...base[i].findings.filter((f) => f.check !== "distance-duplicated"), ...judgeState(state), ...judgeDropped(s.cells as LayoutCell[], state), ...judgeFonts(samples, scale, shape), ...judgeContent(cells), ...(ctx ? [...judgeDrill(s.cells as LayoutCell[], ctx.alert.status), ...judgeDrillWordOutsideDrill(s.cells as LayoutCell[], ctx.alert.status)] : [])];
        if (reversals > MAX_REVERSALS) findings.push({ check: "flicker", detail: `${reversals} luminance reversals of ≥10% within 1 s` });
        let note: string | undefined;
        if (opts.vision) {
          if (!ctx) throw new Error("vision verification needs the bulletin (VerifyContext)");
          const v = await visionCheck({ client: opts.vision.client, model: opts.vision.model, pngs, layout: s, alert: ctx.alert, municipalityId: ctx.municipalityId });
          opts.vision.usage.push(v.usage);
          findings.push(...v.findings);
          note = v.note;
        }
        out.push({ shape: s.shape, ok: findings.length === 0, findings, ...(note ? { note } : {}) });
      }
      return out;
    },
    async close() {
      await browser?.close();
      browser = undefined;
    },
  };
}
