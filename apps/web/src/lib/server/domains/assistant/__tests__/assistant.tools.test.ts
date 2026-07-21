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

// Stand-ins for the optional knowledge sources: resolveKnowledgeSources
// dynamically imports each one whose type the turn's knowledge snapshot
// enabled, so each must be stubbed or a grounding test would reach the real
// (DB-backed) domains.
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

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
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
import { ASSISTANT_CITATION_TYPES } from '../citation-types'
import { RETRIEVED_CONTENT_NOTE } from '../injection-guard'
import type { AssistantToolContext, AssistantToolSpec } from '../assistant.toolspec'

/** Every retrieval source enabled — the config-v3 snapshot that replaces the
 *  old `knowledgeEnabled: true` bundle so all optional sources register. */
const ALL_KNOWLEDGE = { sources: new Set(ASSISTANT_CITATION_TYPES), status: true }

/** Tools-only view of the assembly, for the many cases here that don't need
 *  the paired specs. */
async function assembleTools(
  c: AssistantToolContext,
  specs?: readonly AssistantToolSpec[],
  actionsEnabled = specs !== undefined
) {
  return (await assembleAssistantToolset(c, specs, actionsEnabled)).tools
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
  const tools = await assembleTools(c, specs)
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
    permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
    parents: ['conversation'],
    definition: fakeWriteDefinition,
    execute: mockWriteExecute,
    summarize: (args) => `Close conversation: ${(args as { reason: string }).reason}`,
    ...overrides,
  } as AssistantToolSpec
}

// A fake read-risk spec, for pinning that `ctx.simulate` never touches reads
// (the fixed catalogue only has search, and its behavior is
// covered end to end above; the resolver test below wants a second read spec).
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
  mockPostsRetrieve.mockResolvedValue([])
  mockSnippetsRetrieve.mockResolvedValue([])
  mockConversationSummariesRetrieve.mockResolvedValue([])
  mockTicketsRetrieve.mockResolvedValue([])
  mockChangelogRetrieve.mockResolvedValue([])
})

