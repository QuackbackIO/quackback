import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import { makeKbArticle } from './kb-fixtures'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const mockRetrieve = vi.fn()
vi.mock('../retrieval', () => ({
  retrieveKbArticles: (...args: unknown[]) => mockRetrieve(...args),
}))

// Stands in for the real past-conversation-summaries source: resolveKnowledgeSources
// dynamically imports this only when assistantConversationGrounding is on.
const mockConversationSummariesRetrieve = vi.fn()
vi.mock('../conversation-summary-retrieval', () => ({
  conversationSummariesKnowledgeSource: {
    sourceType: 'summary',
    retrieve: (...args: unknown[]) => mockConversationSummariesRetrieve(...args),
  },
}))

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

/**
 * `isFeatureEnabled` gates two independent flags in this pipeline
 * (assistantActions here, dataConnectors inside the real resolveToolSpecs
 * these tests call by default): a flat `mockResolvedValue(true)` would flip
 * both at once and pull the real connectors domain (and its DB access) into
 * a fully-mocked pipeline test. Discriminate by flag name instead so
 * dataConnectors stays off unless a test opts in.
 */
function mockActionsFlag(enabled: boolean) {
  mockIsFeatureEnabled.mockImplementation(
    async (flag: string) => flag === 'assistantActions' && enabled
  )
}

const mockGetAssistantToolControls = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantToolControls: (...args: unknown[]) => mockGetAssistantToolControls(...args),
}))

// Defensive: with mockActionsFlag in place dataConnectors always resolves
// false, so resolveToolSpecs never takes the dynamic-import branch in these
// tests — but stub the module anyway so a future test that flips it on
// doesn't reach for the real (DB-backed) connectors domain.
vi.mock('@/lib/server/domains/connectors/connector.toolspec', () => ({
  listEnabledConnectorToolSpecs: vi.fn().mockResolvedValue([]),
}))

const mockClaimToolCall = vi.fn()
const mockFinalizeToolCall = vi.fn()
const mockRecordDeniedToolCall = vi.fn()
vi.mock('../tool-audit', () => ({
  claimToolCall: (...args: unknown[]) => mockClaimToolCall(...args),
  finalizeToolCall: (...args: unknown[]) => mockFinalizeToolCall(...args),
  recordDeniedToolCall: (...args: unknown[]) => mockRecordDeniedToolCall(...args),
}))

const mockProposePendingAction = vi.fn()
vi.mock('../pending-actions.service', () => ({
  proposePendingAction: (...args: unknown[]) => mockProposePendingAction(...args),
}))

const mockLoggerWarn = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}))

import { assembleAssistantToolset, resolveEffectiveToolMode } from '../assistant.tools'
import { makeToolTestContext, fakePendingActionRow } from './assistant-tool-fixtures'
import { ASSISTANT_TOOL_SPECS } from '../assistant.toolspec'
import type { AssistantToolContext, AssistantToolSpec } from '../assistant.toolspec'
import type { AssistantToolControls } from '@/lib/server/domains/settings/settings.assistant'

/** Tools-only view of the assembly, for the many cases here that don't need
 *  the paired specs. */
async function assembleTools(
  c: AssistantToolContext,
  specs?: readonly AssistantToolSpec[],
  controls?: AssistantToolControls
) {
  return (await assembleAssistantToolset(c, specs, controls)).tools
}

const ctx = makeToolTestContext

function toolCtx(c: AssistantToolContext) {
  return { context: c, emitCustomEvent: () => {} }
}

async function findTool(
  c: AssistantToolContext,
  name: string,
  specs?: readonly AssistantToolSpec[]
): Promise<{ execute: (args: unknown, o: unknown) => Promise<unknown> }> {
  const tools = specs ? await assembleTools(c, specs) : await assembleTools(c)
  const tool = tools.find((t) => t.name === name)
  if (!tool?.execute) throw new Error(`tool ${name} not found`)
  return tool as { execute: (args: unknown, o: unknown) => Promise<unknown> }
}

// A fake write-risk spec for pipeline tests: assistant.toolspec.ts owns the
// real catalogue (read-only today), so write-tool behavior is exercised
// against an injected spec rather than a real one.
const fakeWriteDefinition = toolDefinition({
  name: 'close_conversation',
  description: 'Close the conversation.',
  inputSchema: z.object({ reason: z.string() }),
  outputSchema: z.object({ closed: z.boolean() }),
})

const mockWriteExecute = vi.fn()

function makeFakeWriteSpec(overrides: Partial<AssistantToolSpec> = {}): AssistantToolSpec {
  return {
    name: 'close_conversation',
    label: 'Close conversation',
    description: 'Close the conversation with the given reason.',
    promptGuidance: 'Only call once the customer has confirmed the issue is resolved.',
    risk: 'write',
    supportedModes: ['disabled', 'approval', 'autonomous'],
    defaultMode: 'approval',
    permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
    parents: ['conversation'],
    definition: fakeWriteDefinition,
    execute: mockWriteExecute,
    summarize: (args) => `Close conversation: ${(args as { reason: string }).reason}`,
    ...overrides,
  } as AssistantToolSpec
}

