import fs from "node:fs";
import { parseArgs } from "node:util";
import { parseJmaXml } from "../jma/parse.js";
import { resolveUserPath } from "../paths.js";
import type { Municipality } from "../composer/compose.js";
import { situationFor } from "../composer/rules.js";
import { cacheLatestWriterPerClass } from "./class-cache.js";
import { blindBulletin, writerMunicipality } from "./live.js";
import { WRITER_OUTPUT_SCHEMA, writerSystem, writerUser, type CellBudget } from "./request.js";

const DEFAULT_BUDGETS: CellBudget[] = [
  { role: "action", max_chars: { ja: 14, ja_easy: 20, en: 32 } },
  { role: "languages", max_chars: { ja_easy: 20, en: 32, zh_hans: 14, ko: 20 } },
];

const { values } = parseArgs({ options: { alert: { type: "string" }, municipality: { type: "string" }, "dry-run": { type: "boolean", default: false }, "build-class-cache": { type: "boolean", default: false } } });
if (values["build-class-cache"]) {
  for (const line of cacheLatestWriterPerClass({ log: (m) => console.error(m) })) console.log(line);
  process.exit(0);
}
if (!values.alert || !values["dry-run"]) {
  console.error("usage: pnpm -F agents writer --dry-run --alert <bulletin.xml> --municipality data/municipalities/<id>.json\n       pnpm -F agents writer --build-class-cache\n(the live call runs inside pipeline --writer live, fanout and replay-pipeline)");
  process.exit(2);
}
const alert = parseJmaXml(fs.readFileSync(resolveUserPath(values.alert)));
if (!values.municipality) {
  console.error("--dry-run needs --municipality: the Writer is told the class of the bulletin for that municipality, not the bulletin");
  process.exit(2);
}
const municipality = JSON.parse(fs.readFileSync(resolveUserPath(values.municipality), "utf8")) as Municipality;
const { municipality: facts } = writerMunicipality(alert, municipality);
console.log(JSON.stringify({ dry_run: true, system: writerSystem(), user: writerUser(blindBulletin(alert, situationFor(alert, municipality.id)), facts, DEFAULT_BUDGETS), output_schema: WRITER_OUTPUT_SCHEMA }, null, 2));
