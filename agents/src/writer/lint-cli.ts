import fs from "node:fs";
import { lintWriter } from "./live.js";
import type { WriterOutput } from "../composer/compose.js";

// A cached record does not keep the display level, so the level 5 wording rule is checked in the loop, not here.
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: pnpm -F agents lint-writer <data/writer/<id>/<bulletin>.json>...");
  process.exit(2);
}
let failed = 0;
for (const f of files) {
  const record = JSON.parse(fs.readFileSync(f, "utf8")) as { output: WriterOutput };
  const findings = lintWriter(record.output, 0);
  if (findings.length) {
    failed++;
    console.log(`FAIL ${f}\n${findings.map((x) => `  ${x.rule}: 「${x.match}」`).join("\n")}`);
  } else console.log(`OK   ${f}`);
}
process.exit(failed ? 1 : 0);
