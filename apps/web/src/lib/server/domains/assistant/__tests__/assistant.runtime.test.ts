import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeKbArticle } from './kb-fixtures'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
  aiChatModel: 'test-model' as string | undefined,
  aiSummaryModel: undefined,
  aiSentimentModel: undefined,
  aiExtractionModel: undefined,
  aiQualityGateModel: undefined,
  aiInterpretationModel: undefined,
  aiMergeModel: undefined,
  aiHelpCenterModel: undefined,
  aiEmbeddingModel: undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const mockChat = vi.fn()
// Keep the real toolDefinition / maxIterations / parsePartialJSON; only the
// model call is mocked, so tool wiring and JSON streaming are exercised for real.
vi.mock('@tanstack/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/ai')>()
  return { ...actual, chat: (...args: unknown[]) => mockChat(...args) }
})
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: () => ({ kind: 'text' }),
}))

const mockRetrieve = vi.fn()
vi.mock('../retrieval', () => ({
  retrieveKbArticles: (...args: unknown[]) => mockRetrieve(...args),
}))

// The runtime never triggers get_conversation_context in these tests; stub the
// conversation query so importing the tool module stays hermetic.
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false, nextCursor: null }),
}))

const mockWithUsageLogging = vi.fn()
/** The merged metadata of the most recent usage-log row (params + fn outcome). */
let lastLoggedMetadata: Record<string, unknown> | undefined
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  withUsageLogging: (...args: unknown[]) => mockWithUsageLogging(...args),
}))

// Assistant actions off (the shipped default): the runtime gets the
// byte-identical legacy tool set with no control-mode pipeline involved.
const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

/**
 * `isFeatureEnabled` gates assistantActions (read here and inside the real
 * assembleAssistantTools this suite exercises) and, inside the real
 * resolveToolSpecs, dataConnectors too. A flat `mockResolvedValue(true)`
 * would flip both and pull the real (DB-backed) connectors domain into these
 * prompt-assembly tests; discriminate by flag name so dataConnectors stays
 * off unless a test opts in.
 */
function mockActionsFlag(enabled: boolean) {
  mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'assistantActions' && enabled
  )
}

// Defensive: with mockActionsFlag in place dataConnectors always resolves
// false, so resolveToolSpecs never reaches for the real connectors domain in
// this file — stub it anyway so that stays true if a test ever flips it on.
vi.mock('@/lib/server/domains/connectors/connector.toolspec', () => ({
  listEnabledConnectorToolSpecs: vi.fn().mockResolvedValue([]),
}))

// Surfaces, basics, tool controls, and guidance rules are only read when
// actions are on (asserted explicitly below); default to nothing saved.
// getAssistantConfig is the runtime's one-read-per-turn entry point;
// getAssistantToolControls stays stubbed too so a test can prove the real
// assembleAssistantTools never falls back to fetching it on its own once the
// runtime already has controls in hand.
const mockGetAssistantConfig = vi.fn()
const mockGetAssistantToolControls = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantConfig: (...args: unknown[]) => mockGetAssistantConfig(...args),
  getAssistantToolControls: (...args: unknown[]) => mockGetAssistantToolControls(...args),
}))

const mockListGuidanceRules = vi.fn()
vi.mock('../guidance.service', () => ({
  listGuidanceRules: (...args: unknown[]) => mockListGuidanceRules(...args),
  GUIDANCE_MAX_ENABLED_PER_SURFACE: 20,
  GUIDANCE_CHAR_BUDGET: 4000,
}))

// Keep the real tool assembly by default (tool wiring is exercised for real
// elsewhere in this file); the registry-derived activity filter tests below
// swap in a fake tool set to prove the filter isn't hardcoded to the two
// built-in tool names.
const mockAssembleAssistantTools = vi.hoisted(() => vi.fn())
const realAssembleAssistantToolsRef = vi.hoisted(() => ({
  current: undefined as unknown as (...args: unknown[]) => unknown,
}))
vi.mock('../assistant.tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../assistant.tools')>()
  realAssembleAssistantToolsRef.current = actual.assembleAssistantTools as (
    ...args: unknown[]
  ) => unknown
  return {
    ...actual,
    assembleAssistantTools: (...args: unknown[]) => mockAssembleAssistantTools(...args),
  }
})