// A fake read-risk spec, for pinning that `ctx.simulate` never touches reads
// (the fixed catalogue only has search_knowledge, and its behavior is
// covered end to end above; the resolver test below wants a read spec with
// a controllable supportedModes/defaultMode too).
const fakeReadDefinition = toolDefinition({
  name: 'lookup_thing',
  description: 'Look something up.',
  inputSchema: z.object({}),
  outputSchema: z.object({ found: z.boolean() }),
})

function makeFakeReadSpec(overrides: Partial<AssistantToolSpec> = {}): AssistantToolSpec {
  return {
    name: 'lookup_thing',
    label: 'Lookup thing',
    description: 'Look something up.',
    promptGuidance: 'Use to look something up.',
    risk: 'read',
    supportedModes: ['disabled', 'autonomous'],
    defaultMode: 'autonomous',
    permissions: [],
    parents: ['conversation', 'ticket'],
    definition: fakeReadDefinition,
    execute: vi.fn(),
    summarize: () => 'Lookup thing',
    ...overrides,
  } as AssistantToolSpec
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(false)
  mockConversationSummariesRetrieve.mockResolvedValue([])
})

describe('search_knowledge', () => {
  it('retrieves audience-scoped, records sources in the ledger, and allowlists output', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1', { content: 'X'.repeat(5000) })])
    const c = ctx({ audience: 'team' })
    const search = await findTool(c, 'search_knowledge')

    const out = (await search.execute({ query: 'billing' }, toolCtx(c))) as {
      articles: Array<{ id: string; title: string; snippet: string }>
    }

    expect(mockRetrieve).toHaveBeenCalledWith('billing', { audience: 'team' })
    expect(out.articles).toHaveLength(1)
    expect(out.articles[0]).toEqual({
      id: 'kb_article_1',
      title: 'Title kb_article_1',
      snippet: expect.any(String),
    })
    expect(out.articles[0].snippet.length).toBeLessThanOrEqual(1200)
    expect(c.sources.get('kb_article_1')).toEqual({
      type: 'article',
      id: 'kb_article_1',
      title: 'Title kb_article_1',
      url: '/hc/articles/general/slug-kb_article_1',
    })
  })

  it('leaves the ledger empty when nothing clears the confidence floor', async () => {
    mockRetrieve.mockResolvedValue([])
    const c = ctx()
    const search = await findTool(c, 'search_knowledge')
    const out = (await search.execute({ query: 'nope' }, toolCtx(c))) as { articles: unknown[] }
    expect(out.articles).toEqual([])
    expect(c.sources.size).toBe(0)
  })

  it('ends exploration past the per-turn search budget with an answer-now note', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    const c = ctx()
    const search = await findTool(c, 'search_knowledge')
    for (let i = 0; i < 3; i++) await search.execute({ query: `q${i}` }, toolCtx(c))
    expect(mockRetrieve).toHaveBeenCalledTimes(3)

    const out = (await search.execute({ query: 'q4' }, toolCtx(c))) as {
      articles: unknown[]
      note?: string
    }
    expect(mockRetrieve).toHaveBeenCalledTimes(3)
    expect(out.articles).toEqual([])
    expect(out.note).toMatch(/answer/i)
    expect(c.sources.has('kb_article_1')).toBe(true)
  })

  it("forwards the context's sourceTypes into retrieveKnowledge, narrowing away the knowledge base", async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    // sourceTypes excludes 'article': the only registered source (flags off)
    // gets filtered out entirely, so retrieveKbArticles is never called.
    const c = ctx({ sourceTypes: ['post'] })
    const search = await findTool(c, 'search_knowledge')

    const out = (await search.execute({ query: 'billing' }, toolCtx(c))) as { articles: unknown[] }

    expect(mockRetrieve).not.toHaveBeenCalled()
    expect(out.articles).toEqual([])
  })

  it("threads the context's customerPrincipalId and conversationId into the past-conversation-summaries source", async () => {
    mockIsFeatureEnabled.mockImplementation(
      async (flag: string) => flag === 'assistantConversationGrounding'
    )
    mockRetrieve.mockResolvedValue([])
    const c = ctx({
      customerPrincipalId: 'principal_customer_1' as never,
      conversationId: 'conversation_current' as never,
    })
    const search = await findTool(c, 'search_knowledge')

    await search.execute({ query: 'billing' }, toolCtx(c))

    expect(mockConversationSummariesRetrieve).toHaveBeenCalledWith(
      'billing',
      'public',
      expect.objectContaining({
        customerPrincipalId: 'principal_customer_1',
        conversationId: 'conversation_current',
      })
    )
  })

  it('runs the summaries source with an undefined customerPrincipalId when the context has none (sandbox)', async () => {
    mockIsFeatureEnabled.mockImplementation(
      async (flag: string) => flag === 'assistantConversationGrounding'
    )
    mockRetrieve.mockResolvedValue([])
    const c = ctx({ conversationId: null })
    const search = await findTool(c, 'search_knowledge')

    await search.execute({ query: 'billing' }, toolCtx(c))

    expect(mockConversationSummariesRetrieve).toHaveBeenCalledWith(
      'billing',
      'public',
      expect.objectContaining({ customerPrincipalId: undefined })
    )
  })
})

