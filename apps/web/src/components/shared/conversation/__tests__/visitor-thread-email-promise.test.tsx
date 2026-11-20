// @vitest-environment happy-dom
/**
 * "We'll reply by email" is a promise, so it shows only when a reply can
 * reach the visitor by email: email is set up and the visitor has a real
 * address. An anonymous visitor (whose account email is a placeholder) and
 * anyone else without one sees "We'll reply here" while the team is away.
 * The server decides (`canEmailVisitor`); the thread shows it in its own
 * header and reports it to the widget, whose header shows the same badge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: () => <div data-testid="editor" />,
}))
vi.mock('@/components/conversation/thread', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/conversation/thread')>()
  return {
    ...actual,
    ThreadViewport: () => <div data-testid="thread-viewport" />,
    useThreadVirtualizer: () => ({ isAtEnd: () => true, scrollToEnd: () => {} }),
    useOlderMessages: () => ({ loadingOlder: false, loadOlder: () => {} }),
    useMarkReadOnIncoming: () => {},
  }
})
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
import { ConversationPresenceBadge } from '../conversation-presence-badge'

afterEach(cleanup)

const AWAY = { agentsOnline: false, withinOfficeHours: null, nextOpenAt: null }

function withIntl(ui: React.ReactNode) {
  return (
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      {ui}
    </IntlProvider>
  )
}

async function renderThread(canEmailVisitor: boolean, onReplyByEmail = vi.fn()) {
  const rpc = {
    getMyConversation: vi.fn(async () => ({
      welcomeMessage: 'Hi there',
      offlineMessage: 'We will get back to you soon.',
      teamName: 'Team',
      assistant: null,
      canEmailVisitor,
      linkedTicket: null,
      conversation: null,
      messages: [],
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
      {withIntl(
        <VisitorSurfaceRpcProvider value={rpc as unknown as VisitorSurfaceRpc}>
          <VisitorConversationThread
            conversationTarget="new"
            uploadFile={vi.fn()}
            presence={AWAY}
            onReplyByEmailChange={onReplyByEmail}
          />
        </VisitorSurfaceRpcProvider>
      )}
    </QueryClientProvider>
  )
  await waitFor(() => expect(rpc.getMyConversation).toHaveBeenCalled())
  return { onReplyByEmail }
}

describe('the away badge', () => {
  it('promises email only when a reply can reach the visitor by email', () => {
    const { rerender } = render(
      withIntl(<ConversationPresenceBadge available={false} canReplyByEmail />)
    )
    expect(screen.getByText("We'll reply by email")).toBeInTheDocument()

    rerender(withIntl(<ConversationPresenceBadge available={false} canReplyByEmail={false} />))
    expect(screen.queryByText("We'll reply by email")).not.toBeInTheDocument()
    expect(screen.getByText("We'll reply here")).toBeInTheDocument()
  })

  it('says the team is online either way', () => {
    render(withIntl(<ConversationPresenceBadge available canReplyByEmail={false} />))
    expect(screen.getByText("We're online")).toBeInTheDocument()
  })
})

describe('the visitor thread while the team is away', () => {
  it('does not promise email to a visitor it cannot email', async () => {
    const { onReplyByEmail } = await renderThread(false)
    expect(await screen.findByText("We'll reply here")).toBeInTheDocument()
    expect(screen.queryByText("We'll reply by email")).not.toBeInTheDocument()
    expect(onReplyByEmail).toHaveBeenLastCalledWith(false)
  })

  it('promises email to a visitor with a real address', async () => {
    const { onReplyByEmail } = await renderThread(true)
    expect(await screen.findByText("We'll reply by email")).toBeInTheDocument()
    await waitFor(() => expect(onReplyByEmail).toHaveBeenLastCalledWith(true))
  })
})
