import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrokenTokenLedger, InvalidTokenRequest, TokensLocked, issueToken, listTokens, revokeToken, withTokensLock } from "../src/tokens.js";

const tempTokensFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "evac-tokens-")), "data", "tokens.json");
const NOW = new Date("2026-11-11T00:00:00Z");

test("issue returns the token once and stores only its SHA-256, in a file only the owner can read", () => {
  const file = tempTokensFile();
  const { token, record } = issueToken({ facility: "alpha-fac", label: "alpha signage", expires: "2027-01-01T00:00:00+09:00", now: NOW }, file);
  assert.ok(Buffer.from(token, "base64url").length >= 32);
  const stored = fs.readFileSync(file, "utf8");
  assert.ok(!stored.includes(token));
  const doc = JSON.parse(stored);
  assert.equal(doc.version, "0.1");
  assert.deepEqual(doc.tokens, [record]);
  assert.equal(record.sha256, createHash("sha256").update(token).digest("hex"));
  assert.equal(record.facility_id, "alpha-fac");
  assert.equal(record.created_at, NOW.toISOString());
  assert.equal(record.expires_at, "2026-12-31T15:00:00.000Z");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["tokens.json"]);
});

test("list shows every token without the token or its hash, and revoke removes one", () => {
  const file = tempTokensFile();
  const a = issueToken({ facility: "alpha-fac", label: "alpha signage", now: NOW }, file);
  const b = issueToken({ facility: "beta-fac", label: "beta signage", now: NOW }, file);
  assert.notEqual(a.token, b.token);
  const listed = listTokens(file);
  assert.deepEqual(listed.map((t) => t.id), [a.record.id, b.record.id]);
  assert.deepEqual(listed[0], { id: a.record.id, label: "alpha signage", facility_id: "alpha-fac", created_at: NOW.toISOString() });
  assert.ok(!JSON.stringify(listed).includes(a.record.sha256));
  assert.equal(revokeToken(a.record.id, file), true);
  assert.deepEqual(listTokens(file).map((t) => t.id), [b.record.id]);
  assert.equal(revokeToken(a.record.id, file), false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("list of a server without tokens.json is empty", () => {
  assert.deepEqual(listTokens(tempTokensFile()), []);
});

test("issue refuses a bad facility id, an empty label and an expiry that is unreadable or past", () => {
  const file = tempTokensFile();
  const bad: [string, Parameters<typeof issueToken>[0]][] = [
    ["upper case", { facility: "Alpha", label: "x", now: NOW }],
    ["too short", { facility: "ab", label: "x", now: NOW }],
    ["leading hyphen", { facility: "-alpha", label: "x", now: NOW }],
    ["empty label", { facility: "alpha-fac", label: " ", now: NOW }],
    ["unreadable expiry", { facility: "alpha-fac", label: "x", expires: "next week", now: NOW }],
    ["past expiry", { facility: "alpha-fac", label: "x", expires: "2026-11-10T00:00:00Z", now: NOW }],
    ["a day that does not exist", { facility: "alpha-fac", label: "x", expires: "2027-02-30", now: NOW }],
    ["a day that does not exist, with a time", { facility: "alpha-fac", label: "x", expires: "2027-04-31T09:00:00+09:00", now: NOW }],
    ["hour 24", { facility: "alpha-fac", label: "x", expires: "2027-01-01T24:00:00Z", now: NOW }],
    ["minute 60", { facility: "alpha-fac", label: "x", expires: "2027-01-01T10:60:00Z", now: NOW }],
    ["month 13", { facility: "alpha-fac", label: "x", expires: "2027-13-01", now: NOW }],
  ];
  for (const [label, input] of bad) assert.throws(() => issueToken(input, file), InvalidTokenRequest, label);
  assert.equal(fs.existsSync(file), false);
});

test("a real day at the end of February is accepted", () => {
  const { record } = issueToken({ facility: "alpha-fac", label: "x", expires: "2028-02-29", now: NOW }, tempTokensFile());
  assert.equal(record.expires_at, "2028-02-29T00:00:00.000Z");
});

const BROKEN = ["{}", "null", '{"tokens":null}', '{"tokens":{}}', '{"version":"0.1","tokens":[{"id":"a","label":"x","facility_id":"alpha-fac","sha256":"abc","created_at":"2026-11-01T00:00:00Z"}]}', "not json"];

test("a broken ledger is reported and never rewritten", () => {
  for (const body of BROKEN) {
    const file = tempTokensFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    assert.throws(() => issueToken({ facility: "alpha-fac", label: "x", now: NOW }, file), BrokenTokenLedger, body);
    assert.throws(() => revokeToken("a", file), BrokenTokenLedger, body);
    assert.throws(() => listTokens(file), BrokenTokenLedger, body);
    assert.equal(fs.readFileSync(file, "utf8"), body);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["tokens.json"], "no lock or partial file left behind");
  }
});

test("an update waits for the lock and gives up while another update holds it", () => {
  const file = tempTokensFile();
  const { record } = issueToken({ facility: "alpha-fac", label: "x", now: NOW }, file);
  const before = fs.readFileSync(file, "utf8");
  withTokensLock(file, () => {
    const started = Date.now();
    assert.throws(() => revokeToken(record.id, file), TokensLocked);
    assert.ok(Date.now() - started >= 100, "it waited before giving up");
    assert.throws(() => issueToken({ facility: "beta-fac", label: "y", now: NOW }, file), TokensLocked);
  });
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(revokeToken(record.id, file), true, "the lock is released afterwards");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["tokens.json"]);
});

test("a lock left behind by a crashed update is taken over once it is old", () => {
  const file = tempTokensFile();
  issueToken({ facility: "alpha-fac", label: "x", now: NOW }, file);
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, "");
  const old = new Date(Date.now() - 10 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    issueToken({ facility: "beta-fac", label: "y", now: NOW }, file);
  } finally {
    console.warn = warn;
  }
  assert.equal(listTokens(file).length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /stale lock/);
  assert.equal(fs.existsSync(lock), false);
});
