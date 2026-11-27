// @vitest-environment happy-dom
/**
 * An anonymous visitor gives their email once. After one in-thread ticket
 * form takes it, every other ticket form in the same thread stops asking,
 * so the thread reports the email to its parent only once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import type { ConversationId } from '@quackback/ids'

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="editor" />,
}))
vi.mock('@/components/conversation/thread', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/conversation/thread')>()
  return {
    ...actual,
    ThreadViewport: ({
      rows,
      renderRow,
    }: {
      rows: unknown[]
      renderRow: (row: unknown) => ReactNode
    }) => (
      <div data-testid="thread-viewport">
        {rows.map((row, i) => (
          <div key={i}>{renderRow(row)}</div>
        ))}
      </div>
    ),
    useThreadVirtualizer: () => ({ isAtEnd: () => true, scrollToEnd: () => {} }),
    useOlderMessages: () => ({ loadingOlder: false, loadOlder: () => {} }),
    useMarkReadOnIncoming: () => {},
  }
})
vi.mock('../block-ticket-form', () => ({
  BlockTicketForm: ({
    askEmail,
    onEmailSubmitted,
  }: {
    askEmail?: boolean
    onEmailSubmitted?: (email: string) => void
  }) => (
    <div data-testid="ticket-form" data-asks-email={String(askEmail)}>
      <button type="button" onClick={() => onEmailSubmitted?.('ada@example.com')}>
        File with email
      </button>
    </div>
  ),
}))
vi.mock('@/lib/client/hooks/use-conversation-stream', () => ({ useConversationStream: () => {} }))
vi.mock('@/lib/server/functions/widget-capabilities', () => ({
  getWidgetCapabilitiesFn: vi.fn(async () => ({ chat: { mode: 'poll', pollIntervalMs: 60_000 } })),
}))
vi.mock('@/lib/server/functions/conversation', () => ({
  getMyConversationFn: vi.fn(),
  sendConversationMessageFn: vi.fn(),
  listConversationMessagesFn: vi.fn(),
  mintConversationStreamTokenFn: vi.fn(),
  submitCsatFn: vi.fn(),
  markConversationReadFn: vi.fn(),
  sendConversationTypingFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/tickets', () => ({
  getConversationLinkedTicketFn: vi.fn(),
  createMyTicketFn: vi.fn(),
  getMyTicketStageLabelsFn: vi.fn(),
  getMyTicketFormFn: vi.fn(),
  getMyTicketWatchStatusFn: vi.fn(),
  watchMyTicketFn: vi.fn(),
  unwatchMyTicketFn: vi.fn(),
  getMyTicketSharingFn: vi.fn(),
  listMyTicketColleaguesFn: vi.fn(),
  shareMyTicketFn: vi.fn(),
  removeMyTicketShareFn: vi.fn(),
}))

import { VisitorSurfaceRpcProvider, type VisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'
import { VisitorConversationThread } from '../visitor-conversation-thread'

afterEach(cleanup)

const CONVERSATION_ID = 'conversation_01h00000000000000000000000' as ConversationId

function ticketFormMessage(id: string, createdAt: string) {
  return {
    id,
    senderType: 'agent',
    content: 'Tell us more and we will open a ticket.',
    createdAt,
    block: { kind: 'ticketForm' },
  }
}

describe('in-thread ticket forms', () => {
  it('stop asking for the email once one form has taken it', async () => {
    const onEmailSubmitted = vi.fn()
    const rpc = {
      getMyConversation: vi.fn(async () => ({
        welcomeMessage: 'Hi there',
        offlineMessage: null,
        teamName: 'Team',
        assistant: null,
        canEmailVisitor: false,
        ticketFormAsksEmail: true,
        linkedTicket: null,
        conversation: { id: CONVERSATION_ID, status: 'open', visitorLastReadAt: null },
        messages: [
          ticketFormMessage('message_1', '2026-07-02T10:00:00.000Z'),
          ticketFormMessage('message_2', '2026-07-02T10:05:00.000Z'),
        ],
        hasMore: false,
      })),
      sendConversationMessage: vi.fn(),
      sendConversationTyping: vi.fn(async () => ({})),
      listConversationMessages: vi.fn(),
      mintConversationStreamToken: vi.fn(),
      submitCsat: vi.fn(),
      markConversationRead: vi.fn(async () => ({})),
      getConversationLinkedTicket: vi.fn(),
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={{}} onError={() => {}}>
          <VisitorSurfaceRpcProvider value={rpc as unknown as VisitorSurfaceRpc}>
            <VisitorConversationThread
              conversationTarget={CONVERSATION_ID}
              uploadFile={vi.fn()}
              presence={{ agentsOnline: true, withinOfficeHours: null, nextOpenAt: null }}
              onEmailSubmitted={onEmailSubmitted}
            />
          </VisitorSurfaceRpcProvider>
        </IntlProvider>
      </QueryClientProvider>
    )

    const forms = await screen.findAllByTestId('ticket-form')
    expect(forms).toHaveLength(2)
    for (const form of forms) expect(form).toHaveAttribute('data-asks-email', 'true')

    fireEvent.click(screen.getAllByRole('button', { name: 'File with email' })[0]!)

    expect(onEmailSubmitted).toHaveBeenCalledExactlyOnceWith('ada@example.com')
    await waitFor(() => {
      for (const form of screen.getAllByTestId('ticket-form')) {
        expect(form).toHaveAttribute('data-asks-email', 'false')
      }
    })
  })
})
