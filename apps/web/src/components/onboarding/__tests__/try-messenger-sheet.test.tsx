// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fns = vi.hoisted(() => ({
  overview: vi.fn(),
  mintToken: vi.fn(async () => ({ token: 'customer-frame', expiresAt: '' })),
  mintPhone: vi.fn(),
  phoneStatus: vi.fn(),
}))
vi.mock('@/lib/server/functions/test-customer', () => ({
  getTestCustomerOverviewFn: fns.overview,
  mintTestCustomerTokenFn: fns.mintToken,
  mintTestCustomerPhoneLinkFn: fns.mintPhone,
  getTestCustomerPhoneLinkStatusFn: fns.phoneStatus,
}))
const frame = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('../test-customer-frame', () => ({
  TestCustomerFrame: (props: Record<string, unknown>) => {
    frame.props = props
    return <iframe title={props.title as string} />
  },
}))
vi.mock('@/components/conversation/agent-conversation-thread', () => ({
  AgentConversationThread: (props: { replyFirst?: boolean }) => (
    <div data-testid="thread" data-reply-first={String(!!props.replyFirst)} />
  ),
}))
vi.mock('@/lib/client/hooks/use-conversation-stream', () => ({ useConversationStream: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#link">{children}</a>,
}))
vi.mock('qrcode', () => ({ default: { toDataURL: async (url: string) => `data:qr,${url}` } }))

import { TryMessengerSheet } from '../try-messenger-sheet'
import { conversationKeys } from '@/components/conversation/query-keys'

