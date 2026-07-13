/**
 * findOrCreateInitialThread — gap tests for both branches: returning an
 * existing public thread vs creating a synthetic one via addThread.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  threadsFindFirst: vi.fn(),
  addThread: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      ticketThreads: { findFirst: m.threadsFindFirst },
    },
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  ticketThreads: { ticketId: 'tt.ticketId', audience: 'tt.audience', deletedAt: 'tt.deletedAt' },
}))

vi.mock('../ticket.threads', () => ({
  addThread: m.addThread,
}))

import { findOrCreateInitialThread } from '../ticket.create-thread-for-attachments'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findOrCreateInitialThread', () => {
  it('returns the existing public thread id when one exists', async () => {
    m.threadsFindFirst.mockResolvedValueOnce({ id: 'thread_existing' })
    const id = await findOrCreateInitialThread('ticket_1' as never, 'p1' as never)
    expect(id).toBe('thread_existing')
    expect(m.addThread).not.toHaveBeenCalled()
  })

  it('creates a synthetic thread when none exists', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(undefined)
    m.addThread.mockResolvedValueOnce({ id: 'thread_new' })
    const id = await findOrCreateInitialThread('ticket_1' as never, null)
    expect(id).toBe('thread_new')
    expect(m.addThread).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 'ticket_1', principalId: null, audience: 'public' })
    )
  })
})
