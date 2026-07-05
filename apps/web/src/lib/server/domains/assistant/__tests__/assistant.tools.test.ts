import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeKbArticle } from './kb-fixtures'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const mockRetrieve = vi.fn()
vi.mock('../retrieval', () => ({
  retrieveKbArticles: (...args: unknown[]) => mockRetrieve(...args),
}))

const mockListMessages = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listMessages: (...args: unknown[]) => mockListMessages(...args),
}))

import { createAssistantTools } from '../assistant.tools'
import type { AssistantCitation, AssistantToolContext } from '../assistant.toolspec'

// The tool array is heterogeneous; expose a loosely-typed execute for the test.
function findTool(name: string): { execute: (args: unknown, ctx: unknown) => Promise<unknown> } {
  const tool = createAssistantTools().find((t) => t.name === name)
  if (!tool?.execute) throw new Error(`tool ${name} not found`)
  return { execute: tool.execute as (args: unknown, ctx: unknown) => Promise<unknown> }
}

function ctx(overrides: Partial<AssistantToolContext> = {}): AssistantToolContext {
  return {
    db: {} as never,
    assistantPrincipalId: 'principal_assistant' as never,
    audience: 'public',
    conversationId: null,
    sources: new Map<string, AssistantCitation>(),
    searchCalls: 0,
    ...overrides,
  }
}

function toolCtx(c: AssistantToolContext) {
  return { context: c, emitCustomEvent: () => {} }
}

beforeEach(() => vi.clearAllMocks())

describe('search_knowledge', () => {
  it('retrieves audience-scoped, records sources in the ledger, and allowlists output', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1', { content: 'X'.repeat(5000) })])
    const c = ctx({ audience: 'team' })
    const search = findTool('search_knowledge')

    const out = (await search.execute({ query: 'billing' }, toolCtx(c))) as {
      articles: Array<{ id: string; title: string; snippet: string }>
    }

    expect(mockRetrieve).toHaveBeenCalledWith('billing', { audience: 'team' })
    // Output is allowlisted to id/title/snippet, snippet trimmed.
    expect(out.articles).toHaveLength(1)
    expect(out.articles[0]).toEqual({
      id: 'kb_article_1',
      title: 'Title kb_article_1',
      snippet: expect.any(String),
    })
    expect(out.articles[0].snippet.length).toBeLessThanOrEqual(1200)
    // Ledger enriched for citation assembly (title + url the viewer can reach).
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
    const out = (await findTool('search_knowledge').execute({ query: 'nope' }, toolCtx(c))) as {
      articles: unknown[]
    }
    expect(out.articles).toEqual([])
    expect(c.sources.size).toBe(0)
  })

  it('ends exploration past the per-turn search budget with an answer-now note', async () => {
    mockRetrieve.mockResolvedValue([makeKbArticle('kb_article_1')])
    const c = ctx()
    const search = findTool('search_knowledge')
    for (let i = 0; i < 3; i++) await search.execute({ query: `q${i}` }, toolCtx(c))
    expect(mockRetrieve).toHaveBeenCalledTimes(3)

    const out = (await search.execute({ query: 'q4' }, toolCtx(c))) as {
      articles: unknown[]
      note?: string
    }
    // The budgeted call performs no retrieval and instructs the model to answer.
    expect(mockRetrieve).toHaveBeenCalledTimes(3)
    expect(out.articles).toEqual([])
    expect(out.note).toMatch(/answer/i)
    // Ledger keeps everything already retrieved for citation assembly.
    expect(c.sources.has('kb_article_1')).toBe(true)
  })
})

describe('get_conversation_context', () => {
  it('returns not-linked without a conversation (sandbox)', async () => {
    const out = await findTool('get_conversation_context').execute({}, toolCtx(ctx()))
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

    const out = (await findTool('get_conversation_context').execute(
      {},
      toolCtx(ctx({ conversationId: 'conversation_1' as never, db: fakeDb as never }))
    )) as { linked: boolean; status: string; assignedToHuman: boolean; messages: unknown[] }

    expect(out.linked).toBe(true)
    expect(out.status).toBe('open')
    expect(out.assignedToHuman).toBe(true)
    // Only sender + text cross the boundary; no internal fields.
    expect(out.messages).toEqual([
      { sender: 'visitor', text: 'help' },
      { sender: 'agent', text: 'hi' },
    ])
  })
})