beforeEach(() => {
  fns.overview.mockReset()
  fns.mintPhone.mockReset()
  fns.phoneStatus.mockReset()
  frame.props = null
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type Msg = { senderType: string; isAssistant?: boolean; at: string }
function seedThread(client: QueryClient, id: string, messages: Msg[], readAt: string | null) {
  client.setQueryData(conversationKeys.agentThread(id as never), {
    conversation: { visitorLastReadAt: readAt },
    messages: messages.map((m) => ({
      senderType: m.senderType,
      isAssistant: m.isAssistant ?? false,
      isInternal: false,
      createdAt: m.at,
    })),
  })
}

function renderSheet(client = new QueryClient(), onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <TryMessengerSheet open onOpenChange={onOpenChange} />
      </IntlProvider>
    </QueryClientProvider>
  )
  return { client, onOpenChange }
}

describe('TryMessengerSheet', () => {
  it('closes when Escape is pressed inside the Messenger frame', async () => {
    fns.overview.mockResolvedValue({ conversationId: null, testEmailAddress: null })
    const { onOpenChange } = renderSheet()
    await waitFor(() => expect(frame.props).not.toBeNull())
    act(() => (frame.props!.onClose as () => void)())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('on a narrow screen shows one side at a time behind Customer and Inbox tabs', async () => {
    fns.overview.mockResolvedValue({ conversationId: null, testEmailAddress: null })
    renderSheet()
    const customer = await screen.findByRole('tab', { name: 'Customer' })
    const inbox = screen.getByRole('tab', { name: 'Inbox' })
    expect(customer.getAttribute('aria-selected')).toBe('true')
    const customerPanel = document.getElementById(customer.getAttribute('aria-controls')!)!
    const inboxPanel = document.getElementById(inbox.getAttribute('aria-controls')!)!
    expect(customerPanel.className).not.toContain('max-lg:hidden')
    expect(inboxPanel.className).toContain('max-lg:hidden')

    fireEvent.click(inbox)
    expect(inbox.getAttribute('aria-selected')).toBe('true')
    expect(customerPanel.className).toContain('max-lg:hidden')
    expect(inboxPanel.className).not.toContain('max-lg:hidden')
    // The customer's frame keeps its session: hidden, never unmounted.
    expect(screen.getByTitle('Messenger as a test customer')).toBeTruthy()
    // The tabs are for narrow screens only; wide screens show both sides.
    expect(screen.getByRole('tablist').className).toContain('lg:hidden')
  })

  it('moves between the tabs with the arrow keys', async () => {
    fns.overview.mockResolvedValue({ conversationId: null, testEmailAddress: null })
    renderSheet()
    const customer = await screen.findByRole('tab', { name: 'Customer' })
    fireEvent.keyDown(customer, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Inbox/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('marks the side that has something new and makes reply the primary action', async () => {
    fns.overview.mockResolvedValue({ conversationId: 'conversation_t', testEmailAddress: null })
    const client = new QueryClient()
    seedThread(
      client,
      'conversation_t',
      [
        { senderType: 'visitor', at: '2026-10-04T10:00:00Z' },
        { senderType: 'agent', isAssistant: true, at: '2026-10-04T10:00:02Z' },
      ],
      null
    )
    renderSheet(client)
    expect(await screen.findByRole('tab', { name: /^Inbox\s*, new$/ })).toBeTruthy()
    expect(screen.getByTestId('thread').dataset.replyFirst).toBe('true')
    expect(screen.getByText('Quinn answered first. Your reply still counts.')).toBeTruthy()
  })

  it('announces each finished step to screen readers', async () => {
    fns.overview.mockResolvedValue({ conversationId: 'conversation_t', testEmailAddress: null })
    const client = new QueryClient()
    seedThread(client, 'conversation_t', [{ senderType: 'visitor', at: '2026-10-04T10:00:00Z' }], null)
    renderSheet(client)
    const live = await screen.findByTestId('round-trip-live')
    expect(live.getAttribute('role')).toBe('status')
    await waitFor(() => expect(live.textContent).toBe('Step 1 of 3 done.'))
    act(() =>
      seedThread(
        client,
        'conversation_t',
        [
          { senderType: 'visitor', at: '2026-10-04T10:00:00Z' },
          { senderType: 'agent', at: '2026-10-04T10:01:00Z' },
        ],
        null
      )
    )
    await waitFor(() => expect(live.textContent).toBe('Step 2 of 3 done.'))
    act(() =>
      seedThread(
        client,
        'conversation_t',
        [
          { senderType: 'visitor', at: '2026-10-04T10:00:00Z' },
          { senderType: 'agent', at: '2026-10-04T10:01:00Z' },
        ],
        '2026-10-04T10:01:05Z'
      )
    )
    await waitFor(() => expect(live.textContent).toBe("That's the round trip"))
  })

  it('swaps in a fresh phone code once the shown one is used or expires', async () => {
    fns.overview.mockResolvedValue({ conversationId: null, testEmailAddress: null })
    fns.mintPhone
      .mockResolvedValueOnce({ url: 'https://acme.test/try-messenger?ott=one', token: 'one', expiresAt: '' })
      .mockResolvedValueOnce({ url: 'https://acme.test/try-messenger?ott=two', token: 'two', expiresAt: '' })
    fns.phoneStatus.mockResolvedValue({ pending: true })
    const { client } = renderSheet()
    fireEvent.click(await screen.findByRole('button', { name: 'Show code' }))
    const qr = await screen.findByTestId('try-messenger-qr')
    await waitFor(() => expect(qr.getAttribute('src')).toBe('data:qr,https://acme.test/try-messenger?ott=one'))
    await waitFor(() => expect(fns.phoneStatus).toHaveBeenCalledWith({ data: { token: 'one' } }))
    expect(fns.mintPhone).toHaveBeenCalledTimes(1)

    fns.phoneStatus.mockResolvedValue({ pending: false })
    await act(() => client.refetchQueries({ queryKey: ['onboarding', 'phone-code'] }))
    await waitFor(() =>
      expect(screen.getByTestId('try-messenger-qr').getAttribute('src')).toBe(
        'data:qr,https://acme.test/try-messenger?ott=two'
      )
    )
    expect(fns.mintPhone).toHaveBeenCalledTimes(2)
    expect(screen.getByText('One use, valid 10 minutes. A new code appears here once it is used.')).toBeTruthy()
  })
})
