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

const mockEvaluateZeroToolCompletion = vi.fn()
vi.mock('../assistant.completion-evaluator', () => ({
  evaluateZeroToolCompletion: (...args: unknown[]) => mockEvaluateZeroToolCompletion(...args),
}))

const mockRetrieve = vi.fn()
vi.mock('../retrieval', () => ({
  retrieveKbArticles: (...args: unknown[]) => mockRetrieve(...args),
}))

// The current conversation's customer lookup (P2-A.4 customer-scoped
// retrieval): a fake `conversations` select chain the runtime queries only
// when `conversationId` is set. The lookup leftJoins `principal` (to fold the
// grounding facts' customer displayName off the same round-trip), so the chain
// carries a `leftJoin` step. Default resolves no row, so every existing test
// (none of which set conversationId) never touches this at all — the real `db`
// export is otherwise passed through unchanged.
const mockConversationLookupLimit = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  const limitStep = { limit: (...args: unknown[]) => mockConversationLookupLimit(...args) }
  const whereStep = { where: vi.fn(() => limitStep) }
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          leftJoin: vi.fn(() => whereStep),
          where: vi.fn(() => limitStep),
        })),
      })),
    },
  }
})

// Stand-ins for the three optional knowledge sources: resolveKnowledgeSources
// dynamically imports each one its type enables in the turn snapshot, so each must
// be stubbed or a grounding test would reach the real (DB-backed) domains.
const mockPostsRetrieve = vi.fn()
vi.mock('../posts-retrieval', () => ({
  postsKnowledgeSource: {
    sourceType: 'post',
    retrieve: (...args: unknown[]) => mockPostsRetrieve(...args),
  },
}))
const mockSnippetsRetrieve = vi.fn()
vi.mock('../snippets-retrieval', () => ({
  snippetsKnowledgeSource: {
    sourceType: 'snippet',
    retrieve: (...args: unknown[]) => mockSnippetsRetrieve(...args),
  },
}))
const mockConversationSummariesRetrieve = vi.fn()
vi.mock('../conversation-summary-retrieval', () => ({
  conversationSummariesKnowledgeSource: {
    sourceType: 'summary',
    retrieve: (...args: unknown[]) => mockConversationSummariesRetrieve(...args),
  },
}))
const mockTicketsRetrieve = vi.fn()
vi.mock('../tickets-retrieval', () => ({
  ticketsKnowledgeSource: {
    sourceType: 'ticket',
    retrieve: (...args: unknown[]) => mockTicketsRetrieve(...args),
  },
}))
const mockChangelogRetrieve = vi.fn()
vi.mock('../changelog-retrieval', () => ({
  changelogKnowledgeSource: {
    sourceType: 'changelog',
    retrieve: (...args: unknown[]) => mockChangelogRetrieve(...args),
  },
}))

// `listMessages` backs get_conversation_context (never triggered here);
// `listConversationMessagesForGrounding` (all: true) backs the conversation
// grounding thread load. Both default unset; the grounding tests below drive a
// real thread through the grounding read.
const mockListMessages = vi.fn()
const mockListConversationMessagesForGrounding = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
  listConversationMessagesForGrounding: (...args: unknown[]) =>
    mockListConversationMessagesForGrounding(...args),
}))

// Ticket grounding (unified inbox §2.9): the runtime's read-only reach into
// the tickets domain for a ticket-scoped turn. Defaults to no ticket
// resolved; individual tests below set a real ticket/thread.
const mockGetTicket = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({
  getTicket: (...args: unknown[]) => mockGetTicket(...args),
}))
const mockListTicketMessages = vi.fn()
vi.mock('@/lib/server/domains/tickets/ticket-message.service', () => ({
  listTicketMessages: (...args: unknown[]) => mockListTicketMessages(...args),
}))

const mockWithUsageLogging = vi.fn()
/** The merged metadata of the most recent usage-log row (params + fn outcome). */
let lastLoggedMetadata: Record<string, unknown> | undefined
vi.mock('@/lib/server/domains/ai/usage-log', () => ({
  withUsageLogging: (...args: unknown[]) => mockWithUsageLogging(...args),
}))

// The live attribute catalogue (P0 catalogue injection): the runtime fetches
// this only when set_attribute made it into the turn's active tool set.
// Defaults to none, so every existing test (which never asserts on this)
// keeps seeing the byte-identical no-definitions prompt.
const mockListConversationAttributes = vi.fn()
vi.mock('@/lib/server/domains/conversation-attributes/conversation-attribute.service', () => ({
  listConversationAttributes: (...args: unknown[]) => mockListConversationAttributes(...args),
}))

const DEFAULT_RUNTIME_CONFIG: AssistantRuntimeConfig = {
  config: {
    version: 3 as const,
    identity: { name: 'Quinn', avatarUrl: null },
    agents: {
      agent: {
        voice: {
          tone: 'balanced' as const,
          responseLength: 'balanced' as const,
          additionalInstructions: '',
        },
        knowledge: { helpCenter: true, posts: false, changelog: false, status: false },
      },
      copilot: {
        capabilities: { qa: true, suggestedReplies: true },
        knowledge: {
          helpCenter: true,
          posts: true,
          pastConversations: true,
          internalNotes: true,
          tickets: false,
          changelog: false,
          status: true,
        },
      },
    },
  },
  revision: 1,
  workspaceName: 'Quackback',
  actionsEnabled: false,
}

const mockGetAssistantRuntimeConfig = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantRuntimeConfig: (...args: unknown[]) => mockGetAssistantRuntimeConfig(...args),
}))

function mockRuntimeConfig(
  overrides: Omit<Partial<AssistantRuntimeConfig>, 'config'> & {
    // `voice` is a convenience that maps onto the Agent's sub-config (v3), so
    // existing call sites keep passing a flat voice override.
    config?: Partial<Omit<AssistantRuntimeConfig['config'], 'agents'>> & {
      voice?: AssistantRuntimeConfig['config']['agents']['agent']['voice']
      agents?: Partial<AssistantRuntimeConfig['config']['agents']>
    }
  }
) {
  const { voice, agents, ...configRest } = overrides.config ?? {}
  const base = structuredClone(DEFAULT_RUNTIME_CONFIG.config)
  mockGetAssistantRuntimeConfig.mockResolvedValue({
    ...structuredClone(DEFAULT_RUNTIME_CONFIG),
    ...overrides,
    config: {
      ...base,
      ...configRest,
      agents: {
        ...base.agents,
        ...agents,
        // Deep-merge the Agent sub-config: base <- caller's agents.agent override
        // <- the `voice` shorthand (which wins where passed). Without folding in
        // `agents?.agent`, this key would clobber a caller-supplied agent override
        // with the base. The copilot override is carried by the `...agents` spread.
        agent: { ...base.agents.agent, ...agents?.agent, ...(voice ? { voice } : {}) },
      },
    },
  })
}

function mockActionsFlag(enabled: boolean) {
  mockRuntimeConfig({ actionsEnabled: enabled })
}

const mockListEnabledGuidanceCandidates = vi.fn()
vi.mock('../guidance.service', () => ({
  listEnabledGuidanceCandidates: (...args: unknown[]) => mockListEnabledGuidanceCandidates(...args),
}))

const mockSelectApplicableGuidance = vi.fn()
vi.mock('../guidance-selector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../guidance-selector')>()
  return {
    ...actual,
    selectApplicableGuidance: (...args: unknown[]) => mockSelectApplicableGuidance(...args),
  }
})

// Keep the real tool assembly by default (tool wiring is exercised for real
// elsewhere in this file); the registry-derived activity filter tests below
// swap in a fake tool set to prove the filter isn't hardcoded to any
// built-in tool name.
const mockAssembleAssistantToolset = vi.hoisted(() => vi.fn())
const realAssembleAssistantToolsetRef = vi.hoisted(() => ({
  current: undefined as unknown as (...args: unknown[]) => unknown,
}))
vi.mock('../assistant.tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../assistant.tools')>()
  realAssembleAssistantToolsetRef.current = actual.assembleAssistantToolset as (
    ...args: unknown[]
  ) => unknown
  return {
    ...actual,
    assembleAssistantToolset: (...args: unknown[]) => mockAssembleAssistantToolset(...args),
  }
})

