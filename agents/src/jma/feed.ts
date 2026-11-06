import fs from "node:fs";
import path from "node:path";
import { FEED_DIR } from "../paths.js";
import { tsunamiRegionsFor, warnIfNoTsunamiRegion } from "./regions.js";

export { FEED_DIR };

export interface FeedBody { file: string; day: string; code: string; office: string; stamp: string }

const BODY_NAME = /^(\d{14})_\d+_([A-Z0-9]{6})_(\d{6})\.xml$/;

export function listBodies(feedDir = FEED_DIR): FeedBody[] {
  const root = path.join(feedDir, "bodies");
  if (!fs.existsSync(root)) throw new Error(`JMA feed recording not found at ${root}; set JMA_FEED_DIR`);
  return fs.readdirSync(root).sort().flatMap((day) =>
    fs.readdirSync(path.join(root, day)).sort().flatMap((name) => {
      const m = name.match(BODY_NAME);
      return m ? [{ file: path.join(root, day, name), day, code: m[2], office: m[3], stamp: m[1] }] : [];
    }),
  );
}

export function mentionsMunicipality(xml: string, code: string, municipalityId: string): boolean {
  if (new RegExp(`>${municipalityId}\\d{2}<`).test(xml)) return true;
  if (!code.startsWith("VTSE")) return false;
  warnIfNoTsunamiRegion(municipalityId);
  return tsunamiRegionsFor(municipalityId).some((r) => xml.includes(`<Code>${r}</Code>`));
}
