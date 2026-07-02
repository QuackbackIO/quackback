/**
 * Differential-coverage tests for handle-ticket-conflict — the conflict
 * detection branches (code / message regex / neither) and the refresh action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ toastError: vi.fn(), invalidate: vi.fn() }))

vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => m.toastError(...a) } }))
vi.mock('@/lib/client/queries/tickets', () => ({
  ticketQueries: {
    detail: (id: string) => ({ queryKey: ['tickets', 'detail', id] }),
    threads: (id: string) => ({ queryKey: ['tickets', 'threads', id] }),
    activity: (id: string) => ({ queryKey: ['tickets', 'activity', id] }),
  },
}))

import { handleTicketConflict } from '../handle-ticket-conflict'

const qc = { invalidateQueries: (...a: unknown[]) => m.invalidate(...a) } as never

beforeEach(() => vi.clearAllMocks())

describe('handleTicketConflict', () => {
  it('surfaces a refresh toast on a coded conflict and wires the refresh action', () => {
    handleTicketConflict(Object.assign(new Error('boom'), { code: 'CONFLICT' }), qc, 't1' as never)
    const opts = m.toastError.mock.calls[0][1] as { action: { onClick: () => void } }
    opts.action.onClick()
    expect(m.invalidate).toHaveBeenCalledTimes(3)
  })
  it('detects TICKET_CONFLICT code and message-regex conflicts', () => {
    handleTicketConflict({ code: 'TICKET_CONFLICT' }, qc, 't1' as never)
    handleTicketConflict(new Error('row is stale, refresh'), qc, 't1' as never)
    expect(m.toastError).toHaveBeenCalledTimes(2)
  })
  it('falls through to a plain error toast for non-conflicts (incl. non-Error values)', () => {
    handleTicketConflict(new Error('something else'), qc, 't1' as never)
    handleTicketConflict('a raw string', qc, 't1' as never)
    expect(m.toastError).toHaveBeenLastCalledWith('a raw string')
  })
})
