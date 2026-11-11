import { parseArgs } from "node:util";
import { EVAC_URL, resolveUserPath } from "../paths.js";
import { ExportStop } from "./capture.js";
import { previewPlan, renderPreview } from "./preview.js";

const { values } = parseArgs({
  options: {
    site: { type: "string" },
    bulletin: { type: "string" },
    out: { type: "string" },
    "base-url": { type: "string", default: EVAC_URL },
  },
});
if (!values.site || !values.bulletin || !values.out) {
  console.error("usage: pnpm -F agents preview --site <site_id> --bulletin <bulletin_id> --out <dir under data/previews/> [--base-url $EVAC_URL]");
  process.exit(2);
}
try {
  const plan = previewPlan({ site: values.site, bulletin: values.bulletin, out: resolveUserPath(values.out) });
  const { rendered, failed } = await renderPreview(plan, { baseUrl: values["base-url"]!, log: (m) => console.log(m) });
  console.log(`preview ${plan.site} ${plan.bulletin}: ${rendered.length} of ${plan.shapes.length} shapes`);
  if (failed.length) {
    console.error(`[preview incomplete] ${failed.join("; ")}`);
    process.exit(1);
  }
} catch (e) {
  if (e instanceof ExportStop) {
    console.error(`[preview stopped] ${e.message}`);
    process.exit(3);
  }
  throw e;
}
