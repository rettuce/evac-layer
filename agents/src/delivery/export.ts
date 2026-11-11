import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { EXPORT_DIGEST_FILE } from "../../../app/layout/feed";
import { isSyntheticBulletinId } from "../../../app/layout/replay";
import type { Shape } from "../../../app/layout/types";
import { SHAPE_ORDER } from "../composer/rules.js";
import { LAYOUTS_DIR, REPORTS_DIR, chromePath } from "../paths.js";
import { findSite as findSiteFile, siteMunicipality, SiteNotFound, type SiteFile } from "../sites.js";
import { formatErrors, validateDoc } from "../schemas.js";
import { exportGate, layoutClassOf, layoutDigestOf, readApprovals } from "./gate.js";
import { ExportStop, captureShape } from "./capture.js";
import { INLINE_PAGE_SCRIPT } from "./inline-page.js";

export { ExportStop };

interface IndexEntry { bulletin_id: string; issued_at: string; screen: boolean; template?: string; display_level?: number; synthetic?: boolean; status?: string }

export function findSite(siteId: string): SiteFile {
  try {
    return findSiteFile(siteId);
  } catch (e) {
    if (e instanceof SiteNotFound) throw new ExportStop(e.message);
    throw e;
  }
}

export function mergeEntries<T extends { bulletin_id: string }>(kept: readonly T[], rendered: readonly T[], approvedOrder: readonly string[]): T[] {
  const byId = new Map([...kept, ...rendered].map((entry) => [entry.bulletin_id, entry]));
  return approvedOrder.flatMap((id) => byId.get(id) ?? []);
}

function stagingDir(siteDir: string, bulletinId: string): string {
  return path.join(siteDir, `.${bulletinId}.staging`);
}

interface ShapeFiles { json: string; png: string; html: string }

async function renderShape(browser: Browser, args: { baseUrl: string; site: string; municipality: string; bulletinId: string; shape: Shape; layoutFile: string; dir: string; log: (m: string) => void }): Promise<{ files: ShapeFiles; sources: unknown[] }> {
  const { bulletinId, shape, dir } = args;
  const layout = JSON.parse(fs.readFileSync(args.layoutFile, "utf8"));
  const v = validateDoc(layout, "layout");
  if (!v.ok) throw new ExportStop(`${args.layoutFile} fails layout.schema.json:\n${formatErrors(v.errors)}`);
  fs.writeFileSync(path.join(dir, `${shape}.json`), JSON.stringify(layout, null, 2) + "\n");
  const live = `/api/live-layout?${new URLSearchParams({ municipality: args.municipality, bulletin: bulletinId, shape, site: args.site })}`;
  await captureShape(browser, {
    baseUrl: args.baseUrl, shape, src: live, png: path.join(dir, `${shape}.png`), label: `${bulletinId} ${shape}`,
    after: async (page) => {
      const { html, fontsKept } = (await page.evaluate(INLINE_PAGE_SCRIPT)) as { html: string; fontsKept: number };
      fs.writeFileSync(path.join(dir, `${shape}.html`), html);
      args.log(`${bulletinId} ${shape}: png + html (${fontsKept} font subsets, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
    },
  });
  return { files: { json: `${bulletinId}/${shape}.json`, png: `${bulletinId}/${shape}.png`, html: `${bulletinId}/${shape}.html` }, sources: layout.sources };
}

export async function exportSite(opts: { site: string; out: string; baseUrl: string; bulletins?: readonly string[]; chrome?: string; skipShapes?: readonly string[]; log?: (m: string) => void }) {
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
  const shown = index.entries.filter((e) => e.screen && !e.synthetic && !isSyntheticBulletinId(e.bulletin_id));
  const gated = shown.map((e) => ({ e, ...exportGate(approvals, site.id, e.bulletin_id, layoutDigestOf(path.join(siteLayouts, e.bulletin_id)), layoutClassOf(path.join(siteLayouts, e.bulletin_id), path.join(REPORTS_DIR, site.id, e.bulletin_id, "report.json"), e.status)) }));
  const approvedAt = new Map(gated.map((g) => [g.e.bulletin_id, g.approved_at]));
  const approvedIds = gated.filter((g) => g.gate === "ok").map((g) => g.e.bulletin_id);
  const partial = Boolean(opts.bulletins?.length);
  const wanted = partial ? gated.filter((g) => opts.bulletins!.includes(g.e.bulletin_id)) : gated;
  const ready = wanted.filter((g) => g.gate === "ok").map((g) => g.e);
  for (const g of wanted) if (g.gate !== "ok") log(`skip ${g.e.bulletin_id}: ${g.gate}`);
  if (!ready.length) throw new ExportStop(`nothing to export for ${site.id}: ${wanted.length ? wanted[0].gate : partial ? `${opts.bulletins!.join(", ")} not among the screens in index.json` : "no browser-verified screens in index.json"}`);

  const siteDir = path.join(opts.out, site.id);
  const manifestFile = path.join(siteDir, "manifest.json");
  const browser = await puppeteer.launch({ executablePath: opts.chrome ?? chromePath(), headless: true, args: ["--disable-gpu-rasterization"] });
  const entries = [];
  try {
    for (const e of ready) {
      const files: Record<string, ShapeFiles> = {};
      let sources: unknown[] = [];
      const dir = stagingDir(siteDir, e.bulletin_id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const layoutDir = path.join(siteLayouts, e.bulletin_id);
      const digest = layoutDigestOf(layoutDir)!;
      try {
        for (const shape of shapes) {
          const rendered = await renderShape(browser, { baseUrl: opts.baseUrl, site: site.id, municipality: m, bulletinId: e.bulletin_id, shape, layoutFile: path.join(siteLayouts, e.bulletin_id, `${shape}.json`), dir, log });
          files[shape] = rendered.files;
          sources = rendered.sources;
        }
        // The pages were read from the layout files while they rendered; the digest vouches for them only if the files did not change meanwhile.
        if (layoutDigestOf(layoutDir) !== digest) throw new ExportStop(`${e.bulletin_id} was composed again during the export; export it again`);
        fs.writeFileSync(path.join(dir, EXPORT_DIGEST_FILE), digest);
      } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
      }
      // The feed lists a shape as soon as its files exist, so a bulletin is published in one rename, never half rendered.
      const published = path.join(siteDir, e.bulletin_id);
      const replaced = `${dir}.replaced`;
      fs.rmSync(replaced, { recursive: true, force: true });
      if (fs.existsSync(published)) fs.renameSync(published, replaced);
      fs.renameSync(dir, published);
      fs.rmSync(replaced, { recursive: true, force: true });
      entries.push({
        bulletin_id: e.bulletin_id, issued_at: e.issued_at, template: e.template!, display_level: e.display_level!,
        approved_at: approvedAt.get(e.bulletin_id)!, files, sources,
      });
    }
  } finally {
    await browser.close();
  }
  const kept = partial && fs.existsSync(manifestFile) ? (JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { entries: typeof entries }).entries : [];
  if (!partial) {
    for (const name of fs.readdirSync(siteDir)) if (name !== "manifest.json" && !approvedIds.includes(name)) fs.rmSync(path.join(siteDir, name), { recursive: true, force: true });
  }
  const manifest = { feed_version: "0.1", site: site.id, municipality_id: m, entries: mergeEntries(kept, entries, approvedIds) };
  const v = validateDoc(manifest, "export-manifest");
  if (!v.ok) throw new ExportStop(`manifest fails export-manifest.schema.json:\n${formatErrors(v.errors)}`);
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  return { siteDir, entries: entries.length, shapes: shapes.length, files: entries.length * shapes.length * 3 + 1 };
}
