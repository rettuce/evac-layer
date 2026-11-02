import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseJmaXml } from "../jma/parse.js";
import { resolveUserPath } from "../paths.js";
import { formatErrors, validateDoc } from "../schemas.js";
import { compose } from "./compose.js";
import { ComposerStop } from "./rules.js";
import { loadMunicipality } from "../loop/municipality.js";

const { values } = parseArgs({
  options: { alert: { type: "string" }, municipality: { type: "string" }, site: { type: "string" }, writer: { type: "string" }, "out-dir": { type: "string" } },
});
const required = ["alert", "municipality", "site", "writer"] as const;
if (required.some((k) => !values[k])) {
  console.error("usage: pnpm -F agents compose --alert <bulletin.xml> --municipality <id | file.json> --site <site>.json --writer <writer>.json [--out-dir dir]");
  process.exit(2);
}
const read = (p: string) => JSON.parse(fs.readFileSync(resolveUserPath(p), "utf8"));
try {
  const screens = compose({
    alert: parseJmaXml(fs.readFileSync(resolveUserPath(values.alert!))),
    municipality: /^\d{5}$/.test(values.municipality!) ? loadMunicipality(values.municipality!).municipality : read(values.municipality!),
    site: read(values.site!),
    writer: read(values.writer!),
  });
  let failed = false;
  for (const s of screens) {
    const r = validateDoc(s, "layout");
    if (!r.ok) { failed = true; console.error(`FAIL ${s.shape}\n${formatErrors(r.errors)}`); }
    if (values["out-dir"]) {
      const dir = resolveUserPath(values["out-dir"]);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${s.municipality.id}-${s.alert.bulletin_id}-${s.shape}.json`);
      fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
      console.error(`${r.ok ? "OK  " : "FAIL"} ${file}`);
    }
  }
  if (!values["out-dir"]) console.log(JSON.stringify(screens, null, 2));
  process.exit(failed ? 1 : 0);
} catch (e) {
  if (e instanceof ComposerStop) { console.error(`[composer stopped] ${e.message}`); process.exit(3); }
  throw e;
}