describe('search', () => {
  it('retrieves audience-scoped, records sources in the ledger, and allowlists output', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1', { content: 'X'.repeat(5000) })])
    const c = ctx({ audience: 'team' })
    const search = await findTool(c, 'search')

    const out = (await search.execute({ query: 'billing' }, toolCtx(c))) as {
      results: Array<{ id: string; title: string; snippet: string }>
    }

    expect(mockRetrieve).toHaveBeenCalledWith('billing', { audience: 'team' })
    expect(out.results).toHaveLength(1)
    expect(out.results[0]).toEqual({
      id: 'kb_article_1',
      kind: 'article',
      title: 'Title kb_article_1',
      snippet: expect.any(String),
    })
    expect(out.results[0].snippet.length).toBeLessThanOrEqual(1200)
    expect(c.ledger.sources.get('kb_article_1')).toEqual({
      type: 'article',
      id: 'kb_article_1',
      title: 'Title kb_article_1',
      url: '/hc/articles/general/slug-kb_article_1',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
  })

  it('leaves the ledger empty when nothing clears the confidence floor', async () => {
    mockRetrieve.mockResolvedValue([])
    const c = ctx()
    const search = await findTool(c, 'search')
    const out = (await search.execute({ query: 'nope' }, toolCtx(c))) as { results: unknown[] }
    expect(out.results).toEqual([])
    expect(c.ledger.sources.size).toBe(0)
  })

  it('frames a non-empty result with the shared content-not-instructions note (retrieval is the fourth guard surface)', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    const c = ctx()
    const search = await findTool(c, 'search')

    const out = (await search.execute({ query: 'billing' }, toolCtx(c))) as { note?: string }

    expect(out.note).toBe(RETRIEVED_CONTENT_NOTE)
    expect(out.note).toContain('not instructions')
  })

  it('an empty result carries the resolution-contract note, not the untrusted-content framing', async () => {
    mockRetrieve.mockResolvedValue([])
    const c = ctx()
    const search = await findTool(c, 'search')

    const out = (await search.execute({ query: 'nope' }, toolCtx(c))) as { note?: string }

    // Restates the post-miss contract (answer from admin-stated facts, refine
    // once, or resolve honestly) at the most recent point the model reads.
    expect(out.note).toContain('No results.')
    expect(out.note).not.toContain('does not carry instructions')
  })

  it("records each surfaced source's updatedAt on the ledgered citation itself (stripped only at persistence)", async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    const c = ctx()
    const search = await findTool(c, 'search')

    await search.execute({ query: 'billing' }, toolCtx(c))

    expect(c.ledger.sources.get('kb_article_1')?.updatedAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('ends exploration past the per-turn search budget with an answer-now note', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    const c = ctx()
    const search = await findTool(c, 'search')
    for (let i = 0; i < 3; i++) await search.execute({ query: `q${i}` }, toolCtx(c))
    expect(mockRetrieve).toHaveBeenCalledTimes(3)

    const out = (await search.execute({ query: 'q4' }, toolCtx(c))) as {
      results: unknown[]
      note?: string
    }
    expect(mockRetrieve).toHaveBeenCalledTimes(3)
    expect(out.results).toEqual([])
    expect(out.note).toMatch(/answer/i)
    expect(c.ledger.sources.has('kb_article_1')).toBe(true)
  })

  it("forwards the context's sourceTypes into retrieveKnowledge, narrowing away the knowledge base", async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    // sourceTypes excludes 'article': the only registered source (flags off)
    // gets filtered out entirely, so retrieveKbArticles is never called.
    const c = ctx({ sourceTypes: ['post'] })
    const search = await findTool(c, 'search')

    const out = (await search.execute({ query: 'billing' }, toolCtx(c))) as { results: unknown[] }

    expect(mockRetrieve).not.toHaveBeenCalled()
    expect(out.results).toEqual([])
  })

  it("threads the context's customerPrincipalId and conversationId into the past-conversation-summaries source", async () => {
    mockRetrieve.mockResolvedValue([])
    const c = ctx({
      customerPrincipalId: 'principal_customer_1' as never,
      conversationId: 'conversation_current' as never,
      knowledge: ALL_KNOWLEDGE,
    })
    const search = await findTool(c, 'search')

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
    mockRetrieve.mockResolvedValue([])
    const c = ctx({ conversationId: null, knowledge: ALL_KNOWLEDGE })
    const search = await findTool(c, 'search')

    await search.execute({ query: 'billing' }, toolCtx(c))

    expect(mockConversationSummariesRetrieve).toHaveBeenCalledWith(
      'billing',
      'public',
      expect.objectContaining({ customerPrincipalId: undefined })
    )
  })
})

describe('assembleAssistantToolset: assistant actions flag', () => {
  it('returns the read tool plus core control tools with no pipeline wrapping when the flag is off', async () => {
    const tools = await assembleTools(ctx())
    expect(tools.map((t) => t.name).sort()).toEqual(['report_inability', 'search'])
  })

  it('exposes the write tools too when actions are enabled', async () => {
    const tools = await assembleTools(ctx(), undefined, true)
    // Read + control tools plus the default-active write tools.
    expect(tools.map((t) => t.name)).toContain('search')
    expect(tools.map((t) => t.name)).toContain('set_attribute')
  })

  it('read tools always run — there is no per-tool off switch', async () => {
    const tools = await assembleTools(ctx(), undefined, true)
    expect(tools.map((t) => t.name)).toContain('search')
  })
})

describe('assembleAssistantToolset: write-policy gating', () => {
  it('does not register a write tool when the turn policy is disabled (proactive-suggestions)', async () => {
    const tools = await assembleTools(ctx({ writeToolPolicy: 'disabled' }), [makeFakeWriteSpec()])
    expect(tools).toHaveLength(0)
  })

  it('registers a write tool for a real customer-support turn (autonomous execution)', async () => {
    const tools = await assembleTools(
      ctx({ conversationId: 'conversation_1' as never, writeToolPolicy: 'execute' }),
      [makeFakeWriteSpec()]
    )
    expect(tools.map((t) => t.name)).toEqual(['close_conversation'])
  })

  it('a read tool is never dropped by the write policy', async () => {
    const tools = await assembleTools(ctx({ writeToolPolicy: 'disabled' }), undefined, true)
    expect(tools.map((t) => t.name)).toContain('search')
  })
})

