import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

export const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
export const FACILITY_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const TOKEN_BYTES = 32;
const ID_BYTES = 6;
const SHA256_HEX = /^[0-9a-f]{64}$/i;
const LOCK_ATTEMPTS = 5;
const LOCK_WAIT_MS = 50;
const STALE_LOCK_MS = 60_000;
const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))?)?$/;

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
export class BrokenTokenLedger extends Error {}
export class TokensLocked extends Error {}

export function isFacilityId(id: unknown): id is string {
  return typeof id === "string" && FACILITY_ID.test(id);
}

function isFacilityToken(value: unknown): value is FacilityToken {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.label === "string" &&
    typeof t.facility_id === "string" &&
    typeof t.sha256 === "string" &&
    SHA256_HEX.test(t.sha256) &&
    (t.expires_at === undefined || typeof t.expires_at === "string")
  );
}

// Same rule as the app (app/server/utils/adminPolicy.ts): a ledger that is not a list of well-formed records
// is broken, and rewriting it from what could be read would silently drop or revive tokens.
function readTokens(file: string): FacilityToken[] {
  if (!fs.existsSync(file)) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new BrokenTokenLedger(`${file} cannot be read: ${(e as Error).message}; fix or remove it by hand`);
  }
  const tokens = typeof doc === "object" && doc !== null ? (doc as { tokens?: unknown }).tokens : undefined;
  if (!Array.isArray(tokens) || !tokens.every(isFacilityToken)) throw new BrokenTokenLedger(`${file} is not a token ledger (a "tokens" list of id, label, facility_id, sha256 and optional expires_at); fix or remove it by hand`);
  return tokens;
}

// Same rule as the app's holdsFacilities: a broken ledger counts as one with facility tokens, never as none.
export function holdsFacilities(file = TOKENS_FILE): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    return readTokens(file).length > 0;
  } catch (e) {
    if (e instanceof BrokenTokenLedger) return true;
    throw e;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function takeLock(lock: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.closeSync(fs.openSync(lock, "wx", 0o600));
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
    if (age > STALE_LOCK_MS) {
      console.warn(`taking over a stale lock ${lock} (${Math.round(age / 1000)} s old; an earlier update did not finish)`);
      fs.rmSync(lock, { force: true });
      continue;
    }
    if (attempt >= LOCK_ATTEMPTS) throw new TokensLocked(`${lock} is held by another update; try again, or remove it if no update is running`);
    sleepSync(LOCK_WAIT_MS);
  }
}

// issue and revoke read the whole ledger and write it back: two at once would bring a revoked token back.
export function withTokensLock<T>(file: string, task: () => T): T {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  takeLock(lock);
  try {
    return task();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

function inRange(value: string | undefined, max: number): boolean {
  return value === undefined || Number(value) <= max;
}

// Date.parse rolls 2027-02-30 over to March; a mistyped expiry must be refused, not moved.
function parseExpiry(text: string): number {
  const m = ISO_8601.exec(text);
  if (!m) return NaN;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = m;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const realDay = calendar.getUTCFullYear() === Number(year) && calendar.getUTCMonth() === Number(month) - 1 && calendar.getUTCDate() === Number(day);
  const realTime = inRange(hour, 23) && inRange(minute, 59) && inRange(second, 59) && inRange(offsetHour, 23) && inRange(offsetMinute, 59);
  return realDay && realTime ? Date.parse(text) : NaN;
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
    const at = parseExpiry(expires);
    if (Number.isNaN(at)) throw new InvalidTokenRequest(`--expires ${JSON.stringify(expires)} is not an ISO 8601 date`);
    if (at <= now.getTime()) throw new InvalidTokenRequest(`--expires ${expires} is not in the future`);
    expires_at = new Date(at).toISOString();
  }
  return withTokensLock(file, () => {
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
  });
}

export function listTokens(file = TOKENS_FILE): ListedToken[] {
  return readTokens(file).map(({ sha256: _sha256, ...listed }) => listed);
}

export function revokeToken(id: string, file = TOKENS_FILE): boolean {
  return withTokensLock(file, () => {
    const tokens = readTokens(file);
    const kept = tokens.filter((t) => t.id !== id);
    if (kept.length === tokens.length) return false;
    writeTokens(kept, file);
    return true;
  });
}