import {
  runAssistantTurn,
  respondEligible,
  assembleCitations,
  isSubstantiveAnswer,
  isAssistantConfigured,
  AssistantNotConfiguredError,
  salvageAssistantOutput,
  extractFirstJsonObject,
  relinkCitations,
  validateAssistantCompletion,
  AssistantCompletionError,
  type AssistantRuntimeConfig,
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
  role: 'customer_support' as const,
  surface: 'widget' as const,
}

const copilotQaInput = {
  ...baseInput,
  role: 'copilot_qa' as const,
  surface: 'copilot' as const,
}

const suggestedReplyInput = {
  ...baseInput,
  role: 'suggested_reply' as const,
  surface: 'copilot' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockConfig.aiChatModel = 'test-model'
  mockConfig.aiHelpCenterModel = undefined
  mockConfig.aiQualityGateModel = undefined
  mockEvaluateZeroToolCompletion.mockResolvedValue({
    decision: 'accept',
    reason: 'complete_response',
  })
  mockConversationLookupLimit.mockResolvedValue([])
  mockListMessages.mockResolvedValue({ messages: [], hasMore: false, nextCursor: null })
  mockListConversationMessagesForGrounding.mockResolvedValue([])
  mockPostsRetrieve.mockResolvedValue([])
  mockSnippetsRetrieve.mockResolvedValue([])
  mockConversationSummariesRetrieve.mockResolvedValue([])
  mockTicketsRetrieve.mockResolvedValue([])
  mockChangelogRetrieve.mockResolvedValue([])
  mockGetAssistantRuntimeConfig.mockResolvedValue(structuredClone(DEFAULT_RUNTIME_CONFIG))
  mockListEnabledGuidanceCandidates.mockResolvedValue([])
  mockSelectApplicableGuidance.mockResolvedValue([])
  mockListConversationAttributes.mockResolvedValue([])
  mockAssembleAssistantToolset.mockImplementation((...args: unknown[]) =>
    realAssembleAssistantToolsetRef.current(...args)
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

describe('mockRuntimeConfig helper', () => {
  it('applies an agents.agent override instead of clobbering it with the base', async () => {
    mockRuntimeConfig({
      config: {
        agents: {
          agent: {
            voice: DEFAULT_RUNTIME_CONFIG.config.agents.agent.voice,
            knowledge: { helpCenter: false, posts: true, changelog: true, status: true },
          },
        },
      },
    })
    const resolved = (await mockGetAssistantRuntimeConfig()) as AssistantRuntimeConfig
    expect(resolved.config.agents.agent.knowledge).toEqual({
      helpCenter: false,
      posts: true,
      changelog: true,
      status: true,
    })
  })
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

  it('preserves the internal flag a source adapter set on the ledger entry', () => {
    const internalLedger = new Map<string, AssistantCitation>([
      [
        'assistant_snippet_1',
        { type: 'snippet', id: 'assistant_snippet_1', title: 'S1', url: '', internal: true },
      ],
    ])
    expect(
      assembleCitations([{ type: 'snippet', id: 'assistant_snippet_1' }], internalLedger)
    ).toEqual([
      { type: 'snippet', id: 'assistant_snippet_1', title: 'S1', url: '', internal: true },
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

  it('round-trips a post citation the same way as an article one (post grounding source)', () => {
    const postLedger = new Map<string, AssistantCitation>([
      ...ledger,
      [
        'post_1',
        { type: 'post', id: 'post_1', title: 'Dark mode request', url: '/b/general/posts/post_1' },
      ],
    ])
    expect(
      assembleCitations(
        [
          { type: 'article', id: 'kb_article_1' },
          { type: 'post', id: 'post_1' },
        ],
        postLedger
      )
    ).toEqual([
      { type: 'article', id: 'kb_article_1', title: 'T1', url: '/hc/articles/g/a1' },
      { type: 'post', id: 'post_1', title: 'Dark mode request', url: '/b/general/posts/post_1' },
    ])
  })

  it('round-trips a snippet citation the same way as an article one (snippets grounding source)', () => {
    const snippetLedger = new Map<string, AssistantCitation>([
      ...ledger,
      [
        'assistant_snippet_1',
        { type: 'snippet', id: 'assistant_snippet_1', title: 'Refund window', url: '' },
      ],
    ])
    expect(
      assembleCitations(
        [
          { type: 'article', id: 'kb_article_1' },
          { type: 'snippet', id: 'assistant_snippet_1' },
        ],
        snippetLedger
      )
    ).toEqual([
      { type: 'article', id: 'kb_article_1', title: 'T1', url: '/hc/articles/g/a1' },
      { type: 'snippet', id: 'assistant_snippet_1', title: 'Refund window', url: '' },
    ])
  })

  it('round-trips a summary citation the same way as an article one (past-conversation grounding source)', () => {
    const summaryLedger = new Map<string, AssistantCitation>([
      ...ledger,
      [
        'conversation_1',
        { type: 'summary', id: 'conversation_1', title: 'Past conversation', url: '' },
      ],
    ])
    expect(
      assembleCitations(
        [
          { type: 'article', id: 'kb_article_1' },
          { type: 'summary', id: 'conversation_1' },
        ],
        summaryLedger
      )
    ).toEqual([
      { type: 'article', id: 'kb_article_1', title: 'T1', url: '/hc/articles/g/a1' },
      { type: 'summary', id: 'conversation_1', title: 'Past conversation', url: '' },
    ])
  })

  it('drops everything when nothing cleared the confidence floor (empty ledger)', () => {
    expect(assembleCitations([{ type: 'article', id: 'kb_article_1' }], new Map())).toEqual([])
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

describe('terminal completion protocol', () => {
  const source = {
    type: 'article' as const,
    id: 'kb_article_1',
    title: 'Reset password',
    url: '/hc/articles/reset-password',
  }

  it('requires a grounded citation after a successful search', () => {
    expect(() =>
      validateAssistantCompletion(
        { text: 'Use the reset link.', citations: [] },
        {
          searchCalls: 1,
          sources: new Map([[source.id, source]]),
          toolCalls: ['search_knowledge'],
          inabilityReported: false,
          handoffRequested: false,
        }
      )
    ).toThrowError(new AssistantCompletionError('uncited_retrieved_answer'))

    expect(() =>
      validateAssistantCompletion(
        {
          text: 'Use the reset link. [1]',
          citations: [{ type: 'article', id: source.id }],
        },
        {
          searchCalls: 1,
          sources: new Map([[source.id, source]]),
          toolCalls: ['search_knowledge'],
          inabilityReported: false,
          handoffRequested: false,
        }
      )
    ).not.toThrow()
  })

  it('requires report_inability after an empty search, then accepts model-authored text', () => {
    expect(() =>
      validateAssistantCompletion(
        {
          text: 'I could not find anything relevant. I can connect you with a teammate.',
          citations: [],
        },
        {
          searchCalls: 1,
          sources: new Map(),
          toolCalls: ['search_knowledge'],
          inabilityReported: false,
          handoffRequested: false,
        }
      )
    ).toThrowError(new AssistantCompletionError('empty_search_without_resolution_tool'))

    expect(() =>
      validateAssistantCompletion(
        {
          text: 'I could not find anything relevant. I can connect you with a teammate.',
          citations: [],
        },
        {
          searchCalls: 1,
          sources: new Map(),
          toolCalls: ['search_knowledge', 'report_inability'],
          inabilityReported: true,
          handoffRequested: false,
        }
      )
    ).not.toThrow()
  })

  it('accepts a get_status-grounded answer: the tool result is the resolution basis, zero search citations', () => {
    // A status answer grounds on the live get_status tool result, not on
    // retrieval — no citation is minted. The tool call is a non-search
    // resolution tool, so the completion validator must accept it.
    expect(() =>
      validateAssistantCompletion(
        {
          text: 'The API is currently experiencing a major outage. See the status page.',
          citations: [],
        },
        {
          searchCalls: 0,
          sources: new Map(),
          toolCalls: ['get_status'],
          inabilityReported: false,
          handoffRequested: false,
        }
      )
    ).not.toThrow()

    // Even if the model also searched and found nothing, get_status is an
    // alternative tool result that resolves the turn.
    expect(() =>
      validateAssistantCompletion(
        { text: 'The API is down right now; here is the status page.', citations: [] },
        {
          searchCalls: 1,
          sources: new Map(),
          toolCalls: ['search_knowledge', 'get_status'],
          inabilityReported: false,
          handoffRequested: false,
        }
      )
    ).not.toThrow()
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

    expect(result).toMatchObject({
      status: 'answered',
      answerType: 'draft_reply',
      text: 'Use the reset link.',
      citations: [
        {
          type: 'article',
          id: 'kb_article_1',
          title: 'Title kb_article_1',
          url: '/hc/articles/general/slug-kb_article_1',
          updatedAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      internalSourced: false,
      proposedActions: [],
      skip: false,
      identity: DEFAULT_RUNTIME_CONFIG.config.identity,
      trace: {
        promptVersion: 'support-agent-v2',
        configRevision: 1,
        role: 'customer_support',
        tone: 'balanced',
        responseLength: 'balanced',
        appliedGuidance: [],
      },
    })
    expect(deltas.join('')).toBe('Use the reset link.')
    // Retrieval was called through the tool, audience-scoped.
    expect(mockRetrieve).toHaveBeenCalledWith('reset password', { audience: 'public' })
  })

  it('derives a team content audience for the copilot surface (structural leak gate)', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'internal escalation policy' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          const object = {
            text: 'Here is the policy.',
            citations: [{ type: 'article', id: 'kb_article_1' }],
          }
          yield* completeRun(object)
        })()
    )

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what is the escalation policy?'),
    })

    // A copilot-surface turn resolves a 'team' retrieval ceiling — mapped to
    // the KB's own 'team' HelpCenterAudience at the toolspec boundary — never
    // a caller-suppliable value, since AssistantTurnInput has no audience
    // field at all.
    expect(mockRetrieve).toHaveBeenCalledWith('internal escalation policy', { audience: 'team' })
  })

  it('sets internalSourced when retrieval returns mixed public/internal sources but the final cites only public', async () => {
    mockRetrieve.mockResolvedValue([
      makeKbArticle('kb_article_public', { isPublic: true }),
      makeKbArticle('kb_article_internal', { isPublic: false }),
    ])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'internal policy' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({
            text: 'Here is the policy.',
            citations: [{ type: 'article', id: 'kb_article_public' }],
          })
        })()
    )

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what is the policy?'),
    })

    expect(result.status).toBe('answered')
    if (result.status === 'answered') {
      expect(result.citations).toEqual([expect.objectContaining({ id: 'kb_article_public' })])
      expect(result.citations[0]).not.toHaveProperty('internal')
      expect(result.internalSourced).toBe(true)
    }
  })

  it('internalSourced stays false when every retrieved source is public', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1', { isPublic: true })])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'public policy' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({
            text: 'Here is the policy.',
            citations: [{ type: 'article', id: 'kb_article_1' }],
          })
        })()
    )

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what is the policy?'),
    })

    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.internalSourced).toBe(false)
  })

  it('conservatively taints copilot Q&A when replayed history contains an assistant turn', async () => {
    mockChat.mockImplementation(() =>
      chunkStream(completeRun({ text: 'Here is the follow-up.', citations: [] }))
    )

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: [
        { sender: 'customer', content: 'What is the policy?' },
        { sender: 'assistant', content: 'A prior Copilot answer.' },
        { sender: 'customer', content: 'Can you clarify?' },
      ],
    })

    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.internalSourced).toBe(true)
  })

  it("carries the source's updatedAt on every surface's citations (freshness line; the orchestrator strips it at persistence)", async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    const turnWith = (copilot = false) => {
      mockChat.mockImplementation(
        (opts: {
          tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
          context: unknown
        }) =>
          (async function* () {
            const search = opts.tools.find((t) => t.name === 'search_knowledge')!
            await search.execute(
              { query: 'policy' },
              { context: opts.context, emitCustomEvent: () => {} }
            )
            yield* completeRun({
              text: 'Here is the policy.',
              citations: [{ type: 'article', id: 'kb_article_1' }],
            })
          })()
      )
      return runAssistantTurn({
        ...(copilot ? copilotQaInput : baseInput),
        messages: customerAsks('what is the policy?'),
      })
    }

    const copilot = await turnWith(true)
    expect(copilot.status).toBe('answered')
    if (copilot.status === 'answered') {
      expect(copilot.citations[0].updatedAt).toBe('2026-06-01T00:00:00.000Z')
    }

    // A widget turn's citations carry it too: the orchestrator's persistence
    // strip (not any surface gate here) is what keeps it out of storage.
    const widget = await turnWith()
    expect(widget.status).toBe('answered')
    if (widget.status === 'answered') {
      expect(widget.citations[0].updatedAt).toBe('2026-06-01T00:00:00.000Z')
    }
  })

  it('returns an explicit inability outcome when retrieval finds nothing', async () => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          const report = opts.tools.find((t) => t.name === 'report_inability')!
          await search.execute(
            { query: 'obscure' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          await report.execute(
            { reason: 'no_relevant_sources' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          const object = {
            text: 'I could not find that. Want me to connect a human?',
            citations: [],
          }
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
          yield { type: 'RUN_FINISHED', usage: undefined }
        })()
    )

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('something obscure'),
    })
    expect(result).toMatchObject({
      status: 'cannot_answer',
      cannotAnswerReason: 'no_relevant_sources',
      citations: [],
    })
  })

  it('derives handoff only from the handoff_to_human tool call, never the final object', async () => {
    mockConversationLookupLimit.mockResolvedValue([
      { visitorPrincipalId: 'principal_visitor', visitorDisplayName: 'Pat' },
    ])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const handoff = opts.tools.find((tool) => tool.name === 'handoff_to_human')!
          await handoff.execute(
            {
              reason: 'frustration',
              customerNeed: 'Restore access to the broken feature.',
              attempted: ['Asked the customer to retry once.'],
              recommendedNextStep: 'Review the account and reproduce the failure.',
            },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({ text: 'I am connecting you with a teammate now.', citations: [] })
        })()
    )

    const result = await runAssistantTurn({
      ...baseInput,
      conversationId: 'conversation_1' as never,
      messages: customerAsks('this is broken and I am furious'),
    })
    expect(result.status !== 'suppressed' && result.escalation).toEqual({
      reason: 'frustration',
      mode: 'handoff',
      customerNeed: 'Restore access to the broken feature.',
      attempted: ['Asked the customer to retry once.'],
      recommendedNextStep: 'Review the account and reproduce the failure.',
    })
  })

  it('ignores a handoff-shaped custom output field when no handoff tool was called', async () => {
    mockChat.mockImplementation(() =>
      chunkStream(
        completeRun({
          text: 'I can keep helping here.',
          citations: [],
          escalation: { reason: 'frustration' },
        })
      )
    )

    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('help') })

    expect(result.status !== 'suppressed' && result.escalation).toBeUndefined()
  })

  it("passes the model's answerType classification through to the result", async () => {
    const object = {
      text: 'The customer is writing in Swedish; wait for their actual request before acting.',
      citations: [],
      answerType: 'analysis',
    }
    mockChat.mockImplementation(() => chunkStream(completeRun(object)))

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what language is he speaking?'),
    })
    expect(result.status === 'answered' && result.answerType).toBe('analysis')
  })

  it('defaults a missing Copilot answerType to analysis', async () => {
    const object = { text: 'Try resetting from Settings.', citations: [] }
    mockChat.mockImplementation(() => chunkStream(completeRun(object)))

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('how do I reset?'),
    })
    expect(result.status === 'answered' && result.answerType).toBe('analysis')
  })

  it('isolates the suggested-reply role from the teammate-facing copilot role', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    const result = await runAssistantTurn({
      ...suggestedReplyInput,
    })

    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    const prompt = opts.systemPrompts.join('\n')
    expect(prompt).toContain('Draft a reply for a support teammate to review and send')
    expect(prompt).toContain('Write only the reply the\ncustomer should receive')
    expect(prompt).not.toContain('Answer the teammate directly')
    expect(result.status !== 'suppressed' && result.trace.role).toBe('suggested_reply')
  })

  it('uses the explicit Copilot Q&A role', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('a question'),
    })

    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    const prompt = opts.systemPrompts.join('\n')
    expect(prompt).toContain('AI copilot assisting a support teammate')
    expect(prompt).toContain('Answer the teammate directly')
    expect(prompt).not.toContain('Draft a reply for a support teammate to review and send')
    expect(result.status !== 'suppressed' && result.trace.role).toBe('copilot_qa')
  })

  it('derives a suggestion skip from report_inability, never from a custom output field', async () => {
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const report = opts.tools.find((tool) => tool.name === 'report_inability')!
          await report.execute(
            { reason: 'no_relevant_sources' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({
            text: 'There is not enough grounded information to draft a reply.',
            citations: [],
            skip: false,
          })
        })()
    )

    const result = await runAssistantTurn({
      ...suggestedReplyInput,
    })

    expect(result).toMatchObject({
      status: 'cannot_answer',
      cannotAnswerReason: 'no_relevant_sources',
      skip: true,
      text: '',
      citations: [],
      internalSourced: false,
    })
  })

  it('keeps skip false for a real draft when no inability tool was called', async () => {
    mockChat.mockImplementation(() =>
      chunkStream(completeRun({ text: 'Here is a draft.', citations: [] }))
    )

    const result = await runAssistantTurn({
      ...suggestedReplyInput,
    })

    expect(result.status === 'answered' && result.skip).toBe(false)
    expect(result.status === 'answered' && result.text).toBe('Here is a draft.')
  })

  it('ignores a spurious "skip" field on every intent because it is not an action channel', async () => {
    const object = { text: 'A real answer, not a miss.', citations: [], skip: true }
    mockChat.mockImplementation(() => chunkStream(completeRun(object)))

    const widget = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('how do I reset?'),
    })
    expect(widget).toMatchObject({
      status: 'answered',
      skip: false,
      text: 'A real answer, not a miss.',
    })

    const copilotQa = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what is the status here?'),
    })
    expect(copilotQa).toMatchObject({
      status: 'answered',
      skip: false,
      text: 'A real answer, not a miss.',
    })

    const suggestion = await runAssistantTurn({
      ...suggestedReplyInput,
    })
    expect(suggestion).toMatchObject({
      status: 'answered',
      skip: false,
      text: 'A real answer, not a miss.',
    })
  })

  it('feeds the profile-owned drafting instruction as the sole turn message on the suggest intent (the route passes no messages at all)', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'draft', citations: [] })))

    await runAssistantTurn(suggestedReplyInput)

    const opts = mockChat.mock.calls.at(-1)?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    expect(opts.messages).toEqual([
      {
        role: 'user',
        content:
          "Draft a ready-to-send reply to the customer's latest message in this conversation.",
      },
    ])
  })

  it("records pipelineStep 'copilot_suggest' for a proactive-suggestions turn, keeping it out of the Q&A question count (analytics/copilot-usage.ts scans pipelineStep: 'assistant')", async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({
      ...suggestedReplyInput,
    })

    expect(mockWithUsageLogging.mock.calls.at(-1)?.[0]).toMatchObject({
      pipelineStep: 'copilot_suggest',
    })
  })

  it("uses pipelineStep 'assistant' for an explicit Q&A Copilot turn", async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('a question'),
    })

    expect(mockWithUsageLogging.mock.calls.at(-1)?.[0]).toMatchObject({
      pipelineStep: 'assistant',
    })
  })

  it('reuses one config revision and tool snapshot across a retry', async () => {
    mockRuntimeConfig({
      revision: 37,
      actionsEnabled: true,
    })
    const object = { text: 'Second try.', citations: [] }
    mockChat
      .mockReturnValueOnce(chunkStream([{ type: 'RUN_FINISHED', usage: undefined }]))
      .mockReturnValueOnce(chunkStream(completeRun(object)))

    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('q') })
    expect(result.status === 'answered' && result.text).toBe('Second try.')
    expect(mockChat).toHaveBeenCalledTimes(2)
    expect(mockGetAssistantRuntimeConfig).toHaveBeenCalledTimes(1)
    expect(mockAssembleAssistantToolset).toHaveBeenCalledTimes(1)
    expect(mockAssembleAssistantToolset).toHaveBeenCalledWith(expect.any(Object), undefined, true)
    expect(result.status !== 'suppressed' && result.trace.configRevision).toBe(37)
    expect(lastLoggedMetadata?.configRevision).toBe(37)
  })

  it('rejects an incomplete zero-tool product reply and lets Quinn retry with search', async () => {
    mockConversationLookupLimit.mockResolvedValue([
      { visitorPrincipalId: 'principal_visitor', visitorDisplayName: 'Pat' },
    ])
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    mockEvaluateZeroToolCompletion.mockResolvedValueOnce({
      decision: 'retry',
      reason: 'incomplete_sentence',
    })

    const promptsByAttempt: string[][] = []
    let attempt = 0
    mockChat.mockImplementation(
      (opts: {
        systemPrompts: string[]
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) => {
        promptsByAttempt.push([...opts.systemPrompts])
        attempt += 1
        if (attempt === 1) {
          return chunkStream(
            completeRun({ text: "I'm not familiar with anything called", citations: [] })
          )
        }
        return (async function* () {
          const search = opts.tools.find((tool) => tool.name === 'search_knowledge')!
          await search.execute(
            { query: 'What is Quackback?' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({
            text: 'Quackback is a customer feedback platform. [1]',
            citations: [{ type: 'article', id: 'kb_article_1' }],
          })
        })()
      }
    )

    const result = await runAssistantTurn({
      ...baseInput,
      conversationId: 'conversation_1' as never,
      messages: customerAsks('ok tell me about quackback'),
    })

    expect(mockEvaluateZeroToolCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate: "I'm not familiar with anything called",
        availableTools: expect.arrayContaining(['search_knowledge']),
      })
    )
    expect(mockChat).toHaveBeenCalledTimes(2)
    expect(promptsByAttempt[1]?.join('\n')).toContain(
      'Your previous final response was not a complete resolution'
    )
    expect(result).toMatchObject({
      status: 'answered',
      text: 'Quackback is a customer feedback platform. [1]',
      citations: [{ id: 'kb_article_1' }],
    })
  })

  it('accepts a complete casual zero-tool reply without forcing a tool call', async () => {
    mockConversationLookupLimit.mockResolvedValue([
      { visitorPrincipalId: 'principal_visitor', visitorDisplayName: 'Pat' },
    ])
    mockChat.mockImplementation(() =>
      chunkStream(completeRun({ text: 'Margherita is a classic choice.', citations: [] }))
    )

    const result = await runAssistantTurn({
      ...baseInput,
      conversationId: 'conversation_1' as never,
      messages: customerAsks('What is your favourite pizza?'),
    })

    expect(mockEvaluateZeroToolCompletion).toHaveBeenCalledTimes(1)
    expect(mockChat).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'answered',
      text: 'Margherita is a classic choice.',
      citations: [],
    })
  })

  it('throws after both attempts hard-fail instead of publishing a canned Quinn reply', async () => {
    mockChat.mockImplementation(() =>
      chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
    )
    await expect(runAssistantTurn({ ...baseInput, messages: customerAsks('q') })).rejects.toThrow(
      'provider exploded'
    )
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('also throws on total suggestion synthesis failure instead of inventing a skip response', async () => {
    mockChat.mockImplementation(() =>
      chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
    )

    await expect(
      runAssistantTurn({
        ...suggestedReplyInput,
      })
    ).rejects.toThrow('provider exploded')
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('also throws on total copilot Q&A failure', async () => {
    mockChat.mockImplementation(() =>
      chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
    )

    await expect(
      runAssistantTurn({
        ...copilotQaInput,
        messages: customerAsks('what is going on here?'),
      })
    ).rejects.toThrow('provider exploded')
  })

  it('keeps a real proposal side effect but still throws when final generation fails', async () => {
    mockRetrieve.mockResolvedValue([])
    let callCount = 0
    let finalContext: { ledger: { proposedActions: unknown[] } } | undefined
    mockChat.mockImplementation((opts: { context: { ledger: { proposedActions: unknown[] } } }) => {
      callCount += 1
      if (callCount === 1) {
        // First attempt: a plain hard failure, nothing proposed.
        return chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
      }
      // Second (final) attempt: a write tool proposes before this run also
      // fails to produce a usable answer.
      finalContext = opts.context
      return (async function* () {
        opts.context.ledger.proposedActions.push({
          id: 'assistant_action_1',
          toolName: 'end_conversation',
          summary: 'Close the conversation',
          label: 'End conversation',
        })
        yield { type: 'RUN_ERROR', message: 'provider exploded again' }
      })()
    })

    await expect(runAssistantTurn({ ...baseInput, messages: customerAsks('q') })).rejects.toThrow(
      'provider exploded again'
    )

    expect(finalContext?.ledger.proposedActions).toEqual([
      {
        id: 'assistant_action_1',
        toolName: 'end_conversation',
        summary: 'Close the conversation',
        label: 'End conversation',
      },
    ])
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

  it('throws instead of synthesizing a reply when both final objects fail schema validation', async () => {
    const nonConformant = { text: 123, citations: [] }
    mockChat.mockImplementation(() => chunkStream(completeRun(nonConformant)))

    await expect(runAssistantTurn({ ...baseInput, messages: customerAsks('q') })).rejects.toThrow(
      'non_conformant_output'
    )
  })

  it('throws on a non-conformant suggestion final too', async () => {
    const nonConformant = { text: 123, citations: [] }
    mockChat.mockImplementation(() => chunkStream(completeRun(nonConformant)))

    await expect(
      runAssistantTurn({
        ...suggestedReplyInput,
      })
    ).rejects.toThrow('non_conformant_output')
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
    expect(lastLoggedMetadata).toMatchObject({
      toolCalls: ['search_knowledge'],
      searchCalls: 1,
      citationCandidates: 1,
      completionDisposition: 'answer',
    })
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
          const report = opts.tools.find((t) => t.name === 'report_inability')!
          await search.execute(
            { query: 'obscure' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          await report.execute(
            { reason: 'no_relevant_sources' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          const object = {
            text: 'I could not find that.',
            citations: [],
          }
          yield { type: 'CUSTOM', name: 'structured-output.complete', value: { object } }
          yield { type: 'RUN_FINISHED', usage: undefined }
        })()
    )

    await runAssistantTurn({ ...baseInput, messages: customerAsks('something obscure') })

    expect(lastLoggedMetadata?.answerKind).toBe('no_sources')
    expect(lastLoggedMetadata).toMatchObject({
      toolCalls: ['search_knowledge', 'report_inability'],
      completionDisposition: 'inability',
      inabilityReason: 'no_relevant_sources',
    })
  })

  it('logs answerKind "escalated" when the model calls handoff_to_human', async () => {
    mockConversationLookupLimit.mockResolvedValue([
      { visitorPrincipalId: 'principal_visitor', visitorDisplayName: 'Pat' },
    ])
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          const handoff = opts.tools.find((tool) => tool.name === 'handoff_to_human')!
          await handoff.execute(
            {
              reason: 'frustration',
              customerNeed: 'Resolve the recurring failure.',
              attempted: ['Retried the operation.'],
              recommendedNextStep: 'Inspect the failed operation logs.',
            },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({ text: 'I am connecting you with a teammate.', citations: [] })
        })()
    )

    await runAssistantTurn({
      ...baseInput,
      conversationId: 'conversation_1' as never,
      messages: customerAsks('this is broken and I am furious'),
    })

    expect(lastLoggedMetadata?.answerKind).toBe('escalated')
    expect(lastLoggedMetadata).toMatchObject({
      toolCalls: ['handoff_to_human'],
      completionDisposition: 'handoff',
      handoffReason: 'frustration',
    })
  })

  it('records candidate and applied V2 guidance IDs separately in metadata and trace', async () => {
    mockListEnabledGuidanceCandidates.mockResolvedValue([
      {
        id: 'assistant_guidance_1',
        name: 'Empathy',
        appliesWhen: null,
        instruction: 'Acknowledge the impact.',
        priority: 0,
      },
      {
        id: 'assistant_guidance_2',
        name: 'Refund request',
        appliesWhen: 'The customer asks for a refund.',
        instruction: 'Explain the refund window.',
        priority: 1,
      },
      {
        id: 'assistant_guidance_3',
        name: 'Billing issue',
        appliesWhen: 'The customer reports an incorrect charge.',
        instruction: 'Ask for the invoice number.',
        priority: 2,
      },
    ])
    mockSelectApplicableGuidance.mockResolvedValue(['assistant_guidance_2'])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('Can I get a refund?'),
    })

    expect(mockListEnabledGuidanceCandidates).toHaveBeenCalledWith({
      agent: 'agent',
    })
    expect(mockSelectApplicableGuidance).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: 'assistant_guidance_2' }),
          expect.objectContaining({ id: 'assistant_guidance_3' }),
        ]),
        latestRequest: 'Can I get a refund?',
        role: 'customer_support',
        channel: 'widget',
      })
    )
    expect(lastLoggedMetadata?.guidanceCandidateIds).toEqual([
      'assistant_guidance_1',
      'assistant_guidance_2',
      'assistant_guidance_3',
    ])
    expect(lastLoggedMetadata?.guidanceAppliedIds).toEqual([
      'assistant_guidance_1',
      'assistant_guidance_2',
    ])
    expect(result.status !== 'suppressed' && result.trace.appliedGuidance).toEqual([
      { id: 'assistant_guidance_1', name: 'Empathy' },
      { id: 'assistant_guidance_2', name: 'Refund request' },
    ])
    const prompts = (mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }).systemPrompts
    expect(prompts.join('\n')).toContain('Acknowledge the impact.')
    expect(prompts.join('\n')).toContain('Explain the refund window.')
    expect(prompts.join('\n')).not.toContain('Ask for the invoice number.')
  })

  it('omits guidance ID metadata when there are no candidates', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata).not.toHaveProperty('guidanceCandidateIds')
    expect(lastLoggedMetadata).not.toHaveProperty('guidanceAppliedIds')
    expect(lastLoggedMetadata).toMatchObject({
      conversationId: null,
      ticketId: null,
      surface: 'widget',
      role: 'customer_support',
      promptVersion: 'support-agent-v2',
      configRevision: 1,
      tone: 'balanced',
      responseLength: 'balanced',
      attempt: 0,
      answerKind: 'no_sources',
      toolCalls: [],
      searchCalls: 0,
      citationCandidates: 0,
      completionDisposition: 'answer',
    })
  })

  it('records candidate IDs but omits applied IDs when no conditional rule is selected', async () => {
    mockListEnabledGuidanceCandidates.mockResolvedValue([
      {
        id: 'assistant_guidance_1',
        name: 'Refund request',
        appliesWhen: 'The customer asks for a refund.',
        instruction: 'Explain the refund window.',
        priority: 0,
      },
    ])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata?.guidanceCandidateIds).toEqual(['assistant_guidance_1'])
    expect(lastLoggedMetadata).not.toHaveProperty('guidanceAppliedIds')
  })

  it('records the deploy surface in the usage-log metadata, defaulting to widget', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata?.surface).toBe('widget')
  })

  it('records surface: copilot for a copilot-surface turn, distinguishing it from every other surface', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...copilotQaInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata?.surface).toBe('copilot')
  })

  it('records the asking teammate as principalId when actorPrincipalId is set (copilot)', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('hi'),
      actorPrincipalId: 'principal_teammate_1' as never,
    })

    expect(lastLoggedMetadata?.principalId).toBe('principal_teammate_1')
  })

  it('omits principalId from the usage-log metadata when no actorPrincipalId is given (widget)', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata).not.toHaveProperty('principalId')
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
    expect(result).toMatchObject({
      status: 'answered',
      answerType: 'draft_reply',
      text: 'Click the reset link in your email.',
      citations: [],
      internalSourced: false,
      proposedActions: [],
      skip: false,
      identity: DEFAULT_RUNTIME_CONFIG.config.identity,
      trace: expect.objectContaining({ promptVersion: 'support-agent-v2', configRevision: 1 }),
    })
    // Salvaged on the first attempt; no retry needed.
    expect(mockChat).toHaveBeenCalledTimes(1)
  })
})

