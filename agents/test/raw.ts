import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, FEED_DIR, SAMPLES_DIR } from "../src/paths.js";

const WHERE = {
  samples: `the official JMA sample bulletins (https://xml.kishou.go.jp/), unzipped into JMA_SAMPLES_DIR (now ${SAMPLES_DIR}; default <EVAC_RAW_DIR>/jma-samples/unzipped)`,
  feed: `a recording of the JMA XML long feeds as bodies/<YYYYMMDD>/<id>.xml in JMA_FEED_DIR (now ${FEED_DIR}; default <EVAC_RAW_DIR>/jma-feed)`,
};

// node:test skip reason when a test's non-redistributed input is absent, so a fresh clone runs the rest green.
export function needsRaw(need: { samples?: string[]; feed?: string[]; feedRoot?: boolean; samplesOf?: string[] }): string | false {
  const samples = [...(need.samples ?? []), ...(need.samplesOf ?? []).flatMap((id) => (JSON.parse(fs.readFileSync(path.join(DATA_DIR, "samples", `${id}.json`), "utf8")) as { files: string[] }).files)];
  const missingSample = samples.map((n) => path.join(SAMPLES_DIR, n)).find((f) => !fs.existsSync(f));
  if (missingSample) return `needs ${missingSample}: ${WHERE.samples}`;
  const feed = [...(need.feedRoot ? ["bodies"] : []), ...(need.feed ?? [])];
  const missingFeed = feed.map((n) => path.join(FEED_DIR, n)).find((f) => !fs.existsSync(f));
  if (missingFeed) return `needs ${missingFeed}: ${WHERE.feed}`;
  return false;
}
