import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SITES_DIR } from "./paths.js";
import { formatErrors, validateDoc } from "./schemas.js";
import { assertCoordinates, buildSite, GSI_REVERSE_GEOCODER, type RegisteredSite } from "./site-register.js";
import { isSiteId } from "./sites.js";
import { isFacilityId } from "./tokens.js";

const USAGE = "usage: pnpm -F agents site --id <id> --lat <deg> --lng <deg> [--facing <deg; leave out when not known>] [--name <text>] [--municipality <5-digit code>] [--facility <facility id>] [--force]";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    name: { type: "string" },
    lat: { type: "string" },
    lng: { type: "string" },
    facing: { type: "string" },
    municipality: { type: "string" },
    facility: { type: "string" },
    force: { type: "boolean", default: false },
  },
});

function readPrevious(file: string): RegisteredSite | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RegisteredSite;
  } catch {
    return undefined;
  }
}

// Screens composed before a move point the wrong way, so the admin API reports such a site as needing new screens.
function locationStamp(previous: RegisteredSite | undefined, site: RegisteredSite): string | undefined {
  if (!previous) return undefined;
  const moved = (["lat", "lng", "facing_deg", "municipality_id"] as const).some((k) => previous[k] !== site[k]);
  return moved ? new Date().toISOString() : previous.location_updated_at;
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

if (!values.id || values.lat === undefined || values.lng === undefined) fail(USAGE, 2);
if (!isSiteId(values.id)) fail(`site id ${JSON.stringify(values.id)} is invalid: use 1-80 of A-Z a-z 0-9 _ -`);
if (values.facility !== undefined && !isFacilityId(values.facility)) fail(`facility id ${JSON.stringify(values.facility)} is invalid: use 3-64 of a-z 0-9 -, not starting with -`);
// Without --facing nothing is assumed: a default of 0 would turn every arrow as if the viewer faced north.
const facing = values.facing === undefined ? undefined : Number(values.facing);
if (values.facing !== undefined && (values.facing.trim() === "" || !Number.isFinite(facing))) fail(`--facing ${JSON.stringify(values.facing)} is not a number`);

const sitesDir = path.resolve(SITES_DIR);
const file = path.resolve(sitesDir, `${values.id}.json`);
if (path.dirname(file) !== sitesDir) fail(`site file ${file} is outside ${sitesDir}`);

try {
  const { lat, lng } = assertCoordinates(values.lat, values.lng);
  if (!values.force && fs.existsSync(file)) fail(`${file} exists; pass --force to overwrite`);
  const previous = values.force && fs.existsSync(file) ? readPrevious(file) : undefined;
  const geocoder = { url: process.env.EVAC_REVERSE_GEOCODER_URL || GSI_REVERSE_GEOCODER };
  const { site, warnings } = await buildSite({ id: values.id, name: values.name, lat, lng, facing_deg: facing, municipality_id: values.municipality }, fetch, geocoder);
  if (values.facility) site.facility_id = values.facility;
  const stamp = locationStamp(previous, site);
  if (stamp) site.location_updated_at = stamp;
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