import {
  runAssistantTurn,
  respondEligible,
  assembleCitations,
  decideEscalation,
  isSubstantiveAnswer,
  buildAssistantSystemPrompt,
  buildSurfaceInstructionsPrompt,
  buildBasicsPrompt,
  buildGuidancePrompt,
  isAssistantConfigured,
  AssistantNotConfiguredError,
  salvageAssistantOutput,
  extractFirstJsonObject,
  relinkCitations,
  ASSISTANT_FALLBACK_MESSAGE,
  type AssistantThreadMessage,
} from '../assistant.runtime'
import type { AssistantCitation } from '../assistant.toolspec'

/** Async-iterable of scripted chunks. */
function chunkStream(chunks: unknown[]) {
  return (async function* () {
    for (const c of chunks) yield c
  })()
}

function completeRun(object: unknown) {
  return [
    { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(object) },
    { type: 'CUSTOM', name: 'structured-output.complete', value: { object } },
    { type: 'RUN_FINISHED', usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 } },
  ]
}

const customerAsks = (content: string): AssistantThreadMessage[] => [
  { sender: 'customer', content },
]

const baseInput = {
  assistantPrincipalId: 'principal_assistant' as never,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockConfig.aiChatModel = 'test-model'
  mockConfig.aiHelpCenterModel = undefined
  mockIsFeatureEnabled.mockResolvedValue(false)
  mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
  mockGetAssistantToolControls.mockResolvedValue({})
  mockListGuidanceRules.mockResolvedValue([])
  mockAssembleAssistantTools.mockImplementation((...args: unknown[]) =>
    realAssembleAssistantToolsRef.current(...args)
  )
  lastLoggedMetadata = undefined
  mockWithUsageLogging.mockImplementation(
    async (
      params: { metadata?: Record<string, unknown> },
      fn: () => Promise<{
        result: unknown
        retryCount: number
        metadata?: Record<string, unknown>
      }>,
      extract: (result: unknown) => unknown
    ) => {
      const { result, metadata } = await fn()
      extract(result)
      // Mirror the real wrapper's contract: outcome metadata returned by fn is
      // merged over the params metadata in the logged row.
      lastLoggedMetadata = { ...params.metadata, ...metadata }
      return result
    }
  )
})

describe('respondEligible (silence rule)', () => {
  it('is eligible when no human teammate has replied', () => {
    expect(respondEligible([{ sender: 'customer', content: 'hi' }])).toBe(true)
  })

  it('mutes Quinn after a human teammate replies past its last message', () => {
    expect(
      respondEligible([
        { sender: 'customer', content: 'hi' },
        { sender: 'assistant', content: 'hello' },
        { sender: 'human_agent', content: 'I got this' },
        { sender: 'customer', content: 'thanks' },
      ])
    ).toBe(false)
  })

  it('stays eligible when Quinn spoke after the human teammate', () => {
    expect(
      respondEligible([
        { sender: 'human_agent', content: 'earlier note' },
        { sender: 'assistant', content: 'back to me' },
        { sender: 'customer', content: 'another question' },
      ])
    ).toBe(true)
  })

  it('mutes when a human is already handling and Quinn never spoke', () => {
    expect(
      respondEligible([
        { sender: 'customer', content: 'hi' },
        { sender: 'human_agent', content: 'a human replies' },
        { sender: 'customer', content: 'ok' },
      ])
    ).toBe(false)
  })
})

