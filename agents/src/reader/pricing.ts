import type Anthropic from "@anthropic-ai/sdk";

export type ModelKey = "sonnet" | "haiku";

interface Rate { input: number; output: number; cacheRead: number }

// USD per million tokens, platform.claude.com pricing as of 2026-10-19. Haiku 5.5 switches tier when the whole
// prompt (cache reads and writes included) exceeds 100K tokens.
export const MODELS: Record<ModelKey, { id: string; rate: (promptTokens: number) => Rate }> = {
  sonnet: { id: "claude-sonnet-5-5", rate: () => ({ input: 2, output: 10, cacheRead: 0.1 }) },
  haiku: {
    id: "claude-haiku-5-5",
    rate: (p) => (p > 100_000 ? { input: 0.5, output: 2.5, cacheRead: 0.05 } : { input: 0.1, output: 0.5, cacheRead: 0.01 }),
  },
};

export interface CallUsage { stage: string; input: number; output: number; cache_write: number; cache_read: number; usd: number }

export function costOf(model: ModelKey, stage: string, u: Anthropic.Usage): CallUsage {
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const r = MODELS[model].rate(u.input_tokens + cacheWrite + cacheRead);
  const usd = (u.input_tokens * r.input + cacheWrite * r.input * 1.25 + cacheRead * r.cacheRead + u.output_tokens * r.output) / 1e6;
  return { stage, input: u.input_tokens, output: u.output_tokens, cache_write: cacheWrite, cache_read: cacheRead, usd };
}

export function estimateUsd(model: ModelKey, inputTokens: number, outputTokens: number): number {
  const r = MODELS[model].rate(inputTokens);
  return (inputTokens * r.input + outputTokens * r.output) / 1e6;
}
