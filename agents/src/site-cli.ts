import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SITES_DIR } from "./paths.js";
import { formatErrors, validateDoc } from "./schemas.js";
import { assertCoordinates, buildSite } from "./site-register.js";
import { isSiteId } from "./sites.js";

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

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

if (!values.id || values.lat === undefined || values.lng === undefined) fail(USAGE, 2);
if (!isSiteId(values.id)) fail(`site id ${JSON.stringify(values.id)} is invalid: use 1-80 of A-Z a-z 0-9 _ -`);
const facing = Number(values.facing);
if (values.facing.trim() === "" || !Number.isFinite(facing)) fail(`--facing ${JSON.stringify(values.facing)} is not a number`);

const sitesDir = path.resolve(SITES_DIR);
const file = path.resolve(sitesDir, `${values.id}.json`);
if (path.dirname(file) !== sitesDir) fail(`site file ${file} is outside ${sitesDir}`);

try {
  const { lat, lng } = assertCoordinates(values.lat, values.lng);
  if (!values.force && fs.existsSync(file)) fail(`${file} exists; pass --force to overwrite`);
  const { site, warnings } = await buildSite({ id: values.id, name: values.name, lat, lng, facing_deg: facing, municipality_id: values.municipality });
  for (const w of warnings) console.warn(`WARN ${w}`);
  const result = validateDoc(site, "site");
  if (!result.ok) fail(`site does not validate:\n${formatErrors(result.errors)}`);
  fs.mkdirSync(sitesDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(site, null, 2)}\n`, { flag: values.force ? "w" : "wx" });
  console.log(`wrote ${file} (municipality_id ${site.municipality_id}${values.municipality ? ", given" : ", from GSI"})`);
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  fail(err.code === "EEXIST" ? `${file} exists; pass --force to overwrite` : err.message);
}
