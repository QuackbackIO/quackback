import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketId } from '@quackback/ids'

const mocks = vi.hoisted(() => ({
  listMyTicketsFn: vi.fn(),
  getMyTicketFn: vi.fn(),
  replyToMyTicketFn: vi.fn(),
  createMyTicketFn: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/lib/server/functions/portal-tickets', () => ({
  listMyTicketsFn: (input: unknown) => mocks.listMyTicketsFn(input),
  getMyTicketFn: (input: unknown) => mocks.getMyTicketFn(input),
  replyToMyTicketFn: (input: unknown) => mocks.replyToMyTicketFn(input),
  createMyTicketFn: (input: unknown) => mocks.createMyTicketFn(input),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

import { portalTicketQueries, useReplyToMyTicket, useCreateMyTicket } from '../portal-tickets'

const ticketId = 'ticket_abc' as TicketId

beforeEach(() => {
  vi.clearAllMocks()
})

describe('portalTicketQueries.list', () => {
  it('uses the "all" key when no statusCategory is given and maps rows into Date instances', async () => {
    const options = portalTicketQueries.list()
    expect(options.queryKey).toEqual(['portal', 'tickets', 'list', 'all'])

    mocks.listMyTicketsFn.mockResolvedValueOnce({
      rows: [
        {
          id: ticketId,
          subject: 'Need help',
          statusName: 'Open',
          statusCategory: 'open',
          statusColor: '#fff',
          lastActivityAt: '2026-01-02T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
    })

    const result = (await options.queryFn!({} as never)) as {
      rows: Array<{ lastActivityAt: Date; createdAt: Date; statusColor: string | null }>
      total: number
    }

    expect(mocks.listMyTicketsFn).toHaveBeenCalledWith({
      data: { statusCategory: undefined },
    })
    expect(result.total).toBe(1)
    expect(result.rows[0].lastActivityAt).toBeInstanceOf(Date)
    expect(result.rows[0].createdAt).toBeInstanceOf(Date)
    expect(result.rows[0].statusColor).toBe('#fff')
  })

  it('passes the provided statusCategory through to the key and the server fn', async () => {
    const options = portalTicketQueries.list({ statusCategory: 'solved' })
    expect(options.queryKey).toEqual(['portal', 'tickets', 'list', 'solved'])

    mocks.listMyTicketsFn.mockResolvedValueOnce({ rows: [], total: 0 })

    const result = (await options.queryFn!({} as never)) as { rows: unknown[]; total: number }

    expect(mocks.listMyTicketsFn).toHaveBeenCalledWith({
      data: { statusCategory: 'solved' },
    })
    expect(result.rows).toEqual([])
    expect(result.total).toBe(0)
  })
})

describe('portalTicketQueries.detail', () => {
  it('revives ticket and thread dates, including a non-null editedAt', async () => {
    const options = portalTicketQueries.detail(ticketId)
    expect(options.queryKey).toEqual(['portal', 'tickets', 'detail', ticketId])

    mocks.getMyTicketFn.mockResolvedValueOnce({
      ticket: {
        id: ticketId,
        subject: 'Hello',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActivityAt: '2026-01-03T00:00:00.000Z',
      },
      threads: [
        {
          id: 'thread_1',
          createdAt: '2026-01-02T00:00:00.000Z',
          editedAt: '2026-01-02T01:00:00.000Z',
        },
      ],
      principalNames: { p1: 'Alice' },
      viewerPrincipalId: 'p1',
      viewerRelationship: 'requester',
    })

    const result = (await options.queryFn!({} as never)) as {
      ticket: { createdAt: Date; lastActivityAt: Date }
      threads: Array<{ ticketId: TicketId; createdAt: Date; editedAt: Date | null }>
      principalNames: Record<string, string>
      viewerPrincipalId: string
      viewerRelationship: string
    }

    expect(mocks.getMyTicketFn).toHaveBeenCalledWith({ data: { ticketId } })
    expect(result.ticket.createdAt).toBeInstanceOf(Date)
    expect(result.ticket.lastActivityAt).toBeInstanceOf(Date)
    expect(result.threads[0].ticketId).toBe(ticketId)
    expect(result.threads[0].createdAt).toBeInstanceOf(Date)
    expect(result.threads[0].editedAt).toBeInstanceOf(Date)
    expect(result.principalNames).toEqual({ p1: 'Alice' })
    expect(result.viewerPrincipalId).toBe('p1')
    expect(result.viewerRelationship).toBe('requester')
  })

  it('keeps editedAt null when the thread was never edited', async () => {
    const options = portalTicketQueries.detail(ticketId)

    mocks.getMyTicketFn.mockResolvedValueOnce({
      ticket: {
        id: ticketId,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActivityAt: '2026-01-03T00:00:00.000Z',
      },
      threads: [{ id: 'thread_2', createdAt: '2026-01-02T00:00:00.000Z', editedAt: null }],
      principalNames: {},
      viewerPrincipalId: 'p1',
      viewerRelationship: 'requester',
    })

    const result = (await options.queryFn!({} as never)) as {
      threads: Array<{ editedAt: Date | null }>
    }

    expect(result.threads[0].editedAt).toBeNull()
  })
})

describe('useReplyToMyTicket', () => {
  it('forwards normalized payload, invalidates caches and toasts on success', async () => {
    const mutation = useReplyToMyTicket(ticketId) as unknown as {
      mutationFn: (input: { bodyJson?: unknown; bodyText?: string | null }) => unknown
      onSuccess: () => void
      onError: (e: Error) => void
    }

    mocks.replyToMyTicketFn.mockResolvedValueOnce({ ok: true })
    await mutation.mutationFn({ bodyJson: { type: 'doc' }, bodyText: 'hi' })
    expect(mocks.replyToMyTicketFn).toHaveBeenCalledWith({
      data: { ticketId, bodyJson: { type: 'doc' }, bodyText: 'hi' },
    })

    mutation.onSuccess()
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['portal', 'tickets', 'detail', ticketId],
    })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['portal', 'tickets', 'list'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Reply sent')
  })

  it('defaults missing body fields to null', async () => {
    const mutation = useReplyToMyTicket(ticketId) as unknown as {
      mutationFn: (input: { bodyJson?: unknown; bodyText?: string | null }) => unknown
    }
    mocks.replyToMyTicketFn.mockResolvedValueOnce({ ok: true })
    await mutation.mutationFn({})
    expect(mocks.replyToMyTicketFn).toHaveBeenCalledWith({
      data: { ticketId, bodyJson: null, bodyText: null },
    })
  })

  it('shows the error message on failure', () => {
    const mutation = useReplyToMyTicket(ticketId) as unknown as { onError: (e: Error) => void }
    mutation.onError(new Error('boom'))
    expect(mocks.toastError).toHaveBeenCalledWith('boom')
  })

  it('falls back to a generic message when the error has no message', () => {
    const mutation = useReplyToMyTicket(ticketId) as unknown as { onError: (e: Error) => void }
    mutation.onError(new Error(''))
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to send reply')
  })
})

describe('useCreateMyTicket', () => {
  it('forwards normalized payload, invalidates the list and toasts on success', async () => {
    const mutation = useCreateMyTicket() as unknown as {
      mutationFn: (input: {
        subject: string
        descriptionJson?: unknown
        descriptionText?: string | null
        priority?: 'low' | 'normal' | 'high' | 'urgent'
      }) => unknown
      onSuccess: () => void
      onError: (e: Error) => void
    }

    mocks.createMyTicketFn.mockResolvedValueOnce({ id: ticketId })
    await mutation.mutationFn({
      subject: 'Subject',
      descriptionJson: { type: 'doc' },
      descriptionText: 'desc',
      priority: 'high',
    })
    expect(mocks.createMyTicketFn).toHaveBeenCalledWith({
      data: {
        subject: 'Subject',
        descriptionJson: { type: 'doc' },
        descriptionText: 'desc',
        priority: 'high',
      },
    })

    mutation.onSuccess()
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['portal', 'tickets', 'list'],
    })
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Ticket created')
  })

  it('defaults missing description fields to null', async () => {
    const mutation = useCreateMyTicket() as unknown as {
      mutationFn: (input: { subject: string }) => unknown
    }
    mocks.createMyTicketFn.mockResolvedValueOnce({ id: ticketId })
    await mutation.mutationFn({ subject: 'Only subject' })
    expect(mocks.createMyTicketFn).toHaveBeenCalledWith({
      data: {
        subject: 'Only subject',
        descriptionJson: null,
        descriptionText: null,
        priority: undefined,
      },
    })
  })

  it('shows the error message on failure', () => {
    const mutation = useCreateMyTicket() as unknown as { onError: (e: Error) => void }
    mutation.onError(new Error('nope'))
    expect(mocks.toastError).toHaveBeenCalledWith('nope')
  })

  it('falls back to a generic message when the error has no message', () => {
    const mutation = useCreateMyTicket() as unknown as { onError: (e: Error) => void }
    mutation.onError(new Error(''))
    expect(mocks.toastError).toHaveBeenCalledWith('Failed to create ticket')
  })
})