describe('assembleAssistantToolset: assistant actions flag', () => {
  it('returns exactly the one read tool with no pipeline wrapping when the flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const tools = await assembleTools(ctx())
    expect(tools.map((t) => t.name).sort()).toEqual(['search_knowledge'])
    // Byte-identical legacy behavior: no settings read beyond the flag itself.
    expect(mockGetAssistantToolControls).not.toHaveBeenCalled()
  })

  it('reads the flag and controls exactly once per assembly when the flag is on', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({})
    await assembleTools(ctx())
    // Twice, not once: assistantActions here plus dataConnectors inside the
    // real resolveToolSpecs this call falls through to (no explicit specs) —
    // each flag is still read exactly once, not re-read redundantly.
    expect(mockIsFeatureEnabled).toHaveBeenCalledTimes(2)
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('assistantActions')
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('dataConnectors')
    expect(mockGetAssistantToolControls).toHaveBeenCalledTimes(1)
  })

  it('accepts pre-fetched controls, skipping its own settings read', async () => {
    mockActionsFlag(true)
    const tools = await assembleTools(ctx(), undefined, { search_knowledge: 'disabled' })
    expect(tools.map((t) => t.name)).not.toContain('search_knowledge')
    expect(mockGetAssistantToolControls).not.toHaveBeenCalled()
  })
})

describe('assembleAssistantToolset: control-mode gating', () => {
  it('does not register a disabled tool', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'disabled' })
    const tools = await assembleTools(ctx(), [makeFakeWriteSpec()])
    expect(tools).toHaveLength(0)
  })

  it('fails closed to disabled (with a warning) when the saved mode is not supported', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })
    const spec = makeFakeWriteSpec({ supportedModes: ['disabled', 'approval'] })
    const tools = await assembleTools(ctx(), [spec])
    expect(tools).toHaveLength(0)
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it('read tools still respect disabled mode when actions are on', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ search_knowledge: 'disabled' })
    const tools = await assembleTools(ctx())
    expect(tools.map((t) => t.name)).not.toContain('search_knowledge')
    // Another default-active tool (autonomous by default) survives untouched.
    expect(tools.map((t) => t.name)).toContain('set_attribute')
  })
})

describe('assembleAssistantToolset: parent-kind gating (unified inbox §2.9/§3.3)', () => {
  it('never offers a conversation-only write tool on a ticket-scoped turn', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'approval' })

    const c = ctx({ conversationId: null, ticketId: 'ticket_1' as never })
    const tools = await assembleTools(c, [makeFakeWriteSpec()])

    expect(tools).toHaveLength(0)
  })

  it('still offers a conversation-only write tool on a conversation-scoped turn', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'approval' })

    const c = ctx({ conversationId: 'conversation_1' as never })
    const tools = await assembleTools(c, [makeFakeWriteSpec()])

    expect(tools.map((t) => t.name)).toEqual(['close_conversation'])
  })

  it('offers a tool declaring both parents on a ticket-scoped turn too', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({})

    const c = ctx({ conversationId: null, ticketId: 'ticket_1' as never })
    const tools = await assembleTools(c, [
      makeFakeReadSpec({ parents: ['conversation', 'ticket'] }),
    ])

    expect(tools.map((t) => t.name)).toEqual(['lookup_thing'])
  })

  it('filters the same way with the assistantActions flag off (legacy read-only branch)', async () => {
    mockActionsFlag(false)

    const c = ctx({ conversationId: null, ticketId: 'ticket_1' as never })
    // A conversation-only read spec (hypothetical: today's only read tool,
    // search_knowledge, declares both) must still be excluded here too.
    const tools = await assembleTools(c, [makeFakeReadSpec({ parents: ['conversation'] })])

    expect(tools).toHaveLength(0)
  })

  it('a null-null context (sandbox) falls back to conversation parent, matching pre-ticket behavior', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })

    const c = ctx({ conversationId: null, simulate: true })
    const tools = await assembleTools(c, [makeFakeWriteSpec({ defaultMode: 'autonomous' })])

    expect(tools.map((t) => t.name)).toEqual(['close_conversation'])
  })
})

