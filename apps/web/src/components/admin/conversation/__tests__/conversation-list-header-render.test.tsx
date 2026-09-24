// @vitest-environment happy-dom
/**
 * Opening an item changes only which row is selected. The list column's
 * header (scope label, search, sort and filter menus, the compose dialog)
 * does not depend on it, so it skips that render and only the rows update.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ComponentProps } from 'react'
import type { ConversationId, PrincipalId } from '@quackback/ids'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'

afterEach(cleanup)

const composeDialogRenders = vi.hoisted(() => ({ count: 0 }))
vi.mock('@/components/admin/conversation/new-conversation-dialog', () => ({
  NewConversationDialog: () => {
    composeDialogRenders.count++
    return null
  },
}))
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ userRole: 'admin', settings: { featureFlags: {} } }),
}))
vi.mock('@/lib/client/hooks/use-activation-action', () => ({
  useActivationAction: () => null,
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

const ITEMS: InboxItemDTO[] = ['conversation_a', 'conversation_b'].map((id) => ({
  kind: 'conversation',
  conversation: conversation(id),
  linkedTicket: null,
  searchSnippet: null,
}))

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
  items: ITEMS,
  selectedId: null,
  onSelect: noop,
}

describe('ConversationListColumn', () => {
  it('re-renders the rows, not the header, when the selection changes', () => {
    const client = new QueryClient()
    const ui = (selectedId: string | null) => (
      <QueryClientProvider client={client}>
        <IntlProvider locale="en">
          <ConversationListColumn {...PROPS} selectedId={selectedId} />
        </IntlProvider>
      </QueryClientProvider>
    )
    const { rerender, container } = render(ui(null))
    const headerRenders = composeDialogRenders.count

    rerender(ui('conversation_b'))

    expect(composeDialogRenders.count).toBe(headerRenders)
    expect(container.querySelectorAll('.bg-muted\\/60')).toHaveLength(1)
  })
})
