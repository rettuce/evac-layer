import fs from "node:fs";
import type { WriterOutput } from "../composer/compose.js";
import { NoRevision, type Reviser } from "./types.js";

// Stands in for the Writer while no API key is present: returns the next hand-written revision in order, so the
// loop's path can be exercised end to end.
export function fixtureReviser(files: string[]): Reviser {
  return {
    name: "fixture",
    async revise(_current, _findings, attempt) {
      const file = files[attempt - 1];
      if (!file) throw new NoRevision(`no fixture revision for attempt ${attempt + 1} (have ${files.length})`);
      return { writer: JSON.parse(fs.readFileSync(file, "utf8")) as WriterOutput, source: `fixture:${file.split("/").pop()}` };
    },
  };
}

export const liveWriterReviser: Reviser = {
  name: "writer-api",
  async revise() {
    throw new NoRevision("live Writer revision lands on Day 2 (needs ANTHROPIC_API_KEY); pass fixture revisions to exercise the loop");
  },
};
