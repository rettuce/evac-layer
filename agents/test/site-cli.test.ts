import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AGENTS_DIR } from "../src/paths.js";

async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

test("site --force stamps location_updated_at when the place or the municipality changes, and keeps it otherwise", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "evac-site-cli-"));
  const env = { ...process.env, EVAC_DATA_DIR: dataDir, EVAC_REVERSE_GEOCODER_URL: `http://127.0.0.1:${await closedPort()}/unreachable` };
  const site = (...args: string[]) =>
    promisify(execFile)("pnpm", ["-s", "exec", "tsx", "src/site-cli.ts", "--id", "cli-hall", "--facing", "90", ...args], { cwd: AGENTS_DIR, env });
  const stored = () => JSON.parse(fs.readFileSync(path.join(dataDir, "sites", "cli-hall.json"), "utf8"));
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    await site("--lat", "35.68", "--lng", "139.76", "--municipality", "13101");
    assert.equal(stored().location_updated_at, undefined);

    await site("--lat", "35.68", "--lng", "139.76", "--municipality", "13101", "--force");
    assert.equal(stored().location_updated_at, undefined, "nothing moved");

    await site("--lat", "35.69", "--lng", "139.76", "--municipality", "13101", "--force");
    const moved = stored().location_updated_at;
    assert.ok(!Number.isNaN(Date.parse(moved)));

    await site("--lat", "35.69", "--lng", "139.76", "--municipality", "13101", "--force", "--name", "Hall");
    assert.equal(stored().location_updated_at, moved, "a new name is not a move");

    await sleep(5);
    await site("--lat", "35.69", "--lng", "139.76", "--municipality", "13102", "--force");
    assert.ok(Date.parse(stored().location_updated_at) > Date.parse(moved));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
