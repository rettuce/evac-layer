import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const envFile = path.join(repoRoot, ".env");
const dotenv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
const configured = (k: string) => process.env[k] !== undefined || dotenv[k] !== undefined;
const fixtures = path.join(import.meta.dirname, "fixtures", "jma");

if (!configured("EVAC_RAW_DIR") && !fs.existsSync(path.join(repoRoot, "data", "raw"))) {
  if (!configured("JMA_SAMPLES_DIR")) process.env.JMA_SAMPLES_DIR = path.join(fixtures, "jma-samples");
  if (!configured("JMA_FEED_DIR")) process.env.JMA_FEED_DIR = path.join(fixtures, "jma-feed");
}
