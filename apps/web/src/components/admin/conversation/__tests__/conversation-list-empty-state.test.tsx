// @vitest-environment happy-dom
/**
 * The first-run "Connect Messenger" call to action shows only in an empty
 * main queue, and deciding it reads the workspace's launch status (a server
 * call). A list with conversations in it shows no call to action, so it does
 * not ask for the status.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ComponentProps } from 'react'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'

afterEach(cleanup)

const fetchOnboardingStatus = vi.hoisted(() =>
  vi.fn(async () => ({
    useCase: 'customer_support',
    hasFirstWin: false,
    hasWidgetInstalled: false,
    permissions: { settingsManage: true },
  }))
)
vi.mock('@/lib/server/functions/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOnboardingStatus,
}))
vi.mock('@/components/admin/conversation/new-conversation-dialog', () => ({
  NewConversationDialog: () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts?: { select?: (context: unknown) => unknown }) => {
    const context = { userRole: 'admin', settings: { featureFlags: {} } }
    return opts?.select ? opts.select(context) : context
  },
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

const { ConversationListColumn } = await import('../conversation-list-column')

function conversation(id: string): ConversationDTO {
  return {
    id: id as ConversationId,
    status: 'open',
    priority: 'none',
    channel: 'messenger',
    subject: null,
    lastMessagePreview: `Preview of ${id}`,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    visitor: { principalId: 'principal_v' as PrincipalId, displayName: 'Rita', avatarUrl: null },
    assignedAgent: null,
    unreadCount: 0,
    visitorLastReadAt: null,
    agentLastReadAt: null,
    csatRating: null,
    visitorEmail: null,
    resolvedAt: null,
    endReason: null,
    endNote: null,
    snoozedUntil: null,
    tags: [],
  } as unknown as ConversationDTO
}

const noop = () => {}
const PROPS: ComponentProps<typeof ConversationListColumn> = {
  nav: { kind: 'view', view: 'all' },
  onSelectNav: noop,
  scopeLabel: 'All conversations',
  showRefinements: true,
  searchInput: '',
  onSearchInput: noop,
  facet: 'open',
  onFacet: noop,
  priorityFilter: 'all',
  onPriorityFilter: noop,
  onChannelFilter: noop,
  sort: 'recent',
  onSort: noop,
  loading: false,
  items: [],
  selectedId: null,
  onSelect: noop,
}

function renderColumn(items: InboxItemDTO[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en">
        <ConversationListColumn {...PROPS} items={items} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

describe('ConversationListColumn launch status', () => {
  it('is not asked for while the list has conversations', async () => {
    fetchOnboardingStatus.mockClear()
    renderColumn([
      {
        kind: 'conversation',
        conversation: conversation('conversation_a'),
        linkedTicket: null,
        searchSnippet: null,
      },
    ])
    await screen.findByText('Preview of conversation_a')
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fetchOnboardingStatus).not.toHaveBeenCalled()
  })

  it('decides the call to action of an empty main queue', async () => {
    fetchOnboardingStatus.mockClear()
    renderColumn([])

    expect(await screen.findByText('Connect Messenger')).toBeTruthy()
    expect(fetchOnboardingStatus).toHaveBeenCalledTimes(1)
  })
})
