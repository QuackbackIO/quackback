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

const mockListMessages = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
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
  mockIsFeatureEnabled.mockImplementation(async (flag: string) => flag === 'assistantActions' && enabled)
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

import { assembleAssistantTools } from '../assistant.tools'
import { makeToolTestContext, fakePendingActionRow } from './assistant-tool-fixtures'
import type { AssistantToolContext, AssistantToolSpec } from '../assistant.toolspec'

const ctx = makeToolTestContext

function toolCtx(c: AssistantToolContext) {
  return { context: c, emitCustomEvent: () => {} }
}

async function findTool(
  c: AssistantToolContext,
  name: string,
  specs?: readonly AssistantToolSpec[]
): Promise<{ execute: (args: unknown, o: unknown) => Promise<unknown> }> {
  const tools = specs ? await assembleAssistantTools(c, specs) : await assembleAssistantTools(c)
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
    risk: 'write',
    supportedModes: ['disabled', 'approval', 'autonomous'],
    defaultMode: 'approval',
    permissions: [PERMISSIONS.CONVERSATION_SET_STATUS],
    definition: fakeWriteDefinition,
    execute: mockWriteExecute,
    summarize: (args) => `Close conversation: ${(args as { reason: string }).reason}`,
    ...overrides,
  } as AssistantToolSpec
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(false)
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
})

describe('get_conversation_context', () => {
  it('returns not-linked without a conversation (sandbox)', async () => {
    const c = ctx()
    const tool = await findTool(c, 'get_conversation_context')
    const out = await tool.execute({}, toolCtx(c))
    expect(out).toEqual({
      linked: false,
      status: null,
      priority: null,
      assignedToHuman: false,
      messages: [],
    })
    expect(mockListMessages).not.toHaveBeenCalled()
  })

  it('reads the conversation and allowlists status/priority/assignment + recent messages', async () => {
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                { status: 'open', priority: 'high', assignedAgentPrincipalId: 'principal_agent' },
              ]),
          }),
        }),
      }),
    }
    mockListMessages.mockResolvedValue({
      messages: [
        { senderType: 'visitor', content: 'help', foo: 'secret' },
        { senderType: 'agent', content: 'hi', bar: 'secret' },
      ],
      hasMore: false,
      nextCursor: null,
    })

    const c = ctx({ conversationId: 'conversation_1' as never, db: fakeDb as never })
    const tool = await findTool(c, 'get_conversation_context')
    const out = (await tool.execute({}, toolCtx(c))) as {
      linked: boolean
      status: string
      assignedToHuman: boolean
      messages: unknown[]
    }

    expect(out.linked).toBe(true)
    expect(out.status).toBe('open')
    expect(out.assignedToHuman).toBe(true)
    expect(out.messages).toEqual([
      { sender: 'visitor', text: 'help' },
      { sender: 'agent', text: 'hi' },
    ])
  })
})

describe('assembleAssistantTools: assistant actions flag', () => {
  it('returns exactly the two read tools with no pipeline wrapping when the flag is off', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false)
    const tools = await assembleAssistantTools(ctx())
    expect(tools.map((t) => t.name).sort()).toEqual(['get_conversation_context', 'search_knowledge'])
    // Byte-identical legacy behavior: no settings read beyond the flag itself.
    expect(mockGetAssistantToolControls).not.toHaveBeenCalled()
  })

  it('reads the flag and controls exactly once per assembly when the flag is on', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({})
    await assembleAssistantTools(ctx())
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
    const tools = await assembleAssistantTools(ctx(), undefined, { search_knowledge: 'disabled' })
    expect(tools.map((t) => t.name)).not.toContain('search_knowledge')
    expect(mockGetAssistantToolControls).not.toHaveBeenCalled()
  })
})

describe('assembleAssistantTools: control-mode gating', () => {
  it('does not register a disabled tool', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'disabled' })
    const tools = await assembleAssistantTools(ctx(), [makeFakeWriteSpec()])
    expect(tools).toHaveLength(0)
  })

  it('fails closed to disabled (with a warning) when the saved mode is not supported', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })
    const spec = makeFakeWriteSpec({ supportedModes: ['disabled', 'approval'] })
    const tools = await assembleAssistantTools(ctx(), [spec])
    expect(tools).toHaveLength(0)
    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it('read tools still respect disabled mode when actions are on', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ search_knowledge: 'disabled' })
    const tools = await assembleAssistantTools(ctx())
    expect(tools.map((t) => t.name)).not.toContain('search_knowledge')
    expect(tools.map((t) => t.name)).toContain('get_conversation_context')
  })
})

describe('assembleAssistantTools: write-tool pipeline (approval mode)', () => {
  it('proposes a pending action, returns a pending_approval note, and never executes', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'approval' })
    mockProposePendingAction.mockResolvedValue({ id: 'assistant_action_1' })

    const c = ctx({ conversationId: 'conversation_1' as never, involvementId: 'assistant_involvement_1' as never })
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
    })
    expect(out.status).toBe('pending_approval')
    expect(typeof out.note).toBe('string')
    expect(mockWriteExecute).not.toHaveBeenCalled()
    expect(mockClaimToolCall).not.toHaveBeenCalled()
  })
})

describe('assembleAssistantTools: write-tool pipeline (autonomous mode)', () => {
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

describe('assembleAssistantTools: sandbox simulate mode', () => {
  it('skips claim, execute, and audit for a write tool and returns a simulated summary', async () => {
    mockActionsFlag(true)
    mockGetAssistantToolControls.mockResolvedValue({ close_conversation: 'autonomous' })

    const c = ctx({ conversationId: null, simulate: true })
    const tool = await findTool(c, 'close_conversation', [makeFakeWriteSpec({ defaultMode: 'autonomous' })])
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
})

// The registry's exact contents are pinned by assistant.toolspec.test.ts;
// this file only asserts how assembly treats what the registry returns.