describe('assembleAssistantToolset', () => {
  it('pairs each wired tool with the spec that produced it, index-aligned', async () => {
    mockActionsFlag(false)
    const { tools, activeSpecs } = await assembleAssistantToolset(ctx())
    expect(tools.map((t) => t.name)).toEqual(activeSpecs.map((s) => s.name))
    expect(
      activeSpecs.every((s) => typeof s.promptGuidance === 'string' && s.promptGuidance.length > 0)
    ).toBe(true)
  })
})

describe('assembleAssistantToolset: write-tool pipeline (approval mode)', () => {
  it('proposes a pending action, returns a pending_approval note, records it on ctx.proposedActions, and never executes', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'approval' })
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: 'conversation_1' as never,
      involvementId: 'assistant_involvement_1' as never,
    })
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec()])
    const out = (await tool.execute({ reason: 'resolved' }, toolCtx(c))) as {
      status: string
      note: string
    }

    expect(mockProposePendingAction).toHaveBeenCalledWith({
      conversationId: 'conversation_1',
      involvementId: 'assistant_involvement_1',
      toolName: 'close_conversation',
      args: { reason: 'resolved' },
      summary: 'Close conversation: resolved',
      // Same-shaped key as the autonomous branch's claim (S1); this context
      // has no latestCustomerMessageId override, so it threads through as
      // the literal "null" segment.
      idempotencyKey: expect.stringMatching(
        /^conversation_1:null:close_conversation:[0-9a-f]{64}$/
      ),
    })
    expect(out.status).toBe('pending_approval')
    expect(typeof out.note).toBe('string')
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockClaimToolCall).not.toHaveBeenCalled()
    // Mirrors ctx.sources for citations: the pipeline records what it
    // proposed, keyed off the row proposePendingAction actually created.
    expect(c.proposedActions).toEqual([
      {
        id: 'assistant_action_1',
        toolName: 'close_conversation',
        summary: 'Close conversation: resolved',
        label: 'Close conversation',
      },
    ])
  })

  it('computes the same-shaped idempotency key the autonomous branch claims with, so a retry can dedupe (S1)', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'approval' })
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: 'conversation_1' as never,
      latestCustomerMessageId: 'conversation_message_1',
    })
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec()])
    await tool.execute({ reason: 'resolved' }, toolCtx(c))

    // {conversationId}:{latestCustomerMessageId}:{toolName}:{sha256(args)} —
    // identical shape (and, for identical args, identical value) to the
    // autonomous claim's key asserted above.
    expect(mockProposePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(
          /^conversation_1:conversation_message_1:close_conversation:[0-9a-f]{64}$/
        ),
      })
    )
  })

  it('reports the SAME proposal id on two invocations for an identical turn+args (S1: propose-retry idempotency)', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'approval' })
    // Stands in for proposePendingAction's real dedup behavior (covered end
    // to end against a real DB in pending-actions.service.test.ts /
    // pending-actions-note.test.ts): a second call with the same
    // idempotencyKey resolves to the SAME existing row rather than a new one.
    mockProposePendingAction.mockImplementation(async (input: { idempotencyKey?: string }) => ({
      id: `assistant_action_for_${input.idempotencyKey}`,
    }))

    const c1 = ctx({
      conversationId: 'conversation_1' as never,
      latestCustomerMessageId: 'conversation_message_1',
    })
    const tool1 = await findTool(c1, 'close_conversation', [makeFakeWriteSpec()])
    await tool1.execute({ reason: 'resolved' }, toolCtx(c1))

    const c2 = ctx({
      conversationId: 'conversation_1' as never,
      latestCustomerMessageId: 'conversation_message_1',
    })
    const tool2 = await findTool(c2, 'close_conversation', [makeFakeWriteSpec()])
    await tool2.execute({ reason: 'resolved' }, toolCtx(c2))

    expect(c1.proposedActions[0].id).toBe(c2.proposedActions[0].id)
    expect(mockProposePendingAction).toHaveBeenCalledTimes(2)
  })

  it('proposes against the ticket parent (not conversationId) for a ticket-scoped context (unified inbox §2.9)', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'approval' })
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: null,
      ticketId: 'ticket_1' as never,
      involvementId: 'assistant_involvement_1' as never,
    })
    // This test is about runWithPipeline's parent-choice logic once a write
    // tool IS on a ticket-scoped turn's catalogue, a separate concern from
    // the parents catalogue gate itself (covered in its own describe block
    // below) — so the fake spec here opts into both parents explicitly.
    const tool = await findTool(c, 'close_conversation', [
      makeFakeWriteSpec({ parents: ['conversation', 'ticket'] }),
    ])
    await tool.execute({ reason: 'resolved' }, toolCtx(c))

    expect(mockProposePendingAction).toHaveBeenCalledWith({
      ticketId: 'ticket_1',
      involvementId: 'assistant_involvement_1',
      toolName: 'close_conversation',
      args: { reason: 'resolved' },
      summary: 'Close conversation: resolved',
      // Falls back to ticketId (not the bare "null" a naive conversationId-only
      // key would produce) so two different tickets proposing the same tool
      // with the same args never collide — see resolveIdempotencyKey's doc.
      idempotencyKey: expect.stringMatching(/^ticket_1:null:close_conversation:[0-9a-f]{64}$/),
    })
  })
})