describe('assembleCitations', () => {
  const ledger = new Map<string, AssistantCitation>([
    [
      'kb_article_1',
      { type: 'article', id: 'kb_article_1', title: 'T1', url: '/hc/articles/g/a1' },
    ],
  ])

  it('keeps only surfaced ids, enriched from the ledger', () => {
    expect(assembleCitations([{ type: 'article', id: 'kb_article_1' }], ledger)).toEqual([
      { type: 'article', id: 'kb_article_1', title: 'T1', url: '/hc/articles/g/a1' },
    ])
  })

  it('drops hallucinated ids and dedupes', () => {
    expect(
      assembleCitations(
        [
          { type: 'article', id: 'kb_article_1' },
          { type: 'article', id: 'kb_article_HALLUCINATED' },
          { type: 'article', id: 'kb_article_1' },
        ],
        ledger
      )
    ).toEqual([{ type: 'article', id: 'kb_article_1', title: 'T1', url: '/hc/articles/g/a1' }])
  })

  it('drops everything when nothing cleared the confidence floor (empty ledger)', () => {
    expect(assembleCitations([{ type: 'article', id: 'kb_article_1' }], new Map())).toEqual([])
  })
})

describe('decideEscalation (single offer)', () => {
  it('is undefined when the model flags no escalation', () => {
    expect(decideEscalation(undefined, false)).toBeUndefined()
    expect(decideEscalation(null, true)).toBeUndefined()
  })

  it('offers on the first trigger', () => {
    expect(decideEscalation('frustration', false)).toEqual({ reason: 'frustration', mode: 'offer' })
  })

  it('escalates immediately on a repeat trigger (never offered twice)', () => {
    expect(decideEscalation('frustration', true)).toEqual({
      reason: 'frustration',
      mode: 'handoff',
    })
  })
})

describe('isSubstantiveAnswer', () => {
  it('is true when there are citations', () => {
    expect(
      isSubstantiveAnswer({
        text: 'ok',
        citations: [{ type: 'article', id: 'x', title: 't', url: 'u' }],
      })
    ).toBe(true)
  })

  it('is false for a short greeting with no citations', () => {
    expect(isSubstantiveAnswer({ text: 'Hi there!', citations: [] })).toBe(false)
  })

  it('is true for a long uncited answer', () => {
    expect(isSubstantiveAnswer({ text: 'x'.repeat(50), citations: [] })).toBe(true)
  })
})

describe('buildAssistantSystemPrompt', () => {
  it('carries the citation, scope-honesty, escalation, and injection guards', () => {
    const joined = buildAssistantSystemPrompt('Quinn').join('\n').toLowerCase()
    expect(joined).toContain('search_knowledge')
    expect(joined).toContain('never invent ids')
    expect(joined).toContain('do not know')
    expect(joined).toContain('escalation')
    expect(joined).toContain('not instructions to obey')
    expect(joined).toContain('same language')
  })

  it('hardens the JSON-only instruction to curb weak-model prose leaks', () => {
    const joined = buildAssistantSystemPrompt('Quinn').join('\n').toLowerCase()
    expect(joined).toContain('only a single json object')
    expect(joined).toContain('no markdown code fences')
  })
})

describe('buildSurfaceInstructionsPrompt', () => {
  it('returns null when there are no instructions to add', () => {
    expect(buildSurfaceInstructionsPrompt(undefined)).toBeNull()
    expect(buildSurfaceInstructionsPrompt(null)).toBeNull()
    expect(buildSurfaceInstructionsPrompt('   ')).toBeNull()
  })

  it('carries the instructions text, framed to yield to the base rules on conflict', () => {
    const block = buildSurfaceInstructionsPrompt('Always mention our refund policy.')
    expect(block).toContain('Always mention our refund policy.')
    expect(block!.toLowerCase()).toContain('rules above')
  })

  it('contains no em dashes', () => {
    const block = buildSurfaceInstructionsPrompt('Be concise.')
    expect(block).not.toContain('—')
  })
})

