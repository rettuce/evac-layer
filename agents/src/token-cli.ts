import { parseArgs } from "node:util";
import { TOKENS_FILE, issueToken, listTokens, revokeToken } from "./tokens.js";

const USAGE = `usage: pnpm -F agents tokens issue --facility <facility id> --label <text> [--expires <ISO 8601>]
       pnpm -F agents tokens list
       pnpm -F agents tokens revoke --id <id>`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    facility: { type: "string" },
    label: { type: "string" },
    expires: { type: "string" },
    id: { type: "string" },
  },
});

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

const [command] = positionals;
try {
  if (command === "issue") {
    if (!values.facility || values.label === undefined) fail(USAGE, 2);
    const { token, record } = issueToken({ facility: values.facility, label: values.label, expires: values.expires });
    console.error(`issued ${record.id} for facility ${record.facility_id} (${record.label})${record.expires_at ? `, expires ${record.expires_at}` : ""} in ${TOKENS_FILE}`);
    console.error("the token below is shown this once and is not stored; give it to the facility now");
    console.log(token);
  } else if (command === "list") {
    for (const t of listTokens()) console.log([t.id, t.facility_id, t.label, t.created_at, t.expires_at ?? "-"].join("\t"));
  } else if (command === "revoke") {
    if (!values.id) fail(USAGE, 2);
    if (!revokeToken(values.id)) fail(`no token ${values.id} in ${TOKENS_FILE}`);
    console.error(`revoked ${values.id}`);
  } else {
    fail(USAGE, 2);
  }
} catch (e) {
  fail((e as Error).message);
}
