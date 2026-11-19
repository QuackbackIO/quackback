// @vitest-environment happy-dom
/**
 * A tickets-only workspace (support conversations off, tickets on) still opens
 * the Support inbox, but only for its tickets: no "New conversation" button,
 * no conversation views in the nav, and a conversation view in the URL opens
 * All tickets instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConversationTagId, SegmentId, TeamId } from '@quackback/ids'
import { navFromSearch, type InboxNavItem } from '@/lib/client/conversation/inbox-scope'

afterEach(cleanup)

const flags = vi.hoisted(() => ({ value: {} as Record<string, boolean> }))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({
      userRole: 'admin',
      principal: { role: 'admin' },
      session: {},
      settings: { featureFlags: flags.value },
    }),
}))

const resolved =
  <T,>(value: T) =>
  () =>
    Promise.resolve(value)
vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsWithCountsFn: resolved([
    { id: 'conversation_tag_1', name: 'Billing', color: '#000', count: 2 },
  ]),
}))
vi.mock('@/lib/server/functions/conversation-segments', () => ({
  fetchInboxSegmentsWithCountsFn: resolved([
    { id: 'segment_1', name: 'Enterprise', color: '#000', count: 1 },
  ]),
}))
vi.mock('@/lib/server/functions/conversation-views', () => ({
  listConversationViewsFn: resolved([]),
  pinConversationViewFn: vi.fn(),
  unpinConversationViewFn: vi.fn(),
  deleteConversationViewFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/inbox', () => ({
  fetchInboxCountsFn: () => new Promise<never>(() => {}),
  listInboxItemsFn: resolved([]),
  getConversationTicketLinkFn: resolved(null),
}))
vi.mock('@/lib/server/functions/teams', () => ({
  listTeamsFn: resolved([{ id: 'team_1', name: 'Tier 2', memberCount: 1, isMember: true }]),
}))
vi.mock('@/components/admin/conversation/new-conversation-dialog', () => ({
  NewConversationDialog: () => null,
}))
vi.mock('@/lib/client/hooks/use-activation-action', () => ({
  useActivationAction: () => null,
}))

const { InboxNavSidebar } = await import('../inbox-nav-sidebar')
const { ConversationListColumn } = await import('../conversation-list-column')

const TICKETS_ALL: InboxNavItem = { kind: 'view', view: 'tickets_all' }

function withProviders(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" onError={() => {}}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>
  )
}

function renderSidebar() {
  return withProviders(
    <InboxNavSidebar nav={TICKETS_ALL} onSelect={vi.fn()} onCreateView={vi.fn()} />
  )
}

function renderListColumn() {
  const noop = () => {}
  return withProviders(
    <ConversationListColumn
      nav={TICKETS_ALL}
      onSelectNav={noop}
      scopeLabel="All tickets"
      showRefinements
      searchInput=""
      onSearchInput={noop}
      facet="open"
      onFacet={noop}
      priorityFilter="all"
      onPriorityFilter={noop}
      onChannelFilter={noop}
      sort="recent"
      onSort={noop}
      loading={false}
      items={[]}
      selectedId={null}
      onSelect={noop}
    />
  )
}

describe('a tickets-only Support inbox', () => {
  beforeEach(() => {
    flags.value = { supportTickets: true }
  })

  it('lists only ticket views and saved views in the nav', async () => {
    renderSidebar()
    expect(screen.getByText('All tickets')).toBeInTheDocument()
    expect(screen.getByText('Saved views')).toBeInTheDocument()
    expect(screen.queryByText('Conversations')).not.toBeInTheDocument()
    expect(screen.queryByText('All conversations')).not.toBeInTheDocument()
    expect(screen.queryByText('Assigned to me')).not.toBeInTheDocument()
    expect(screen.queryByText('AI agent activity')).not.toBeInTheDocument()
    // Teams, tags and segments only ever list conversations.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('Tier 2')).not.toBeInTheDocument()
    expect(screen.queryByText('Billing')).not.toBeInTheDocument()
    expect(screen.queryByText('Enterprise')).not.toBeInTheDocument()
  })

  it('offers no New conversation button', () => {
    renderListColumn()
    expect(screen.queryByRole('button', { name: /new conversation/i })).not.toBeInTheDocument()
  })

  it('opens All tickets for a conversation view in the URL', () => {
    const ticketsOnly = { conversations: false }
    expect(navFromSearch({}, ticketsOnly)).toEqual(TICKETS_ALL)
    expect(navFromSearch({ view: 'mine' }, ticketsOnly)).toEqual(TICKETS_ALL)
    expect(navFromSearch({ view: 'spam' }, ticketsOnly)).toEqual(TICKETS_ALL)
    expect(navFromSearch({ team: 'team_1' as TeamId }, ticketsOnly)).toEqual(TICKETS_ALL)
    expect(navFromSearch({ tag: 'conversation_tag_1' as ConversationTagId }, ticketsOnly)).toEqual(
      TICKETS_ALL
    )
    expect(navFromSearch({ segment: 'segment_1' as SegmentId }, ticketsOnly)).toEqual(TICKETS_ALL)
    // Ticket views and saved views stay where they are.
    expect(navFromSearch({ view: 'tickets_customer' }, ticketsOnly)).toEqual({
      kind: 'view',
      view: 'tickets_customer',
    })
  })
})

describe('a Support inbox with conversations on', () => {
  beforeEach(() => {
    flags.value = { supportInbox: true, supportTickets: true }
  })

  it('lists the conversation views and ticket views', async () => {
    renderSidebar()
    expect(screen.getByText('All conversations')).toBeInTheDocument()
    expect(screen.getByText('All tickets')).toBeInTheDocument()
    expect(await screen.findByText('Tier 2')).toBeInTheDocument()
    expect(await screen.findByText('Billing')).toBeInTheDocument()
  })

  it('offers the New conversation button', () => {
    renderListColumn()
    expect(screen.getByRole('button', { name: /new conversation/i })).toBeInTheDocument()
  })

  it('keeps conversation views in the URL', () => {
    expect(navFromSearch({ view: 'mine' }, { conversations: true })).toEqual({
      kind: 'view',
      view: 'mine',
    })
    expect(navFromSearch({})).toEqual({ kind: 'view', view: 'all' })
  })
})