describe('assembleAssistantToolset: parent-kind gating (unified inbox §2.9/§3.3)', () => {
  it('never offers a conversation-only write tool on a ticket-scoped turn', async () => {
    const c = ctx({ conversationId: null, ticketId: 'ticket_1' as never })
    const tools = await assembleTools(c, [makeFakeWriteSpec()])

    expect(tools).toHaveLength(0)
  })

  it('still offers a conversation-only write tool on a conversation-scoped turn', async () => {
    const c = ctx({ conversationId: 'conversation_1' as never })
    const tools = await assembleTools(c, [makeFakeWriteSpec()])

    expect(tools.map((t) => t.name)).toEqual(['close_conversation'])
  })

  it('offers a tool declaring both parents on a ticket-scoped turn too', async () => {
    const c = ctx({ conversationId: null, ticketId: 'ticket_1' as never })
    const tools = await assembleTools(c, [
      makeFakeReadSpec({ parents: ['conversation', 'ticket'] }),
    ])

    expect(tools.map((t) => t.name)).toEqual(['lookup_thing'])
  })

  it('filters the same way with the assistantTools flag off (legacy read-only branch)', async () => {
    const c = ctx({ conversationId: null, ticketId: 'ticket_1' as never })
    // A conversation-only read spec (hypothetical: today's only read tool,
    // search, declares both) must still be excluded here too.
    const tools = await assembleTools(c, [makeFakeReadSpec({ parents: ['conversation'] })])

    expect(tools).toHaveLength(0)
  })

  it('a null-null context (sandbox) falls back to conversation parent, matching pre-ticket behavior', async () => {
    const c = ctx({ conversationId: null, simulate: true })
    const tools = await assembleTools(c, [makeFakeWriteSpec()])

    expect(tools.map((t) => t.name)).toEqual(['close_conversation'])
  })
})

describe('assembleAssistantToolset', () => {
  it('pairs each wired tool with the spec that produced it, index-aligned', async () => {
    const { tools, activeSpecs } = await assembleAssistantToolset(ctx())
    expect(tools.map((t) => t.name)).toEqual(activeSpecs.map((s) => s.name))
    expect(
      activeSpecs.every((s) => typeof s.promptGuidance === 'string' && s.promptGuidance.length > 0)
    ).toBe(true)
  })
})

describe('assembleAssistantToolset: write-tool pipeline (propose mode)', () => {
  it('proposes a pending action, returns a pending_approval note, records it on ctx.ledger.proposedActions, and never executes', async () => {
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: 'conversation_1' as never,
      involvementId: 'assistant_involvement_1' as never,
      writeToolPolicy: 'propose',
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
      originRole: 'customer_support',
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
    // Mirrors ctx.ledger.sources for citations: the pipeline records what it
    // proposed, keyed off the row proposePendingAction actually created.
    expect(c.ledger.proposedActions).toEqual([
      {
        id: 'assistant_action_1',
        toolName: 'close_conversation',
        summary: 'Close conversation: resolved',
        label: 'Close conversation',
      },
    ])
  })

  it('computes the same-shaped idempotency key the autonomous branch claims with, so a retry can dedupe (S1)', async () => {
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: 'conversation_1' as never,
      latestCustomerMessageId: 'conversation_message_1',
      writeToolPolicy: 'propose',
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
      writeToolPolicy: 'propose',
    })
    const tool1 = await findTool(c1, 'close_conversation', [makeFakeWriteSpec()])
    await tool1.execute({ reason: 'resolved' }, toolCtx(c1))

    const c2 = ctx({
      conversationId: 'conversation_1' as never,
      latestCustomerMessageId: 'conversation_message_1',
      writeToolPolicy: 'propose',
    })
    const tool2 = await findTool(c2, 'close_conversation', [makeFakeWriteSpec()])
    await tool2.execute({ reason: 'resolved' }, toolCtx(c2))

    expect(c1.ledger.proposedActions[0].id).toBe(c2.ledger.proposedActions[0].id)
    expect(mockProposePendingAction).toHaveBeenCalledTimes(2)
  })

  it('proposes against the ticket parent (not conversationId) for a ticket-scoped context (unified inbox §2.9)', async () => {
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: null,
      ticketId: 'ticket_1' as never,
      involvementId: 'assistant_involvement_1' as never,
      writeToolPolicy: 'propose',
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
      originRole: 'customer_support',
      // Falls back to ticketId (not the bare "null" a naive conversationId-only
      // key would produce) so two different tickets proposing the same tool
      // with the same args never collide — see resolveIdempotencyKey's doc.
      idempotencyKey: expect.stringMatching(/^ticket_1:null:close_conversation:[0-9a-f]{64}$/),
    })
  })
})

