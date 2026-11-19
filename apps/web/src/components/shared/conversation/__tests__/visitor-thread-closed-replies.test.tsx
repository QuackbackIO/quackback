// @vitest-environment happy-dom
/**
 * A closed conversation tells the visitor what a reply will do. By default a
 * reply reopens it. With "Reopen when a visitor replies" off, the server
 * refuses the reply, so the thread says the conversation is closed and to
 * start a new one instead; and when a send is refused that way (the thread
 * was closed, or the setting changed, after it loaded) the visitor sees the
 * same notice and keeps what they typed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConversationId } from '@quackback/ids'

const probe = vi.hoisted(() => ({
  editorMounts: 0,
  onDocumentChange: null as ((document: unknown) => void) | null,
}))

vi.mock('@/components/ui/rich-text-editor', async () => {
  const { useEffect } = await import('react')
  return {
    RichTextEditor: ({ onDocumentChange }: { onDocumentChange?: (document: unknown) => void }) => {
      probe.onDocumentChange = onDocumentChange ?? null
      useEffect(() => {
        probe.editorMounts++
      }, [])
      return <div data-testid="editor" />
    },
  }
})
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

afterEach(() => {
  cleanup()
  probe.editorMounts = 0
  probe.onDocumentChange = null
})

const CONVERSATION_ID = 'conversation_01h00000000000000000000000' as ConversationId
const REOPEN_COPY = 'This conversation was closed. Reply to reopen it.'
const CLOSED_COPY = 'This conversation is closed. Start a new one to message us.'

function typeText(text: string) {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
  const unread = () => {
    throw new Error('the composer reads only the JSON')
  }
  act(() => probe.onDocumentChange!({ json: () => doc, html: unread, markdown: unread }))
}

async function renderThread({
  status,
  reopensOnReply,
}: {
  status: 'open' | 'closed'
  reopensOnReply: boolean
}) {
  const rpc = {
    getMyConversation: vi.fn(async () => ({
      welcomeMessage: null,
      offlineMessage: null,
      teamName: 'Team',
      assistant: null,
      canEmailVisitor: false,
      reopensOnReply,
      linkedTicket: null,
      conversation: { id: CONVERSATION_ID, status, visitorLastReadAt: null },
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
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <VisitorSurfaceRpcProvider value={rpc as unknown as VisitorSurfaceRpc}>
          <VisitorConversationThread
            conversationTarget={CONVERSATION_ID}
            uploadFile={vi.fn()}
            presence={{ agentsOnline: true, withinOfficeHours: null, nextOpenAt: null }}
          />
        </VisitorSurfaceRpcProvider>
      </IntlProvider>
    </QueryClientProvider>
  )
  await screen.findByTestId('editor')
  await waitFor(() => expect(rpc.getMyConversation).toHaveBeenCalled())
  return rpc
}

const sendButton = () => screen.getByRole('button', { name: 'Send' })

describe('a closed conversation in the visitor thread', () => {
  it('says a reply reopens it when replies reopen closed conversations', async () => {
    await renderThread({ status: 'closed', reopensOnReply: true })
    expect(await screen.findByText(REOPEN_COPY)).toBeInTheDocument()
    expect(screen.queryByText(CLOSED_COPY)).not.toBeInTheDocument()
  })

  it('says to start a new conversation when replies to closed conversations are refused', async () => {
    await renderThread({ status: 'closed', reopensOnReply: false })
    expect(await screen.findByText(CLOSED_COPY)).toBeInTheDocument()
    expect(screen.queryByText(REOPEN_COPY)).not.toBeInTheDocument()
  })

  it('explains a refused send and keeps the draft', async () => {
    // Loaded open; closed by the team before the visitor sends.
    const rpc = await renderThread({ status: 'open', reopensOnReply: true })
    // The shape the browser receives for the server's refusal
    // (typed-error-serialization.ts): a plain Error carrying its code.
    rpc.sendConversationMessage.mockRejectedValueOnce(
      Object.assign(new Error('This conversation has been closed. Please start a new one.'), {
        code: 'CONVERSATION_CLOSED',
        statusCode: 409,
      })
    )
    typeText('Hello again')
    fireEvent.click(sendButton())

    expect(await screen.findByText(CLOSED_COPY)).toBeInTheDocument()
    expect(screen.queryByText(REOPEN_COPY)).not.toBeInTheDocument()
    // The draft stays.
    expect(probe.editorMounts).toBe(1)
    await waitFor(() => expect(sendButton()).toBeEnabled())
  })

  it('raises the notice when a send to a conversation already shown closed is refused', async () => {
    const rpc = await renderThread({ status: 'closed', reopensOnReply: false })
    expect(await screen.findByText(CLOSED_COPY)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    rpc.sendConversationMessage.mockRejectedValueOnce(
      Object.assign(new Error('This conversation has been closed. Please start a new one.'), {
        code: 'CONVERSATION_CLOSED',
        statusCode: 409,
      })
    )
    typeText('Hello again')
    fireEvent.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(CLOSED_COPY)
    expect(probe.editorMounts).toBe(1)
  })

  it('says nothing about closing when a send fails for another reason', async () => {
    const rpc = await renderThread({ status: 'open', reopensOnReply: true })
    rpc.sendConversationMessage.mockRejectedValueOnce(
      Object.assign(new Error('Conversation not found'), {
        code: 'CONVERSATION_NOT_FOUND',
        statusCode: 404,
      })
    )
    typeText('Hello again')
    fireEvent.click(sendButton())
    await waitFor(() => expect(rpc.sendConversationMessage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(sendButton()).toBeEnabled())
    expect(screen.queryByText(CLOSED_COPY)).not.toBeInTheDocument()
    expect(screen.queryByText(REOPEN_COPY)).not.toBeInTheDocument()
  })
})
