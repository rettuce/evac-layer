import { parseArgs } from "node:util";
import { readSites } from "../sites.js";
import { migrateBulletinStatus } from "./status-migration.js";

const { values } = parseArgs({ options: { sites: { type: "string" } } });
const ids = values.sites ? values.sites.split(",").map((s) => s.trim()).filter(Boolean) : readSites().map((s) => s.id);
for (const id of ids) {
  const migrated = migrateBulletinStatus(id);
  console.log(`${id}: ${migrated.length ? `drill or test status written for ${migrated.join(", ")}` : "nothing to migrate"}`);
}
