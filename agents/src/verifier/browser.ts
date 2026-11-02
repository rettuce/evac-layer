import type { Browser, Page } from "puppeteer-core";
import type { Shape } from "../../../app/layout/types";
import { SHAPES, designScale } from "../../../app/layout/shapes";
import type { ScreenState, TextSample } from "./checks.js";

const READY_TIMEOUT_MS = 30_000;
const FLICKER_FRAMES = 3;
const FLICKER_WINDOW_MS = 1000;

export type Clock = "realtime" | "virtual";

export interface ScreenTarget { baseUrl: string; layout: string; variant: number }

function screenUrl(t: ScreenTarget, shape: Shape, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ shape, layout: t.layout, variant: String(t.variant), ...extra });
  return `${t.baseUrl}/screen?${q}`;
}

async function open(browser: Browser, url: string, shape: Shape, reducedMotion: boolean): Promise<Page> {
  const page = await browser.newPage();
  const { width, height } = SHAPES[shape];
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }]);
  await page.goto(url, { waitUntil: "networkidle0" });
  if (await page.$('[data-error="fixture-not-found"]')) throw new Error(`renderer reports fixture not found: ${url}`);
  await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS });
  return page;
}

export async function readScreen(browser: Browser, t: ScreenTarget, shape: Shape) {
  const page = await open(browser, screenUrl(t, shape), shape, true);
  try {
    const state = await page.$eval(".evac-screen", (el): ScreenState => {
      const d = (el as HTMLElement).dataset;
      return { shape: d.shape ?? "", template: d.template ?? "", variant: d.variant ?? "", level: d.level ?? "", dropped: d.dropped ?? "", overflow: d.overflow ?? null, missing_required: d.missingRequired ?? null };
    });
    const samples = await page.$$eval("[data-cell-id]", (cells): TextSample[] =>
      cells.flatMap((cell) => {
        const c = cell as HTMLElement;
        return [...c.querySelectorAll<HTMLElement>(".t-action, .t-guide, .t-fine")]
          .filter((el) => {
            const cs = getComputedStyle(el);
            const variant = el.closest(".lang-variant");
            return el.offsetParent !== null && cs.visibility !== "hidden" && (!variant || variant.classList.contains("is-current")) && el.innerText.trim() !== "";
          })
          .map((el) => ({
            cell_id: c.dataset.cellId!,
            role: c.dataset.role as TextSample["role"],
            step_class: (["action", "guide", "fine"].find((s) => el.classList.contains(`t-${s}`)) ?? null) as TextSample["step_class"],
            font_px: parseFloat(getComputedStyle(el).fontSize),
            kind: (el.classList.contains("lang-label") ? "label" : c.dataset.role === "action" && !el.classList.contains("action-text") ? "secondary" : "primary") as TextSample["kind"],
            text: el.innerText.replace(/\s+/g, " ").trim(),
          }));
      }),
    );
    const { width, height } = SHAPES[shape];
    return { state, samples, scale: designScale(width, height) };
  } finally {
    await page.close();
  }
}

async function meanLuminance(page: Page): Promise<number> {
  const png = Buffer.from(await page.screenshot({ type: "png" })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const weights = [0.2126, 0.7152, 0.0722];
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const v = data[i + ch] / 255;
        sum += weights[ch] * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      }
    }
    return sum / (data.length / 4);
  }, png);
}

export async function sampleLuminance(browser: Browser, t: ScreenTarget, shape: Shape, clock: Clock): Promise<number[]> {
  const interval = FLICKER_WINDOW_MS / FLICKER_FRAMES;
  const out: number[] = [];
  if (clock === "virtual") {
    for (let i = 0; i < FLICKER_FRAMES; i++) {
      const page = await open(browser, screenUrl(t, shape, { clock: "virtual", t: String(Math.round(i * interval)) }), shape, false);
      out.push(await meanLuminance(page));
      await page.close();
    }
    return out;
  }
  const page = await open(browser, screenUrl(t, shape), shape, false);
  try {
    for (let i = 0; i < FLICKER_FRAMES; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, interval));
      out.push(await meanLuminance(page));
    }
  } finally {
    await page.close();
  }
  return out;
}
