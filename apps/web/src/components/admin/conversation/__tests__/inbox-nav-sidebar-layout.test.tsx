// @vitest-environment happy-dom
/**
 * The Support pane: titled like its rail entry, no search box (search lives in
 * the list column), Quinn activity listed with the conversations, and no
 * filler sentence under an empty Saved views section.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InboxNavItem } from '@/lib/client/conversation/inbox-scope'

afterEach(cleanup)

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: ({ select }: { select: (context: unknown) => unknown }) =>
    select({ session: {}, settings: { featureFlags: { supportTickets: true } } }),
}))

const empty = () => Promise.resolve([])
vi.mock('@/lib/server/functions/conversation-tags', () => ({
  fetchConversationTagsWithCountsFn: empty,
}))
vi.mock('@/lib/server/functions/conversation-segments', () => ({
  fetchInboxSegmentsWithCountsFn: empty,
}))
vi.mock('@/lib/server/functions/conversation-views', () => ({
  listConversationViewsFn: empty,
  pinConversationViewFn: vi.fn(),
  unpinConversationViewFn: vi.fn(),
  deleteConversationViewFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/inbox', () => ({
  fetchInboxCountsFn: () => new Promise<never>(() => {}),
  listInboxItemsFn: empty,
  getConversationTicketLinkFn: empty,
}))
vi.mock('@/lib/server/functions/teams', () => ({ listTeamsFn: empty }))

const { InboxNavSidebar } = await import('../inbox-nav-sidebar')

const NAV: InboxNavItem = { kind: 'view', view: 'all' }

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <InboxNavSidebar nav={NAV} onSelect={vi.fn()} onCreateView={vi.fn()} />
    </QueryClientProvider>
  )
}

describe('InboxNavSidebar layout', () => {
  it('is titled Support', () => {
    renderSidebar()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Support')
    expect(screen.queryByText('Inbox')).toBeNull()
  })

  it('has no search box', () => {
    const { container } = renderSidebar()
    expect(container.querySelector('input')).toBeNull()
  })

  it('lists Quinn activity under Conversations, with no AI section', async () => {
    renderSidebar()
    expect(screen.queryByText('AI')).toBeNull()
    const quinn = screen.getByRole('button', { name: /Quinn activity/ })
    const conversations = screen.getByText('Conversations').closest('div.pb-4') as HTMLElement
    expect(within(conversations).getByRole('button', { name: /Quinn activity/ })).toBe(quinn)
  })

  it('shows no empty-state sentence under Saved views, only its add button', async () => {
    renderSidebar()
    expect(await screen.findByText('Saved views')).toBeTruthy()
    expect(screen.queryByText('No saved views yet')).toBeNull()
    expect(screen.getByRole('button', { name: 'New view' })).toBeTruthy()
  })
})