describe('runAssistantTurn: customer-scoped retrieval context (P2-A.4)', () => {
  /** Drives the model to call search_knowledge once, capturing the ctx it ran under. */
  function driveSearch(onSearch: (ctx: unknown) => void) {
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (args: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          onSearch(opts.context)
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          const report = opts.tools.find((t) => t.name === 'report_inability')!
          await search.execute(
            { query: 'billing' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          await report.execute(
            { reason: 'no_relevant_sources' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({ text: 'ok', citations: [] })
        })()
    )
  }

  it("resolves the conversation's visitorPrincipalId (narrow customer_support lookup) and threads it into the tool context", async () => {
    mockRetrieve.mockResolvedValue([])
    mockConversationLookupLimit.mockResolvedValue([{ visitorPrincipalId: 'principal_customer_1' }])
    let capturedCtx: { customerPrincipalId?: unknown; conversationId?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    // The narrow (customer_support) lookup resolves the visitor and threads it
    // onto the tool context. The past-conversation-summaries source itself is
    // Copilot-only (D8), so a customer_support turn never registers it — that
    // threading-into-retrieval path is covered by the copilot test below.
    expect(capturedCtx?.customerPrincipalId).toBe('principal_customer_1')
    expect(capturedCtx?.conversationId).toBe('conversation_42')
    expect(mockConversationSummariesRetrieve).not.toHaveBeenCalled()
  })

  it('never queries the conversation row when there is no conversationId (sandbox)', async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { customerPrincipalId?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({ ...baseInput, messages: customerAsks('question') })

    expect(mockConversationLookupLimit).not.toHaveBeenCalled()
    expect(capturedCtx?.customerPrincipalId).toBeUndefined()
  })

  it('leaves customerPrincipalId undefined when the conversation row is not found', async () => {
    mockRetrieve.mockResolvedValue([])
    mockConversationLookupLimit.mockResolvedValue([])
    let capturedCtx: { customerPrincipalId?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_missing' as never,
    })

    expect(capturedCtx?.customerPrincipalId).toBeUndefined()
  })

  it('threads sourceTypes onto the tool context for search_knowledge to forward', async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { sourceTypes?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      sourceTypes: ['snippet', 'summary'],
    })

    expect(capturedCtx?.sourceTypes).toEqual(['snippet', 'summary'])
  })

  it('defaults sourceTypes to undefined when the caller omits it', async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { sourceTypes?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({ ...baseInput, messages: customerAsks('question') })

    expect(capturedCtx?.sourceTypes).toBeUndefined()
  })

  it('keeps explicit simulation simulated even with a real conversationId', async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { simulate?: unknown; writeToolPolicy?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
      simulate: true,
    })

    expect(capturedCtx?.simulate).toBe(true)
    expect(capturedCtx?.writeToolPolicy).toBe('simulate')
  })

  it('defaults simulate to false for a real conversationId when the caller omits it (unchanged orchestrator behavior)', async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { simulate?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(capturedCtx?.simulate).toBe(false)
  })

  it("executes customer-support writes autonomously through the role-owned 'execute' policy", async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { writeToolPolicy?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(capturedCtx?.writeToolPolicy).toBe('execute')
  })

  it("forces Copilot Q&A writes to approval through the role-owned 'propose' policy", async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { writeToolPolicy?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(capturedCtx?.writeToolPolicy).toBe('propose')
  })

  it('disables writes for the suggested-reply role', async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { writeToolPolicy?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...suggestedReplyInput,
    })

    expect(capturedCtx?.writeToolPolicy).toBe('disabled')
  })

  it('surfaces ctx.ledger.proposedActions on the result (P2-C.4), mirroring ctx.ledger.sources for citations', async () => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation((opts: { context: { ledger: { proposedActions: unknown[] } } }) =>
      (async function* () {
        // Stands in for what the approval branch of runWithPipeline does
        // (assistant.tools.ts): this file exercises the runtime's plumbing
        // of the ledger onto the result, not the pipeline logic itself
        // (covered end to end in assistant.tools.test.ts).
        opts.context.ledger.proposedActions.push({
          id: 'assistant_action_1',
          toolName: 'end_conversation',
          summary: 'Close the conversation',
        })
        yield* completeRun({ text: 'ok', citations: [] })
      })()
    )

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(result).toMatchObject({
      proposedActions: [
        {
          id: 'assistant_action_1',
          toolName: 'end_conversation',
          summary: 'Close the conversation',
        },
      ],
    })
  })

  it('defaults proposedActions to an empty array when nothing was proposed', async () => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('question') })

    expect(result).toMatchObject({ proposedActions: [] })
  })
})

