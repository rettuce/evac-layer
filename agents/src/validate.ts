import fs from "node:fs";
import { parseArgs } from "node:util";
import { formatErrors, validateDoc, type SchemaName } from "./schemas.js";
import { resolveUserPath } from "./paths.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { schema: { type: "string" } },
});

if (positionals.length === 0) {
  console.error("usage: pnpm -F agents validate [--schema layout|alert|municipality] <file.json>...");
  process.exit(2);
}

let failed = 0;
for (const p of positionals) {
  const file = resolveUserPath(p);
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = validateDoc(doc, values.schema as SchemaName | undefined);
  if (result.ok) {
    console.log(`OK   ${p} (${result.schema})`);
  } else {
    failed++;
    console.log(`FAIL ${p} (${result.schema})\n${formatErrors(result.errors)}`);
  }
}
process.exit(failed ? 1 : 0);
