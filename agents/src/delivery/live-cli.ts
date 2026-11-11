import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { LAYOUTS_DIR } from "../paths.js";
import { DrillNotLive, refuseDrillOnLive, SyntheticNotLive, writeLive } from "./live.js";
import { findSite, SiteNotFound } from "../sites.js";

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
try {
  if (bulletin) refuseDrillOnLive(values.site, bulletin);
  const { file, doc } = writeLive(values.site, bulletin);
  console.log(`${file}: ${JSON.stringify(doc)}`);
} catch (e) {
  if (!(e instanceof SyntheticNotLive) && !(e instanceof DrillNotLive)) throw e;
  console.error(`[live stopped] ${e.message}`);
  process.exit(2);
}
