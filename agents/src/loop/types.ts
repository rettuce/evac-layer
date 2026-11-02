import type { Finding } from "../verifier/checks.js";
import type { WriterOutput } from "../composer/compose.js";

export interface Screen { shape: string; cells: unknown[]; [k: string]: unknown }
export interface ScreenVerdict { shape: string; ok: boolean; findings: Finding[]; note?: string }
export interface VerifyContext { alert: import("../jma/parse.js").Alert; municipalityId: string }
export interface Verifier { name: string; skippedShapes?: readonly string[]; verify(screens: Screen[], ctx?: VerifyContext): Promise<ScreenVerdict[]> }

export interface LoopFinding { shape: string; check: string; cell_id?: string; lang?: string; detail: string }
export interface Reviser {
  name: string;
  revise(current: WriterOutput, findings: LoopFinding[], attempt: number): Promise<{ writer: WriterOutput; source: string }>;
}

export class NoRevision extends Error {}
