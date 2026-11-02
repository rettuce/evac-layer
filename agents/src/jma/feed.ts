import fs from "node:fs";
import path from "node:path";
import { tsunamiRegionsFor } from "./regions.js";

// Hourly recording of the JMA long feeds (bodies/<YYYYMMDD>/<id>.xml), kept outside the public repository.
export const FEED_DIR = process.env.JMA_FEED_DIR ?? "/Users/you/Dropbox/dev/claude-hackathon-2026/data/jma-feed";

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
  return tsunamiRegionsFor(municipalityId).some((r) => xml.includes(`<Code>${r}</Code>`));
}
