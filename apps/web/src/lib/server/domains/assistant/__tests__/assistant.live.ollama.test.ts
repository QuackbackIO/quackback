// @vitest-environment node
/**
 * Live integration smoke test against a real, OpenAI-compatible AI endpoint.
 *
 * Opt-in: it runs only when BOTH OPENAI_BASE_URL and AI_CHAT_MODEL are set in
 * the environment (and that endpoint is reachable). So it stays skipped in CI
 * and in a plain `bun run test` — matching the other resource-gated live tests
 * (real-DB suites) — and runs against whatever you point it at, e.g.
 *
 *   # local Ollama
 *   OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
 *     AI_CHAT_MODEL=gemma4:e4b-it-qat npx vitest run assistant.live.ollama
 *   # or the app's configured hosted endpoint
 *   bun --env-file=../../.env test -- --run assistant.live.ollama
 *
 * Runs in the node environment because the OpenAI SDK refuses to construct a
 * client under a browser-like global (happy-dom) without dangerouslyAllowBrowser.
 *
 * Exercises the real runtime end to end: real TanStack AI chat(), real
 * structured-output decoding (terse models can return an empty object, which
 * the runtime treats as retryable), and the retrieval keyword fallback (no
 * local embedding model, so the semantic path is skipped by design).
 */
import { describe, it, expect, vi } from 'vitest'

const AI_BASE = process.env.OPENAI_BASE_URL
const AI_MODEL = process.env.AI_CHAT_MODEL
// Only meaningful when a developer has explicitly configured an endpoint.
const liveConfigured = Boolean(AI_BASE && AI_MODEL)

// Point the runtime + retrieval at the configured endpoint and the test DB.
// Embeddings stay off so retrieval runs its keyword fallback (the pgvector dims
// differ locally).
vi.mock('@/lib/server/config', () => ({
  config: {
    databaseUrl: process.env.DATABASE_URL,
    openaiApiKey: process.env.OPENAI_API_KEY || 'ollama',
    openaiBaseUrl: AI_BASE,
    aiChatModel: AI_MODEL,
    aiEmbeddingModel: undefined,
    aiSummaryModel: undefined,
    aiSentimentModel: undefined,
    aiExtractionModel: undefined,
    aiQualityGateModel: undefined,
    aiInterpretationModel: undefined,
    aiMergeModel: undefined,
    aiHelpCenterModel: undefined,
  },
}))

async function endpointReachable(base: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2000)
    const res = await fetch(`${base}/models`, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

const reachable = liveConfigured ? await endpointReachable(AI_BASE!) : false

describe.skipIf(!reachable)('assistant runtime (live AI endpoint)', () => {
  it('produces a structured, cited answer through the real loop', async () => {
    const { runAssistantTurn } = await import('../assistant.runtime')

    const result = await runAssistantTurn({
      assistantPrincipalId: 'principal_assistant' as never,
      role: 'customer_support',
      surface: 'widget',
      messages: [{ sender: 'customer', content: 'What is your refund policy?' }],
    })

    expect(result.status).not.toBe('suppressed')
    if (result.status !== 'suppressed') {
      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
      // Citations are a structured contract: an array of ledger-backed sources
      // (an honest no-source result may instead be `cannot_answer`).
      expect(Array.isArray(result.citations)).toBe(true)
    }
  }, 60_000)

  it('uses search for pricing while allowing zero-tool casual conversation', async () => {
    const { runAssistantTurn } = await import('../assistant.runtime')

    const pricingActivities: Array<{ kind: 'thinking' } | { kind: 'tool'; tool: string }> = []
    await runAssistantTurn({
      assistantPrincipalId: 'principal_assistant' as never,
      role: 'customer_support',
      surface: 'widget',
      messages: [
        { sender: 'customer', content: "I'd like to learn more about Quackback pricing." },
      ],
      onActivity: (activity) => pricingActivities.push(activity),
    })
    expect(pricingActivities).toContainEqual({ kind: 'tool', tool: 'search' })

    const casualActivities: Array<{ kind: 'thinking' } | { kind: 'tool'; tool: string }> = []
    await runAssistantTurn({
      assistantPrincipalId: 'principal_assistant' as never,
      role: 'customer_support',
      surface: 'widget',
      messages: [{ sender: 'customer', content: "What's your favourite pizza?" }],
      onActivity: (activity) => casualActivities.push(activity),
    })
    expect(casualActivities.some((activity) => activity.kind === 'tool')).toBe(false)
  }, 120_000)
})
