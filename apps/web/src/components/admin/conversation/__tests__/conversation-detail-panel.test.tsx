// @vitest-environment happy-dom
/**
 * <ConversationDetailPanel> tab host (COPILOT-SIDEBAR-UX.md B.1): the
 * Copilot tab only renders when BOTH the `assistantCopilot` flag is on AND
 * the viewer holds `copilot.use`. With the flag off, there is no Tabs
 * wrapper at all — the panel renders the exact same Details content as
 * before Copilot existed.
 *
 * Heavy child controls (tags/attributes/priority/assignee/status/company/
 * block) are stubbed: this test is about the tab host, not those controls,
 * and several of them fire unconditional queries that would otherwise hit
 * real server functions.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { FeatureFlags } from '@/lib/shared/types/settings'

afterEach(cleanup)

// vi.mock's specifier resolves relative to THIS file (in __tests__/), so the
// module under test's `./x` (relative to conversation-detail-panel.tsx, one
// directory up) must be mocked here as `../x`.
vi.mock('../priority-control', () => ({ PriorityControl: () => null }))
vi.mock('../assignee-control', () => ({ AssigneeControl: () => null }))
vi.mock('../export-transcript-button', () => ({ ExportTranscriptButton: () => null }))
vi.mock('../conversation-tags-editor', () => ({ ConversationTagsEditor: () => null }))
vi.mock('../conversation-attributes-editor', () => ({ ConversationAttributesEditor: () => null }))
vi.mock('../status-control', () => ({ StatusControl: () => null }))
vi.mock('../company-card', () => ({ CompanyCard: () => null }))
vi.mock('@/components/admin/users/block-person-control', () => ({
  BlockPersonControl: () => null,
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  listConversationsForUserFn: vi.fn().mockResolvedValue({ conversations: [], hasMore: false }),
  getConversationAssistantActivityFn: vi.fn().mockResolvedValue(null),
  exportConversationTranscriptFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/admin', () => ({
  getPortalUserFn: vi.fn().mockResolvedValue(null),
}))
vi.mock('../copilot-panel', () => ({
  CopilotPanel: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="copilot-panel-stub">copilot for {conversationId}</div>
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

import { ConversationDetailPanel } from '../conversation-detail-panel'

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
    ...overrides,
  }
}

function renderPanel(conversation: ConversationDTO = makeConversation()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ConversationDetailPanel
        conversation={conversation}
        onChanged={vi.fn()}
        onSelectConversation={vi.fn()}
        onEndConversation={vi.fn()}
        onTrackAsFeedback={vi.fn()}
        onInsertFromCopilot={vi.fn()}
        getComposerText={() => ''}
        onReplaceComposerText={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('<ConversationDetailPanel> tab host', () => {
  it('renders no Tabs when the assistantCopilot flag is off — Details content directly, byte-identical', () => {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: false } as unknown as FeatureFlags,
    }
    routeContextState.principal = { role: 'admin' }

    const { container } = renderPanel()

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Copilot')).not.toBeInTheDocument()
    // Details content renders directly under <aside>, no intermediate Tabs wrapper.
    expect(screen.getByText('Manage')).toBeInTheDocument()
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
    expect(screen.getByText('Manage')).toBeInTheDocument()
  })

  it('keeps Details mounted (not unmounted) once the Copilot tab is switched to', () => {
    routeContextState.settings = {
      featureFlags: { assistantCopilot: true } as unknown as FeatureFlags,
    }
    routeContextState.principal = { role: 'admin' }

    renderPanel()

    fireEvent.click(screen.getByRole('tab', { name: /copilot/i }))

    // Both stay in the DOM (forceMount + CSS-hide) — Details content is still present.
    expect(screen.getByText('Manage')).toBeInTheDocument()
    expect(screen.getByTestId('copilot-panel-stub')).toBeInTheDocument()
  })
})