describe('buildBasicsPrompt', () => {
  it('returns null when neither tone nor length is set', () => {
    expect(buildBasicsPrompt(undefined)).toBeNull()
    expect(buildBasicsPrompt(null)).toBeNull()
    expect(buildBasicsPrompt({})).toBeNull()
  })

  it('renders a tone-only directive', () => {
    expect(buildBasicsPrompt({ tone: 'friendly' })).toBe('Write in a friendly tone.')
  })

  it('renders a length-only directive', () => {
    expect(buildBasicsPrompt({ length: 'concise' })).toBe('Keep answers concise.')
  })

  it('renders both as two sentences, tone then length', () => {
    expect(buildBasicsPrompt({ tone: 'friendly', length: 'concise' })).toBe(
      'Write in a friendly tone. Keep answers concise.'
    )
  })

  it('covers every tone and length value', () => {
    expect(buildBasicsPrompt({ tone: 'neutral' })).toBe('Write in a neutral tone.')
    expect(buildBasicsPrompt({ tone: 'professional' })).toBe('Write in a professional tone.')
    expect(buildBasicsPrompt({ length: 'standard' })).toBe('Keep answers to a standard length.')
    expect(buildBasicsPrompt({ length: 'thorough' })).toBe('Give thorough, detailed answers.')
  })

  it('contains no em dashes', () => {
    const block = buildBasicsPrompt({ tone: 'professional', length: 'thorough' })
    expect(block).not.toContain('—')
  })
})

describe('buildGuidancePrompt', () => {
  const rule = (id: string, title: string, body: string) => ({ id: id as never, title, body })

  it('returns a null block and empty ruleIds when there are no rules', () => {
    expect(buildGuidancePrompt([])).toEqual({ block: null, ruleIds: [] })
  })

  it('folds in each rule title + body, framed to yield to the base rules on conflict', () => {
    const { block } = buildGuidancePrompt([
      rule('assistant_guidance_1', 'Refunds', 'Always mention the refund policy.'),
    ])
    expect(block).toContain('Refunds')
    expect(block).toContain('Always mention the refund policy.')
    expect(block!.toLowerCase()).toContain('rules above')
  })

  it('returns the id of each rule actually folded in', () => {
    const { ruleIds } = buildGuidancePrompt([
      rule('assistant_guidance_1', 'Refunds', 'Always mention the refund policy.'),
      rule('assistant_guidance_2', 'Tone', 'Stay upbeat.'),
    ])
    expect(ruleIds).toEqual(['assistant_guidance_1', 'assistant_guidance_2'])
  })

  it('contains no em dashes', () => {
    const { block } = buildGuidancePrompt([rule('assistant_guidance_1', 'Tone', 'Stay upbeat.')])
    expect(block).not.toContain('—')
  })

  it('caps at 20 enabled rules, in position order, and ruleIds mirrors the cap', () => {
    const rules = Array.from({ length: 25 }, (_, i) =>
      rule(`assistant_guidance_${i}`, `Rule ${i}`, 'body')
    )
    const { block, ruleIds } = buildGuidancePrompt(rules)
    expect(block).toContain('Rule 19')
    expect(block).not.toContain('Rule 20')
    expect(ruleIds).toHaveLength(20)
    expect(ruleIds).not.toContain('assistant_guidance_20')
  })

  it('drops whole rules past the char budget, in position order (never truncates one), and ruleIds mirrors it', () => {
    const nearBudget = 'x'.repeat(3990)
    const { block, ruleIds } = buildGuidancePrompt([
      rule('assistant_guidance_1', 'First', nearBudget),
      rule('assistant_guidance_2', 'Second', 'short body'),
    ])
    expect(block).toContain('First')
    expect(block).not.toContain('Second')
    expect(ruleIds).toEqual(['assistant_guidance_1'])
  })
})

describe('isAssistantConfigured', () => {
  it('is true with a client and chat model', () => {
    expect(isAssistantConfigured()).toBe(true)
  })
  it('is false without a chat model', () => {
    mockConfig.aiChatModel = undefined
    expect(isAssistantConfigured()).toBe(false)
  })
  it('is false without the AI client', () => {
    mockConfig.openaiBaseUrl = undefined
    expect(isAssistantConfigured()).toBe(false)
  })
})

