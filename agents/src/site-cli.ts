import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SITES_DIR } from "./paths.js";
import { formatErrors, validateDoc } from "./schemas.js";
import { buildSite } from "./site-register.js";

const USAGE = "usage: pnpm -F agents site --id <id> --lat <deg> --lng <deg> [--facing <deg, default 0>] [--name <text>] [--municipality <5-digit code>] [--force]";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    name: { type: "string" },
    lat: { type: "string" },
    lng: { type: "string" },
    facing: { type: "string", default: "0" },
    municipality: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

const lat = Number(values.lat);
const lng = Number(values.lng);
const facing = Number(values.facing);
if (!values.id || values.lat === undefined || values.lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(facing)) {
  console.error(USAGE);
  process.exit(2);
}

const file = path.join(SITES_DIR, `${values.id}.json`);
if (fs.existsSync(file) && !values.force) {
  console.error(`${file} exists; pass --force to overwrite`);
  process.exit(1);
}

try {
  const { site, warnings } = await buildSite({ id: values.id, name: values.name, lat, lng, facing_deg: facing, municipality_id: values.municipality });
  for (const w of warnings) console.warn(`WARN ${w}`);
  const result = validateDoc(site, "site");
  if (!result.ok) {
    console.error(`site does not validate:\n${formatErrors(result.errors)}`);
    process.exit(1);
  }
  fs.mkdirSync(SITES_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(site, null, 2)}\n`);
  console.log(`wrote ${file} (municipality_id ${site.municipality_id}${values.municipality ? ", given" : ", from GSI"})`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
