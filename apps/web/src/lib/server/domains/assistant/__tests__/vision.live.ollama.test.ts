// @vitest-environment node
/**
 * Live Quinn-vision smoke test: a customer screenshot reaches a real
 * vision-capable, OpenAI-compatible endpoint and Quinn describes its contents.
 *
 * Opt-in like assistant.live.ollama.test.ts: runs only when OPENAI_BASE_URL,
 * OPENAI_API_KEY and AI_CHAT_MODEL are set, the endpoint is reachable, AND
 * VISION_TEST_IMAGE (a data-URI or absolute URL of a real image) is provided.
 * The screenshot rides the exact production path: thread message with an image
 * attachment -> buildThreadModelMessages (vision.ts, gated by
 * isVisionCapableModel — set AI_ASSISTANT_VISION=on when the model's name
 * isn't in the curated pattern list) -> synthesis -> the endpoint.
 *
 *   OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_API_KEY=ollama \
 *   AI_CHAT_MODEL=gemma4:12b-it-q4_K_M AI_ASSISTANT_VISION=on \
 *   VISION_TEST_IMAGE=data:image/png;base64,... \
 *   npx vitest run vision.live.ollama
 */
import { describe, expect, it, vi } from 'vitest'

const AI_BASE = process.env.OPENAI_BASE_URL
const AI_MODEL = process.env.AI_CHAT_MODEL
const IMAGE = process.env.VISION_TEST_IMAGE
const liveConfigured = Boolean(AI_BASE && AI_MODEL && IMAGE)

vi.mock('@/lib/server/config', () => ({
  config: {
    baseUrl: 'https://app.example.com',
    databaseUrl: process.env.DATABASE_URL,
    openaiApiKey: process.env.OPENAI_API_KEY || 'ollama',
    openaiBaseUrl: AI_BASE,
    aiChatModel: AI_MODEL,
    aiAssistantVision: process.env.AI_ASSISTANT_VISION,
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

const { runAssistantTurn } = await import('../assistant.runtime')
const { isVisionCapableModel } = await import('@/lib/server/domains/ai/models')

describe.runIf(liveConfigured)('quinn vision (live endpoint)', () => {
  it('describes the contents of a screenshot a customer sent', { timeout: 900_000 }, async () => {
    if (!(await endpointReachable(AI_BASE!))) {
      console.warn(`[vision.live] endpoint ${AI_BASE} unreachable — skipping`)
      return
    }
    expect(isVisionCapableModel(AI_MODEL!)).toBe(true)

    const result = await runAssistantTurn({
      assistantPrincipalId: 'principal_quinn' as never,
      conversationId: null,
      involvementId: null,
      role: 'customer_support',
      surface: 'widget',
      simulate: true,
      messages: [
        {
          sender: 'customer',
          content: 'My export keeps failing — what does this screenshot show?',
          attachments: [
            {
              url: IMAGE!,
              name: 'export-error.png',
              contentType: 'image/png',
              size: IMAGE!.length,
            },
          ],
        },
      ],
    })

    console.log('[vision.live] quinn said:', result.status === 'answered' ? result.text : result)
    expect(result.status).toBe('answered')
    if (result.status !== 'answered') return
    // The screenshot contains the literal words "Export" and "502".
    expect(result.text.toLowerCase()).toContain('export')
  })
})
