/**
 * Opening a conversation in the agent inbox fetches the thread and the reads
 * beside it (linked ticket, contact card, company, block state, previous
 * conversations, Quinn's activity, the composer's pickers) in one request,
 * and seeds each read's own query from the answer so none of them asks on its
 * own. A read whose cache is still fresh is not asked for again, and the
 * detail panel's own reads are only asked for where the panel shows.
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'

const mockGetConversation = vi.fn()
vi.mock('@/lib/server/functions/conversation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/conversation')>()),
  getConversationFn: (...args: unknown[]) => mockGetConversation(...args),
}))

const { conversationInboxQueries } = await import('../conversation-inbox')
const { conversationPanelQueries } = await import('../conversation-panels')
const { conversationPanelEntries } = await import('../conversation-panel-cache')
const { teamMembersQuery } = await import('@/lib/client/hooks/use-team-members')
const { inboxQueries, ticketQueries } = await import('../inbox')
const { macrosQuery } = await import('../macros')
const { runnableWorkflowsQuery } = await import('../workflows')

const CONVERSATION = 'conversation_01h00000000000000000000000' as ConversationId
const VISITOR = 'principal_01h00000000000000000000000' as PrincipalId
const TICKET = 'ticket_01h00000000000000000000000' as TicketId
const LINK = { id: TICKET, number: 7, title: 'Broken', statusName: 'Open', statusCategory: 'open' }

const PANELS = {
  ticketLink: LINK,
  linkedTicket: { id: TICKET, title: 'Broken' },
  blockStatus: { blockedAt: null },
  contact: { principalId: VISITOR, name: 'Vic' },
  history: { conversations: [], hasMore: false, nextCursor: null },
  company: null,
  assistantActivity: null,
  languagePreference: 'fr',
  macros: { macros: [] },
  runnableWorkflows: [],
  teamMembers: [{ id: 'principal_a' }],
  ticketStageLabels: { received: 'Received' },
}
const ALL = Object.keys(PANELS).sort()
const PANEL_ONLY = ['contact', 'history', 'company', 'assistantActivity']

function threadPayload(panels?: Record<string, unknown>) {
  return {
    conversation: { id: CONVERSATION, visitor: { principalId: VISITOR } },
    messages: [],
    hasMore: false,
    ...(panels ? { panels } : {}),
  }
}

function requestedPanels(): string[] | undefined {
  const [{ data }] = mockGetConversation.mock.calls.at(-1) as [{ data: { panels?: string[] } }]
  return data.panels ? [...data.panels].sort() : undefined
}

function showPanel(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }))
}

let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  showPanel(true)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => vi.unstubAllGlobals())

describe('conversationInboxQueries.thread with the panels beside it', () => {
  it('asks for every panel on first open and seeds each panel query', async () => {
    mockGetConversation.mockResolvedValueOnce(threadPayload(PANELS))

    const thread = await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))

    expect(requestedPanels()).toEqual(ALL)
    expect(client.getQueryData(inboxQueries.conversationTicketLink(CONVERSATION).queryKey)).toEqual(
      LINK
    )
    expect(client.getQueryData(inboxQueries.ticketDetail(TICKET).queryKey)).toEqual(
      PANELS.linkedTicket
    )
    const q = conversationPanelQueries
    expect(client.getQueryData(q.blockStatus(VISITOR).queryKey)).toEqual(PANELS.blockStatus)
    expect(client.getQueryData(q.contact(VISITOR).queryKey)).toEqual(PANELS.contact)
    expect(client.getQueryData(q.history(VISITOR).queryKey)).toEqual(PANELS.history)
    expect(client.getQueryData(q.company(VISITOR).queryKey)).toBeNull()
    expect(client.getQueryData(q.assistantActivity(CONVERSATION).queryKey)).toBeNull()
    expect(client.getQueryData(q.languagePreference().queryKey)).toBe('fr')
    expect(client.getQueryData(teamMembersQuery().queryKey)).toEqual(PANELS.teamMembers)
    expect(client.getQueryData(macrosQuery('support').queryKey)).toEqual(PANELS.macros)
    expect(client.getQueryData(runnableWorkflowsQuery().queryKey)).toEqual([])
    expect(client.getQueryData(ticketQueries.stageLabels().queryKey)).toEqual(
      PANELS.ticketStageLabels
    )
    // The panels live in their own caches, not inside the thread entry.
    expect(thread).not.toHaveProperty('panels')
    expect(thread.conversation.id).toBe(CONVERSATION)
  })

  it("does not ask again for panels whose caches are fresh, checked against the thread's visitor", async () => {
    mockGetConversation.mockResolvedValueOnce(threadPayload(PANELS))
    await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))
    await client.invalidateQueries({
      queryKey: conversationInboxQueries.thread(CONVERSATION).queryKey,
    })
    mockGetConversation.mockResolvedValueOnce(threadPayload({}))

    await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))

    expect(requestedPanels()).toBeUndefined()
  })

  it('asks again for a panel whose cache has gone stale', async () => {
    mockGetConversation.mockResolvedValueOnce(threadPayload(PANELS))
    await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))
    client.setQueryData(teamMembersQuery().queryKey, [], {
      updatedAt: Date.now() - 10 * 60_000,
    })
    await client.invalidateQueries({
      queryKey: conversationInboxQueries.thread(CONVERSATION).queryKey,
    })
    mockGetConversation.mockResolvedValueOnce(threadPayload({}))

    await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))

    expect(requestedPanels()).toEqual(['teamMembers'])
  })

  it("leaves the detail panel's own reads out where the panel does not show", async () => {
    showPanel(false)
    mockGetConversation.mockResolvedValueOnce(threadPayload({}))

    await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))

    expect(requestedPanels()).toEqual(ALL.filter((p) => !PANEL_ONLY.includes(p)))
  })

  it('asks for no ticket read while a conversation is fresh-known to have no ticket', async () => {
    client.setQueryData(inboxQueries.conversationTicketLink(CONVERSATION).queryKey, null)
    mockGetConversation.mockResolvedValueOnce(threadPayload({}))

    await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))

    expect(requestedPanels()).not.toContain('ticketLink')
    expect(requestedPanels()).not.toContain('linkedTicket')
    expect(requestedPanels()).not.toContain('ticketStageLabels')
  })

  it('leaves a panel the server did not answer to fetch on its own', async () => {
    const { teamMembers: _withheld, ...rest } = PANELS
    mockGetConversation.mockResolvedValueOnce(threadPayload(rest))

    await client.fetchQuery(conversationInboxQueries.thread(CONVERSATION))

    expect(client.getQueryData(teamMembersQuery().queryKey)).toBeUndefined()
    expect(client.getQueryData(macrosQuery('support').queryKey)).toEqual(PANELS.macros)
  })
})

describe('conversationPanelEntries', () => {
  it("matches each read's own query factory, key and freshness", () => {
    const e = conversationPanelEntries
    const q = conversationPanelQueries
    type Entry = { queryKey: readonly unknown[]; staleTime?: unknown }
    const pairs: [Entry, Entry][] = [
      [e.ticketLink(CONVERSATION), inboxQueries.conversationTicketLink(CONVERSATION)],
      [e.linkedTicket(TICKET), inboxQueries.ticketDetail(TICKET)],
      [e.ticketStageLabels(), ticketQueries.stageLabels()],
      [e.blockStatus(VISITOR), q.blockStatus(VISITOR)],
      [e.contact(VISITOR), q.contact(VISITOR)],
      [e.history(VISITOR), q.history(VISITOR)],
      [e.company(VISITOR), q.company(VISITOR)],
      [e.assistantActivity(CONVERSATION), q.assistantActivity(CONVERSATION)],
      [e.languagePreference(), q.languagePreference()],
      [e.macros(), macrosQuery('support')],
      [e.runnableWorkflows(), runnableWorkflowsQuery()],
      [e.teamMembers(), teamMembersQuery()],
    ]
    for (const [entry, query] of pairs) {
      expect(entry.queryKey).toEqual(query.queryKey)
      expect(entry.staleTime).toBe(query.staleTime)
    }
  })
})