describe('assembleAssistantToolset: write-tool pipeline (writeToolPolicy: propose, P2-C.4)', () => {
  it('forces approval for a write tool configured autonomous, proposing instead of executing', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: 'conversation_1' as never,
      writeToolPolicy: 'propose',
    })
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec()])
    const out = (await tool.execute({ reason: 'resolved' }, toolCtx(c))) as {
      status: string
      note: string
    }

    expect(out.status).toBe('pending_approval')
    expect(mockProposePendingAction).toHaveBeenCalledTimes(1)
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockClaimToolCall).not.toHaveBeenCalled()
    expect(c.proposedActions).toEqual([
      {
        id: 'assistant_action_1',
        toolName: 'close_conversation',
        summary: 'Close conversation: resolved',
        label: 'Close conversation',
      },
    ])
  })

  it('still disables a tool the workspace turned off, propose notwithstanding', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'disabled' })

    const tools = await assembleTools(ctx({ writeToolPolicy: 'propose' }), [makeFakeWriteSpec()])

    expect(tools).toHaveLength(0)
  })

  it('flag off still exposes only the read tool, writeToolPolicy notwithstanding', async () => {
    mockActionsFlag(false)

    const tools = await assembleTools(ctx({ writeToolPolicy: 'propose' }))

    expect(tools.map((t) => t.name)).toEqual(['search_knowledge'])
  })
})

describe('assembleAssistantToolset: write-tool pipeline (autonomous mode)', () => {
  function autonomousCtx(overrides: Partial<AssistantToolContext> = {}) {
    return ctx({ conversationId: 'conversation_1' as never, ...overrides })
  }

  it('denies a call missing a required permission, records the denial, and never executes', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })
    const spec = makeFakeWriteSpec({ permissions: [PERMISSIONS.SETTINGS_MANAGE] })

    const c = autonomousCtx()
    const tool = await findTool(c, 'close_conversation', [spec])
    const out = (await tool.execute({ reason: 'resolved' }, toolCtx(c))) as {
      status: string
      note: string
    }

    expect(out.status).toBe('denied')
    expect(mockRecordDeniedToolCall).toHaveBeenCalledTimes(1)
    expect(mockRecordDeniedToolCall.mock.calls[0][0]).toMatchObject({
      conversationId: 'conversation_1',
      toolName: 'close_conversation',
      reason: expect.stringContaining('settings.manage'),
    })
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockClaimToolCall).not.toHaveBeenCalled()
  })

  it('claims, executes, and finalizes succeeded with latency on the happy path', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })
    mockClaimToolCall.mockResolvedValue({ id: 'assistant_tool_call_1', status: 'started' })
    mockWriteExecute.mockResolvedValue({ closed: true })

    const c = autonomousCtx({ latestCustomerMessageId: 'conversation_message_1' })
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec()])
    const out = await tool.execute({ reason: 'resolved' }, toolCtx(c))

    expect(out).toEqual({ closed: true })
    expect(mockClaimToolCall).toHaveBeenCalledTimes(1)
    const claimArgs = mockClaimToolCall.mock.calls[0][0]
    expect(claimArgs.conversationId).toBe('conversation_1')
    expect(claimArgs.toolName).toBe('close_conversation')
    // {conversationId}:{latestCustomerMessageId}:{toolName}:{sha256(args)}
    expect(claimArgs.idempotencyKey).toMatch(
      /^conversation_1:conversation_message_1:close_conversation:[0-9a-f]{64}$/
    )
    expect(mockFinalizeToolCall).toHaveBeenCalledWith(
      'assistant_tool_call_1',
      expect.objectContaining({ status: 'succeeded', latencyMs: expect.any(Number) })
    )
  })

  it('skips a duplicate claim and never executes', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })
    mockClaimToolCall.mockResolvedValue(null)

    const c = autonomousCtx()
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec()])
    const out = (await tool.execute({ reason: 'resolved' }, toolCtx(c))) as { status: string }

    expect(out.status).toBe('skipped_duplicate')
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockFinalizeToolCall).not.toHaveBeenCalled()
  })

  it('finalizes failed and returns a graceful note when execute throws (never crashes the turn)', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })
    mockClaimToolCall.mockResolvedValue({ id: 'assistant_tool_call_1', status: 'started' })
    mockWriteExecute.mockRejectedValue(new Error('boom'))

    const c = autonomousCtx()
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec()])
    const out = (await tool.execute({ reason: 'resolved' }, toolCtx(c))) as { status: string }

    expect(out.status).toBe('failed')
    expect(mockFinalizeToolCall).toHaveBeenCalledWith(
      'assistant_tool_call_1',
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('boom') })
    )
  })

  it('skips claim and audit entirely for a read-risk tool', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({})
    mockRetrieve.mockResolvedValue([])

    const c = autonomousCtx()
    const tool = await findTool(c, 'search_knowledge')
    await tool.execute({ query: 'x' }, toolCtx(c))

    expect(mockClaimToolCall).not.toHaveBeenCalled()
    expect(mockFinalizeToolCall).not.toHaveBeenCalled()
  })
})

