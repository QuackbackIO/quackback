/**
 * A ticket the server answers NotFound for (deleted, or outside the viewer's
 * scope) is read once and never retried, so the inbox shows the not-found pane
 * at once instead of a skeleton through the retries. Any other failure keeps
 * the default retries.
 *
 * The errors stand in for what the browser receives: a typed server error
 * arrives as an Error carrying its own `code` and `statusCode`, and loses its
 * class name on the way.
 */
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketId } from '@quackback/ids'

const mockGetTicket = vi.fn()
const mockListTicketMessages = vi.fn()
vi.mock('@/lib/server/functions/tickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/tickets')>()),
  getTicketFn: (...args: unknown[]) => mockGetTicket(...args),
  listTicketMessagesFn: (...args: unknown[]) => mockListTicketMessages(...args),
}))

const { inboxQueries } = await import('../inbox')
const { isNotFoundError } = await import('@/lib/shared/errors')

const TICKET = 'ticket_01h00000000000000000000000' as TicketId

/** A typed NotFound as it arrives in the browser: own props kept, class lost. */
function receivedNotFound(): Error {
  return Object.assign(new Error('Ticket not found'), {
    code: 'TICKET_NOT_FOUND',
    statusCode: 404,
  })
}

/** A hidden technical failure as it arrives in the browser. */
function receivedFailure(): Error {
  return Object.assign(new Error('Something went wrong on our side.'), { reference: 'ABCD-1234' })
}

/** The retries a `useQuery` gets by default (three; `fetchQuery` would
 *  otherwise turn them off), with no wait between tries. */
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } })
}

beforeEach(() => {
  mockGetTicket.mockReset()
  mockListTicketMessages.mockReset()
})

describe('isNotFoundError', () => {
  it('reads the typed status, not the message or the class', () => {
    expect(isNotFoundError(receivedNotFound())).toBe(true)
    expect(isNotFoundError(new Error('Ticket not found'))).toBe(false)
    expect(isNotFoundError(Object.assign(new Error('x'), { statusCode: 403 }))).toBe(false)
    expect(isNotFoundError(null)).toBe(false)
  })
})

describe.each([
  [
    'ticketDetail',
    (qc: QueryClient) => qc.fetchQuery(inboxQueries.ticketDetail(TICKET)),
    mockGetTicket,
  ],
  [
    'ticketThread',
    (qc: QueryClient) => qc.fetchQuery(inboxQueries.ticketThread(TICKET)),
    mockListTicketMessages,
  ],
] as const)('inboxQueries.%s', (_, read, fetcher) => {
  it('reads a NotFound ticket once and does not retry', async () => {
    fetcher.mockRejectedValue(receivedNotFound())
    await expect(read(client())).rejects.toMatchObject({ statusCode: 404 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('still retries any other failure', async () => {
    fetcher.mockRejectedValue(receivedFailure())
    await expect(read(client())).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})
