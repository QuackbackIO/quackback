// @vitest-environment happy-dom
/**
 * Typing a message is the editor's work alone: a keystroke must not re-render
 * the visitor thread around the composer. The composer still sends exactly
 * what was typed, empties after a send, signals typing to the team and looks
 * up help articles for a first message. The editor is a stub that hands the
 * test its onChange; the thread viewport stub counts the thread's renders.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ConversationId } from '@quackback/ids'

const probe = vi.hoisted(() => ({
  threadRenders: 0,
  editorMounts: 0,
  onChange: null as ((json: unknown) => void) | null,
  onSubmit: null as (() => void) | null,
  previewed: [] as string[],
}))

vi.mock('@/components/ui/rich-text-editor', async () => {
  const { useEffect } = await import('react')
  return {
    RichTextEditor: ({
      onChange,
      onSubmit,
    }: {
      onChange?: (json: unknown) => void
      onSubmit?: () => void
    }) => {
      probe.onChange = onChange ?? null
      probe.onSubmit = onSubmit ?? null
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
    ThreadViewport: () => {
      probe.threadRenders++
      return <div data-testid="thread-viewport" />
    },
    useThreadVirtualizer: () => ({ isAtEnd: () => true, scrollToEnd: () => {} }),
    useOlderMessages: () => ({ loadingOlder: false, loadOlder: () => {} }),
    useMarkReadOnIncoming: () => {},
  }
})

vi.mock('@/lib/client/hooks/use-conversation-stream', () => ({ useConversationStream: () => {} }))
vi.mock('@/lib/server/functions/widget-capabilities', () => ({
  getWidgetCapabilitiesFn: vi.fn(async () => ({ chat: { mode: 'poll', pollIntervalMs: 60_000 } })),
}))
// The portal's default RPC; every call in these tests goes to the one the test provides.
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
vi.mock('@/components/shared/link-preview-card', () => ({
  LinkPreviews: ({ content }: { content: string }) => {
    probe.previewed.push(content)
    return null
  },
}))

import { VisitorSurfaceRpcProvider, type VisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'
import { VisitorConversationThread } from '../visitor-conversation-thread'

afterEach(() => {
  cleanup()
  probe.threadRenders = 0
  probe.editorMounts = 0
  probe.onChange = null
  probe.previewed = []
})

const CONVERSATION_ID = 'conversation_01h00000000000000000000000' as ConversationId

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Feed the composer one character at a time, as the editor does. */
function type(from: string, to: string) {
  for (let i = from.length + 1; i <= to.length; i++) {
    act(() => probe.onChange!(doc(to.slice(0, i))))
  }
}

function makeRpc(existing: boolean) {
  return {
    getMyConversation: vi.fn(async () => ({
      welcomeMessage: 'Hi there',
      offlineMessage: null,
      teamName: 'Team',
      assistant: null,
      canEmailVisitor: false,
      linkedTicket: null,
      conversation: existing ? { id: CONVERSATION_ID, status: 'open' } : null,
      messages: [],
      hasMore: false,
    })),
    sendConversationMessage: vi.fn(async () => ({
      conversation: { id: CONVERSATION_ID, status: 'open' },
      message: {
        id: 'message_1',
        senderType: 'visitor',
        content: 'Hello there',
        createdAt: new Date().toISOString(),
      },
    })),
    sendConversationTyping: vi.fn(async () => ({})),
    listConversationMessages: vi.fn(),
    mintConversationStreamToken: vi.fn(),
    submitCsat: vi.fn(),
    markConversationRead: vi.fn(async () => ({})),
    getConversationLinkedTicket: vi.fn(),
  }
}

async function renderThread({
  existing = false,
  helpSearch,
  linkPreviews = false,
}: {
  existing?: boolean
  helpSearch?: (q: string) => Promise<Array<{ slug: string; title: string }>>
  linkPreviews?: boolean
} = {}) {
  const rpc = makeRpc(existing)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <VisitorSurfaceRpcProvider value={rpc as unknown as VisitorSurfaceRpc}>
          <VisitorConversationThread
            conversationTarget={existing ? CONVERSATION_ID : 'new'}
            uploadImage={async () => 'https://example.com/a.png'}
            presence={{ agentsOnline: true, withinOfficeHours: null, nextOpenAt: null }}
            linkPreviews={linkPreviews}
            helpSearch={helpSearch ? { search: helpSearch, onSelect: () => {} } : undefined}
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

describe('VisitorConversationThread composer', () => {
  it('does not re-render the thread per keystroke', async () => {
    await renderThread()
    expect(sendButton()).toBeDisabled()

    type('', 'H')
    expect(sendButton()).toBeEnabled()

    probe.threadRenders = 0
    type('H', 'Hello there')
    expect(probe.threadRenders).toBe(0)
  })

  it('sends the message as typed and empties the composer', async () => {
    const rpc = await renderThread()
    type('', 'Hello there')

    fireEvent.click(sendButton())

    await waitFor(() => expect(rpc.sendConversationMessage).toHaveBeenCalledTimes(1))
    expect(rpc.sendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: 'Hello there', contentJson: doc('Hello there') }),
      })
    )
    // The editor remounts empty, and there is nothing left to send.
    await waitFor(() => expect(probe.editorMounts).toBe(2))
    expect(sendButton()).toBeDisabled()
  })

  it('sends on Enter what was typed last', async () => {
    const rpc = await renderThread()
    type('', 'Hi')
    act(() => probe.onSubmit!())
    await waitFor(() => expect(rpc.sendConversationMessage).toHaveBeenCalledTimes(1))
    expect(rpc.sendConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ content: 'Hi' }) })
    )
  })

  it('tells the team the visitor is typing', async () => {
    const rpc = await renderThread({ existing: true })
    type('', 'Hello')
    expect(rpc.sendConversationTyping).toHaveBeenCalledTimes(1)
    expect(rpc.sendConversationTyping).toHaveBeenCalledWith(
      expect.objectContaining({ data: { conversationId: CONVERSATION_ID } })
    )
  })

  it('suggests help articles for what the first message says', async () => {
    const search = vi.fn(async () => [{ slug: 'reset-password', title: 'Reset your password' }])
    await renderThread({ helpSearch: search })
    type('', 'pa')
    type('pa', 'password')

    expect(await screen.findByText('Reset your password')).toBeTruthy()
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('password', expect.anything())
  })

  it('previews links once typing pauses', async () => {
    await renderThread({ linkPreviews: true })
    type('', 'see https://example.com')
    await waitFor(() => expect(probe.previewed.at(-1)).toBe('see https://example.com'))
  })
})
