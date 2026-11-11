import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Page } from "puppeteer-core";
import { isBulletinId } from "../../../app/layout/replay";
import type { Shape } from "../../../app/layout/types";
import { SHAPE_ORDER } from "../composer/rules.js";
import { DATA_DIR, LAYOUTS_DIR, chromePath } from "../paths.js";
import { formatErrors, validateDoc } from "../schemas.js";
import { isSiteId } from "../sites.js";
import { ExportStop, captureShape } from "./capture.js";

export const PREVIEWS_DIR = path.join(DATA_DIR, "previews");
export const PREVIEW_LAYOUT_PATH = "/api/admin/preview-layout";

export interface PreviewPlan { site: string; bulletin: string; out: string; shapes: { shape: Shape; layoutFile: string }[] }

export function previewPlan(args: { site?: string; bulletin?: string; out?: string }, roots = { layouts: LAYOUTS_DIR, previews: PREVIEWS_DIR }): PreviewPlan {
  if (!isSiteId(args.site)) throw new ExportStop("--site must be a site id");
  if (!isBulletinId(args.bulletin)) throw new ExportStop("--bulletin must be a bulletin id");
  if (!args.out) throw new ExportStop("--out is required");
  const out = path.resolve(args.out);
  const inside = path.relative(path.resolve(roots.previews), out);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new ExportStop(`--out must be a directory under ${roots.previews}: a preview is not a delivery file`);
  const dir = path.join(roots.layouts, args.site, args.bulletin);
  const shapes = SHAPE_ORDER.map((shape) => ({ shape, layoutFile: path.join(dir, `${shape}.json`) })).filter((s) => fs.existsSync(s.layoutFile));
  if (!shapes.length) throw new ExportStop(`no layouts in ${dir}`);
  return { site: args.site, bulletin: args.bulletin, out, shapes };
}

export function previewSrc(site: string, bulletin: string, shape: Shape): string {
  return `${PREVIEW_LAYOUT_PATH}?${new URLSearchParams({ site, bulletin, shape })}`;
}

// The unapproved layout is answered inside the browser from the file the server would read, so rendering a
// preview needs no admin credential: the page never reaches an admin path of the server, or anything off it.
export function previewRequestAction(requestUrl: string, args: { baseUrl: string; src: string }): "respond" | "abort" | "continue" {
  const url = new URL(requestUrl);
  if (url.protocol === "data:" || url.protocol === "blob:") return "continue";
  if (url.origin !== new URL(args.baseUrl).origin) return "abort";
  if (`${url.pathname}${url.search}` === args.src) return "respond";
  return url.pathname.startsWith("/api/admin/") ? "abort" : "continue";
}

async function serveLayout(page: Page, baseUrl: string, src: string, body: string): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const action = previewRequestAction(request.url(), { baseUrl, src });
    if (action === "respond") void request.respond({ status: 200, contentType: "application/json", body });
    else if (action === "abort") void request.abort();
    else void request.continue();
  });
}

export async function renderPreview(plan: PreviewPlan, opts: { baseUrl: string; chrome?: string; log?: (m: string) => void }): Promise<{ rendered: Shape[]; failed: string[] }> {
  const log = opts.log ?? (() => {});
  fs.mkdirSync(plan.out, { recursive: true });
  const rendered: Shape[] = [];
  const failed: string[] = [];
  const browser = await puppeteer.launch({ executablePath: opts.chrome ?? chromePath(), headless: true, args: ["--disable-gpu-rasterization"] });
  try {
    for (const { shape, layoutFile } of plan.shapes) {
      try {
        const body = fs.readFileSync(layoutFile, "utf8");
        const v = validateDoc(JSON.parse(body), "layout");
        if (!v.ok) throw new ExportStop(`${layoutFile} fails layout.schema.json:\n${formatErrors(v.errors)}`);
        const src = previewSrc(plan.site, plan.bulletin, shape);
        await captureShape(browser, {
          baseUrl: opts.baseUrl, shape, src, png: path.join(plan.out, `${shape}.png`), label: `${plan.bulletin} ${shape}`,
          prepare: (page) => serveLayout(page, opts.baseUrl, src, body),
        });
        rendered.push(shape);
        log(`${plan.bulletin} ${shape}: preview png`);
      } catch (e) {
        failed.push(`${shape}: ${(e as Error).message}`);
      }
    }
  } finally {
    await browser.close();
  }
  return { rendered, failed };
}