describe('runAssistantTurn: ticket-scoped grounding (unified inbox §2.9)', () => {
  function systemPromptsFromLastCall(): string[] {
    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    return opts.systemPrompts
  }

  function modelMessagesFromLastCall(): Array<{ role: string; content: string }> {
    const opts = mockChat.mock.calls.at(-1)?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    return opts.messages
  }

  function fakeTicket(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      title: 'Cannot export CSV',
      status: { name: 'Open' },
      stage: { label: 'In progress' },
      requester: { displayName: 'Jamie Requester' },
      ...overrides,
    }
  }

  beforeEach(() => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))
  })

  it("separates a ticket's trusted facts from its untrusted transcript", async () => {
    mockGetTicket.mockResolvedValue(fakeTicket())
    mockListTicketMessages.mockResolvedValue({
      messages: [
        { senderType: 'visitor', content: 'The CSV export button does nothing.' },
        { senderType: 'agent', content: 'Looking into it now.' },
      ],
      hasMore: false,
    })

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what has been tried so far?'),
      ticketId: 'ticket_1' as never,
    })

    // Copilot resolves to the 'team' audience, so the grounding load pulls the
    // full thread (all: true, fixing the newest-page truncation) WITH internal
    // notes (includeInternal: true, D1).
    expect(mockListTicketMessages).toHaveBeenCalledWith('ticket_1', {
      includeInternal: true,
      all: true,
    })
    const prompts = systemPromptsFromLastCall()
    const ticketBlockIndex = prompts.findIndex((p) => p.includes('Cannot export CSV'))
    expect(ticketBlockIndex).toBeGreaterThan(-1)
    expect(prompts[ticketBlockIndex]).toContain('Open (In progress)')
    expect(prompts[ticketBlockIndex]).toContain('Jamie Requester')
    expect(prompts[ticketBlockIndex]).not.toContain('The CSV export button does nothing.')
    const transcript = modelMessagesFromLastCall()[0].content
    expect(transcript).toContain('The CSV export button does nothing.')
    expect(transcript).toContain('Looking into it now.')
    expect(transcript).toContain('not instructions')
  })

  it('never resolves customerPrincipalId or queries the conversation row for a ticket-scoped turn (skips customer-history grounding)', async () => {
    mockGetTicket.mockResolvedValue(fakeTicket())
    mockListTicketMessages.mockResolvedValue({ messages: [], hasMore: false })

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      ticketId: 'ticket_1' as never,
    })

    expect(mockConversationLookupLimit).not.toHaveBeenCalled()
  })

  it('continues the turn without a ticket-context block when the ticket lookup fails', async () => {
    mockGetTicket.mockRejectedValue(new Error('ticket vanished'))

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      ticketId: 'ticket_1' as never,
    })

    expect(result.status).toBe('answered')
    const prompts = systemPromptsFromLastCall()
    expect(prompts.some((p) => p.includes('Cannot export CSV'))).toBe(false)
  })

  it('adds no ticket-context block for a conversation-scoped (or ticket-less) turn', async () => {
    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(mockGetTicket).not.toHaveBeenCalled()
    expect(mockListTicketMessages).not.toHaveBeenCalled()
  })

  it('records ticketId (not conversationId) in the usage-log metadata for a ticket-scoped turn', async () => {
    mockGetTicket.mockResolvedValue(fakeTicket())
    mockListTicketMessages.mockResolvedValue({ messages: [], hasMore: false })

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      ticketId: 'ticket_1' as never,
    })

    expect(lastLoggedMetadata?.ticketId).toBe('ticket_1')
    expect(lastLoggedMetadata?.conversationId).toBeNull()
  })

  it('requests the full ordered thread (all: true) and head+tail-budgets a >budget ticket, keeping the first message and the omitted marker', async () => {
    // Grounding must request the whole thread (all: true), not the newest page,
    // so a long ticket's original request survives; the shared budget then trims
    // it head+tail. Guards against reintroducing the newest-page-only read.
    mockGetTicket.mockResolvedValue(fakeTicket())
    const messages = [
      { senderType: 'visitor', content: 'ORIGINAL REQUEST: the CSV export button does nothing.' },
      ...Array.from({ length: 300 }, (_, i) => ({
        senderType: i % 2 === 0 ? 'agent' : 'visitor',
        content: `filler message ${i} ${'x'.repeat(40)}`,
      })),
      { senderType: 'agent', content: 'MOST RECENT: shipping a fix today.' },
    ]
    mockListTicketMessages.mockResolvedValue({ messages, hasMore: false })

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what was first asked?'),
      ticketId: 'ticket_1' as never,
    })

    expect(mockListTicketMessages).toHaveBeenCalledWith('ticket_1', {
      includeInternal: true,
      all: true,
    })
    const transcript = modelMessagesFromLastCall()[0].content
    expect(transcript).toContain('ORIGINAL REQUEST: the CSV export button does nothing.')
    expect(transcript).toContain('MOST RECENT: shipping a fix today.')
    expect(transcript).toContain('earlier messages omitted')
    expect(transcript).not.toContain('filler message 150')
  })
})

