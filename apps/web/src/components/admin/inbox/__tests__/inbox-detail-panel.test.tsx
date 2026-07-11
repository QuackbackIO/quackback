// @vitest-environment happy-dom
/**
 * <InboxDetailPanel> tab host (COPILOT-SIDEBAR-UX.md B.1; unified inbox §2.7):
 * the Copilot tab only renders when BOTH the `assistantCopilot` flag is on
 * AND the viewer holds `copilot.use`. With the flag off, there is no Tabs
 * wrapper at all — the panel renders the exact same Details content as
 * before Copilot existed.
 *
 * Heavy child controls (tags/attributes/priority/assignee/status/company)
 * are stubbed: this test is about the tab host, not those controls, and
 * several of them fire unconditional queries that would otherwise hit real
 * server functions.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { FeatureFlags } from '@/lib/shared/types/settings'

afterEach(cleanup)

vi.mock('@/components/admin/conversation/priority-control', () => ({
  PriorityControl: () => null,
}))
vi.mock('@/components/admin/conversation/assignee-control', () => ({
  AssigneeControl: () => null,
}))
vi.mock('@/components/admin/conversation/conversation-tags-editor', () => ({
  ConversationTagsEditor: () => null,
}))
vi.mock('@/components/admin/conversation/conversation-attributes-editor', () => ({
  ConversationAttributesEditor: () => null,
}))
vi.mock('@/components/admin/conversation/status-control', () => ({ StatusControl: () => null }))
vi.mock('@/components/admin/conversation/company-card', () => ({ CompanyCard: () => null }))
vi.mock('@/components/admin/inbox/ticket-chips', () => ({
  TicketTypeBadge: () => null,
  TicketStageChip: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-controls', () => ({
  TicketStatusControl: () => null,
  TicketAssigneeControl: () => null,
  TicketPriorityControl: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-links', () => ({ TicketLinks: () => null }))
vi.mock('@/components/admin/users/block-person-control', () => ({
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn().mockResolvedValue({ conversations: [], hasMore: false }),
  getConversationAssistantActivityFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/server/functions/admin', () => ({
  getPortalUserFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/components/admin/conversation/copilot-panel', () => ({
  // Renders a bare textarea wired to `askInputRef` so the openCopilotToken
  // focus tests can observe the host-driven focus move.
  CopilotPanel: ({
    item,
    askInputRef,
  }: {
    item: { kind: string; id: string }
    askInputRef?: React.Ref<HTMLTextAreaElement>
  }) => (
    <div data-testid="copilot-panel-stub">
      <textarea ref={askInputRef} data-testid="copilot-ask-stub" />
      copilot for {item.kind}:{item.id}
    </div>
  ),
}))

const routeContextState: {
  settings: { featureFlags?: FeatureFlags } | undefined
  principal: { role: string } | undefined
} = {
  settings: undefined,
  principal: undefined,
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouteContext: () => routeContextState,
}))

import { InboxDetailPanel } from '../inbox-detail-panel'

function makeConversation(overrides: Partial<ConversationDTO> = {}): ConversationDTO {
  return {
    id: 'conversation_1' as ConversationDTO['id'],
    status: 'open',
    priority: 'none',
    channel: 'messenger',
    subject: null,
    lastMessagePreview: null,
    lastMessageAt: '2026-07-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    visitor: { principalId: 'principal_visitor', displayName: 'Vic Visitor', avatarUrl: null },
    assignedAgent: null,
    unreadCount: 0,
    visitorLastReadAt: null,
    agentLastReadAt: null,
    csatRating: null,
    visitorEmail: 'vic@example.com',
    resolvedAt: null,
    snoozedUntil: null,
    assignedTeamId: null,
    endReason: null,
    endNote: null,
    tags: [],
    sla: null,
    customAttributes: {},
    translation: null,
    ...overrides,
  }
}

function renderPanel(
  conversation: ConversationDTO = makeConversation(),
  extra: { openCopilotToken?: number } = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (props: { openCopilotToken?: number }) => (
    <QueryClientProvider client={client}>
      <InboxDetailPanel
        item={{ kind: 'conversation', id: conversation.id }}
        conversation={conversation}
        onChanged={vi.fn()}
        onSelectItem={vi.fn()}
        onTrackAsFeedback={vi.fn()}
        onCreateTicket={vi.fn()}
        onInsertFromCopilot={vi.fn()}
        getComposerText={() => ''}
        onReplaceComposerText={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  )
  const result = render(ui(extra))
  return {
    ...result,
    rerenderWith: (props: { openCopilotToken?: number }) => result.rerender(ui(props)),
  }
}

describe('<InboxDetailPanel> tab host', () => {
  it('renders no Tabs when the assistantCopilot flag is off — Details content directly, byte-identical', () => {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: false } as unknown as FeatureFlags,
    }
    routeContextState.principal = { role: 'admin' }

    const { container } = renderPanel()

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Copilot')).not.toBeInTheDocument()
    // Details content renders directly under <aside>, no intermediate Tabs wrapper.
    expect(screen.getByText('Properties')).toBeInTheDocument()
    const aside = container.querySelector('aside')
    expect(aside?.querySelector('[data-slot="tabs"]')).toBeNull()
  })

  it('renders Tabs with a Copilot tab when the flag is on and the viewer holds copilot.use', () => {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: true } as unknown as FeatureFlags,
    }
    routeContextState.principal = { role: 'admin' } // admin -> owner preset -> has copilot.use

    renderPanel()

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Details' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /copilot/i })).toBeInTheDocument()
  })

  it('renders no Copilot tab when the flag is on but the viewer lacks copilot.use', () => {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: true } as unknown as FeatureFlags,
    }
    routeContextState.principal = undefined // no principal -> resolvePermission is false

    renderPanel()

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /copilot/i })).not.toBeInTheDocument()
    expect(screen.getByText('Properties')).toBeInTheDocument()
  })

  it('keeps Details mounted (not unmounted) once the Copilot tab is switched to', () => {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: true } as unknown as FeatureFlags,
    }
    routeContextState.principal = { role: 'admin' }

    renderPanel()

    fireEvent.click(screen.getByRole('tab', { name: /copilot/i }))

    // Both stay in the DOM (forceMount + CSS-hide) — Details content is still present.
    expect(screen.getByText('Properties')).toBeInTheDocument()
    expect(screen.getByTestId('copilot-panel-stub')).toBeInTheDocument()
  })
})

describe('<InboxDetailPanel> openCopilotToken ping (the Ask Copilot shortcut)', () => {
  function enableCopilot() {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: true } as unknown as FeatureFlags,
    }
    routeContextState.principal = { role: 'admin' }
  }

  it('a token bump switches from Details to the Copilot tab and focuses the ask input', async () => {
    enableCopilot()
    const { rerenderWith } = renderPanel(makeConversation(), { openCopilotToken: 0 })
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('data-state', 'active')

    rerenderWith({ openCopilotToken: 1 })

    expect(screen.getByRole('tab', { name: /copilot/i })).toHaveAttribute('data-state', 'active')
    // Focus lands after the rAF that waits for the tab content to un-hide.
    await waitFor(() => expect(screen.getByTestId('copilot-ask-stub')).toHaveFocus())
  })

  it('a zero token at mount (no pending bump) does not steal focus', () => {
    enableCopilot()
    renderPanel(makeConversation(), { openCopilotToken: 0 })

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByTestId('copilot-ask-stub')).not.toHaveFocus()
  })

  it('a nonzero token at mount fires — the bump landed while the panel was still loading', async () => {
    // The inbox route resets the token to 0 whenever the selected item
    // changes, so a nonzero value at mount can only mean `q` was pressed for
    // THIS item during its load window (the panel wasn't mounted yet to see
    // the bump) — honor it on mount instead of swallowing it.
    enableCopilot()
    renderPanel(makeConversation(), { openCopilotToken: 5 })

    expect(screen.getByRole('tab', { name: /copilot/i })).toHaveAttribute('data-state', 'active')
    await waitFor(() => expect(screen.getByTestId('copilot-ask-stub')).toHaveFocus())
  })

  it('the route-side reset back to 0 does not re-open Copilot', async () => {
    enableCopilot()
    const { rerenderWith } = renderPanel(makeConversation(), { openCopilotToken: 0 })
    rerenderWith({ openCopilotToken: 1 })
    await waitFor(() => expect(screen.getByTestId('copilot-ask-stub')).toHaveFocus())

    // Back to Details, then the route resets the token (selection changed).
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }), { button: 0 })
    rerenderWith({ openCopilotToken: 0 })

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('data-state', 'active')
  })

  it('tabs stay user-switchable after a token bump (controlled Tabs round-trip)', async () => {
    enableCopilot()
    const { rerenderWith } = renderPanel(makeConversation(), { openCopilotToken: 0 })
    rerenderWith({ openCopilotToken: 1 })
    await waitFor(() => expect(screen.getByTestId('copilot-ask-stub')).toHaveFocus())

    // Radix TabsTrigger activates on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Details' }), { button: 0 })

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('data-state', 'active')
  })

  it('a token bump is a clean no-op when the Copilot tab is unavailable (flag off)', () => {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: false } as unknown as FeatureFlags,
    }
    routeContextState.principal = { role: 'admin' }
    const { rerenderWith } = renderPanel(makeConversation(), { openCopilotToken: 0 })

    rerenderWith({ openCopilotToken: 1 })

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('Properties')).toBeInTheDocument()
  })
})
