/**
 * Fail-fast environment guard. The golden set hits the real configured dev
 * model and a real embedding endpoint; without them, grounding scenarios would
 * silently seed articles that never retrieve and turns would hang or throw deep
 * inside the runtime. Assert the config up front with an actionable message
 * (§7.2 — "if OPENAI_API_KEY/OPENAI_BASE_URL are absent, fail fast, not hang").
 */
import { config } from '@/lib/server/config'
import { getChatModel, getEmbeddingModel } from '@/lib/server/domains/ai/models'

const RUN_HINT =
  'Run from the repo root with the app env file: ' +
  'bun --env-file=.env vitest run --config apps/web/evals/vitest.config.ts'

export function assertEvalEnv(): void {
  if (!config.openaiApiKey || !config.openaiBaseUrl) {
    throw new Error(
      `[evals] OPENAI_API_KEY and OPENAI_BASE_URL must be set for the golden eval set.\n${RUN_HINT}`
    )
  }
  if (!getChatModel('assistant')) {
    throw new Error(
      `[evals] No assistant chat model resolved — set AI_ASSISTANT_MODEL (or AI_CHAT_MODEL).\n${RUN_HINT}`
    )
  }
  if (!getEmbeddingModel()) {
    throw new Error(
      `[evals] No embedding model resolved — set AI_EMBEDDING_MODEL. Grounding scenarios seed ` +
        `KB articles with embeddings and cannot retrieve without one.\n${RUN_HINT}`
    )
  }
}

/** The judge model (§7.4): the configured quality-gate model, else the assistant model. */
export function judgeModel(): string {
  return getChatModel('qualityGate') ?? getChatModel('assistant')!
}
