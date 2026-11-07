import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const AGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(AGENTS_DIR, "..");
export const SCHEMA_DIR = path.join(REPO_ROOT, "schema");
export const ENV_FILE = path.join(REPO_ROOT, ".env");
export const TMP_DIR = path.join(REPO_ROOT, "tmp");

const PATH_SETTINGS = ["EVAC_DATA_DIR", "EVAC_RAW_DIR", "JMA_FEED_DIR", "JMA_SAMPLES_DIR", "EVAC_URL", "CHROME_PATH"] as const;

if (fs.existsSync(ENV_FILE)) {
  const dotenv = parseEnv(fs.readFileSync(ENV_FILE, "utf8"));
  for (const k of PATH_SETTINGS) if (process.env[k] === undefined && dotenv[k] !== undefined) process.env[k] = dotenv[k];
}

// pnpm -F runs scripts inside agents/, so user-supplied relative paths are resolved against the invoking directory.
export function resolveUserPath(p: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

export const DATA_DIR = path.resolve(REPO_ROOT, process.env.EVAC_DATA_DIR ?? "data");
export const SITES_DIR = path.join(DATA_DIR, "sites");
export const LAYOUTS_DIR = path.join(DATA_DIR, "layouts");
export const REPORTS_DIR = path.join(DATA_DIR, "reports");
export const MUNICIPALITIES_DIR = path.join(DATA_DIR, "municipalities");
export const SAMPLES_LIST_DIR = path.join(DATA_DIR, "samples");
export const WRITER_DIR = path.join(DATA_DIR, "writer");
export const LIVE_DIR = path.join(DATA_DIR, "live");
export const APPROVALS_FILE = path.join(DATA_DIR, "approvals.json");
export const TSUNAMI_REGIONS_FILE = path.join(DATA_DIR, "jma", "tsunami-regions.json");

export const RAW_DIR = path.resolve(REPO_ROOT, process.env.EVAC_RAW_DIR ?? "data/raw");
export const FEED_DIR = path.resolve(REPO_ROOT, process.env.JMA_FEED_DIR ?? path.join(RAW_DIR, "jma-feed"));
export const SAMPLES_DIR = path.resolve(REPO_ROOT, process.env.JMA_SAMPLES_DIR ?? path.join(RAW_DIR, "jma-samples", "unzipped"));

export const EVAC_URL = process.env.EVAC_URL ?? "http://127.0.0.1:3150";

const RAW_HELP = `Raw inputs are not part of the repository. Put them under EVAC_RAW_DIR (now ${RAW_DIR}) or point the variables at them in .env:
  - JMA_FEED_DIR (now ${FEED_DIR}): a recording of the JMA XML long feeds as bodies/<YYYYMMDD>/<id>.xml. Record it with "pnpm -F agents record" (the JMA long feeds at https://www.data.jma.go.jp/developer/xml/feed/).
  - JMA_SAMPLES_DIR (now ${SAMPLES_DIR}): the official JMA sample bulletins, unzipped, from https://xml.kishou.go.jp/ (技術資料 → サンプル電文). Needed for the municipalities listed in data/samples/.
  - EVAC_RAW_DIR/gsi-shelters/<id>_1.csv and <id>_2.csv: GSI designated shelter CSVs from https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/ (Reader and shelters only).
  - EVAC_RAW_DIR/municipal-pdfs/...: the municipal hazard-map PDFs named in data/municipalities/<id>.preset.json (Reader only).`;

export function requireRawDir(dir: string, what: string): void {
  if (fs.existsSync(dir)) return;
  console.error(`[stopped] ${what} not found at ${dir}.\n${RAW_HELP}`);
  process.exit(1);
}

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`no Chrome found (looked at ${CHROME_CANDIDATES.join(", ")}); set CHROME_PATH to a Chrome or Chromium executable`);
  return found;
}
