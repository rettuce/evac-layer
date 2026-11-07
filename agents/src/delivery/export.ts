import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { SHAPES } from "../../../app/layout/shapes";
import type { Shape } from "../../../app/layout/types";
import { SHAPE_ORDER } from "../composer/rules.js";
import { LAYOUTS_DIR, REPORTS_DIR, chromePath } from "../paths.js";
import { findSite as findSiteFile, siteMunicipality, SiteNotFound, type SiteFile } from "../sites.js";
import { formatErrors, validateDoc } from "../schemas.js";
import { exportGate, layoutClassOf, layoutDigestOf, readApprovals } from "./gate.js";
import { INLINE_PAGE_SCRIPT } from "./inline-page.js";

const CAPTURE_SCALE: Partial<Record<Shape, number>> = { pillar: 0.5 };
const READY_TIMEOUT_MS = 30_000;
const SETTLE_MS = 500;

export class ExportStop extends Error {}

interface IndexEntry { bulletin_id: string; issued_at: string; screen: boolean; template?: string; display_level?: number }

export function findSite(siteId: string): SiteFile {
  try {
    return findSiteFile(siteId);
  } catch (e) {
    if (e instanceof SiteNotFound) throw new ExportStop(e.message);
    throw e;
  }
}

export async function exportSite(opts: { site: string; out: string; baseUrl: string; chrome?: string; skipShapes?: readonly string[]; log?: (m: string) => void }) {
  const log = opts.log ?? (() => {});
  const shapes = SHAPE_ORDER.filter((shape) => !opts.skipShapes?.includes(shape));
  for (const shape of SHAPE_ORDER) if (!shapes.includes(shape)) log(`skip shape ${shape} (--skip-shapes)`);
  const site = findSite(opts.site);
  const m = siteMunicipality(site);
  const siteLayouts = path.join(LAYOUTS_DIR, site.id);
  const approvals = readApprovals();
  const indexFile = path.join(siteLayouts, "index.json");
  if (!fs.existsSync(indexFile)) throw new ExportStop(`${indexFile} not found; run replay-pipeline or fanout first`);
  const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { entries: IndexEntry[] };
  const shown = index.entries.filter((e) => e.screen);
  const gated = shown.map((e) => ({ e, ...exportGate(approvals, site.id, e.bulletin_id, layoutDigestOf(path.join(siteLayouts, e.bulletin_id)), layoutClassOf(path.join(siteLayouts, e.bulletin_id), path.join(REPORTS_DIR, site.id, e.bulletin_id, "report.json"))) }));
  const approvedAt = new Map(gated.map((g) => [g.e.bulletin_id, g.approved_at]));
  const ready = gated.filter((g) => g.gate === "ok").map((g) => g.e);
  for (const g of gated) if (g.gate !== "ok") log(`skip ${g.e.bulletin_id}: ${g.gate}`);
  if (!ready.length) throw new ExportStop(`nothing to export for ${site.id}: ${shown.length ? gated[0].gate : "no browser-verified screens in index.json"}`);

  const siteDir = path.join(opts.out, site.id);
  fs.rmSync(siteDir, { recursive: true, force: true });
  const browser = await puppeteer.launch({ executablePath: opts.chrome ?? chromePath(), headless: true, args: ["--disable-gpu-rasterization"] });
  const entries = [];
  try {
    for (const e of ready) {
      const files: Record<string, { json: string; png: string; html: string }> = {};
      let sources: unknown[] = [];
      for (const shape of shapes) {
        const layoutFile = path.join(siteLayouts, e.bulletin_id, `${shape}.json`);
        const layout = JSON.parse(fs.readFileSync(layoutFile, "utf8"));
        const v = validateDoc(layout, "layout");
        if (!v.ok) throw new ExportStop(`${layoutFile} fails layout.schema.json:\n${formatErrors(v.errors)}`);
        sources = layout.sources;
        const dir = path.join(siteDir, e.bulletin_id);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${shape}.json`), JSON.stringify(layout, null, 2) + "\n");
        const live = `/api/live-layout?${new URLSearchParams({ municipality: m, bulletin: e.bulletin_id, shape, site: site.id })}`;
        const page = await browser.newPage();
        try {
          await page.setViewport({ ...SHAPES[shape], deviceScaleFactor: CAPTURE_SCALE[shape] ?? 1 });
          await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
          await page.goto(`${opts.baseUrl}/screen?${new URLSearchParams({ shape, src: live })}`, { waitUntil: "networkidle0" });
          const failed = await page.$('[data-error]');
          if (failed) throw new ExportStop(`renderer refused ${e.bulletin_id} ${shape}: ${await failed.evaluate((el) => el.textContent)}`);
          await page.waitForSelector('.evac-screen[data-ready="1"]', { timeout: READY_TIMEOUT_MS });
          const overflow = await page.$eval(".evac-screen", (el) => (el as HTMLElement).dataset.overflow ?? "");
          if (overflow) throw new ExportStop(`${e.bulletin_id} ${shape} overflows (${overflow}); re-run the Verifier before exporting`);
          await new Promise((r) => setTimeout(r, SETTLE_MS));
          await page.screenshot({ path: path.join(dir, `${shape}.png`), type: "png" });
          const { html, fontsKept } = (await page.evaluate(INLINE_PAGE_SCRIPT)) as { html: string; fontsKept: number };
          fs.writeFileSync(path.join(dir, `${shape}.html`), html);
          log(`${e.bulletin_id} ${shape}: png + html (${fontsKept} font subsets, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
        } finally {
          await page.close();
        }
        files[shape] = { json: `${e.bulletin_id}/${shape}.json`, png: `${e.bulletin_id}/${shape}.png`, html: `${e.bulletin_id}/${shape}.html` };
      }
      entries.push({
        bulletin_id: e.bulletin_id, issued_at: e.issued_at, template: e.template!, display_level: e.display_level!,
        approved_at: approvedAt.get(e.bulletin_id)!, files, sources,
      });
    }
  } finally {
    await browser.close();
  }
  const manifest = { feed_version: "0.1", site: site.id, municipality_id: m, entries };
  const v = validateDoc(manifest, "export-manifest");
  if (!v.ok) throw new ExportStop(`manifest fails export-manifest.schema.json:\n${formatErrors(v.errors)}`);
  fs.writeFileSync(path.join(siteDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { siteDir, entries: entries.length, shapes: shapes.length, files: entries.length * shapes.length * 3 + 1 };
}