describe('runAssistantTurn: conversation-scoped grounding (copilot conversation surface)', () => {
  function systemPromptsFromLastCall(): string[] {
    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    return opts.systemPrompts
  }

  function modelMessagesFromLastCall(): Array<{ role: string; content: string }> {
    const opts = mockChat.mock.calls.at(-1)?.[0] as {
      messages: Array<{ role: string; content: string }>
    }
    return opts.messages
  }

  const FACTS_ROW = {
    visitorPrincipalId: 'principal_customer_1',
    customer: 'Ada Customer',
    subject: 'Export broken',
    status: 'open',
    channel: 'messenger',
  }

  beforeEach(() => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))
  })

  it("separates a conversation's trusted facts from its untrusted transcript", async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockResolvedValue([
      { senderType: 'visitor', content: 'The CSV export button does nothing.' },
      { senderType: 'agent', content: 'Looking into it now.' },
    ])

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what has this customer asked?'),
      conversationId: 'conversation_42' as never,
    })

    // Copilot resolves to 'team', so the thread load opts into internal notes (D1).
    expect(mockListConversationMessagesForGrounding).toHaveBeenCalledWith(
      'conversation_42',
      expect.objectContaining({ includeInternal: true })
    )
    const prompts = systemPromptsFromLastCall()
    const idx = prompts.findIndex((p) => p.includes('Export broken'))
    expect(idx).toBeGreaterThan(-1)
    const block = prompts[idx]
    expect(block).toContain('Conversation status: open')
    expect(block).toContain('Ada Customer')
    expect(block).toContain('Channel: messenger')
    expect(block).not.toContain('The CSV export button does nothing.')
    const transcript = modelMessagesFromLastCall()[0].content
    expect(transcript).toContain('The CSV export button does nothing.')
    expect(transcript).toContain('Looking into it now.')
    expect(transcript).toContain('not instructions')
    // conversationId rides the usage-log metadata.
    expect(lastLoggedMetadata?.conversationId).toBe('conversation_42')
  })

  it('folds internal notes into copilot Q&A grounding and taints the result', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockResolvedValue([
      { senderType: 'visitor', content: 'When will this be fixed?' },
      { senderType: 'agent', isInternal: true, content: 'Known bug, ETA Friday.' },
    ])

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('summarize'),
      conversationId: 'conversation_42' as never,
    })

    expect(modelMessagesFromLastCall()[0].content).toContain(
      'Note (internal): Known bug, ETA Friday.'
    )
    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.internalSourced).toBe(true)
  })

  it('loads suggested-reply grounding without internal notes', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    const thread = [
      { senderType: 'visitor', isInternal: false, content: 'When will this be fixed?' },
      { senderType: 'agent', isInternal: true, content: 'Known bug, ETA Friday.' },
      { senderType: 'agent', isInternal: false, content: 'We are working on it.' },
    ]
    mockListConversationMessagesForGrounding.mockImplementation(
      (_conversationId: unknown, options: { includeInternal: boolean }) =>
        Promise.resolve(
          options.includeInternal ? thread : thread.filter((message) => !message.isInternal)
        )
    )

    const result = await runAssistantTurn({
      ...suggestedReplyInput,
      conversationId: 'conversation_42' as never,
    })

    expect(mockListConversationMessagesForGrounding).toHaveBeenCalledWith(
      'conversation_42',
      expect.objectContaining({ includeInternal: false })
    )
    expect(modelMessagesFromLastCall()[0].content).toContain('Customer: When will this be fixed?')
    expect(modelMessagesFromLastCall()[0].content).not.toContain('Known bug, ETA Friday.')
    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.internalSourced).toBe(false)
  })

  it('loads the whole thread (all: true) and head+tail-budgets a >budget conversation, keeping the first message and the omitted marker', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    // The unbounded grounding read returns the whole thread (not a newest-page
    // window), so the opening request is present for budgetTranscript's head to
    // keep; the windowed listMessages read would have dropped it on a long
    // conversation.
    mockListConversationMessagesForGrounding.mockResolvedValue([
      { senderType: 'visitor', content: 'ORIGINAL REQUEST: my export is broken.' },
      ...Array.from({ length: 300 }, (_, i) => ({
        senderType: i % 2 === 0 ? 'agent' : 'visitor',
        content: `filler message ${i} ${'x'.repeat(40)}`,
      })),
      { senderType: 'agent', content: 'MOST RECENT: fix shipping today.' },
    ])

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('what was first asked?'),
      conversationId: 'conversation_42' as never,
    })

    // The grounding read was asked for the full thread, not a page.
    expect(mockListConversationMessagesForGrounding).toHaveBeenCalledWith(
      'conversation_42',
      expect.objectContaining({ includeInternal: true })
    )
    const transcript = modelMessagesFromLastCall()[0].content
    expect(transcript).toContain('ORIGINAL REQUEST: my export is broken.')
    expect(transcript).toContain('MOST RECENT: fix shipping today.')
    expect(transcript).toContain('earlier messages omitted')
    expect(transcript).not.toContain('filler message 150')
  })

  it('continues the turn without a conversation-context block when the thread load fails', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockRejectedValue(new Error('thread read failed'))

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(result.status).toBe('answered')
    expect(systemPromptsFromLastCall().some((p) => p.includes('Export broken'))).toBe(false)
  })

  it('adds no conversation-context block for a sandbox turn (neither conversationId nor ticketId)', async () => {
    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
    })

    expect(mockConversationLookupLimit).not.toHaveBeenCalled()
    expect(mockListConversationMessagesForGrounding).not.toHaveBeenCalled()
    expect(systemPromptsFromLastCall().some((p) => p.startsWith('Conversation'))).toBe(false)
  })

  it('adds no conversation-context block on a customer-facing widget turn (grounding is copilot-only)', async () => {
    mockConversationLookupLimit.mockResolvedValue([{ visitorPrincipalId: 'principal_customer_1' }])

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
      // default surface: widget
    })

    // The customer lookup still runs (for customer-history retrieval), but the
    // thread is never loaded for grounding and no block is injected.
    expect(mockListConversationMessagesForGrounding).not.toHaveBeenCalled()
    expect(systemPromptsFromLastCall().some((p) => p.startsWith('Conversation'))).toBe(false)
  })

  it('adds no conversation-context block when the thread renders empty (system events only)', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    // Only system status events: nothing customer- or agent-authored to ground on.
    mockListConversationMessagesForGrounding.mockResolvedValue([
      { senderType: 'system', content: 'Conversation assigned.' },
    ])

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(systemPromptsFromLastCall().some((p) => p.startsWith('Conversation'))).toBe(false)
  })

  it('keeps the customer-history retrieval source excluding the current conversation (unchanged)', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockResolvedValue([])
    // Copilot's default knowledge map enables pastConversations, so the
    // summary source registers without any override.
    let capturedCtx: { customerPrincipalId?: unknown; conversationId?: unknown } | undefined
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (a: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          capturedCtx = opts.context as typeof capturedCtx
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          const report = opts.tools.find((t) => t.name === 'report_inability')!
          await search.execute(
            { query: 'billing' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          await report.execute(
            { reason: 'no_relevant_sources' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({ text: 'ok', citations: [] })
        })()
    )

    await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    // The current conversation is still passed as the exclusion key to the
    // past-conversation-summaries source (which excludes it by design).
    expect(mockConversationSummariesRetrieve).toHaveBeenCalledWith(
      'billing',
      'team',
      expect.objectContaining({
        customerPrincipalId: 'principal_customer_1',
        conversationId: 'conversation_42',
      })
    )
    expect(capturedCtx?.conversationId).toBe('conversation_42')
  })
})

