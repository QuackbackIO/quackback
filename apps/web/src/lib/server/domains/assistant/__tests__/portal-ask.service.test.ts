/**
 * Ask in Customise: the local fast path first, then the model with a strict
 * patch schema. Every failure comes back as a plain reply, never an error:
 * AI off, allowance used up, a failed call, or output that does not fit the
 * schema or the draft. The model is mocked; no real call is made.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import type { AskDraftContext } from '@/lib/shared/portal-customise/ask'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: (apiKey?: string, baseUrl?: string) => Boolean(apiKey) && Boolean(baseUrl),
}))

const usageParams: unknown[] = []
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: (params: unknown) => {
    usageParams.push(params)
    return { name: 'ai-usage-logging' }
  },
}))

const mockGetChatModel = vi.fn((_feature: string): string | null => 'test-assistant-model')
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (feature: string) => mockGetChatModel(feature),
}))

const buckets = vi.hoisted(() => ({
  counts: [1, 1] as Array<number | null>,
  asked: [] as Array<{ key: string; windowSeconds: number }>,
}))
vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBuckets: vi.fn(async (specs: Array<{ key: string; windowSeconds: number }>) => {
    buckets.asked.push(...specs)
    return buckets.counts
  }),
}))

const mockEnforceAiTokenBudget = vi.fn(async () => {})
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: () => mockEnforceAiTokenBudget(),
}))

interface StructuredInput {
  model: string
  systemPrompts: string[]
  messages: Array<{ role: string; content: string }>
  schema: z.ZodType
  maxTokens: number
  middleware?: unknown[]
}
const mockStructuredChat = vi.fn(async (_input: StructuredInput): Promise<unknown> => ({}))
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: (input: StructuredInput) => mockStructuredChat(input),
}))

import {
  askPortalCustomise,
  PORTAL_ASK_EXAMPLES,
  portalAskOutputSchema,
} from '../portal-ask.service'

function draft(overrides: Partial<AskDraftContext> = {}): AskDraftContext {
  return {
    themeMode: 'light',
    buttonShape: 'pill',
    corners: 0.5,
    font: 'inter',
    colours: { light: { main: '#2563eb', background: '#ffffff' }, dark: {} },
    tabs: [
      { id: 'feedback', type: 'feedback', enabled: true },
      { id: 'roadmap', type: 'roadmap', enabled: true },
    ],
    welcomeMessage: '',
    helpCenter: null,
    ...overrides,
  }
}

const OPEN_REQUEST = 'make it feel warmer and friendlier'

beforeEach(() => {
  vi.clearAllMocks()
  buckets.counts = [1, 1]
  buckets.asked.length = 0
  usageParams.length = 0
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockGetChatModel.mockImplementation(() => 'test-assistant-model')
  mockEnforceAiTokenBudget.mockImplementation(async () => {})
  mockStructuredChat.mockImplementation(async () => ({}))
})

describe('askPortalCustomise: unavailable', () => {
  it('answers plainly when the allowance is used up, and never calls the model', async () => {
    mockEnforceAiTokenBudget.mockImplementation(async () => {
      throw new TierLimitError({ limit: 'aiTokensPerMonth', message: 'used up' })
    })
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toEqual({
      outcome: 'unavailable',
      handled: 'refused',
      reply: expect.stringMatching(/allowance/),
    })
    expect(mockStructuredChat).not.toHaveBeenCalled()
  })

  it('answers plainly when AI is not set up', async () => {
    mockConfig.openaiApiKey = undefined
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({ outcome: 'unavailable', handled: 'refused' })
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
    expect(mockStructuredChat).not.toHaveBeenCalled()
  })

  it('answers plainly when no assistant model is chosen', async () => {
    mockGetChatModel.mockImplementation(() => null)
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({ outcome: 'unavailable' })
    expect(mockGetChatModel).toHaveBeenCalledWith('assistant')
  })

  it('still answers plain requests locally when the allowance is used up', async () => {
    mockEnforceAiTokenBudget.mockImplementation(async () => {
      throw new TierLimitError({ limit: 'aiTokensPerMonth', message: 'used up' })
    })
    mockConfig.openaiApiKey = undefined
    const answer = await askPortalCustomise({ request: 'use #1a73e8', draft: draft() })
    expect(answer).toMatchObject({
      outcome: 'patch',
      handled: 'local',
      patch: { colours: { light: { main: '#1a73e8' } } },
    })
    expect(mockStructuredChat).not.toHaveBeenCalled()
  })

  it('lets errors other than the allowance through', async () => {
    mockEnforceAiTokenBudget.mockImplementation(async () => {
      throw new Error('database down')
    })
    await expect(askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })).rejects.toThrow(
      'database down'
    )
  })
})

describe('askPortalCustomise: the model', () => {
  it('returns a patch the model proposes, with a plain reply composed here', async () => {
    mockStructuredChat.mockImplementation(async () => ({
      patch: { colours: { light: { background: '#f8f6f1' } }, corners: 1 },
    }))
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({
      outcome: 'patch',
      handled: 'model',
      patch: { colours: { light: { background: '#f8f6f1' } }, corners: 1 },
    })
    if (answer.outcome !== 'patch') throw new Error('unreachable')
    expect(answer.reply).not.toMatch(/#[0-9a-f]{3,6}/i)
    expect(answer.reply).not.toMatch(/[–—]/)
  })

  it('keeps a header request to the header: what the model repeats from the draft is dropped', async () => {
    // A radius between stops is shown at its nearest stop; the model repeats it,
    // the font and the main colour while setting the header.
    const current = draft({ themeMode: 'user', corners: 0.625 })
    mockStructuredChat.mockImplementation(async () => ({
      patch: {
        colours: {
          light: { header: '#0b1f3a', main: '#2563EB' },
          dark: { header: '#0b1f3a' },
        },
        font: 'inter',
        corners: 0.5,
        buttonShape: 'pill',
      },
    }))
    const answer = await askPortalCustomise({ request: 'Make the header navy', draft: current })
    expect(answer).toMatchObject({ outcome: 'patch' })
    if (answer.outcome !== 'patch') throw new Error('unreachable')
    expect(answer.patch).toEqual({
      colours: { light: { header: '#0b1f3a' }, dark: { header: '#0b1f3a' } },
    })
    const user = mockStructuredChat.mock.calls[0]![0].messages[0]!.content
    expect(user).toContain('"corners":0.5')
    expect(mockStructuredChat.mock.calls[0]![0].systemPrompts.join('\n')).toContain(
      'a request about the header changes the header colour alone'
    )
  })

  it('keeps the patch as the model gave it when it only repeats the draft', async () => {
    mockStructuredChat.mockImplementation(async () => ({ patch: { font: 'inter' } }))
    const answer = await askPortalCustomise({ request: 'Use Inter', draft: draft() })
    // The editor answers that it already looks that way.
    expect(answer).toMatchObject({ outcome: 'patch', patch: { font: 'inter' } })
  })

  it('sends the request, the draft and few-shots, under its own usage step', async () => {
    mockStructuredChat.mockImplementation(async () => ({ patch: { buttonShape: 'corners' } }))
    await askPortalCustomise({ request: OPEN_REQUEST, draft: draft(), page: 'help' })
    const input = mockStructuredChat.mock.calls[0]![0]
    expect(input.model).toBe('test-assistant-model')
    const prompt = input.systemPrompts.join('\n')
    for (const example of PORTAL_ASK_EXAMPLES) {
      expect(prompt).toContain(JSON.stringify(example.output))
    }
    const user = input.messages.map((m) => m.content).join('\n')
    expect(user).toContain(OPEN_REQUEST)
    expect(user).toContain('"roadmap"')
    expect(user).toContain('Page in the preview: help')
    expect(input).not.toHaveProperty('strict')
    expect(usageParams).toEqual([
      expect.objectContaining({ pipelineStep: 'portal_ask', model: 'test-assistant-model' }),
    ])
    expect(JSON.stringify(usageParams)).not.toContain(OPEN_REQUEST)
  })

  it('hands the model a schema that refuses CSS', async () => {
    mockStructuredChat.mockImplementation(async () => ({ patch: { buttonShape: 'corners' } }))
    await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    const { schema } = mockStructuredChat.mock.calls[0]![0]
    expect(schema.safeParse({ patch: { buttonShape: 'corners' } }).success).toBe(true)
    expect(schema.safeParse({ patch: { extraCss: 'body{}' } }).success).toBe(false)
    expect(schema.safeParse({ css: 'body{}' }).success).toBe(false)
  })

  it('every few-shot example fits the schema it teaches', async () => {
    mockStructuredChat.mockImplementation(async () => ({ patch: { buttonShape: 'corners' } }))
    await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    const { schema } = mockStructuredChat.mock.calls[0]![0]
    expect(PORTAL_ASK_EXAMPLES.length).toBeGreaterThanOrEqual(3)
    expect(PORTAL_ASK_EXAMPLES.length).toBeLessThanOrEqual(6)
    for (const example of PORTAL_ASK_EXAMPLES) {
      expect(schema.safeParse(example.output).success, example.request).toBe(true)
    }
  })

  it('teaches the header colour: in the settings list, an example that sets it and clears it', async () => {
    mockStructuredChat.mockImplementation(async () => ({
      patch: { colours: { light: { header: '#0b1f3a' } } },
    }))
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({
      outcome: 'patch',
      patch: { colours: { light: { header: '#0b1f3a' } } },
    })
    const prompt = mockStructuredChat.mock.calls[0]![0].systemPrompts.join('\n')
    expect(prompt).toMatch(/header \(the bar along the top\)/)
    expect(prompt).toContain('"auto"')
    // The header's colour is a setting now; only its layout is refused.
    expect(prompt).not.toMatch(/about the header, footer/)
    const headers = PORTAL_ASK_EXAMPLES.flatMap((e) => [
      e.output.patch?.colours?.light?.header,
      e.output.patch?.colours?.dark?.header,
    ]).filter(Boolean)
    expect(headers.some((h) => /^#[0-9a-f]{6}$/.test(h!))).toBe(true)
    expect(headers).toContain('auto')
  })

  it('refuses safely when the model output does not fit the schema', async () => {
    // The json_schema path hands back the provider's object without a parse.
    mockStructuredChat.mockImplementation(async () => ({
      patch: { colours: { light: { main: 'red; } body { display: none' } } },
    }))
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({ outcome: 'refused', handled: 'refused' })
    expect(answer).not.toHaveProperty('patch')
  })

  it('refuses safely when the call fails', async () => {
    mockStructuredChat.mockImplementation(async () => {
      throw Object.assign(new Error('bad'), { code: 'structured-output-validation-failed' })
    })
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({ outcome: 'refused', handled: 'refused' })
  })

  it('refuses a patch naming a tab the draft does not have', async () => {
    mockStructuredChat.mockImplementation(async () => ({
      patch: { tabs: { changes: [{ id: 'pricing', label: 'Pricing' }] } },
    }))
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({ outcome: 'refused' })
  })

  it('refuses Help Center changes when the draft has no Help Center home', async () => {
    mockStructuredChat.mockImplementation(async () => ({
      patch: { helpCenter: { homepageTitle: 'Help' } },
    }))
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({ outcome: 'refused' })
  })

  it('refuses an empty answer', async () => {
    mockStructuredChat.mockImplementation(async () => ({ patch: {} }))
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toMatchObject({ outcome: 'refused' })
  })

  it('says Feedback is always on when that is all the model would change', async () => {
    mockStructuredChat.mockImplementation(async () => ({
      patch: { tabs: { changes: [{ id: 'feedback', enabled: false }] } },
    }))
    const answer = await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(answer).toEqual({
      outcome: 'refused',
      handled: 'refused',
      reply: 'Feedback is always on.',
    })
  })

  it('describes its output schema as JSON Schema for the prompt-only fallback', () => {
    expect(() => z.toJSONSchema(portalAskOutputSchema)).not.toThrow()
  })

  it('uses fixed copy for out-of-reach requests', async () => {
    mockStructuredChat.mockImplementation(async () => ({ refusal: 'layout' }))
    const layout = await askPortalCustomise({ request: 'add a hero image', draft: draft() })
    expect(layout).toMatchObject({
      outcome: 'refused',
      handled: 'refused',
      reply: "That isn't a setting. Your own CSS rules can do it, on the Business plan.",
    })
    mockStructuredChat.mockImplementation(async () => ({ refusal: 'out_of_reach' }))
    const other = await askPortalCustomise({ request: 'translate my posts', draft: draft() })
    expect(other.reply).toMatch(/^I can't do that one\./)
  })

  it('runs Import when the model names a website', async () => {
    mockStructuredChat.mockImplementation(async () => ({ matchWebsite: 'example.com' }))
    const answer = await askPortalCustomise({
      request: 'look like the Example site',
      draft: draft(),
    })
    expect(answer).toMatchObject({ outcome: 'import', host: 'example.com', handled: 'model' })
  })
})

describe('rate limit', () => {
  it('counts each model request per workspace, ten a minute and a hundred a day', async () => {
    mockStructuredChat.mockResolvedValueOnce({ patch: { buttonShape: 'corners' }, reply: 'Done.' })
    await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })
    expect(buckets.asked).toEqual([
      { key: 'portal-ask:minute', windowSeconds: 60 },
      { key: 'portal-ask:day', windowSeconds: 86_400 },
    ])
  })

  it('answers a request over the limit with a plain reply, calling no model', async () => {
    buckets.counts = [11, 11]
    expect(await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })).toEqual({
      outcome: 'unavailable',
      handled: 'refused',
      reply: 'Try again in a minute.',
    })
    buckets.counts = [1, 101]
    expect((await askPortalCustomise({ request: OPEN_REQUEST, draft: draft() })).reply).toBe(
      'Try again tomorrow.'
    )
    expect(mockStructuredChat).not.toHaveBeenCalled()
  })

  it('never counts or limits a request the fast path answers', async () => {
    buckets.counts = [999, 999]
    const answer = await askPortalCustomise({ request: 'use #1a73e8', draft: draft() })
    expect(answer.outcome).toBe('patch')
    expect(buckets.asked).toEqual([])
  })
})
