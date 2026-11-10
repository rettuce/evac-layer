import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

export const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
export const FACILITY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const TOKEN_BYTES = 32;
const ID_BYTES = 6;

export interface FacilityToken {
  id: string;
  label: string;
  facility_id: string;
  sha256: string;
  created_at: string;
  expires_at?: string;
}

export type ListedToken = Omit<FacilityToken, "sha256">;

interface TokensFile {
  version: "0.1";
  tokens: FacilityToken[];
}

export class InvalidTokenRequest extends Error {}

export function isFacilityId(id: unknown): id is string {
  return typeof id === "string" && FACILITY_ID.test(id);
}

function readTokens(file: string): FacilityToken[] {
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, "utf8")) as TokensFile).tokens ?? [];
}

// The file holds who may change what every facility's screens show, so it is never readable by others,
// and a crash mid-write must not leave half a file that locks every facility out.
function writeTokens(tokens: FacilityToken[], file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(partial, `${JSON.stringify({ version: "0.1", tokens } satisfies TokensFile, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(partial, file);
}

export interface IssueInput {
  facility: string;
  label: string;
  expires?: string;
  now?: Date;
}

export function issueToken({ facility, label, expires, now = new Date() }: IssueInput, file = TOKENS_FILE): { token: string; record: FacilityToken } {
  if (!isFacilityId(facility)) throw new InvalidTokenRequest(`facility id ${JSON.stringify(facility)} is invalid: use 3-64 of a-z 0-9 -, not starting with -`);
  if (!label.trim()) throw new InvalidTokenRequest("label is required");
  let expires_at: string | undefined;
  if (expires !== undefined) {
    const at = /^\d{4}-\d{2}-\d{2}(T|$)/.test(expires) ? Date.parse(expires) : NaN;
    if (Number.isNaN(at)) throw new InvalidTokenRequest(`--expires ${JSON.stringify(expires)} is not an ISO 8601 date`);
    if (at <= now.getTime()) throw new InvalidTokenRequest(`--expires ${expires} is not in the future`);
    expires_at = new Date(at).toISOString();
  }
  const tokens = readTokens(file);
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const record: FacilityToken = {
    id: randomBytes(ID_BYTES).toString("hex"),
    label: label.trim(),
    facility_id: facility,
    sha256: createHash("sha256").update(token).digest("hex"),
    created_at: now.toISOString(),
    ...(expires_at ? { expires_at } : {}),
  };
  writeTokens([...tokens, record], file);
  return { token, record };
}

export function listTokens(file = TOKENS_FILE): ListedToken[] {
  return readTokens(file).map(({ sha256: _sha256, ...listed }) => listed);
}

export function revokeToken(id: string, file = TOKENS_FILE): boolean {
  const tokens = readTokens(file);
  const kept = tokens.filter((t) => t.id !== id);
  if (kept.length === tokens.length) return false;
  writeTokens(kept, file);
  return true;
}
