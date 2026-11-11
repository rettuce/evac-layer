import fs from "node:fs";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { SHAPES } from "../../../app/layout/shapes";
import type { Shape } from "../../../app/layout/types";
import { chromePath } from "../paths.js";

const CAPTURE_SCALE: Partial<Record<Shape, number>> = { pillar: 0.5 };
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 500;

export class ExportStop extends Error {}

const TERMINATED_EXIT_CODE = 143;

// Chrome runs in a process group of its own, so stopping this command's group would leave it running: the server names
// a file for its pid (never stdout or stderr, which carry text from the data), and a SIGTERM closes it here first.
export async function launchBrowser(chrome?: string): Promise<Browser> {
  const browser = await puppeteer.launch({ executablePath: chrome ?? chromePath(), headless: true, args: ["--disable-gpu-rasterization"] });
  const pid = browser.process()?.pid;
  const pidFile = process.env.EVAC_CHROME_PID_FILE;
  if (pid && pidFile) fs.writeFileSync(pidFile, `${pid}\n`);
  process.once("SIGTERM", () => {
    void browser.close().catch(() => undefined).finally(() => process.exit(TERMINATED_EXIT_CODE));
  });
  return browser;
}

export async function captureShape(browser: Browser, args: {
  baseUrl: string; shape: Shape; src: string; png: string; label: string;
  prepare?: (page: Page) => Promise<void>; after?: (page: Page) => Promise<void>;
}): Promise<void> {
  const { shape, label } = args;
  const page = await browser.newPage();
  try {
    await args.prepare?.(page);
    await page.setViewport({ ...SHAPES[shape], deviceScaleFactor: CAPTURE_SCALE[shape] ?? 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(`${args.baseUrl}/screen?${new URLSearchParams({ shape, src: args.src })}`, { waitUntil: "networkidle0" });
    const failed = await page.$('[data-error]');
    if (failed) throw new ExportStop(`renderer refused ${label}: ${await failed.evaluate((el) => el.textContent)}`);
    await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS });
    const overflow = await page.$eval(".evac-screen", (el) => (el as HTMLElement).dataset.overflow ?? "");
    if (overflow) throw new ExportStop(`${label} overflows (${overflow}); re-run the Verifier before exporting`);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await page.screenshot({ path: args.png, type: "png" });
    await args.after?.(page);
  } finally {
    await page.close();
  }
}
