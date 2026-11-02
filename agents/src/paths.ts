import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(AGENTS_DIR, "..");
export const SCHEMA_DIR = path.join(REPO_ROOT, "schema");
export const MUNICIPALITIES_DIR = path.join(REPO_ROOT, "data", "municipalities");

// pnpm -F runs scripts inside agents/, so user-supplied relative paths are resolved against the invoking directory.
export function resolveUserPath(p: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}