describe('runAssistantTurn: V2 prompt and config snapshot', () => {
  function systemPromptsFromLastCall(): string[] {
    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    return opts.systemPrompts
  }

  it('applies dynamic identity and customer voice even when assistantTools is disabled', async () => {
    const identity = {
      name: 'Nova',
      avatarUrl: 'https://cdn.example.com/nova.png',
    }
    mockRuntimeConfig({
      revision: 12,
      workspaceName: 'Acme',
      actionsEnabled: false,
      config: {
        identity,
        voice: {
          tone: 'warm',
          responseLength: 'brief',
          additionalInstructions: 'Call customers members.',
        },
      },
    })
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    const prompt = systemPromptsFromLastCall().join('\n')
    expect(prompt).toContain("You are Nova, Acme's AI customer-support agent")
    expect(prompt).toContain('Use a warm, approachable tone.')
    expect(prompt).toContain('Prefer the shortest complete answer.')
    expect(prompt).toContain('Call customers members.')
    expect(result).toMatchObject({
      identity,
      trace: {
        promptVersion: 'support-agent-v2',
        configRevision: 12,
        role: 'customer_support',
        tone: 'warm',
        responseLength: 'brief',
        appliedGuidance: [],
      },
    })
    expect(lastLoggedMetadata).toMatchObject({
      promptVersion: 'support-agent-v2',
      configRevision: 12,
      role: 'customer_support',
      tone: 'warm',
      responseLength: 'brief',
    })
    expect(mockAssembleAssistantToolset).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantName: 'Nova',
        // The Agent's default knowledge map (helpCenter only among retrieval
        // sources) compiles to this snapshot on a customer_support turn.
        knowledge: { sources: new Set(['article']), status: false },
      }),
      undefined,
      false
    )
  })

  it('keeps copilot Q&A isolated from customer identity and voice configuration', async () => {
    mockRuntimeConfig({
      workspaceName: 'Acme',
      config: {
        identity: { name: 'Nova', avatarUrl: null },
        voice: {
          tone: 'warm',
          responseLength: 'brief',
          additionalInstructions: 'Call customers members.',
        },
      },
    })
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    const result = await runAssistantTurn({
      ...copilotQaInput,
      messages: customerAsks('Summarize this issue.'),
    })

    const prompt = systemPromptsFromLastCall().join('\n')
    expect(prompt).toContain('AI copilot assisting a support teammate')
    expect(prompt).not.toContain("Nova, Acme's")
    expect(prompt).not.toContain('# Customer-facing voice')
    expect(prompt).not.toContain('Call customers members.')
    expect(result.status !== 'suppressed' && result.trace).toMatchObject({
      role: 'copilot_qa',
      appliedGuidance: [],
    })
    expect(result.status !== 'suppressed' && result.trace).not.toHaveProperty('tone')
    expect(lastLoggedMetadata).not.toHaveProperty('tone')
    expect(lastLoggedMetadata).not.toHaveProperty('responseLength')
  })

  it('keeps one-time workflow instructions when the V2 config read fails', async () => {
    mockGetAssistantRuntimeConfig.mockRejectedValue(new Error('settings row corrupt'))
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('hi'),
      stepInstructions: 'Focus only on billing questions.',
    })

    expect(systemPromptsFromLastCall().join('\n')).toContain('Focus only on billing questions.')
    expect(result).toMatchObject({
      identity: DEFAULT_RUNTIME_CONFIG.config.identity,
      trace: expect.objectContaining({
        configRevision: 1,
        configFallbackReason: 'database_read_failed',
      }),
    })
    expect(lastLoggedMetadata?.configFallbackReason).toBe('database_read_failed')
  })

  it('scopes guidance candidates by the resolved agent', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })
    expect(mockListEnabledGuidanceCandidates).toHaveBeenLastCalledWith({
      agent: 'agent',
    })

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'email' })
    expect(mockListEnabledGuidanceCandidates).toHaveBeenLastCalledWith({
      agent: 'agent',
    })
  })
})