describe('runAssistantTurn', () => {
  it('throws when not configured', async () => {
    mockConfig.aiChatModel = undefined
    await expect(
      runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })
    ).rejects.toBeInstanceOf(AssistantNotConfiguredError)
  })

  it('short-circuits (no model call) under the silence rule', async () => {
    const result = await runAssistantTurn({
      ...baseInput,
      messages: [
        { sender: 'customer', content: 'hi' },
        { sender: 'assistant', content: 'hello' },
        { sender: 'human_agent', content: 'I got this' },
      ],
    })
    expect(result).toEqual({ status: 'suppressed', reason: 'silence' })
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('runs the tool round trip and assembles citations from what search_knowledge surfaced', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    const deltas: string[] = []
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          // Simulate the model calling search_knowledge; the loop threads context.
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'reset password' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          const object = {
            text: 'Use the reset link.',
            citations: [{ type: 'article', id: 'kb_article_1' }],
          }
          yield { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(object) }
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
          yield {
            type: 'RUN_FINISHED',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          }
        })()
    )

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('how do I reset my password?'),
      onTextDelta: (d) => deltas.push(d),
    })

    expect(result).toEqual({
      status: 'answered',
      text: 'Use the reset link.',
      citations: [
        {
          type: 'article',
          id: 'kb_article_1',
          title: 'Title kb_article_1',
          url: '/hc/articles/general/slug-kb_article_1',
        },
      ],
    })
    expect(deltas.join('')).toBe('Use the reset link.')
    // Retrieval was called through the tool, audience-scoped.
    expect(mockRetrieve).toHaveBeenCalledWith('reset password', { audience: 'public' })
  })

  it('drops citations below the confidence floor (nothing retrieved)', async () => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'obscure' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          const object = {
            text: 'I could not find that. Want me to connect a human?',
            citations: [{ type: 'article', id: 'kb_article_ghost' }],
          }
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
          yield { type: 'RUN_FINISHED', usage: undefined }
        })()
    )

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('something obscure'),
    })
    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.citations).toEqual([])
  })

  it('offers escalation once, then escalates immediately on the repeat', async () => {
    const object = {
      text: 'Let me get a teammate.',
      citations: [],
      escalation: { reason: 'frustration' },
    }
    mockChat.mockImplementation(() => chunkStream(completeRun(object)))

    const first = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('this is broken and I am furious'),
      escalationAlreadyOffered: false,
    })
    expect(first.status === 'answered' && first.escalation).toEqual({
      reason: 'frustration',
      mode: 'offer',
    })

    const second = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('still furious'),
      escalationAlreadyOffered: true,
    })
    expect(second.status === 'answered' && second.escalation).toEqual({
      reason: 'frustration',
      mode: 'handoff',
    })
  })

  it('retries once when the first stream yields no structured object', async () => {
    const object = { text: 'Second try.', citations: [] }
    mockChat
      .mockReturnValueOnce(chunkStream([{ type: 'RUN_FINISHED', usage: undefined }]))
      .mockReturnValueOnce(chunkStream(completeRun(object)))

    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('q') })
    expect(result.status === 'answered' && result.text).toBe('Second try.')
    expect(mockChat).toHaveBeenCalledTimes(2)
    // Prompt assembly and tool assembly each read the flag once per turn, not
    // per attempt: a retry reuses the same assembled prompt and tool set.
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(2)
  })

  it('answers with a friendly fallback (never silence) when both attempts hard-fail', async () => {
    mockChat.mockImplementation(() =>
      chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
    )
    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('q') })
    expect(result).toEqual({
      status: 'answered',
      text: ASSISTANT_FALLBACK_MESSAGE,
      citations: [],
    })
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('propagates an abort instead of masking it with the fallback', async () => {
    const controller = new AbortController()
    mockChat.mockImplementation(() =>
      (async function* () {
        controller.abort()
        yield { type: 'RUN_ERROR', message: 'aborted' }
      })()
    )
    await expect(
      runAssistantTurn({ ...baseInput, messages: customerAsks('q'), signal: controller.signal })
    ).rejects.toThrow()
  })

  it('falls back instead of throwing when the final structured object fails schema validation', async () => {
    // A non-null but non-conformant final (text is a number, not a string)
    // reaches runAssistantTurn as a "success" outcome from runSynthesis (it
    // only checks final !== null, never revalidates against the schema). The
    // turn's own post-loop validation must catch this and fall back rather
    // than let a thrown ZodError escape runAssistantTurn: Quinn's live widget
    // path may only throw on an aborted signal, never otherwise.
    const nonConformant = { text: 123, citations: [] }
    mockChat.mockImplementation(() => chunkStream(completeRun(nonConformant)))

    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('q') })

    expect(result).toEqual({
      status: 'answered',
      text: ASSISTANT_FALLBACK_MESSAGE,
      citations: [],
    })
  })

  it('logs answerKind "answered" in the usage-log metadata for a normal grounded reply', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'reset password' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          const object = {
            text: 'Use the reset link.',
            citations: [{ type: 'article', id: 'kb_article_1' }],
          }
          yield { type: 'TEXT_MESSAGE_CONTENT', delta: JSON.stringify(object) }
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
          yield {
            type: 'RUN_FINISHED',
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          }
        })()
    )

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('how do I reset my password?'),
    })

    expect(mockWithUsageLogging).toHaveBeenCalledTimes(1)
    expect(lastLoggedMetadata?.answerKind).toBe('answered')
  })

  it('logs answerKind "no_sources" when retrieval never surfaced a citation candidate', async () => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'obscure' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          const object = { text: 'I could not find that.', citations: [] }
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
          yield { type: 'RUN_FINISHED', usage: undefined }
        })()
    )

    await runAssistantTurn({ ...baseInput, messages: customerAsks('something obscure') })

    expect(lastLoggedMetadata?.answerKind).toBe('no_sources')
  })

  it('logs answerKind "escalated" when the model sets an escalation reason', async () => {
    const object = {
      text: 'Let me get a teammate.',
      citations: [],
      escalation: { reason: 'frustration' },
    }
    mockChat.mockImplementation(() => chunkStream(completeRun(object)))

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('this is broken and I am furious'),
      escalationAlreadyOffered: false,
    })

    expect(lastLoggedMetadata?.answerKind).toBe('escalated')
  })

  it('records guidanceRuleIds in the usage-log metadata for rules folded into the prompt', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
    mockListGuidanceRules.mockResolvedValue([
      { id: 'assistant_guidance_1', title: 'Refunds', body: 'Mention the policy.' },
      { id: 'assistant_guidance_2', title: 'Tone', body: 'Stay upbeat.' },
    ])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata?.guidanceRuleIds).toEqual([
      'assistant_guidance_1',
      'assistant_guidance_2',
    ])
  })

  it('omits guidanceRuleIds from the usage-log metadata (byte-identical) when actions are off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata).not.toHaveProperty('guidanceRuleIds')
    expect(lastLoggedMetadata).toEqual({
      conversationId: null,
      attempt: 0,
      answerKind: 'no_sources',
    })
  })

  it('omits guidanceRuleIds from the usage-log metadata when actions are on but no rule survives', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
    mockListGuidanceRules.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata).not.toHaveProperty('guidanceRuleIds')
  })

  it('salvages a schema answer from prose the weak model wrapped around the JSON', async () => {
    // Model leaks a chatty preamble, then the JSON envelope, and never emits a
    // structured-output.complete: the turn must still land the real answer.
    mockChat.mockImplementation(() =>
      chunkStream([
        {
          type: 'TEXT_MESSAGE_CONTENT',
          delta:
            'Sure, happy to help!\n\n{"text": "Click the reset link in your email.", "citations": []}',
        },
        { type: 'RUN_ERROR', message: 'Failed to parse structured output as JSON' },
      ])
    )
    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('reset?') })
    expect(result).toEqual({
      status: 'answered',
      text: 'Click the reset link in your email.',
      citations: [],
    })
    // Salvaged on the first attempt; no retry needed.
    expect(mockChat).toHaveBeenCalledTimes(1)
  })
})

