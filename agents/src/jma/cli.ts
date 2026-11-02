import fs from "node:fs";
import { parseJmaXml } from "./parse.js";
import { resolveUserPath } from "../paths.js";
import { formatErrors, validateDoc } from "../schemas.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: pnpm -F agents jma <bulletin.xml>...");
  process.exit(2);
}
for (const f of files) {
  const alert = parseJmaXml(fs.readFileSync(resolveUserPath(f)));
  const r = validateDoc(alert, "alert");
  if (!r.ok) {
    console.error(`alert from ${f} fails alert.schema.json:\n${formatErrors(r.errors)}`);
    process.exit(1);
  }
  console.log(JSON.stringify(alert, null, 2));
}
