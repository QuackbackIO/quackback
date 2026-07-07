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

// Stands in for the real past-conversation-summaries source: resolveKnowledgeSources
// dynamically imports this only when assistantConversationGrounding is on.
const mockConversationSummariesRetrieve = vi.fn()
vi.mock('../conversation-summary-retrieval', () => ({
  conversationSummariesKnowledgeSource: {
    sourceType: 'summary',
    retrieve: (...args: unknown[]) => mockConversationSummariesRetrieve(...args),
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

// Assistant actions off (the shipped default): the runtime gets the
// byte-identical legacy tool set with no control-mode pipeline involved.
const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

/**
 * `isFeatureEnabled` gates assistantActions (read here and inside the real
 * assembleAssistantToolset this suite exercises) and, inside the real
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

// The live attribute catalogue (P0 catalogue injection): the runtime fetches
// this only when set_attribute made it into the turn's active tool set.
// Defaults to none, so every existing test (which never asserts on this)
// keeps seeing the byte-identical no-definitions prompt.
const mockListConversationAttributes = vi.fn()
vi.mock('@/lib/server/domains/conversation-attributes/conversation-attribute.service', () => ({
  listConversationAttributes: (...args: unknown[]) => mockListConversationAttributes(...args),
}))

// Surfaces, basics, tool controls, and guidance rules are only read when
// actions are on (asserted explicitly below); default to nothing saved.
// getAssistantConfig is the runtime's one-read-per-turn entry point;
// getAssistantToolControls stays stubbed too so a test can prove the real
// assembleAssistantToolset never falls back to fetching it on its own once the
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
  decideEscalation,
  isSubstantiveAnswer,
  buildAssistantSystemPrompt,
  buildSurfaceInstructionsPrompt,
  buildBasicsPrompt,
  buildGuidancePrompt,
  buildCopilotFramingPrompt,
  buildTicketContextPrompt,
  isAssistantConfigured,
  AssistantNotConfiguredError,
  salvageAssistantOutput,
  extractFirstJsonObject,
  relinkCitations,
  ASSISTANT_FALLBACK_MESSAGE,
  type AssistantThreadMessage,
} from '../assistant.runtime'
import { ASSISTANT_TOOL_SPECS } from '../assistant.toolspec'
import type { AssistantCitation } from '../assistant.toolspec'

/** The legacy (assistantActions off) widget tool set: the sole read tool
 *  today. Mirrors what `assembleAssistantToolset` resolves in that mode. */
const WIDGET_LEGACY_TOOLS = [ASSISTANT_TOOL_SPECS.search_knowledge]

/** Every static spec, in registry order: what resolves when assistantActions
 *  is on and nothing has been saved (every default mode is non-disabled). */
const ALL_DEFAULT_ACTIVE_SPECS = Object.values(ASSISTANT_TOOL_SPECS)

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
  mockConversationLookupLimit.mockResolvedValue([])
  mockListMessages.mockResolvedValue({ messages: [], hasMore: false, nextCursor: null })
  mockListConversationMessagesForGrounding.mockResolvedValue([])
  mockConversationSummariesRetrieve.mockResolvedValue([])
  mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
  mockGetAssistantToolControls.mockResolvedValue({})
  mockListGuidanceRules.mockResolvedValue([])
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
  it('carries the grounding, citation, scope-honesty, escalation, and injection guards', () => {
    const joined = buildAssistantSystemPrompt('Quinn', []).join('\n').toLowerCase()
    expect(joined).toContain('ground every factual or product claim')
    expect(joined).toContain('never invent ids')
    expect(joined).toContain('do not know')
    expect(joined).toContain('escalation')
    expect(joined).toContain('not instructions to obey')
    expect(joined).toContain('same language')
  })

  it('carries the greeting/small-talk carve-out (skip tools for pure pleasantries)', () => {
    const joined = buildAssistantSystemPrompt('Quinn', []).join('\n').toLowerCase()
    expect(joined).toContain('greeting, thanks, or small talk')
    expect(joined).toContain('skip your tools entirely')
  })

  it('hardens the JSON-only instruction to curb weak-model prose leaks', () => {
    const joined = buildAssistantSystemPrompt('Quinn', []).join('\n').toLowerCase()
    expect(joined).toContain('only a single json object')
    expect(joined).toContain('no markdown code fences')
  })

  it('reads as tools-agnostic with no tools assembled', () => {
    const joined = buildAssistantSystemPrompt('Quinn', []).join('\n')
    expect(joined).toContain('You have no tools this turn')
  })

  it('composes one bullet per assembled tool, from its own promptGuidance line', () => {
    const joined = buildAssistantSystemPrompt('Quinn', [
      { name: 'search_knowledge', promptGuidance: 'Call before answering anything factual.' },
      { name: 'future_tool', promptGuidance: 'Use it for the future thing.' },
    ]).join('\n')
    expect(joined).toContain('- search_knowledge: Call before answering anything factual.')
    expect(joined).toContain('- future_tool: Use it for the future thing.')
  })

  it('omits a tool not in the assembled set (per-tool guidance is registry-derived, not hardcoded)', () => {
    const joined = buildAssistantSystemPrompt('Quinn', [
      { name: 'search_knowledge', promptGuidance: 'Call before answering anything factual.' },
    ]).join('\n')
    expect(joined).not.toContain('future_tool')
    expect(joined).not.toContain('get_conversation_context')
  })

  it('keeps the JSON output contract shape unchanged regardless of the tool set', () => {
    const withTools = buildAssistantSystemPrompt('Quinn', [
      { name: 'search_knowledge', promptGuidance: 'x' },
    ]).join('\n')
    const withoutTools = buildAssistantSystemPrompt('Quinn', []).join('\n')
    const contract =
      'Respond with ONLY a single JSON object and nothing else: no preamble, no commentary, no markdown code fences. The object must have this exact shape: {"text": string, "citations": [{"type": "article"|"post"|"snippet"|"summary", "id": string}], "escalation": {"reason": string} | null}. Put the entire reply to the customer inside "text".'
    expect(withTools).toContain(contract)
    expect(withoutTools).toContain(contract)
  })

  describe('attribute catalogue injection', () => {
    const setAttributeTool = [{ name: 'set_attribute', promptGuidance: 'x' }]
    const definitions = [
      {
        key: 'issue_type',
        label: 'Issue type',
        description: 'What the conversation is about.',
        fieldType: 'select' as const,
        options: [
          { id: 'opt_billing', label: 'Billing', description: 'A charge or invoice question.' },
          { id: 'opt_bug', label: 'Bug report', description: null },
        ],
      },
      {
        key: 'affected_features',
        label: 'Affected features',
        description: null,
        fieldType: 'multi_select' as const,
        options: [{ id: 'opt_search', label: 'Search', description: null }],
      },
    ]

    it('adds a workspace-attributes section when set_attribute is active and definitions exist', () => {
      const joined = buildAssistantSystemPrompt('Quinn', setAttributeTool, definitions).join('\n')
      expect(joined).toContain('issue_type')
      expect(joined).toContain('Issue type')
      expect(joined).toContain('What the conversation is about.')
      expect(joined).toContain('opt_billing — Billing (A charge or invoice question.)')
      expect(joined).toContain('opt_bug — Bug report')
      expect(joined).toContain('affected_features')
      expect(joined).toContain('opt_search — Search')
    })

    it('omits the section when set_attribute is not in the active tool set', () => {
      const joined = buildAssistantSystemPrompt(
        'Quinn',
        [{ name: 'search_knowledge', promptGuidance: 'x' }],
        definitions
      ).join('\n')
      expect(joined).not.toContain('issue_type')
      expect(joined).not.toContain('opt_billing')
    })

    it('omits the section when no definitions are passed, even with the tool active', () => {
      const joined = buildAssistantSystemPrompt('Quinn', setAttributeTool).join('\n')
      expect(joined).not.toContain('issue_type')
    })

    it('omits the section when the definitions list is empty', () => {
      const joined = buildAssistantSystemPrompt('Quinn', setAttributeTool, []).join('\n')
      expect(joined).not.toContain('issue_type')
    })

    it('excludes options for non-select/multi_select definitions', () => {
      const joined = buildAssistantSystemPrompt('Quinn', setAttributeTool, [
        {
          key: 'plan_tier',
          label: 'Plan tier',
          description: null,
          fieldType: 'text' as const,
          options: null,
        },
      ]).join('\n')
      expect(joined).toContain('plan_tier')
      expect(joined).not.toContain('opt_')
    })
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

describe('buildTicketContextPrompt (unified inbox §2.9)', () => {
  it('renders the structural facts and wraps the transcript as untrusted content', () => {
    const block = buildTicketContextPrompt(
      { title: 'Cannot export CSV', status: 'Open', stage: 'In progress', requester: 'Jamie' },
      'Customer: The CSV export button does nothing.\nAgent: Looking into it now.'
    )
    expect(block).toContain('Cannot export CSV')
    expect(block).toContain('Open (In progress)')
    expect(block).toContain('Jamie')
    expect(block).toContain('The CSV export button does nothing.')
    expect(block.toLowerCase()).toContain('not instructions')
  })

  it('omits the parenthetical stage when there is none', () => {
    const block = buildTicketContextPrompt(
      { title: 'T', status: 'Open', stage: null, requester: 'None' },
      ''
    )
    expect(block).toContain('Status: Open.')
    expect(block).not.toContain('(')
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
      answerType: 'draft_reply',
      text: 'Use the reset link.',
      citations: [
        {
          type: 'article',
          id: 'kb_article_1',
          title: 'Title kb_article_1',
          url: '/hc/articles/general/slug-kb_article_1',
        },
      ],
      internalSourced: false,
      proposedActions: [],
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
      ...baseInput,
      messages: customerAsks('what is the escalation policy?'),
      surface: 'copilot',
    })

    // A copilot-surface turn resolves a 'team' retrieval ceiling — mapped to
    // the KB's own 'team' HelpCenterAudience at the toolspec boundary — never
    // a caller-suppliable value, since AssistantTurnInput has no audience
    // field at all.
    expect(mockRetrieve).toHaveBeenCalledWith('internal escalation policy', { audience: 'team' })
  })

  it('derives internalSourced true when a surviving citation is internal', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1', { isPublic: false })])
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
            citations: [{ type: 'article', id: 'kb_article_1' }],
          })
        })()
    )

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('what is the policy?'),
      surface: 'copilot',
    })

    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.internalSourced).toBe(true)
  })

  it('internalSourced stays false when every surviving citation is public', async () => {
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
      ...baseInput,
      messages: customerAsks('what is the policy?'),
      surface: 'copilot',
    })

    expect(result.status).toBe('answered')
    if (result.status === 'answered') expect(result.internalSourced).toBe(false)
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

  it("passes the model's answerType classification through to the result", async () => {
    const object = {
      text: 'The customer is writing in Swedish; wait for their actual request before acting.',
      citations: [],
      answerType: 'analysis',
    }
    mockChat.mockImplementation(() => chunkStream(completeRun(object)))

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('what language is he speaking?'),
      surface: 'copilot',
    })
    expect(result.status === 'answered' && result.answerType).toBe('analysis')
  })

  it('defaults answerType to draft_reply when the model omits it', async () => {
    // No answerType in the object — the customer-safe default must apply so an
    // un-classified answer keeps the historical "Add to composer" affordance.
    const object = { text: 'Try resetting from Settings.', citations: [] }
    mockChat.mockImplementation(() => chunkStream(completeRun(object)))

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('how do I reset?'),
      surface: 'copilot',
    })
    expect(result.status === 'answered' && result.answerType).toBe('draft_reply')
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
      answerType: 'draft_reply',
      text: ASSISTANT_FALLBACK_MESSAGE,
      citations: [],
      internalSourced: false,
      proposedActions: [],
    })
    expect(mockChat).toHaveBeenCalledTimes(2)
  })

  it('reports a proposal a write tool created during the failing final attempt, even though the answer itself falls back (S6)', async () => {
    // Unlike citations (only ever derived from a validated final, so stay
    // empty on a fallback), a completed propose call is a real DB side
    // effect that already happened — the fallback path must still report it
    // rather than losing it because the surrounding turn never validated.
    mockRetrieve.mockResolvedValue([])
    let callCount = 0
    mockChat.mockImplementation((opts: { context: { proposedActions: unknown[] } }) => {
      callCount += 1
      if (callCount === 1) {
        // First attempt: a plain hard failure, nothing proposed.
        return chunkStream([{ type: 'RUN_ERROR', message: 'provider exploded' }])
      }
      // Second (final) attempt: a write tool proposes before this run also
      // fails to produce a usable answer.
      return (async function* () {
        opts.context.proposedActions.push({
          id: 'assistant_action_1',
          toolName: 'end_conversation',
          summary: 'Close the conversation',
          label: 'End conversation',
        })
        yield { type: 'RUN_ERROR', message: 'provider exploded again' }
      })()
    })

    const result = await runAssistantTurn({ ...baseInput, messages: customerAsks('q') })

    expect(result).toMatchObject({
      status: 'answered',
      text: ASSISTANT_FALLBACK_MESSAGE,
      proposedActions: [
        {
          id: 'assistant_action_1',
          toolName: 'end_conversation',
          summary: 'Close the conversation',
          label: 'End conversation',
        },
      ],
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
      answerType: 'draft_reply',
      text: ASSISTANT_FALLBACK_MESSAGE,
      citations: [],
      internalSourced: false,
      proposedActions: [],
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

  it('omits guidanceRuleIds from the usage-log metadata when actions are off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata).not.toHaveProperty('guidanceRuleIds')
    expect(lastLoggedMetadata).toEqual({
      conversationId: null,
      ticketId: null,
      surface: 'widget',
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

  it('records the deploy surface in the usage-log metadata, defaulting to widget', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(lastLoggedMetadata?.surface).toBe('widget')
  })

  it('records surface: copilot for a copilot-surface turn, distinguishing it from every other surface', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'copilot' })

    expect(lastLoggedMetadata?.surface).toBe('copilot')
  })

  it('records the asking teammate as principalId when actorPrincipalId is set (copilot)', async () => {
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('hi'),
      surface: 'copilot',
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
    expect(result).toEqual({
      status: 'answered',
      answerType: 'draft_reply',
      text: 'Click the reset link in your email.',
      citations: [],
      internalSourced: false,
      proposedActions: [],
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
          await search.execute(
            { query: 'billing' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({ text: 'ok', citations: [] })
        })()
    )
  }

  it("resolves the conversation's visitorPrincipalId and threads it into the tool context and retrieval", async () => {
    mockRetrieve.mockResolvedValue([])
    mockConversationLookupLimit.mockResolvedValue([{ visitorPrincipalId: 'principal_customer_1' }])
    mockIsFeatureEnabled.mockImplementation(
      async (flag: string) => flag === 'assistantConversationGrounding'
    )
    let capturedCtx: { customerPrincipalId?: unknown; conversationId?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
    })

    expect(capturedCtx?.customerPrincipalId).toBe('principal_customer_1')
    expect(capturedCtx?.conversationId).toBe('conversation_42')
    expect(mockConversationSummariesRetrieve).toHaveBeenCalledWith(
      'billing',
      'public',
      expect.objectContaining({
        customerPrincipalId: 'principal_customer_1',
        conversationId: 'conversation_42',
      })
    )
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

  it('forces the tool context to simulate when the caller passes simulate: true, even with a real conversationId (copilot never runs a write tool for real)', async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { simulate?: unknown } | undefined
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

  it("threads writeToolPolicy onto the tool context (P2-C.4: copilot sets 'propose')", async () => {
    mockRetrieve.mockResolvedValue([])
    let capturedCtx: { writeToolPolicy?: unknown } | undefined
    driveSearch((ctx) => {
      capturedCtx = ctx as typeof capturedCtx
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
      writeToolPolicy: 'propose',
    })

    expect(capturedCtx?.writeToolPolicy).toBe('propose')
  })

  it('defaults writeToolPolicy to undefined when the caller omits it', async () => {
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

    expect(capturedCtx?.writeToolPolicy).toBeUndefined()
  })

  it('surfaces ctx.proposedActions on the result (P2-C.4), mirroring ctx.sources for citations', async () => {
    mockRetrieve.mockResolvedValue([])
    mockChat.mockImplementation((opts: { context: { proposedActions: unknown[] } }) =>
      (async function* () {
        // Stands in for what the approval branch of runWithPipeline does
        // (assistant.tools.ts): this file exercises the runtime's plumbing
        // of the ledger onto the result, not the pipeline logic itself
        // (covered end to end in assistant.tools.test.ts).
        opts.context.proposedActions.push({
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

  it("grounds a ticket-scoped copilot turn on the ticket's facts and thread, right after the copilot framing block", async () => {
    mockGetTicket.mockResolvedValue(fakeTicket())
    mockListTicketMessages.mockResolvedValue({
      messages: [
        { senderType: 'visitor', content: 'The CSV export button does nothing.' },
        { senderType: 'agent', content: 'Looking into it now.' },
      ],
      hasMore: false,
    })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('what has been tried so far?'),
      ticketId: 'ticket_1' as never,
      surface: 'copilot',
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
    expect(prompts[ticketBlockIndex]).toContain('The CSV export button does nothing.')
    expect(prompts[ticketBlockIndex]).toContain('Looking into it now.')
    // Right after the copilot framing block (element 1 is the base prompt's
    // JSON contract, element 2 is the copilot framing, element 3 is ticket
    // grounding — see buildCopilotFramingPrompt's own doc on ordering).
    expect(prompts[ticketBlockIndex - 1]).toBe(buildCopilotFramingPrompt())
  })

  it('never resolves customerPrincipalId or queries the conversation row for a ticket-scoped turn (skips customer-history grounding)', async () => {
    mockGetTicket.mockResolvedValue(fakeTicket())
    mockListTicketMessages.mockResolvedValue({ messages: [], hasMore: false })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      ticketId: 'ticket_1' as never,
      surface: 'copilot',
    })

    expect(mockConversationLookupLimit).not.toHaveBeenCalled()
  })

  it('continues the turn without a ticket-context block when the ticket lookup fails', async () => {
    mockGetTicket.mockRejectedValue(new Error('ticket vanished'))

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      ticketId: 'ticket_1' as never,
      surface: 'copilot',
    })

    expect(result.status).toBe('answered')
    const prompts = systemPromptsFromLastCall()
    expect(prompts.some((p) => p.includes('Cannot export CSV'))).toBe(false)
  })

  it('adds no ticket-context block for a conversation-scoped (or ticket-less) turn', async () => {
    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
      surface: 'copilot',
    })

    expect(mockGetTicket).not.toHaveBeenCalled()
    expect(mockListTicketMessages).not.toHaveBeenCalled()
  })

  it('records ticketId (not conversationId) in the usage-log metadata for a ticket-scoped turn', async () => {
    mockGetTicket.mockResolvedValue(fakeTicket())
    mockListTicketMessages.mockResolvedValue({ messages: [], hasMore: false })

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      ticketId: 'ticket_1' as never,
      surface: 'copilot',
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
      ...baseInput,
      messages: customerAsks('what was first asked?'),
      ticketId: 'ticket_1' as never,
      surface: 'copilot',
    })

    expect(mockListTicketMessages).toHaveBeenCalledWith('ticket_1', {
      includeInternal: true,
      all: true,
    })
    const prompts = systemPromptsFromLastCall()
    const block = prompts.find((p) => p.includes('Cannot export CSV'))!
    expect(block).toContain('ORIGINAL REQUEST: the CSV export button does nothing.')
    expect(block).toContain('MOST RECENT: shipping a fix today.')
    expect(block).toContain('earlier messages omitted')
    expect(block).not.toContain('filler message 150')
  })
})

describe('runAssistantTurn: conversation-scoped grounding (copilot conversation surface)', () => {
  function systemPromptsFromLastCall(): string[] {
    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    return opts.systemPrompts
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

  it("grounds a conversation-scoped copilot turn on the customer's facts and thread, right after the copilot framing block", async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockResolvedValue([
      { senderType: 'visitor', content: 'The CSV export button does nothing.' },
      { senderType: 'agent', content: 'Looking into it now.' },
    ])

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('what has this customer asked?'),
      conversationId: 'conversation_42' as never,
      surface: 'copilot',
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
    expect(block).toContain('Status: open')
    expect(block).toContain('Ada Customer')
    expect(block).toContain('Channel: messenger')
    expect(block).toContain('The CSV export button does nothing.')
    expect(block).toContain('Looking into it now.')
    // The thread is wrapped as untrusted content, not trusted instructions.
    expect(block).toContain('not instructions')
    // Right after the copilot framing block, same slot the ticket block uses.
    expect(prompts[idx - 1]).toBe(buildCopilotFramingPrompt())
    // conversationId rides the usage-log metadata.
    expect(lastLoggedMetadata?.conversationId).toBe('conversation_42')
  })

  it('folds internal notes into the grounding block, labelled Note (internal), so Quinn can see a teammate note on the open thread (D1)', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockResolvedValue([
      { senderType: 'visitor', content: 'When will this be fixed?' },
      { senderType: 'agent', isInternal: true, content: 'Known bug, ETA Friday.' },
    ])

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('summarize'),
      conversationId: 'conversation_42' as never,
      surface: 'copilot',
    })

    const block = systemPromptsFromLastCall().find((p) => p.includes('Export broken'))!
    expect(block).toContain('Note (internal): Known bug, ETA Friday.')
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
      ...baseInput,
      messages: customerAsks('what was first asked?'),
      conversationId: 'conversation_42' as never,
      surface: 'copilot',
    })

    // The grounding read was asked for the full thread, not a page.
    expect(mockListConversationMessagesForGrounding).toHaveBeenCalledWith(
      'conversation_42',
      expect.objectContaining({ includeInternal: true })
    )
    const block = systemPromptsFromLastCall().find((p) => p.includes('Export broken'))!
    expect(block).toContain('ORIGINAL REQUEST: my export is broken.')
    expect(block).toContain('MOST RECENT: fix shipping today.')
    expect(block).toContain('earlier messages omitted')
    expect(block).not.toContain('filler message 150')
  })

  it('continues the turn without a conversation-context block when the thread load fails', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockRejectedValue(new Error('thread read failed'))

    const result = await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
      surface: 'copilot',
    })

    expect(result.status).toBe('answered')
    expect(systemPromptsFromLastCall().some((p) => p.includes('Export broken'))).toBe(false)
  })

  it('adds no conversation-context block for a sandbox turn (neither conversationId nor ticketId)', async () => {
    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      surface: 'copilot',
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
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
      surface: 'copilot',
    })

    expect(systemPromptsFromLastCall().some((p) => p.startsWith('Conversation'))).toBe(false)
  })

  it('keeps the customer-history retrieval source excluding the current conversation (unchanged)', async () => {
    mockConversationLookupLimit.mockResolvedValue([FACTS_ROW])
    mockListConversationMessagesForGrounding.mockResolvedValue([])
    mockIsFeatureEnabled.mockImplementation(
      async (flag: string) => flag === 'assistantConversationGrounding'
    )
    let capturedCtx: { customerPrincipalId?: unknown; conversationId?: unknown } | undefined
    mockChat.mockImplementation(
      (opts: {
        tools: Array<{ name: string; execute: (a: unknown, o: unknown) => Promise<unknown> }>
        context: unknown
      }) =>
        (async function* () {
          capturedCtx = opts.context as typeof capturedCtx
          const search = opts.tools.find((t) => t.name === 'search_knowledge')!
          await search.execute(
            { query: 'billing' },
            { context: opts.context, emitCustomEvent: () => {} }
          )
          yield* completeRun({ text: 'ok', citations: [] })
        })()
    )

    await runAssistantTurn({
      ...baseInput,
      messages: customerAsks('question'),
      conversationId: 'conversation_42' as never,
      surface: 'copilot',
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

describe('runAssistantTurn: prompt assembly (basics + surface instructions + guidance)', () => {
  function systemPromptsFromLastCall(): string[] {
    const opts = mockChat.mock.calls.at(-1)?.[0] as { systemPrompts: string[] }
    return opts.systemPrompts
  }

  it('flag off: systemPrompts is byte-identical to the base prompt alone, no config fetched', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(systemPromptsFromLastCall()).toEqual(
      buildAssistantSystemPrompt('Quinn', WIDGET_LEGACY_TOOLS)
    )
    expect(mockGetAssistantConfig).not.toHaveBeenCalled()
    expect(mockListGuidanceRules).not.toHaveBeenCalled()
  })

  it('copilot surface: adds the copilot framing block right after the base prompt', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'copilot' })

    const prompts = systemPromptsFromLastCall()
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toEqual(buildAssistantSystemPrompt('Quinn', WIDGET_LEGACY_TOOLS)[0])
    expect(prompts[1]).toBe(buildCopilotFramingPrompt())
    // The copilot framing is where Quinn is taught to classify its answer, so
    // the answerType instruction rides on this block and only this surface.
    expect(prompts[1]).toContain('answerType')
  })

  it('widget surface: never adds the copilot framing block', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi'), surface: 'widget' })

    expect(systemPromptsFromLastCall()).toEqual(
      buildAssistantSystemPrompt('Quinn', WIDGET_LEGACY_TOOLS)
    )
  })

  it('flag on but nothing saved: base prompt reflects the full default-active tool set', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
    mockListGuidanceRules.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(systemPromptsFromLastCall()).toEqual(
      buildAssistantSystemPrompt('Quinn', ALL_DEFAULT_ACTIVE_SPECS)
    )
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
    expect(prompts[0]).toEqual(buildAssistantSystemPrompt('Quinn', ALL_DEFAULT_ACTIVE_SPECS)[0])
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

  it('shares the one getAssistantConfig read with tool assembly: assembleAssistantToolset never re-fetches controls', async () => {
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
    mockIsFeatureEnabled.mockResolvedValue(false)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(mockListConversationAttributes).not.toHaveBeenCalled()
    expect(systemPromptsFromLastCall()).toEqual(
      buildAssistantSystemPrompt('Quinn', WIDGET_LEGACY_TOOLS)
    )
  })

  it('flag on (set_attribute active): fetches and injects the live catalogue', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
    mockListGuidanceRules.mockResolvedValue([])
    mockListConversationAttributes.mockResolvedValue(fakeDefinitions)
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(mockListConversationAttributes).toHaveBeenCalledTimes(1)
    const prompts = systemPromptsFromLastCall()
    expect(prompts).toEqual(
      buildAssistantSystemPrompt('Quinn', ALL_DEFAULT_ACTIVE_SPECS, fakeDefinitions)
    )
    expect(prompts.join('\n')).toContain('issue_type')
  })

  it('flag on but no definitions exist: no workspace-attributes section is added', async () => {
    mockActionsFlag(true)
    mockGetAssistantConfig.mockResolvedValue({ toolControls: {}, surfaces: {}, basics: {} })
    mockListGuidanceRules.mockResolvedValue([])
    mockListConversationAttributes.mockResolvedValue([])
    mockChat.mockImplementation(() => chunkStream(completeRun({ text: 'ok', citations: [] })))

    await runAssistantTurn({ ...baseInput, messages: customerAsks('hi') })

    expect(systemPromptsFromLastCall()).toEqual(
      buildAssistantSystemPrompt('Quinn', ALL_DEFAULT_ACTIVE_SPECS)
    )
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