describe('runAssistantTurn: prompt assembly (basics + surface instructions + guidance)', () => {
  function systemPromptsFromLastCall(): string[] {
    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    return opts.systemPrompts
  }

  it('flag off: systemPrompts is byte-identical to the base prompt alone, no config fetched', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(systemPromptsFromLastCall()).toEqual(buildAssistantSystemPrompt('Quinn'))
    expect(mockGetAssistantConfig).not.toHaveBeenCalled()
    expect(mockListGuidanceRules).not.toHaveBeenCalled()
  })

  it('flag on but nothing saved: still byte-identical to the base prompt', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
    mockListGuidanceRules.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(systemPromptsFromLastCall()).toEqual(buildAssistantSystemPrompt('Quinn'))
  })

  it('assembles base -> basics -> surface instructions -> guidance, in that order', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({
      toolControls: {},
      basics: { tone: 'friendly', length: 'concise' },
      surfaces: { widget: { instructions: 'Be extra warm.' } },
    })
    mockListGuidanceRules.mockResolvedValue([
      { id: 'assistant_guidance_1', title: 'Refunds', body: 'Mention the policy.' },
    ])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'widget' })

    const prompts = systemPromptsFromLastCall()
    expect(prompts).toHaveLength(4)
    expect(prompts[0]).toEqual(buildAssistantSystemPrompt('Quinn')[0])
    expect(prompts[1]).toBe('Write in a friendly tone. Keep answers concise.')
    expect(prompts[2]).toContain('Be extra warm.')
    expect(prompts[3]).toContain('Refunds')
  })

  it('adds no basics element when nothing is saved, even with surface + guidance present', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({
      toolControls: {},
      basics: {},
      surfaces: { widget: { instructions: 'Be extra warm.' } },
    })
    mockListGuidanceRules.mockResolvedValue([
      { id: 'assistant_guidance_1', title: 'Refunds', body: 'Mention the policy.' },
    ])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'widget' })

    const prompts = systemPromptsFromLastCall()
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).toContain('Be extra warm.')
    expect(prompts[2]).toContain('Refunds')
  })

  it('scopes the guidance query to the turn surface, defaulting to widget', async () => {
    mockActionsFlag(true)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })
    expect(mockListGuidanceRules).toHaveBeenCalledWith({ enabledOnly: true, surface: 'widget' })

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'email' })
    expect(mockListGuidanceRules).toHaveBeenCalledWith({ enabledOnly: true, surface: 'email' })
  })

  it('fetches assistant config + guidance in parallel, once per turn, before the attempt loop', async () => {
    mockActionsFlag(true)
    // First stream yields nothing structured, forcing the documented retry.
    mockChat
      .mockReturnValueOnce(chunkStream([{ type: 'RUN_FINISHED', usage: undefined }]))
      .mockReturnValueOnce(chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    // Config is turn-scoped, not per-attempt: a retry must not re-fetch it.
    expect(mockGetAssistantConfig).toHaveBeenCalledTimes(1)
    expect(mockListGuidanceRules).toHaveBeenCalledTimes(1)
  })

  it('shares the one getAssistantConfig read with tool assembly: assembleAssistantTools never re-fetches controls', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({
      toolControls: { search_knowledge: 'disabled' },
      surfaces: {},
      basics: {},
    })
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(mockGetAssistantConfig).toHaveBeenCalledTimes(1)
    expect(mockGetAssistantToolControls).not.toHaveBeenCalled()
  })
})

