// @vitest-environment happy-dom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ticketsKeys,
  useTicket,
  useTicketParticipants,
  useTicketShares,
  useTicketStatuses,
  useTicketThreads,
  useTickets,
} from '../use-tickets-queries'

type QueryOptions = {
  queryKey: readonly unknown[]
  queryFn: () => unknown
  enabled?: boolean
  staleTime?: number
  refetchInterval?: number
}

const mocks = vi.hoisted(() => ({
  queryOptions: [] as QueryOptions[],
  queryResult: { data: undefined as unknown, isLoading: false },
  listTicketsFn: vi.fn(),
  getTicketFn: vi.fn(),
  listThreadsFn: vi.fn(),
  listSharesFn: vi.fn(),
  listParticipantsFn: vi.fn(),
  listTicketStatusesFn: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: QueryOptions) => {
    mocks.queryOptions.push(options)
    return mocks.queryResult
  },
}))

vi.mock('@/lib/server/functions/tickets', () => ({
  listTicketsFn: (input: unknown) => mocks.listTicketsFn(input),
  getTicketFn: (input: unknown) => mocks.getTicketFn(input),
  listThreadsFn: (input: unknown) => mocks.listThreadsFn(input),
  listSharesFn: (input: unknown) => mocks.listSharesFn(input),
  listParticipantsFn: (input: unknown) => mocks.listParticipantsFn(input),
  listTicketStatusesFn: () => mocks.listTicketStatusesFn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryOptions = []
  mocks.queryResult = { data: undefined, isLoading: false }
})

describe('ticketsKeys', () => {
  it('builds the stable query-key hierarchy', () => {
    expect(ticketsKeys.all).toEqual(['tickets'])
    expect(ticketsKeys.lists()).toEqual(['tickets', 'list'])
    expect(ticketsKeys.list({ scope: 'all' })).toEqual(['tickets', 'list', { scope: 'all' }])
    expect(ticketsKeys.detail('ticket_1' as never)).toEqual(['tickets', 'detail', 'ticket_1'])
    expect(ticketsKeys.threads('ticket_1' as never)).toEqual(['tickets', 'threads', 'ticket_1'])
    expect(ticketsKeys.shares('ticket_1' as never)).toEqual(['tickets', 'shares', 'ticket_1'])
    expect(ticketsKeys.participants('ticket_1' as never)).toEqual([
      'tickets',
      'participants',
      'ticket_1',
    ])
    expect(ticketsKeys.statuses()).toEqual(['tickets', 'statuses'])
  })
})

describe('useTickets', () => {
  it('builds the list query with defaults', () => {
    renderHook(() => useTickets({ scope: 'all' }))
    const query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(ticketsKeys.list({ scope: 'all' }))
    expect(query.enabled).toBe(true)
    expect(query.staleTime).toBe(10_000)
    expect(query.refetchInterval).toBe(15_000)
    query.queryFn()
    expect(mocks.listTicketsFn).toHaveBeenCalledWith({ data: { scope: 'all' } })
  })

  it('honours explicit enabled and refetchInterval overrides', () => {
    renderHook(() =>
      useTickets({ scope: 'my_assigned' }, { enabled: false, refetchInterval: 5_000 })
    )
    const query = mocks.queryOptions.at(-1)!
    expect(query.enabled).toBe(false)
    expect(query.refetchInterval).toBe(5_000)
  })
})

describe('useTicket', () => {
  it('builds the detail query when an id is present', () => {
    renderHook(() => useTicket('ticket_1' as never))
    const query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(ticketsKeys.detail('ticket_1' as never))
    expect(query.enabled).toBe(true)
    query.queryFn()
    expect(mocks.getTicketFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_1' } })
  })

  it('disables and uses the none key when id is missing', () => {
    renderHook(() => useTicket(null))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['tickets', 'detail', 'none'],
      enabled: false,
    })
  })
})

describe('useTicketThreads', () => {
  it('builds the threads query when an id is present', () => {
    renderHook(() => useTicketThreads('ticket_1' as never))
    const query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(ticketsKeys.threads('ticket_1' as never))
    expect(query.enabled).toBe(true)
    query.queryFn()
    expect(mocks.listThreadsFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_1' } })
  })

  it('disables and uses the none key when id is missing', () => {
    renderHook(() => useTicketThreads(undefined))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['tickets', 'threads', 'none'],
      enabled: false,
    })
  })
})

describe('useTicketShares', () => {
  it('builds the shares query when an id is present', () => {
    renderHook(() => useTicketShares('ticket_1' as never))
    const query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(ticketsKeys.shares('ticket_1' as never))
    expect(query.enabled).toBe(true)
    expect(query.staleTime).toBe(30_000)
    query.queryFn()
    expect(mocks.listSharesFn).toHaveBeenCalledWith({ data: { ticketId: 'ticket_1' } })
  })

  it('disables and uses the none key when id is missing', () => {
    renderHook(() => useTicketShares(null))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['tickets', 'shares', 'none'],
      enabled: false,
    })
  })
})

describe('useTicketParticipants', () => {
  it('builds the participants query when an id is present', () => {
    renderHook(() => useTicketParticipants('ticket_1' as never))
    const query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(ticketsKeys.participants('ticket_1' as never))
    expect(query.enabled).toBe(true)
    expect(query.staleTime).toBe(30_000)
    query.queryFn()
    expect(mocks.listParticipantsFn).toHaveBeenCalledWith({
      data: { ticketId: 'ticket_1' },
    })
  })

  it('disables and uses the none key when id is missing', () => {
    renderHook(() => useTicketParticipants(undefined))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['tickets', 'participants', 'none'],
      enabled: false,
    })
  })
})

describe('useTicketStatuses', () => {
  it('builds the statuses query enabled by default', () => {
    renderHook(() => useTicketStatuses())
    const query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(ticketsKeys.statuses())
    expect(query.enabled).toBe(true)
    expect(query.staleTime).toBe(5 * 60_000)
    query.queryFn()
    expect(mocks.listTicketStatusesFn).toHaveBeenCalled()
  })

  it('honours the disabled flag', () => {
    renderHook(() => useTicketStatuses(false))
    expect(mocks.queryOptions.at(-1)).toMatchObject({ enabled: false })
  })
})
