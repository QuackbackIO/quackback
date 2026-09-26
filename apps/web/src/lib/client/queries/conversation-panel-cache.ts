/**
 * Where each read beside an open conversation in the agent inbox lives in the
 * query cache and how long it stays fresh (see
 * lib/shared/conversation/agent-panels.ts), and how the thread request fills
 * those entries: it asks for every read whose entry is empty or stale, and
 * seeds each entry from the answer before the thread renders, so the panel
 * and composer mount without a request of their own.
 *
 * Only cache entries here, no fetchers: the inbox route loader imports the
 * thread query, and the fetchers (conversation-panels.ts and each read's own
 * factory) would otherwise ride in every page's entry chunk. Each entry
 * matches its read's own query factory, which the tests pin.
 */
import type { QueryClient } from '@tanstack/react-query'
import type { ConversationId, PrincipalId, TicketId } from '@quackback/ids'
import type { AgentConversationPanel } from '@/lib/shared/conversation/agent-panels'
import type { AgentConversationPanels } from '@/lib/server/functions/conversation-panels'
import type { LinkedTicketSummary } from '@/lib/shared/inbox/items'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import { inboxQueries, ticketQueries } from '@/lib/client/queries/inbox'
import { isDetailPanelShown } from '@/lib/client/conversation/detail-panel'
import {
  readNeedsLoad,
  readsToLoad,
  seedReads,
  type ReadEntry,
} from '@/lib/client/queries/read-batch'

export const conversationPanelEntries = {
  ticketLink: (conversationId: ConversationId) =>
    inboxQueries.conversationTicketLink(conversationId),
  linkedTicket: (ticketId: TicketId) => inboxQueries.ticketDetail(ticketId),
  ticketStageLabels: () => ticketQueries.stageLabels(),
  blockStatus: (principalId: PrincipalId) => ({
    queryKey: ['admin', 'person-block-status', principalId] as const,
    staleTime: 30_000,
  }),
  contact: (principalId: PrincipalId) => ({
    queryKey: conversationKeys.agentContactDetail(principalId),
    staleTime: 60_000,
  }),
  history: (principalId: PrincipalId) => ({
    queryKey: conversationKeys.agentUserConversationsFor(principalId),
    staleTime: 30_000,
  }),
  company: (principalId: string) => ({
    queryKey: ['admin', 'company', 'for-principal', principalId] as const,
    staleTime: 60_000,
  }),
  assistantActivity: (conversationId: ConversationId) => ({
    queryKey: conversationKeys.agentAssistantActivity(conversationId),
    staleTime: 30_000,
  }),
  languagePreference: () => ({
    queryKey: ['teammate', 'language-preference'] as const,
    staleTime: 5 * 60_000,
  }),
  macros: () => ({ queryKey: ['macros', 'support'] as const, staleTime: 60_000 }),
  runnableWorkflows: () => ({ queryKey: ['workflows', 'runnable'] as const, staleTime: 60_000 }),
  teamMembers: () => ({ queryKey: ['admin', 'team-members'] as const, staleTime: 60_000 }),
}

/**
 * Each read's cache entry for this conversation: the entry when it is known,
 * null when it depends on something not yet known (the visitor before the
 * thread first loads, the linked ticket before its link is known), which
 * means "ask", or 'skip' for a read with nothing to show.
 */
function panelEntries(
  client: QueryClient,
  conversationId: ConversationId
): Record<AgentConversationPanel, ReadEntry | null | 'skip'> {
  const e = conversationPanelEntries
  const cached = client.getQueryData<{ conversation: { visitor: { principalId: PrincipalId } } }>(
    conversationKeys.agentThread(conversationId)
  )
  const visitor = cached?.conversation.visitor.principalId
  const linkEntry = e.ticketLink(conversationId)
  const link = client.getQueryData<LinkedTicketSummary | null>(linkEntry.queryKey)
  // The panel's own reads are only worth loading where the panel shows.
  const shown = isDetailPanelShown()
  const forVisitor = (make: (principalId: PrincipalId) => ReadEntry) =>
    visitor ? make(visitor) : null
  // A conversation fresh-known to have no linked ticket needs no ticket reads.
  const noTicket = link === null && !readNeedsLoad(client, linkEntry)
  return {
    ticketLink: linkEntry,
    linkedTicket: noTicket ? 'skip' : link ? e.linkedTicket(link.id) : null,
    ticketStageLabels: noTicket ? 'skip' : e.ticketStageLabels(),
    blockStatus: forVisitor(e.blockStatus),
    contact: shown ? forVisitor(e.contact) : 'skip',
    history: shown ? forVisitor(e.history) : 'skip',
    company: shown ? forVisitor(e.company) : 'skip',
    assistantActivity: shown ? e.assistantActivity(conversationId) : 'skip',
    languagePreference: e.languagePreference(),
    macros: e.macros(),
    runnableWorkflows: e.runnableWorkflows(),
    teamMembers: e.teamMembers(),
  }
}

/** The reads the thread request should load for this conversation. */
export function conversationPanelsToLoad(
  client: QueryClient,
  conversationId: ConversationId
): AgentConversationPanel[] {
  return readsToLoad(client, panelEntries(client, conversationId))
}

/** Seed each loaded read's cache entry from the thread answer. */
export function seedConversationPanels(
  client: QueryClient,
  conversationId: ConversationId,
  visitor: PrincipalId,
  loaded: AgentConversationPanels
): void {
  const e = conversationPanelEntries
  seedReads<AgentConversationPanel>(
    client,
    {
      ticketLink: e.ticketLink(conversationId),
      linkedTicket: loaded.linkedTicket ? e.linkedTicket(loaded.linkedTicket.id) : null,
      ticketStageLabels: e.ticketStageLabels(),
      blockStatus: e.blockStatus(visitor),
      contact: e.contact(visitor),
      history: e.history(visitor),
      company: e.company(visitor),
      assistantActivity: e.assistantActivity(conversationId),
      languagePreference: e.languagePreference(),
      macros: e.macros(),
      runnableWorkflows: e.runnableWorkflows(),
      teamMembers: e.teamMembers(),
    },
    loaded
  )
}
