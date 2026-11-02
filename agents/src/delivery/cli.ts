import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "../paths.js";
import { ExportStop, exportSite } from "./export.js";

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    out: { type: "string", default: path.join(REPO_ROOT, "dist") },
    "base-url": { type: "string", default: process.env.EVAC_URL ?? "http://127.0.0.1:3152" },
  },
});
if (!values.site) {
  console.error("usage: pnpm -F agents export --site <site_id> [--out dist/] [--base-url http://127.0.0.1:3152]");
  process.exit(2);
}
try {
  const t0 = Date.now();
  const r = await exportSite({ site: values.site, out: path.resolve(process.env.INIT_CWD ?? process.cwd(), values.out!), baseUrl: values["base-url"]!, log: (m) => console.log(m) });
  console.log(`exported ${r.entries} bulletins × 4 shapes (${r.files} files) to ${path.relative(process.cwd(), r.siteDir)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  if (e instanceof ExportStop) { console.error(`[export stopped] ${e.message}`); process.exit(3); }
  throw e;
}