describe('assembleAssistantToolset: propose policy (copilot Q&A)', () => {
  it('proposes a write tool instead of executing it', async () => {
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({
      conversationId: 'conversation_1' as never,
      role: 'copilot_qa',
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
    expect(c.ledger.proposedActions).toEqual([
      {
        id: 'assistant_action_1',
        toolName: 'close_conversation',
        summary: 'Close conversation: resolved',
        label: 'Close conversation',
      },
    ])
  })

  it.each(['customer_support', 'copilot_qa'] as const)(
    'turns set_attribute into a proposal for %s and records the origin role',
    async (role) => {
      mockProposePendingAction.mockResolvedValue({ id: `assistant_action_${role}` })
      const c = ctx({
        conversationId: 'conversation_1' as never,
        role,
        writeToolPolicy: 'propose',
      })
      const tool = await findTool(c, 'set_attribute', [ASSISTANT_TOOL_SPECS.set_attribute])

      const out = await tool.execute({ key: 'plan_tier', value: 'pro' }, toolCtx(c))

      expect(out).toEqual({
        status: 'pending_approval',
        note: expect.any(String),
      })
      expect(mockProposePendingAction).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'set_attribute',
          originRole: role,
        })
      )
      expect(mockWriteExecute).not.toHaveBeenCalled()
    }
  )

  it('actions disabled still excludes write tools but keeps core controls', async () => {
    const tools = await assembleTools(ctx({ writeToolPolicy: 'propose' }))

    expect(tools.map((t) => t.name)).toEqual(['search', 'report_inability'])
  })
})

describe('assembleAssistantToolset: write-tool pipeline (autonomous mode)', () => {
  function autonomousCtx(overrides: Partial<AssistantToolContext> = {}) {
    return ctx({ conversationId: 'conversation_1' as never, ...overrides })
  }

  it('denies a call missing a required permission, records the denial, and never executes', async () => {
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
    mockClaimToolCall.mockResolvedValue({ id: 'assistant_tool_call_1', status: 'started' })
    mockWriteExecute.mockResolvedValue({ closed: true })

    const c = autonomousCtx({ latestCustomerMessageId: 'conversation_message_1' })
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec({ permissions: [] })])
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
    expect(c.ledger.toolOutcomes).toEqual([{ name: 'close_conversation', outcome: 'executed' }])
  })

  it('skips a duplicate claim and never executes', async () => {
    mockClaimToolCall.mockResolvedValue(null)

    const c = autonomousCtx()
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec({ permissions: [] })])
    const out = (await tool.execute({ reason: 'resolved' }, toolCtx(c))) as { status: string }

    expect(out.status).toBe('skipped_duplicate')
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockFinalizeToolCall).not.toHaveBeenCalled()
  })

  it('finalizes failed and returns a graceful note when execute throws (never crashes the turn)', async () => {
    mockClaimToolCall.mockResolvedValue({ id: 'assistant_tool_call_1', status: 'started' })
    mockWriteExecute.mockRejectedValue(new Error('boom'))

    const c = autonomousCtx()
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec({ permissions: [] })])
    const out = (await tool.execute({ reason: 'resolved' }, toolCtx(c))) as { status: string }

    expect(out.status).toBe('failed')
    expect(mockFinalizeToolCall).toHaveBeenCalledWith(
      'assistant_tool_call_1',
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('boom') })
    )
  })

  it('skips claim and audit entirely for a read-risk tool', async () => {
    mockRetrieve.mockResolvedValue([])

    const c = autonomousCtx()
    const tool = await findTool(c, 'search')
    await tool.execute({ query: 'x' }, toolCtx(c))

    expect(mockClaimToolCall).not.toHaveBeenCalled()
    expect(mockFinalizeToolCall).not.toHaveBeenCalled()
  })
})

