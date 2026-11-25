// @vitest-environment happy-dom
/**
 * "We'll reply by email" is a promise, so it shows only when a reply can
 * reach the visitor by email: email is set up and the visitor has a real
 * address. An anonymous visitor (whose account email is a placeholder) and
 * anyone else without one sees "We'll reply here" while the team is away.
 * The server decides (`canEmailVisitor`); the thread shows it in its own
 * header when the workspace hides its usual reply time, and reports it to
 * the widget, whose header shows the same line.
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
}))

import { VisitorSurfaceRpcProvider, type VisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'
import { VisitorConversationThread } from '../visitor-conversation-thread'
import type { ReplyTime } from '@/lib/shared/widget/reply-time'

afterEach(cleanup)

const AWAY = { agentsOnline: false, withinOfficeHours: null, nextOpenAt: null }

function withIntl(ui: React.ReactNode) {
  return (
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      {ui}
    </IntlProvider>
  )
}

async function renderThread(
  canEmailVisitor: boolean,
  {
    replyTime,
    knownReplyTime,
    pending = false,
    presence = AWAY,
    showHeader,
    onReplyByEmail = vi.fn(),
  }: {
    replyTime?: string
    knownReplyTime?: ReplyTime
    pending?: boolean
    presence?: typeof AWAY
    showHeader?: boolean
    onReplyByEmail?: () => void
  } = {}
) {
  const loaded = {
    welcomeMessage: 'Hi there',
    offlineMessage: 'We will get back to you soon.',
    teamName: 'Acme Support',
    replyTime,
    assistant: null,
    canEmailVisitor,
    linkedTicket: null,
    conversation: null,
    messages: [],
    hasMore: false,
  }
  const rpc = {
    getMyConversation: vi.fn(() => (pending ? new Promise(() => {}) : Promise.resolve(loaded))),
    sendConversationMessage: vi.fn(),
    sendConversationTyping: vi.fn(async () => ({})),
    listConversationMessages: vi.fn(),
    mintConversationStreamToken: vi.fn(),
    submitCsat: vi.fn(),
    markConversationRead: vi.fn(async () => ({})),
    getConversationLinkedTicket: vi.fn(),
  }
  const client = new QueryClient()
  const tree = (surfaceReplyTime?: ReplyTime) => (
    <QueryClientProvider client={client}>
      {withIntl(
        <VisitorSurfaceRpcProvider value={rpc as unknown as VisitorSurfaceRpc}>
          <VisitorConversationThread
            conversationTarget="new"
            uploadFile={vi.fn()}
            presence={presence}
            showHeader={showHeader}
            team={[{ name: 'Ada Lovelace', avatarUrl: null }]}
            replyTime={surfaceReplyTime}
            onReplyByEmailChange={onReplyByEmail}
          />
        </VisitorSurfaceRpcProvider>
      )}
    </QueryClientProvider>
  )
  const { rerender } = render(tree(knownReplyTime))
  await waitFor(() => expect(rpc.getMyConversation).toHaveBeenCalled())
  return { rerenderWith: (surfaceReplyTime?: ReplyTime) => rerender(tree(surfaceReplyTime)) }
}

describe('the visitor thread while the team is away', () => {
  it('names the team and its usual reply time in the header', async () => {
    await renderThread(false)
    expect(await screen.findByText('Acme Support')).toBeInTheDocument()
    expect(screen.getByText('AL')).toBeInTheDocument()
    expect(
      screen.getByText(/^Typically replies in under an hour · We'll reply here$/)
    ).toBeInTheDocument()
  })

  it('words the reply time the surface already knows before the thread loads', async () => {
    await renderThread(false, { knownReplyTime: 'day', pending: true })
    expect(screen.getByText(/^Typically replies within a day · /)).toBeInTheDocument()
  })

  it('follows a reply time the surface passes later, before the thread loads', async () => {
    const { rerenderWith } = await renderThread(false, { knownReplyTime: 'day', pending: true })
    rerenderWith('minutes')
    expect(screen.getByText(/^Typically replies in a few minutes · /)).toBeInTheDocument()
  })

  it('says when the team is back once: in the header, not again in the body', async () => {
    const closed = { ...AWAY, withinOfficeHours: false, nextOpenAt: '2030-01-07T09:00:00.000Z' }
    await renderThread(false, { replyTime: 'off', presence: closed })
    expect(await screen.findByText('Acme Support')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/we'll reply here when we're back/)).toBeInTheDocument()
    )
    expect(screen.getAllByText(/\bBack\b/)).toHaveLength(1)
  })

  it('keeps the body time when the surface draws its own header', async () => {
    const closed = { ...AWAY, withinOfficeHours: false, nextOpenAt: '2030-01-07T09:00:00.000Z' }
    await renderThread(false, { replyTime: 'off', presence: closed, showHeader: false })
    await waitFor(() =>
      expect(screen.getByText(/we'll reply here when we're back/)).toBeInTheDocument()
    )
    expect(screen.getAllByText(/\bBack\b/)).toHaveLength(1)
  })

  it('keeps the known reply time when the thread load does not carry one', async () => {
    await renderThread(false, { knownReplyTime: 'day' })
    expect(await screen.findByText('Acme Support')).toBeInTheDocument()
    expect(screen.getByText(/^Typically replies within a day · /)).toBeInTheDocument()
  })

  it('does not promise email to a visitor it cannot email', async () => {
    const onReplyByEmail = vi.fn()
    await renderThread(false, { replyTime: 'off', onReplyByEmail })
    expect(await screen.findByText("We'll reply here")).toBeInTheDocument()
    expect(screen.queryByText("We'll reply by email")).not.toBeInTheDocument()
    expect(onReplyByEmail).toHaveBeenLastCalledWith(false)
  })

  it('promises email to a visitor with a real address', async () => {
    const onReplyByEmail = vi.fn()
    await renderThread(true, { replyTime: 'off', onReplyByEmail })
    expect(await screen.findByText("We'll reply by email")).toBeInTheDocument()
    await waitFor(() => expect(onReplyByEmail).toHaveBeenLastCalledWith(true))
  })
})