describe('runAssistantTurn: registry-derived tool activity (E-6)', () => {
  it('surfaces a tool-call activity for any name present in the assembled tool set', async () => {
    mockAssembleAssistantTools.mockResolvedValue([
      { name: 'future_tool', description: 'x', execute: async () => ({}) },
    ])
    mockChat.mockImplementation(() =>
      chunkStream([
        { type: 'TOOL_CALL_START', toolCallName: 'future_tool' },
        ...completeRun({ text: 'ok', citations: [] }),
      ])
    )

    const activities: Array<{ kind: string; tool?: string }> = []
    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('hi'),
      onActivity: (a) => activities.push(a),
    })

    expect(activities).toContainEqual({ kind: 'tool', tool: 'future_tool' })
  })

  it('ignores a tool-call chunk for a name outside the assembled tool set', async () => {
    mockAssembleAssistantTools.mockResolvedValue([
      { name: 'search_knowledge', description: 'x', execute: async () => ({}) },
    ])
    mockChat.mockImplementation(() =>
      chunkStream([
        { type: 'TOOL_CALL_START', toolCallName: 'not_assembled' },
        ...completeRun({ text: 'ok', citations: [] }),
      ])
    )

    const activities: Array<{ kind: string; tool?: string }> = []
    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('hi'),
      onActivity: (a) => activities.push(a),
    })

    expect(activities.some((a) => a.kind === 'tool')).toBe(false)
  })
})

