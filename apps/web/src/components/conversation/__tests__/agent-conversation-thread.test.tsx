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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import type { ConversationDTO, AgentConversationMessageDTO } from '@/lib/shared/conversation/types'
import type { LinkedTicketSummary } from '@/lib/shared/inbox/items'

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
vi.mock('../composer-ai-actions', () => ({
  ComposerAiActions: ({ activeMode }: { activeMode: string }) => (
    <div data-testid="composer-ai-actions" data-active-mode={activeMode} />
  ),
}))
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
  InboxDetailPanel: ({ openCopilotToken }: { openCopilotToken?: number }) => (
    <div data-testid="inbox-detail-panel" data-open-copilot-token={openCopilotToken} />
  ),
}))
vi.mock('../suggested-reply-card', () => ({
  SuggestedReplyCard: ({
    lastCustomerMessageId,
    onAskCopilot,
  }: {
    lastCustomerMessageId: string
    onAskCopilot?: () => void
  }) => (
    <div
      data-testid="suggested-reply-card"
      data-last-customer-message-id={lastCustomerMessageId}
      data-has-ask-copilot={String(Boolean(onAskCopilot))}
    >
      {onAskCopilot && (
        <button type="button" onClick={onAskCopilot}>
          Ask Copilot (stub)
        </button>
      )}
    </div>
  ),
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

const { mockTicket, mockTicketThread, mockTicketVariants, mockTicketLink, mockTicketStatuses } =
  vi.hoisted(() => {
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
      sla: null,
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
    // Per-id ticket-detail overrides for tests that need a variant (e.g. a
    // closed-category status) to survive the mount refetch — seeding the query
    // cache alone gets overwritten by the mocked queryFn's canonical row.
    const mockTicketVariants: Record<string, Partial<TicketDTO>> = {}
    // The linked-ticket summary the conversationTicketLink queryFn hands back
    // (null = no linked ticket) and the status catalogue the statuses queryFn
    // serves — object refs so individual tests can flip them per render.
    const mockTicketLink: { value: LinkedTicketSummary | null } = { value: null }
    const mockTicketStatuses: {
      value: { id: string; slug: string; category: string; isDefault: boolean }[]
    } = { value: [] }
    return { mockTicket, mockTicketThread, mockTicketVariants, mockTicketLink, mockTicketStatuses }
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
      queryFn: () => Promise.resolve({ ...mockTicket, ...(mockTicketVariants[id] ?? {}), id }),
    }),
    conversationTicketLink: (id: string) => ({
      queryKey: ['conversation-ticket-link', id],
      queryFn: () => Promise.resolve(mockTicketLink.value),
    }),
  },
  ticketQueries: {
    statuses: () => ({
      queryKey: ['ticket-statuses'],
      queryFn: () => Promise.resolve(mockTicketStatuses.value),
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
import { setConversationStatusFn } from '@/lib/server/functions/conversation'
import { setTicketStatusFn } from '@/lib/server/functions/tickets'

afterEach(() => {
  mockTicketLink.value = null
  mockTicketStatuses.value = []
  vi.clearAllMocks()
})

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

  it('a customer ticket keeps both Reply and Note modes', async () => {
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
    const trigger = await screen.findByRole('button', { name: 'Reply' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitemradio', { name: 'Note' })).toBeInTheDocument()
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
  it('still renders the conversation detail panel and the Reply/Note switcher', async () => {
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    const trigger = await screen.findByRole('button', { name: 'Reply' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    expect(await screen.findByRole('menuitemradio', { name: 'Note' })).toBeInTheDocument()
    expect(screen.getByTestId('inbox-detail-panel')).toBeInTheDocument()
    expect(screen.getByTestId('composer-ai-actions')).toHaveAttribute('data-active-mode', 'reply')
  })
})

/** A minimal, valid `AgentConversationMessageDTO` — every field the type
 *  requires, only `id`/`senderType` varied per test. */
function makeMessage(
  overrides: Partial<AgentConversationMessageDTO> = {}
): AgentConversationMessageDTO {
  return {
    id: 'conversation_msg_1' as AgentConversationMessageDTO['id'],
    conversationId: 'conversation_suggest' as ConversationDTO['id'],
    ticketId: null,
    senderType: 'visitor',
    content: 'It is still broken',
    createdAt: '2026-07-09T00:00:00.000Z',
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
    ...overrides,
  } as AgentConversationMessageDTO
}

describe('AgentConversationThread — suggested-reply card wiring', () => {
  function renderWithMessages(
    messages: AgentConversationMessageDTO[],
    conversationOverrides: Partial<ConversationDTO> = {}
  ) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['conv-thread', 'conversation_suggest'], {
      hasMore: false,
      conversation: makeConversation({
        id: 'conversation_suggest' as ConversationDTO['id'],
        ...conversationOverrides,
      }),
      messages,
    })
    return render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'conversation', id: 'conversation_suggest' } as never}
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

  it('renders the card, keyed to the latest message, when the customer spoke last', async () => {
    renderWithMessages([makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' })])
    const card = await screen.findByTestId('suggested-reply-card')
    expect(card).toHaveAttribute('data-last-customer-message-id', 'conversation_msg_1')
  })

  it('renders nothing when a teammate already replied last', async () => {
    renderWithMessages([
      makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' }),
      makeMessage({ id: 'conversation_msg_2' as never, senderType: 'agent', content: 'On it!' }),
    ])
    await screen.findByTestId('inbox-detail-panel')
    expect(screen.queryByTestId('suggested-reply-card')).not.toBeInTheDocument()
  })

  it("a teammate's internal note after the customer does NOT suppress the card", async () => {
    // A note is not a reply — the customer is still waiting, so the
    // eligibility scan skips internal notes and stays keyed to the customer's
    // message.
    renderWithMessages([
      makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' }),
      makeMessage({
        id: 'conversation_msg_2' as never,
        senderType: 'agent',
        content: 'Looks like the SSO bug again',
        isInternal: true,
      }),
    ])
    const card = await screen.findByTestId('suggested-reply-card')
    expect(card).toHaveAttribute('data-last-customer-message-id', 'conversation_msg_1')
  })

  it('renders nothing for a CLOSED conversation, even with the customer last', async () => {
    renderWithMessages(
      [makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' })],
      { status: 'closed' }
    )
    await screen.findByTestId('inbox-detail-panel')
    expect(screen.queryByTestId('suggested-reply-card')).not.toBeInTheDocument()
  })

  it('renders the card for an open customer ticket, but not a closed-category one', async () => {
    // Open baseline (proves the ticket path renders the card at all)…
    renderThread({ kind: 'ticket', id: 'ticket_1' })
    await screen.findByTestId('suggested-reply-card')
    cleanup()

    // …then the same eligible thread under a closed-category status: no card.
    mockTicketVariants['ticket_closed'] = {
      status: { id: 'ticket_status_closed', name: 'Closed', color: '#666', category: 'closed' },
    } as Partial<TicketDTO>
    try {
      renderThread({ kind: 'ticket', id: 'ticket_closed' })
      await screen.findByTestId('ticket-type-badge')
      expect(screen.queryByTestId('suggested-reply-card')).not.toBeInTheDocument()
    } finally {
      delete mockTicketVariants['ticket_closed']
    }
  })

  it("the route's openCopilotToken reaches the detail panel UNTOUCHED", async () => {
    // The route owns the one open-Copilot signal; this component forwards it
    // verbatim (no local counter merged in), so the panel's 0-sentinel
    // semantics read the route's real token.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['conv-thread', 'conversation_suggest'], {
      hasMore: false,
      conversation: makeConversation({ id: 'conversation_suggest' as ConversationDTO['id'] }),
      messages: [makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' })],
    })
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'conversation', id: 'conversation_suggest' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
          openCopilotToken={7}
        />
      </QueryClientProvider>
    )
    expect(await screen.findByTestId('inbox-detail-panel')).toHaveAttribute(
      'data-open-copilot-token',
      '7'
    )
  })

  it("the card's Ask Copilot link calls the route's requestOpenCopilot callback", async () => {
    const requestOpenCopilot = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['conv-thread', 'conversation_suggest'], {
      hasMore: false,
      conversation: makeConversation({ id: 'conversation_suggest' as ConversationDTO['id'] }),
      messages: [makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' })],
    })
    render(
      <QueryClientProvider client={client}>
        <AgentConversationThread
          item={{ kind: 'conversation', id: 'conversation_suggest' } as never}
          targetMessageId={null}
          onChanged={vi.fn()}
          onBack={vi.fn()}
          onSelectItem={vi.fn()}
          onOpenPost={vi.fn()}
          isVisitorTyping={false}
          isOtherAgentTyping={false}
          openCopilotToken={0}
          requestOpenCopilot={requestOpenCopilot}
        />
      </QueryClientProvider>
    )
    await screen.findByTestId('suggested-reply-card')

    fireEvent.click(screen.getByText('Ask Copilot (stub)'))

    // The bump goes UP to the route (which owns the token) — never into a
    // thread-local counter merged with the forwarded one.
    expect(requestOpenCopilot).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('inbox-detail-panel')).toHaveAttribute('data-open-copilot-token', '0')
  })

  it('forwards NO Ask Copilot callback when the route passed none (Copilot unavailable)', async () => {
    // The route withholds requestOpenCopilot while Copilot can't actually
    // open (gate off, or a viewport too narrow to render the detail panel).
    // The thread forwards that absence verbatim — no noop stand-in — so the
    // card can hide its link instead of rendering a dead one.
    renderWithMessages([makeMessage({ id: 'conversation_msg_1' as never, senderType: 'visitor' })])
    const card = await screen.findByTestId('suggested-reply-card')
    expect(card).toHaveAttribute('data-has-ask-copilot', 'false')
    expect(screen.queryByText('Ask Copilot (stub)')).not.toBeInTheDocument()
  })
})

describe('AgentConversationThread — close with a linked ticket', () => {
  const openLink: LinkedTicketSummary = {
    id: 'ticket_9' as LinkedTicketSummary['id'],
    number: 1042,
    statusName: 'Open',
    statusCategory: 'open',
  }

  it('a plain close (no linked ticket) skips the confirm and closes directly', async () => {
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(screen.queryByText(/is still open/)).not.toBeInTheDocument()
    expect(setTicketStatusFn).not.toHaveBeenCalled()
  })

  it('closing with an OPEN linked ticket asks first; "Close conversation only" leaves the ticket alone', async () => {
    mockTicketLink.value = openLink
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Ticket #1042 is still open')).toBeInTheDocument()
    // Nothing has happened yet — the guard held the close.
    expect(setConversationStatusFn).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation only' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(setTicketStatusFn).not.toHaveBeenCalled()
  })

  it('"Resolve ticket and close" stamps the resolved status on the linked ticket, then closes', async () => {
    mockTicketLink.value = openLink
    // A closed-category default that ISN'T 'resolved' proves the resolve
    // picks the 'resolved' slug over resolveDefaultClosedStatusId's default.
    mockTicketStatuses.value = [
      { id: 'ticket_status_new', slug: 'new', category: 'open', isDefault: true },
      { id: 'ticket_status_wont_do', slug: 'wont_do', category: 'closed', isDefault: true },
      { id: 'ticket_status_resolved', slug: 'resolved', category: 'closed', isDefault: false },
    ]
    // useSetTicketStatus seeds the detail cache with the fn's return value.
    vi.mocked(setTicketStatusFn).mockResolvedValue({
      ...mockTicket,
      id: 'ticket_9',
    } as TicketDTO)
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Ticket #1042 is still open')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve ticket and close' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(setTicketStatusFn).toHaveBeenCalledWith({
      data: { ticketId: 'ticket_9', statusId: 'ticket_status_resolved' },
    })
  })

  it('a closed-category linked ticket skips the confirm entirely', async () => {
    mockTicketLink.value = { ...openLink, statusName: 'Resolved', statusCategory: 'closed' }
    renderThread({ kind: 'conversation', id: 'conversation_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(setConversationStatusFn).toHaveBeenCalled())
    expect(screen.queryByText(/is still open/)).not.toBeInTheDocument()
    expect(setTicketStatusFn).not.toHaveBeenCalled()
  })
})
