// @vitest-environment happy-dom
/**
 * Component tests for the People section of a customer ticket's header card
 * (ticket-people.tsx): what a requester and a participant can do, sharing by
 * picked colleague or typed address with the surface auth headers threaded
 * through, the uniform not-found notice, and leaving.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import { TicketPeople } from '../ticket-people'

vi.mock('@/lib/server/functions/tickets', () => ({
  createMyTicketFn: vi.fn(),
  getConversationLinkedTicketFn: vi.fn(),
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
import {
  getMyTicketSharingFn,
  listMyTicketColleaguesFn,
  removeMyTicketShareFn,
  shareMyTicketFn,
} from '@/lib/server/functions/tickets'

const TICKET = 'ticket_1' as TicketId
const HEADERS = { 'x-widget-session': 'sess_1' }

const person = (over: Record<string, unknown>) => ({
  principalId: 'principal_x',
  displayName: 'Someone',
  avatarUrl: null,
  isRequester: false,
  isMe: false,
  canRemove: false,
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPeople(onLeft = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en-US" messages={{}}>
        <TicketPeople ticketId={TICKET} getAuthHeaders={() => HEADERS} onLeft={onLeft} />
      </IntlProvider>
    </QueryClientProvider>
  )
  return onLeft
}

async function expand() {
  fireEvent.click(await screen.findByRole('button', { name: /people/i }))
}

describe('TicketPeople', () => {
  it('shows nothing to a requester who cannot share and has shared with no one', async () => {
    vi.mocked(getMyTicketSharingFn).mockResolvedValue({
      relation: 'requester',
      people: [person({ principalId: 'principal_me', isRequester: true, isMe: true })],
      canShare: false,
    } as never)
    renderPeople()
    await waitFor(() => expect(getMyTicketSharingFn).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /people/i })).toBeNull()
  })

  it('lets a requester share with a listed colleague, with the surface auth headers', async () => {
    vi.mocked(getMyTicketSharingFn).mockResolvedValue({
      relation: 'requester',
      people: [person({ principalId: 'principal_me', isRequester: true, isMe: true })],
      canShare: true,
    } as never)
    vi.mocked(listMyTicketColleaguesFn).mockResolvedValue({
      colleagues: [{ principalId: 'principal_cole', displayName: 'Cole', avatarUrl: null }],
    } as never)
    vi.mocked(shareMyTicketFn).mockResolvedValue({
      principalId: 'principal_cole',
      added: true,
    } as never)
    renderPeople()
    await expand()

    expect(await screen.findByText('Cole')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Share' })[0])
    await waitFor(() => expect(shareMyTicketFn).toHaveBeenCalledTimes(1))
    expect(shareMyTicketFn).toHaveBeenCalledWith({
      data: { ticketId: TICKET, principalId: 'principal_cole' },
      headers: HEADERS,
    })
    expect(await screen.findByText(/they can now read and reply/i)).toBeTruthy()
  })

  it('shares by a typed address and says so when no colleague matches', async () => {
    vi.mocked(getMyTicketSharingFn).mockResolvedValue({
      relation: 'requester',
      people: [person({ principalId: 'principal_me', isRequester: true, isMe: true })],
      canShare: true,
    } as never)
    vi.mocked(listMyTicketColleaguesFn).mockResolvedValue({ colleagues: [] } as never)
    vi.mocked(shareMyTicketFn).mockRejectedValue(
      Object.assign(new Error('nope'), { code: 'COLLEAGUE_NOT_FOUND' })
    )
    renderPeople()
    await expand()

    fireEvent.change(await screen.findByPlaceholderText(/colleague's email/i), {
      target: { value: ' tess@example.com ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() =>
      expect(shareMyTicketFn).toHaveBeenCalledWith({
        data: { ticketId: TICKET, email: 'tess@example.com' },
        headers: HEADERS,
      })
    )
    expect(await screen.findByText(/no one in your company matches/i)).toBeTruthy()
  })

  it('lets a participant leave, and hands control back to the thread', async () => {
    vi.mocked(getMyTicketSharingFn).mockResolvedValue({
      relation: 'participant',
      people: [
        person({ principalId: 'principal_rita', displayName: 'Rita', isRequester: true }),
        person({ principalId: 'principal_me', isMe: true, canRemove: true }),
      ],
      canShare: false,
    } as never)
    vi.mocked(removeMyTicketShareFn).mockResolvedValue({ removed: true } as never)
    const onLeft = renderPeople()
    await expand()

    expect(screen.getByText('Rita')).toBeTruthy()
    expect(screen.queryByPlaceholderText(/colleague's email/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(onLeft).toHaveBeenCalledTimes(1))
    expect(removeMyTicketShareFn).toHaveBeenCalledWith({
      data: { ticketId: TICKET, principalId: 'principal_me' },
      headers: HEADERS,
    })
  })
})
