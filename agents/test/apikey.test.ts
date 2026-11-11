import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadApiKey } from "../src/apikey.js";
import { recordChromePid } from "../src/delivery/capture.js";

const KEY = "sk-ant-api-key-for-the-dotenv-test-000000000000";
const NAMES = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "EVAC_URL", "JMA_FEED_DIR", "NUXT_ADMIN_TOKEN", "SECRET_SAMPLE"];

test(".env gives the API key, the API base URL and the path settings, and nothing else", () => {
  const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));
  for (const name of NAMES) delete process.env[name];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-apikey-"));
  const envFile = path.join(dir, ".env");
  fs.writeFileSync(envFile, [`ANTHROPIC_API_KEY=${KEY}`, "ANTHROPIC_BASE_URL=http://127.0.0.1:9/from-dotenv", "EVAC_URL=http://127.0.0.1:9", "JMA_FEED_DIR=/feed-from-dotenv", "NUXT_ADMIN_TOKEN=admin-token-in-dotenv", "SECRET_SAMPLE=other"].join("\n"));
  try {
    process.env.JMA_FEED_DIR = "/feed-from-environment";
    const state = loadApiKey(envFile);
    assert.deepEqual(state, { present: true, wellFormed: true, source: "dotenv", dotenvPresent: true });
    assert.equal(process.env.ANTHROPIC_API_KEY, KEY);
    assert.equal(process.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:9/from-dotenv");
    assert.equal(process.env.EVAC_URL, "http://127.0.0.1:9");
    assert.equal(process.env.JMA_FEED_DIR, "/feed-from-environment", "a value already in the environment wins");
    assert.equal(process.env.NUXT_ADMIN_TOKEN, undefined);
    assert.equal(process.env.SECRET_SAMPLE, undefined);
  } finally {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("each Chrome a command starts is one more line of its pid file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-chrome-pid-"));
  const file = path.join(dir, "chrome.pid");
  recordChromePid(file, 4321);
  recordChromePid(file, 8765);
  recordChromePid(undefined, 1111);
  assert.equal(fs.readFileSync(file, "utf8"), "4321\n8765\n");
  fs.rmSync(dir, { recursive: true, force: true });
});
