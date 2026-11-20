// @vitest-environment happy-dom
/**
 * A change that lands between the thread load and the live stream opening
 * (here, a teammate closing the conversation) reaches the visitor without a
 * reopen: once the stream opens, the thread refetches and adopts what it
 * missed. A stream event that lands while that refetch is in flight is not
 * undone by the refetch's older snapshot.
 *
 * Real thread, real stream hook; only the EventSource and the RPCs are fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConversationId } from '@quackback/ids'

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
vi.mock('@/lib/server/functions/widget-capabilities', () => ({
  getWidgetCapabilitiesFn: vi.fn(async () => ({ chat: { mode: 'live', pollIntervalMs: 60_000 } })),
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

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  private listeners = new Map<string, Array<(e: { data: string }) => void>>()
  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }
  addEventListener(name: string, handler: (e: { data: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler])
  }
  emit(name: string, data: unknown) {
    for (const handler of this.listeners.get(name) ?? []) handler({ data: JSON.stringify(data) })
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CONVERSATION_ID = 'conversation_01h00000000000000000000000' as ConversationId
const CLOSED_HINT = 'This conversation was closed. Reply to reopen it.'

const message = {
  id: 'conversation_msg_1',
  conversationId: CONVERSATION_ID,
  senderType: 'visitor',
  content: 'Hi! Is anyone there?',
  createdAt: '2026-11-19T10:00:00.000Z',
}

type Page = { messages: unknown[]; hasMore: boolean; status?: string; csatRating?: number | null }

function makeRpc(listConversationMessages: () => Promise<Page>) {
  return {
    getMyConversation: vi.fn(async () => ({
      welcomeMessage: null,
      offlineMessage: null,
      teamName: 'Team',
      assistant: null,
      canEmailVisitor: false,
      linkedTicket: null,
      reopensOnReply: true,
      // Loaded while still open.
      conversation: { id: CONVERSATION_ID, status: 'open', csatRating: null },
      messages: [message],
      hasMore: false,
    })),
    listConversationMessages: vi.fn(listConversationMessages),
    mintConversationStreamToken: vi.fn(async () => ({ token: 'stream-token' })),
    sendConversationMessage: vi.fn(),
    sendConversationTyping: vi.fn(async () => ({})),
    submitCsat: vi.fn(),
    markConversationRead: vi.fn(async () => ({})),
    getConversationLinkedTicket: vi.fn(async () => null),
  }
}

async function renderThread(rpc: ReturnType<typeof makeRpc>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <VisitorSurfaceRpcProvider value={rpc as unknown as VisitorSurfaceRpc}>
          <VisitorConversationThread
            conversationTarget={CONVERSATION_ID}
            uploadFile={async () => {
              throw new Error('no uploads here')
            }}
            presence={{ agentsOnline: true, withinOfficeHours: null, nextOpenAt: null }}
          />
        </VisitorSurfaceRpcProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
  return FakeEventSource.instances[0]
}

describe('VisitorConversationThread catches up when the stream first opens', () => {
  it('shows a close that happened before the stream opened', async () => {
    // The server's view by the time the stream opens: closed.
    const rpc = makeRpc(async () => ({ messages: [message], hasMore: false, status: 'closed' }))
    const stream = await renderThread(rpc)
    expect(screen.queryByText(CLOSED_HINT)).not.toBeInTheDocument()

    act(() => stream.onopen?.())

    expect(await screen.findByText(CLOSED_HINT)).toBeInTheDocument()
  })

  it('still catches up while the assistant streams (typing and progress frames undo nothing)', async () => {
    let answer: (page: Page) => void = () => {}
    const rpc = makeRpc(() => new Promise<Page>((resolve) => (answer = resolve)))
    const stream = await renderThread(rpc)
    act(() => stream.onopen?.())
    await waitFor(() => expect(rpc.listConversationMessages).toHaveBeenCalledTimes(1))

    act(() => {
      stream.emit('typing', { kind: 'typing', conversationId: CONVERSATION_ID, side: 'agent' })
      stream.emit('assistant_activity', {
        kind: 'assistant_activity',
        conversationId: CONVERSATION_ID,
        status: 'thinking',
      })
      stream.emit('assistant_delta', {
        kind: 'assistant_delta',
        conversationId: CONVERSATION_ID,
        text: 'Let me check',
      })
    })
    await act(async () => answer({ messages: [message], hasMore: false, status: 'closed' }))

    expect(await screen.findByText(CLOSED_HINT)).toBeInTheDocument()
    expect(rpc.listConversationMessages).toHaveBeenCalledTimes(1)
  })

  it('does not let an older refetch undo a stream event that landed while it was in flight', async () => {
    let answer: (page: Page) => void = () => {}
    const pages: Page[] = []
    const rpc = makeRpc(() => {
      // The first refetch hangs until the test answers it; later ones read
      // the server's current view.
      if (rpc.listConversationMessages.mock.calls.length === 1) {
        return new Promise<Page>((resolve) => (answer = resolve))
      }
      return Promise.resolve(pages.at(-1)!)
    })
    const stream = await renderThread(rpc)
    act(() => stream.onopen?.())
    await waitFor(() => expect(rpc.listConversationMessages).toHaveBeenCalledTimes(1))

    // A teammate closes the conversation: the stream says so live…
    act(() =>
      stream.emit('conversation', {
        kind: 'conversation',
        conversation: { id: CONVERSATION_ID, status: 'closed', csatRating: null },
      })
    )
    expect(await screen.findByText(CLOSED_HINT)).toBeInTheDocument()
    // …and the refetch, read before the close, answers afterwards.
    pages.push({ messages: [message], hasMore: false, status: 'closed' })
    await act(async () => answer({ messages: [message], hasMore: false, status: 'open' }))

    await waitFor(() => expect(rpc.listConversationMessages).toHaveBeenCalledTimes(2))
    expect(screen.getByText(CLOSED_HINT)).toBeInTheDocument()
  })
})
