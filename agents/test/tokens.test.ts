import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InvalidTokenRequest, issueToken, listTokens, revokeToken } from "../src/tokens.js";

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
  ];
  for (const [label, input] of bad) assert.throws(() => issueToken(input, file), InvalidTokenRequest, label);
  assert.equal(fs.existsSync(file), false);
});