describe('assembleAssistantToolset: sandbox simulate mode', () => {
  it('skips claim, execute, and audit for a write tool and returns a simulated summary', async () => {
    const c = ctx({ conversationId: null, simulate: true, writeToolPolicy: 'simulate' })
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec()])
    const out = await tool.execute({ reason: 'resolved' }, toolCtx(c))

    expect(out).toEqual({ simulated: true, summary: 'Close conversation: resolved' })
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockClaimToolCall).not.toHaveBeenCalled()
    expect(mockProposePendingAction).not.toHaveBeenCalled()
  })

  it('still executes a read tool normally in simulate mode', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])

    const c = ctx({ conversationId: null, simulate: true })
    const tool = await findTool(c, 'search')
    const out = (await tool.execute({ query: 'billing' }, toolCtx(c))) as { results: unknown[] }

    expect(mockRetrieve).toHaveBeenCalled()
    expect(out.results).toHaveLength(1)
  })
})

describe('knowledge-snapshot registration (D7)', () => {
  async function toolNames(c: AssistantToolContext) {
    return (await assembleTools(c)).map((t) => t.name)
  }

  it('registers search iff ≥1 retrieval source is enabled', async () => {
    const withArticle = await toolNames(
      ctx({ knowledge: { sources: new Set(['article']), status: false } })
    )
    expect(withArticle).toContain('search')

    const noSources = await toolNames(ctx({ knowledge: { sources: new Set(), status: false } }))
    expect(noSources).not.toContain('search')
  })

  it('registers get_status iff the status toggle is on', async () => {
    const statusOn = await toolNames(
      ctx({ knowledge: { sources: new Set(['article']), status: true } })
    )
    expect(statusOn).toContain('get_status')

    const statusOff = await toolNames(
      ctx({ knowledge: { sources: new Set(['article']), status: false } })
    )
    expect(statusOff).not.toContain('get_status')
  })

  it("folds the enabled-source enumeration into search's promptGuidance", async () => {
    const { activeSpecs } = await assembleAssistantToolset(
      ctx({ knowledge: { sources: new Set(['article', 'post']), status: false } })
    )
    const search = activeSpecs.find((s) => s.name === 'search')!
    expect(search.promptGuidance).toContain('help center articles')
    expect(search.promptGuidance).toContain('feedback posts')
    // Posts carry the customer-feedback caveat.
    expect(search.promptGuidance).toMatch(/customer feedback, not/i)
  })
})

