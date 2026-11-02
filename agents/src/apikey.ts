import fs from "node:fs";
import { ENV_FILE } from "./paths.js";

// A placeholder such as "sk-ant-..." must never reach the API; only the shape of a key is checked, never shown.
const API_KEY_PREFIX = "sk-ant-";
const API_KEY_MIN_LENGTH = 40;

export interface ApiKeyState { present: boolean; wellFormed: boolean; source: "environment" | "dotenv" | "none"; dotenvPresent: boolean }

// process.loadEnvFile does not override a variable already in the environment, so a stale shell export silently
// wins over a fresh .env; the source is reported for that reason.
export function loadApiKey(): ApiKeyState {
  const fromEnv = Boolean(process.env.ANTHROPIC_API_KEY);
  const dotenvPresent = fs.existsSync(ENV_FILE);
  if (dotenvPresent) process.loadEnvFile(ENV_FILE);
  const value = process.env.ANTHROPIC_API_KEY ?? "";
  const present = value.length > 0;
  return { present, wellFormed: value.startsWith(API_KEY_PREFIX) && value.length >= API_KEY_MIN_LENGTH, source: fromEnv ? "environment" : present ? "dotenv" : "none", dotenvPresent };
}

export function requireApiKey(): void {
  const k = loadApiKey();
  if (!k.present) throw new Error(`ANTHROPIC_API_KEY not found (${ENV_FILE} absent or empty)`);
  if (!k.wellFormed) throw new Error(`ANTHROPIC_API_KEY (from ${k.source}) does not look like an API key (expected "${API_KEY_PREFIX}…", at least ${API_KEY_MIN_LENGTH} characters); it may still be a placeholder. No API call was made.`);
}