describe('assembleAssistantToolset: sandbox simulate mode', () => {
  it('skips claim, execute, and audit for a write tool and returns a simulated summary', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })

    const c = ctx({ conversationId: null, simulate: true })
    const tool = await findTool(c, 'close_conversation', [
      makeFakeWriteSpec({ defaultMode: 'autonomous' }),
    ])
    const out = await tool.execute({ reason: 'resolved' }, toolCtx(c))

    expect(out).toEqual({ simulated: true, summary: 'Close conversation: resolved' })
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockClaimToolCall).not.toHaveBeenCalled()
    expect(mockProposePendingAction).not.toHaveBeenCalled()
  })

  it('still executes a read tool normally in simulate mode', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({})
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])

    const c = ctx({ conversationId: null, simulate: true })
    const tool = await findTool(c, 'search_knowledge')
    const out = (await tool.execute({ query: 'billing' }, toolCtx(c))) as { articles: unknown[] }

    expect(mockRetrieve).toHaveBeenCalled()
    expect(out.articles).toHaveLength(1)
  })
})

describe('resolveEffectiveToolMode', () => {
  // The full matrix behind the pipeline's single mode decision: risk x
  // configured mode x simulate x writeToolPolicy. Every "today" row pins an
  // observable outcome one of the tests above already exercises end to end
  // through assembleAssistantToolset/runWithPipeline; this suite is the unit
  // form of the same precedence, including the writeToolPolicy: 'propose'
  // rows the P2-C.4 copilot surface actually sets (see copilot.ts) and the
  // 'controls' rows that remain an unused-today seam for a future surface.

  it('resolves a read tool to its configured mode regardless of simulate', () => {
    const spec = makeFakeReadSpec()
    expect(resolveEffectiveToolMode(spec, 'autonomous', ctx({ simulate: false }))).toBe(
      'autonomous'
    )
    expect(resolveEffectiveToolMode(spec, 'autonomous', ctx({ simulate: true }))).toBe('autonomous')
  })

  it('disables a read tool whose saved mode is unsupported, regardless of simulate', () => {
    const spec = makeFakeReadSpec({ supportedModes: ['disabled', 'autonomous'] })
    expect(resolveEffectiveToolMode(spec, 'approval' as never, ctx({ simulate: true }))).toBe(
      'disabled'
    )
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it('disabled always wins for a read tool, simulate included', () => {
    const spec = makeFakeReadSpec()
    expect(resolveEffectiveToolMode(spec, 'disabled', ctx({ simulate: true }))).toBe('disabled')
  })

  it('resolves a write tool to its configured mode when simulate is false, any writeToolPolicy', () => {
    const spec = makeFakeWriteSpec()
    expect(resolveEffectiveToolMode(spec, 'approval', ctx({ simulate: false }))).toBe('approval')
    expect(resolveEffectiveToolMode(spec, 'autonomous', ctx({ simulate: false }))).toBe(
      'autonomous'
    )
    expect(
      resolveEffectiveToolMode(
        spec,
        'approval',
        ctx({ simulate: false, writeToolPolicy: 'controls' })
      )
    ).toBe('approval')
  })

  it("today's default: a write tool under simulate resolves to 'simulate' no matter its configured mode", () => {
    const spec = makeFakeWriteSpec()
    expect(resolveEffectiveToolMode(spec, 'approval', ctx({ simulate: true }))).toBe('simulate')
    expect(resolveEffectiveToolMode(spec, 'autonomous', ctx({ simulate: true }))).toBe('simulate')
  })

  it("an explicit writeToolPolicy: 'simulate' behaves exactly like the unset default", () => {
    const spec = makeFakeWriteSpec()
    const c = ctx({ simulate: true, writeToolPolicy: 'simulate' })
    expect(resolveEffectiveToolMode(spec, 'approval', c)).toBe('simulate')
    expect(resolveEffectiveToolMode(spec, 'autonomous', c)).toBe('simulate')
  })

  it("the C.4 seam: writeToolPolicy: 'controls' defers to the configured mode even while simulate is true", () => {
    const spec = makeFakeWriteSpec()
    const c = ctx({ simulate: true, writeToolPolicy: 'controls' })
    expect(resolveEffectiveToolMode(spec, 'approval', c)).toBe('approval')
    expect(resolveEffectiveToolMode(spec, 'autonomous', c)).toBe('autonomous')
  })

  it("disabled still wins for a write tool under writeToolPolicy: 'controls'", () => {
    const spec = makeFakeWriteSpec()
    expect(
      resolveEffectiveToolMode(
        spec,
        'disabled',
        ctx({ simulate: true, writeToolPolicy: 'controls' })
      )
    ).toBe('disabled')
  })

  it("P2-C.4: writeToolPolicy: 'propose' forces approval for a write tool no matter its configured mode", () => {
    const spec = makeFakeWriteSpec()
    const c = ctx({ simulate: false, writeToolPolicy: 'propose' })
    expect(resolveEffectiveToolMode(spec, 'autonomous', c)).toBe('approval')
    expect(resolveEffectiveToolMode(spec, 'approval', c)).toBe('approval')
  })

  it("writeToolPolicy: 'propose' wins over simulate too", () => {
    const spec = makeFakeWriteSpec()
    const c = ctx({ simulate: true, writeToolPolicy: 'propose' })
    expect(resolveEffectiveToolMode(spec, 'autonomous', c)).toBe('approval')
  })

  it('a metadataWrite tool is EXEMPT from propose-forcing and keeps its configured mode', () => {
    // Attribute classification is metadata, not an action: on the copilot
    // surface it must run under its configured mode like everywhere else,
    // not be forced to a teammate-approval card. Mirrors set_attribute.
    const spec = makeFakeWriteSpec({ metadataWrite: true })
    const c = ctx({ simulate: false, writeToolPolicy: 'propose' })
    expect(resolveEffectiveToolMode(spec, 'autonomous', c)).toBe('autonomous')
    expect(resolveEffectiveToolMode(spec, 'approval', c)).toBe('approval')
  })

  it('a metadataWrite tool still previews under the simulate default (sandbox path)', () => {
    // The exemption only lifts the propose-forcing; sandbox preview keys on
    // simulate (policy unset ⇒ 'simulate'), so a metadata write still previews.
    const spec = makeFakeWriteSpec({ metadataWrite: true })
    const c = ctx({ simulate: true }) // writeToolPolicy unset ⇒ 'simulate'
    expect(resolveEffectiveToolMode(spec, 'autonomous', c)).toBe('simulate')
  })

  it('disabled still wins for a metadataWrite tool', () => {
    const spec = makeFakeWriteSpec({ metadataWrite: true })
    expect(resolveEffectiveToolMode(spec, 'disabled', ctx({ writeToolPolicy: 'propose' }))).toBe(
      'disabled'
    )
  })

  it('real catalogue: set_attribute is the metadata write; the action tools are not', () => {
    // The behaviour change, pinned against the real specs: under the copilot
    // surface's propose policy, recording an attribute runs autonomously while
    // every genuine action still proposes for teammate approval.
    const proposeCtx = ctx({ simulate: false, writeToolPolicy: 'propose' })

    const setAttribute = ASSISTANT_TOOL_SPECS['set_attribute']
    expect(setAttribute.metadataWrite).toBe(true)
    expect(resolveEffectiveToolMode(setAttribute, undefined, proposeCtx)).toBe('autonomous')

    for (const name of ['end_conversation', 'create_ticket', 'capture_feedback']) {
      const action = ASSISTANT_TOOL_SPECS[name]
      expect(action.metadataWrite ?? false).toBe(false)
      expect(resolveEffectiveToolMode(action, undefined, proposeCtx)).toBe('approval')
    }
  })

  it("disabled still wins for a write tool under writeToolPolicy: 'propose'", () => {
    const spec = makeFakeWriteSpec()
    expect(resolveEffectiveToolMode(spec, 'disabled', ctx({ writeToolPolicy: 'propose' }))).toBe(
      'disabled'
    )
  })

  it("S3: fails closed to disabled (with a warning) when propose fires for a write tool that never supports 'approval' at all", () => {
    // Saved mode 'autonomous' IS supported (so fold 1 does not trip), but
    // 'approval' itself is absent from supportedModes — the propose override
    // must not force a mode this spec never declared it could run under.
    const spec = makeFakeWriteSpec({ supportedModes: ['disabled', 'autonomous'] })
    expect(resolveEffectiveToolMode(spec, 'autonomous', ctx({ writeToolPolicy: 'propose' }))).toBe(
      'disabled'
    )
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it("a read tool is unaffected by writeToolPolicy: 'propose'", () => {
    const spec = makeFakeReadSpec()
    expect(resolveEffectiveToolMode(spec, 'autonomous', ctx({ writeToolPolicy: 'propose' }))).toBe(
      'autonomous'
    )
  })

  it("disables a write tool whose saved mode is unsupported, even under writeToolPolicy: 'propose'", () => {
    const spec = makeFakeWriteSpec({ supportedModes: ['disabled', 'approval'] })
    expect(resolveEffectiveToolMode(spec, 'autonomous', ctx({ writeToolPolicy: 'propose' }))).toBe(
      'disabled'
    )
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it('disables a write tool whose saved mode is unsupported, regardless of simulate or writeToolPolicy', () => {
    const spec = makeFakeWriteSpec({ supportedModes: ['disabled', 'approval'] })
    expect(
      resolveEffectiveToolMode(
        spec,
        'autonomous',
        ctx({ simulate: true, writeToolPolicy: 'controls' })
      )
    ).toBe('disabled')
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it('falls back to the spec default mode when no control is saved', () => {
    const spec = makeFakeWriteSpec({ defaultMode: 'autonomous' })
    expect(resolveEffectiveToolMode(spec, undefined, ctx({ simulate: false }))).toBe('autonomous')
  })
})

describe('executeApprovedPendingAction', () => {
  const fakePendingAction = (overrides: Partial<Record<string, unknown>> = {}) =>
    fakePendingActionRow({ status: 'approved', ...overrides })

  it('claims with a pending-keyed idempotency key, executes, links the audit row, and returns executed', async () => {
    mockClaimToolCall.mockResolvedValue({ id: 'assistant_tool_call_1', status: 'started' })
    mockWriteExecute.mockResolvedValue({ closed: true })

    const { executeApprovedPendingAction } = await import('../assistant.tools')
    const pending = fakePendingAction()
    const out = await executeApprovedPendingAction(makeFakeWriteSpec(), pending, ctx())

    expect(mockClaimToolCall).toHaveBeenCalledWith({
      conversationId: 'conversation_1',
      involvementId: 'assistant_involvement_1',
      pendingActionId: 'assistant_action_1',
      toolName: 'close_conversation',
      args: { reason: 'resolved' },
      idempotencyKey: 'pending:assistant_action_1',
      principalId: 'principal_assistant',
    })
    expect(mockWriteExecute).toHaveBeenCalledWith({ reason: 'resolved' }, expect.anything())
    expect(mockFinalizeToolCall).toHaveBeenCalledWith(
      'assistant_tool_call_1',
      expect.objectContaining({ status: 'succeeded' })
    )
    expect(out).toEqual({ status: 'executed', result: { closed: true } })
  })

  it('finalizes failed and returns the error when execute throws', async () => {
    mockClaimToolCall.mockResolvedValue({ id: 'assistant_tool_call_1', status: 'started' })
    mockWriteExecute.mockRejectedValue(new Error('boom'))

    const { executeApprovedPendingAction } = await import('../assistant.tools')
    const out = await executeApprovedPendingAction(makeFakeWriteSpec(), fakePendingAction(), ctx())

    expect(mockFinalizeToolCall).toHaveBeenCalledWith(
      'assistant_tool_call_1',
      expect.objectContaining({ status: 'failed', error: 'boom' })
    )
    expect(out).toEqual({ status: 'failed', error: 'boom' })
  })

  it('skips execution when the claim is already taken (duplicate approve)', async () => {
    mockClaimToolCall.mockResolvedValue(null)

    const { executeApprovedPendingAction } = await import('../assistant.tools')
    const out = await executeApprovedPendingAction(makeFakeWriteSpec(), fakePendingAction(), ctx())

    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockFinalizeToolCall).not.toHaveBeenCalled()
    expect(out).toEqual({ status: 'skipped_duplicate' })
  })

  it('never marks a no-parent no-op result as executed (defense in depth alongside the parents catalogue gate)', async () => {
    // Forces the exact no-op shape a conversation-only write tool's execute
    // body returns when it finds no parent to act on (assistant.toolspec.ts's
    // NO_CONVERSATION_NOTE) — regardless of how the pending action reached
    // this path, the settle must be 'failed', never 'executed'.
    mockClaimToolCall.mockResolvedValue({ id: 'assistant_tool_call_1', status: 'started' })
    mockWriteExecute.mockResolvedValue({ closed: false, note: 'No linked conversation.' })

    const { executeApprovedPendingAction } = await import('../assistant.tools')
    const out = await executeApprovedPendingAction(makeFakeWriteSpec(), fakePendingAction(), ctx())

    expect(out).toEqual({ status: 'failed', error: 'No linked conversation.' })
    expect(mockFinalizeToolCall).toHaveBeenCalledWith(
      'assistant_tool_call_1',
      expect.objectContaining({ status: 'failed', error: 'No linked conversation.' })
    )
  })
})

// The registry's exact contents are pinned by assistant.toolspec.test.ts;
// this file only asserts how assembly treats what the registry returns.