describe('resolveEffectiveToolMode', () => {
  // The matrix behind the pipeline's single execution decision: risk x
  // simulate x writeToolPolicy, decoupled from any saved per-tool config (the
  // control-mode dial is gone). Every row pins an observable outcome one of
  // the tests above exercises end to end through
  // assembleAssistantToolset/runWithPipeline.

  it('resolves a read tool to autonomous regardless of simulate or write policy', () => {
    const spec = makeFakeReadSpec()
    expect(resolveEffectiveToolMode(spec, ctx({ simulate: false }))).toBe('autonomous')
    expect(resolveEffectiveToolMode(spec, ctx({ simulate: true }))).toBe('autonomous')
    expect(resolveEffectiveToolMode(spec, ctx({ writeToolPolicy: 'propose' }))).toBe('autonomous')
    expect(resolveEffectiveToolMode(spec, ctx({ writeToolPolicy: 'disabled' }))).toBe('autonomous')
  })

  it("resolves a write tool to autonomous for a real customer-support turn ('execute')", () => {
    const spec = makeFakeWriteSpec()
    expect(
      resolveEffectiveToolMode(spec, ctx({ simulate: false, writeToolPolicy: 'execute' }))
    ).toBe('autonomous')
  })

  it('resolves a write tool to autonomous when no write policy is set and simulate is false', () => {
    const spec = makeFakeWriteSpec()
    expect(resolveEffectiveToolMode(spec, ctx({ simulate: false }))).toBe('autonomous')
  })

  it("today's sandbox default: a write tool under simulate resolves to 'simulate'", () => {
    const spec = makeFakeWriteSpec()
    expect(resolveEffectiveToolMode(spec, ctx({ simulate: true }))).toBe('simulate')
  })

  it("an explicit writeToolPolicy: 'simulate' behaves exactly like the unset default under simulate", () => {
    const spec = makeFakeWriteSpec()
    const c = ctx({ simulate: true, writeToolPolicy: 'simulate' })
    expect(resolveEffectiveToolMode(spec, c)).toBe('simulate')
  })

  it("P2-C.4: writeToolPolicy: 'propose' proposes a write tool, simulate notwithstanding", () => {
    const spec = makeFakeWriteSpec()
    expect(
      resolveEffectiveToolMode(spec, ctx({ simulate: false, writeToolPolicy: 'propose' }))
    ).toBe('propose')
    expect(
      resolveEffectiveToolMode(spec, ctx({ simulate: true, writeToolPolicy: 'propose' }))
    ).toBe('propose')
  })

  it.each(['customer_support', 'copilot_qa'] as const)(
    'proposes every static write, including set_attribute, for %s under the propose policy',
    (role) => {
      const c = ctx({ role, simulate: false, writeToolPolicy: 'propose' })
      const writes = Object.values(ASSISTANT_TOOL_SPECS).filter((spec) => spec.risk === 'write')

      expect(writes.map((spec) => spec.name)).toContain('set_attribute')
      for (const spec of writes) {
        expect(resolveEffectiveToolMode(spec, c), spec.name).toBe('propose')
      }
    }
  )

  it('executes every static write autonomously for a real customer-support turn', () => {
    const c = ctx({
      role: 'customer_support',
      conversationId: 'conversation_1' as never,
      simulate: false,
      writeToolPolicy: 'execute',
    })
    const writes = Object.values(ASSISTANT_TOOL_SPECS).filter((spec) => spec.risk === 'write')

    expect(writes.map((spec) => spec.name)).toContain('set_attribute')
    for (const spec of writes) {
      expect(resolveEffectiveToolMode(spec, c), spec.name).toBe('autonomous')
    }
  })

  it('keeps explicit simulation simulated for every write', () => {
    const c = ctx({ simulate: true, writeToolPolicy: 'simulate' })
    const writes = Object.values(ASSISTANT_TOOL_SPECS).filter((spec) => spec.risk === 'write')
    for (const spec of writes) {
      expect(resolveEffectiveToolMode(spec, c), spec.name).toBe('simulate')
    }
  })

  it("QUINN-PROACTIVE-SUGGESTIONS-SPEC.md: writeToolPolicy: 'disabled' drops a write tool", () => {
    const spec = makeFakeWriteSpec()
    expect(
      resolveEffectiveToolMode(spec, ctx({ simulate: false, writeToolPolicy: 'disabled' }))
    ).toBe('disabled')
  })

  it("writeToolPolicy: 'disabled' wins over simulate too", () => {
    const spec = makeFakeWriteSpec()
    expect(
      resolveEffectiveToolMode(spec, ctx({ simulate: true, writeToolPolicy: 'disabled' }))
    ).toBe('disabled')
  })

  it("the 'disabled' policy disables every static write, including set_attribute", () => {
    const c = ctx({ simulate: false, writeToolPolicy: 'disabled' })
    const writes = Object.values(ASSISTANT_TOOL_SPECS).filter((spec) => spec.risk === 'write')
    for (const spec of writes) {
      expect(resolveEffectiveToolMode(spec, c), spec.name).toBe('disabled')
    }
  })

  it('control tools are always autonomous, whatever the write policy', () => {
    const controls = Object.values(ASSISTANT_TOOL_SPECS).filter((spec) => spec.risk === 'control')
    expect(controls.length).toBeGreaterThan(0)
    for (const spec of controls) {
      expect(resolveEffectiveToolMode(spec, ctx({ writeToolPolicy: 'disabled' })), spec.name).toBe(
        'autonomous'
      )
      expect(resolveEffectiveToolMode(spec, ctx({ writeToolPolicy: 'propose' })), spec.name).toBe(
        'autonomous'
      )
    }
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