describe('relinkCitations', () => {
  const cite = (id: string) => ({ type: 'article' as const, id })
  const final = (id: string) => ({ type: 'article' as const, id, title: id, url: `/a/${id}` })

  it('keeps markers that map to a surviving source', () => {
    expect(relinkCitations('Reset it.[1]', [cite('a')], [final('a')])).toBe('Reset it.[1]')
  })

  it('renumbers markers to the final (deduped/filtered) order', () => {
    // model cited [1]=a (dropped, hallucinated), [2]=b (kept) -> b is final #1
    expect(relinkCitations('x[1] y[2]', [cite('a'), cite('b')], [final('b')])).toBe('x y[1]')
  })

  it('drops all markers when nothing survived the confidence floor', () => {
    expect(relinkCitations('Answer.[1][2]', [cite('a')], [])).toBe('Answer.')
  })

  it('leaves marker-free text untouched', () => {
    expect(relinkCitations('Just prose.', [cite('a')], [final('a')])).toBe('Just prose.')
  })
})

describe('extractFirstJsonObject', () => {
  it('returns null when there is no object', () => {
    expect(extractFirstJsonObject('just prose, no braces')).toBeNull()
  })

  it('pulls a balanced object out of surrounding prose', () => {
    expect(extractFirstJsonObject('hello {"a": 1} trailing')).toBe('{"a": 1}')
  })

  it('respects braces inside strings and escapes', () => {
    expect(extractFirstJsonObject('x {"t": "a } b \\" c"} y')).toBe('{"t": "a } b \\" c"}')
  })

  it('matches the outermost object when nested', () => {
    expect(extractFirstJsonObject('p {"a": {"b": 1}} q')).toBe('{"a": {"b": 1}}')
  })
})

describe('salvageAssistantOutput', () => {
  const answer = (text: string) => ({ text, citations: [] })

  it('parses clean JSON', () => {
    expect(salvageAssistantOutput('{"text":"hi","citations":[]}')).toEqual(answer('hi'))
  })

  it('strips markdown code fences', () => {
    expect(salvageAssistantOutput('```json\n{"text":"hi","citations":[]}\n```')).toEqual(
      answer('hi')
    )
  })

  it('extracts JSON wrapped in a prose preamble', () => {
    expect(
      salvageAssistantOutput('I am just saying hello!\n\n{"text":"hi","citations":[]}')
    ).toEqual(answer('hi'))
  })

  it('repairs trailing commas and single quotes via jsonrepair', () => {
    expect(salvageAssistantOutput("{'text': 'hi', 'citations': [],}")).toEqual(answer('hi'))
  })

  it('recovers the answer text from a truncated envelope', () => {
    // Cut off mid-string: repair closes it; even if citations were half-formed,
    // the partial parse still yields text.
    const parsed = salvageAssistantOutput('{"text":"the reset link is at the top')
    expect(parsed?.text).toContain('the reset link is at the top')
    expect(parsed?.citations).toEqual([])
  })

  it('returns null for prose with no JSON at all (caller falls back)', () => {
    expect(salvageAssistantOutput('I was just greeting you, no JSON here.')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(salvageAssistantOutput('   ')).toBeNull()
  })
})
