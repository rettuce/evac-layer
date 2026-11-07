import fs from "node:fs";
import type { WriterOutput } from "../composer/compose.js";
import { NoRevision, type Reviser } from "./types.js";

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
    throw new NoRevision("no Writer to revise with: pass --writer live (needs ANTHROPIC_API_KEY) or --revisions <fixture.json>");
  },
};

export function writerApiReviser(args: { client: import("@anthropic-ai/sdk").default; model: import("../writer/live.js").WriterModel; alert: import("../jma/parse.js").Alert; municipality: import("../composer/compose.js").Municipality; municipalityId: string; situation: import("../composer/rules.js").Situation; usage: import("../reader/pricing.js").CallUsage[] }): Reviser {
  return {
    name: `writer-api(${args.model})`,
    async revise(_current, findings) {
      const { writeCells } = await import("../writer/live.js");
      const feedback = findings.map((f) => `${f.shape} ${f.check}${f.cell_id ? `[${f.cell_id}]` : ""}: ${f.detail}`);
      let r = await writeCells({ ...args, feedback });
      args.usage.push(r.usage);
      for (let i = 0; i < 2 && r.lint.length; i++) {
        r = await writeCells({ ...args, feedback: [...feedback, ...r.lint.map((l) => `${l.rule}: 「${l.match}」`)] });
        args.usage.push(r.usage);
      }
      if (r.lint.length) throw new NoRevision(`revised Writer text still breaks the easy-Japanese rules: ${r.lint.map((l) => l.rule).join(", ")}`);
      return { writer: r.output, source: `writer-api:${args.model}` };
    },
  };
}