describe('runAssistantTurn: attribute catalogue injection (P0)', () => {
  function systemPromptsFromLastCall(): string[] {
    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    return opts.systemPrompts
  }

  const fakeDefinitions = [
    {
      key: 'issue_type',
      label: 'Issue type',
      description: 'What the conversation is about.',
      fieldType: 'select' as const,
      options: [{ id: 'opt_billing', label: 'Billing', description: null }],
    },
  ]

  it('flag off (set_attribute not active): never fetches the catalogue', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(mockListConversationAttributes).not.toHaveBeenCalled()
    expect(systemPromptsFromLastCall().join('\n')).not.toContain('# Workspace attribute catalogue')
  })

  it('flag on (set_attribute active): fetches and injects the live catalogue', async () => {
    mockActionsFlag(true)
    mockListConversationAttributes.mockResolvedValue(fakeDefinitions)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(mockListConversationAttributes).toHaveBeenCalledTimes(1)
    const prompts = systemPromptsFromLastCall()
    expect(prompts.join('\n')).toContain('# Workspace attribute catalogue')
    expect(prompts.join('\n')).toContain('issue_type')
    expect(prompts.join('\n')).toContain('opt_billing')
  })

  it('flag on but no definitions exist: no workspace-attributes section is added', async () => {
    mockActionsFlag(true)
    mockListConversationAttributes.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(systemPromptsFromLastCall().join('\n')).not.toContain('# Workspace attribute catalogue')
  })
})

describe('runAssistantTurn: registry-derived tool activity (E-6)', () => {
  it('surfaces a tool-call activity for any name present in the assembled tool set', async () => {
    mockAssembleAssistantToolset.mockResolvedValue({
      tools: [{ name: 'future_tool', description: 'x', execute: async () => ({}) }],
      activeSpecs: [{ name: 'future_tool', promptGuidance: 'Use it for the future thing.' }],
    })
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
    mockAssembleAssistantToolset.mockResolvedValue({
      tools: [{ name: 'search_knowledge', description: 'x', execute: async () => ({}) }],
      activeSpecs: [{ name: 'search_knowledge', promptGuidance: 'x' }],
    })
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

describe('runAssistantTurn: widget tool set (get_conversation_context removal)', () => {
  it('never assembles get_conversation_context for the widget surface (the full thread is already in messages)', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'widget' })

    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    expect(opts.systemPrompts.join('\n')).not.toContain('get_conversation_context')
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
