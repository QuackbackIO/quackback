// @vitest-environment happy-dom
/**
 * <AgentConversationThread> capability wiring (UNIFIED-INBOX-SPEC.md §2.5,
 * M4): the same container drives a conversation and a ticket, gated by the
 * `ThreadCapabilities` derived from `item.kind`/a ticket's `type`. These tests
 * pin the three load-bearing behaviors the fold introduced:
 *
 *  - a back_office/tracker ticket is note-only (no Reply/Note toggle, forced
 *    note mode) — `capabilities.reply` false;
 *  - a customer ticket keeps both Reply and Note tabs — `capabilities.reply`
 *    true.
 *
 * Heavy children (controls, dialogs, the rich editor, the virtualized
 * viewport) are stubbed — this test is about capability wiring, not those
 * components' own behavior, and several of them fire unconditional queries
 * that would otherwise hit real server functions.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import type { ConversationDTO, AgentConversationMessageDTO } from '@/lib/shared/conversation/types'

afterEach(cleanup)

const routeContextState = {
  session: { user: { name: 'Agent Smith' } },
  settings: { featureFlags: {} },
}
vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => routeContextState,
}))

// The virtualized viewport + its supporting hooks are replaced with a plain
// list render — this test asserts on rendered rows, not scroll/virtualization.
vi.mock('../thread', () => ({
  ThreadViewport: ({
    rows,
    renderRow,
  }: {
    rows: { key: string }[]
    renderRow: (r: unknown) => unknown
  }) => (
    <div data-testid="thread-viewport">
      {rows.map((r) => (
        <div key={r.key}>{renderRow(r) as React.ReactNode}</div>
      ))}
    </div>
  ),
  useThreadVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    scrollToIndex: vi.fn(),
    scrollToEnd: vi.fn(),
    isAtEnd: () => true,
    measureElement: () => {},
  }),
  useOlderMessages: () => ({ loadingOlder: false, loadOlder: vi.fn() }),
  useMarkReadOnIncoming: () => {},
  useTypingSender: () => vi.fn(),
}))

vi.mock('../message-bubble', () => ({
  AgentMessageBubble: ({ message }: { message: AgentConversationMessageDTO }) => (
    <div data-testid={`bubble-${message.id}`}>{message.content}</div>
  ),
  UnreadDivider: () => <div data-testid="unread-divider" />,
}))

vi.mock('../macro-picker', () => ({ MacroPicker: () => <div data-testid="macro-picker" /> }))
vi.mock('@/components/admin/conversation/priority-control', () => ({
  PriorityControl: () => null,
}))
vi.mock('@/components/admin/conversation/assignee-control', () => ({
  AssigneeControl: () => null,
}))
vi.mock('@/components/admin/conversation/channel-badge', () => ({ ChannelBadge: () => null }))
vi.mock('@/components/admin/conversation/sla-chip', () => ({ SlaChip: () => null }))
vi.mock('@/components/admin/conversation/conversation-tags-editor', () => ({
  ConversationTagsEditor: () => null,
}))
vi.mock('@/components/admin/conversation/status-control', () => ({ StatusControl: () => null }))
vi.mock('@/components/admin/inbox/inbox-detail-panel', () => ({
  InboxDetailPanel: () => <div data-testid="inbox-detail-panel" />,
}))
vi.mock('@/components/admin/inbox/create-ticket-dialog', () => ({
  CreateTicketDialog: () => null,
}))
vi.mock('@/components/admin/conversation/convert-to-post-dialog', () => ({
  ConvertToPostDialog: () => null,
}))
vi.mock('@/components/admin/conversation/end-conversation-dialog', () => ({
  EndConversationDialog: () => null,
}))
vi.mock('@/components/admin/conversation/share-post-dialog', () => ({
  SharePostDialog: () => null,
}))
vi.mock('@/components/admin/conversation/required-attributes-dialog', () => ({
  RequiredAttributesDialog: () => null,
}))
vi.mock('@/components/admin/users/block-person-control', () => ({
  usePersonBlockStatus: () => ({ blocked: false, isLoading: false }),
}))
vi.mock('@/components/shared/confirm-dialog', () => ({ ConfirmDialog: () => null }))
vi.mock('@/components/admin/conversation/export-transcript-button', () => ({
  downloadTranscriptFile: vi.fn(),
}))
vi.mock('@/components/ui/datetime-picker', () => ({ DateTimePicker: () => null }))
vi.mock('@/components/admin/inbox/ticket-chips', () => ({
  TicketTypeBadge: ({ type }: { type: string }) => (
    <span data-testid="ticket-type-badge">{type}</span>
  ),
  TicketStageChip: () => null,
}))
vi.mock('@/components/admin/inbox/ticket-controls', () => ({
  TicketStatusControl: () => <div data-testid="ticket-status-control" />,
  TicketAssigneeControl: () => <div data-testid="ticket-assignee-control" />,
  TicketPriorityControl: () => <div data-testid="ticket-priority-control" />,
}))
vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ placeholder }: { placeholder?: string }) => (
    <textarea data-testid="editor" placeholder={placeholder} readOnly />
  ),
  RichTextContent: () => null,
}))
vi.mock('@/components/shared/composer-attachment-tray', () => ({
  ComposerAttachmentTray: () => null,
}))
vi.mock('@/components/shared/link-preview-card', () => ({ LinkPreviews: () => null }))
vi.mock('@/components/shared/typing-dots', () => ({ TypingDots: () => null }))
vi.mock('@/components/shared/emoji-picker', () => ({
  EmojiPicker: () => <div data-testid="emoji-picker" />,
}))
vi.mock('@/components/shared/spinner', () => ({ Spinner: () => <div data-testid="spinner" /> }))
vi.mock('@/components/shared/empty-state', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}))
vi.mock('@/components/ui/avatar', () => ({ Avatar: () => null }))

vi.mock('@/lib/client/hooks/use-inbox-translation', () => ({
  useInboxTranslation: () => ({
    translationFor: () => undefined,
    showSuggestionBanner: false,
    enabled: false,
    togglePending: false,
    toggleEnabled: vi.fn(),
    dismissSuggestion: vi.fn(),
    activateFromSuggestion: vi.fn(),
    detectedLanguageLabel: '',
  }),
}))
vi.mock('@/lib/client/hooks/use-copilot-insert', () => ({ useCopilotInsert: () => vi.fn() }))
vi.mock('@/lib/client/hooks/use-image-upload', () => ({
  useImageUpload: () => ({ upload: vi.fn() }),
}))
vi.mock('@/lib/client/hooks/use-conversation-composer-attachments', () => ({
  useConversationComposerAttachments: () => ({
    pending: [],
    addFiles: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    uploading: false,
  }),
}))

vi.mock('@/lib/server/functions/conversation', () => ({
  sendAgentMessageFn: vi.fn(),
  addConversationNoteFn: vi.fn(),
  deleteConversationMessageFn: vi.fn(),
  addMessageReactionFn: vi.fn(),
  removeMessageReactionFn: vi.fn(),
  setMessageFlagFn: vi.fn(),
  markConversationUnreadFromMessageFn: vi.fn(),
  exportConversationTranscriptFn: vi.fn(),
  snoozeConversationFn: vi.fn(),
  setConversationStatusFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/sla', () => ({ removeConversationSlaFn: vi.fn() }))
vi.mock('@/lib/server/functions/blocking', () => ({
  blockPersonFn: vi.fn(),
  unblockPersonFn: vi.fn(),
}))

const { mockTicket, mockTicketThread } = vi.hoisted(() => {
  const mockTicket = {
    id: 'ticket_1',
    number: 1,
    reference: '#1',
    type: 'customer',
    title: 'Cannot log in',
    status: { id: 'ticket_status_1', name: 'Open', color: '#22c55e', category: 'open' },
    stage: { slot: null, label: null },
    priority: 'none',
    requester: null,
    assignee: { principalId: null, displayName: null, teamId: null, teamName: null },
    company: null,
    firstResponseAt: null,
    dueAt: null,
    resolvedAt: null,
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-03T00:00:00.000Z',
    reopenedCount: 0,
    customAttributes: {},
    lastMessagePreview: 'Help please',
    lastMessageAt: '2026-07-03T00:00:00.000Z',
  } as TicketDTO
  const mockTicketThread = {
    hasMore: false,
    messages: [
      {
        id: 'conversation_msg_1',
        conversationId: null,
        ticketId: 'ticket_1',
        senderType: 'visitor',
        content: 'Help please',
        createdAt: '2026-07-03T00:00:00.000Z',
        author: null,
        attachments: [],
        citations: [],
        isAssistant: false,
        isInternal: false,
        contentJson: null,
        viaEmail: false,
        systemEvent: null,
        reactions: [],
        flaggedAt: null,
        postSuggestion: null,
        translatedFrom: null,
      },
    ],
  }
  return { mockTicket, mockTicketThread }
})

vi.mock('@/lib/server/functions/tickets', () => ({
  sendTicketMessageFn: vi.fn(),
  addTicketNoteFn: vi.fn(),
  listTicketMessagesFn: vi.fn().mockResolvedValue(mockTicketThread),
  markTicketUnreadFromMessageFn: vi.fn(),
  markTicketReadFn: vi.fn().mockResolvedValue({ ok: true }),
  getTicketFn: vi.fn().mockResolvedValue(mockTicket),
  setTicketStatusFn: vi.fn(),
  exportTicketTranscriptFn: vi.fn(),
}))
vi.mock('@/lib/client/queries/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/queries/inbox')>()),
  inboxQueries: {
    ticketThread: (id: string) => ({
      queryKey: ['ticket-thread', id],
      queryFn: () => Promise.resolve(mockTicketThread),
    }),
    ticketDetail: (id: string) => ({
      queryKey: ['ticket-detail', id],
      queryFn: () => Promise.resolve({ ...mockTicket, id }),
    }),
    conversationTicketLink: (id: string) => ({
      queryKey: ['conversation-ticket-link', id],
      queryFn: () => Promise.resolve(null),
    }),
  },
  ticketQueries: {
    statuses: () => ({
      queryKey: ['ticket-statuses'],
      queryFn: () => Promise.resolve([]),
    }),
  },
}))
vi.mock('@/lib/client/queries/conversation-inbox', () => ({
  conversationInboxQueries: {
    thread: (id: string) => ({
      queryKey: ['conv-thread', id],
      queryFn: () =>
        Promise.resolve({
          hasMore: false,
          conversation: makeConversation({ id: id as ConversationDTO['id'] }),
          messages: [] as AgentConversationMessageDTO[],
        }),
    }),
  },
}))

import { AgentConversationThread } from '../agent-conversation-thread'

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

function renderThread(item: { kind: 'conversation' | 'ticket'; id: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AgentConversationThread
        item={item as never}
        targetMessageId={null}
        onChanged={vi.fn()}
        onBack={vi.fn()}
        onSelectItem={vi.fn()}
        onOpenPost={vi.fn()}
        isVisitorTyping={false}
        isOtherAgentTyping={false}
      />
    </QueryClientProvider>
  )
}

describe('AgentConversationThread — ticket capability wiring', () => {
  it('a back_office/tracker ticket is note-only: no Reply/Note toggle', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['ticket-detail', 'ticket_tracker'], {
      ...mockTicket,
      id: 'ticket_tracker',
      type: 'tracker',
    })
    client.setQueryData(['ticket-thread', 'ticket_tracker'], mockTicketThread)
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'ticket', id: 'ticket_tracker' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
        />
      </QueryClientProvider>
    )
    const editor = await screen.findByTestId('editor')
    expect(editor).toHaveAttribute('placeholder', 'Add an internal note for your team…')
    expect(screen.queryByText('Reply')).not.toBeInTheDocument()
    expect(screen.queryByText('Note')).not.toBeInTheDocument()
  })

  it('a customer ticket keeps both Reply and Note tabs', async () => {
    // Repoint the ticket-detail queryFn for this one render via a fresh client
    // seeded with the customer variant.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['ticket-detail', 'ticket_2'], {
      ...mockTicket,
      id: 'ticket_2',
      type: 'customer',
    })
    client.setQueryData(['ticket-thread', 'ticket_2'], mockTicketThread)
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'ticket', id: 'ticket_2' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
        />
      </QueryClientProvider>
    )
    expect(await screen.findByText('Reply')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('renders the ticket header controls + type badge', async () => {
    renderThread({ kind: 'ticket', id: 'ticket_1' })
    expect(await screen.findByTestId('ticket-type-badge')).toHaveTextContent('customer')
    expect(screen.getByTestId('ticket-status-control')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-assignee-control')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-priority-control')).toBeInTheDocument()
  })
})

describe('AgentConversationThread — conversation kind unaffected', () => {
  it('still renders the conversation detail panel and Reply/Note tabs', async () => {
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    expect(await screen.findByText('Reply')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-detail-panel')).toBeInTheDocument()
  })
})
