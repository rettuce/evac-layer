import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { LAYOUTS_DIR, LIVE_DIR } from "../paths.js";
import { findSite, SiteNotFound } from "../sites.js";

// Writes data/live/<site_id>.json, the same file POST /api/admin/live writes. A JMA receiver outside this
// repository calls this (or the endpoint) when a new bulletin for the site has been composed and approved.
const { values } = parseArgs({ options: { site: { type: "string" }, bulletin: { type: "string" }, clear: { type: "boolean", default: false } } });
if (!values.site || Boolean(values.bulletin) === values.clear) {
  console.error("usage: pnpm -F agents live --site <site_id> (--bulletin <bulletin_id> | --clear)");
  process.exit(2);
}
try {
  findSite(values.site);
} catch (e) {
  if (!(e instanceof SiteNotFound)) throw e;
  console.error(`[live stopped] ${e.message}`);
  process.exit(2);
}
const bulletin = values.clear ? null : values.bulletin!;
if (bulletin && !fs.existsSync(path.join(LAYOUTS_DIR, values.site, bulletin))) {
  console.warn(`[warn] no screens for ${bulletin} under ${path.join(LAYOUTS_DIR, values.site)}; the site stays ambient until they exist and are approved`);
}
const file = path.join(LIVE_DIR, `${values.site}.json`);
const doc = { bulletin_id: bulletin, updated_at: new Date().toISOString() };
fs.mkdirSync(LIVE_DIR, { recursive: true });
fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 2) + "\n");
fs.renameSync(`${file}.tmp`, file);
console.log(`${file}: ${JSON.stringify(doc)}`);
