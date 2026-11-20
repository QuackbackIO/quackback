/**
 * The unified inbox list key must change whenever the list's filter does, or
 * an edited saved view keeps showing the rows its old rules matched.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/inbox', () => ({}))
vi.mock('@/lib/server/functions/tickets', () => ({}))
vi.mock('@/lib/server/functions/ticket-types', () => ({}))

import { inboxQueries } from './inbox'

describe('inboxQueries.itemList key', () => {
  it("changes with a saved view's ticket stage rule", () => {
    const base = { facet: 'open', kinds: ['ticket'] } as const
    const waiting = inboxQueries.itemList({ ...base, ticketStage: 'waiting_on_customer' } as never)
    const progress = inboxQueries.itemList({ ...base, ticketStage: 'in_progress' } as never)
    expect(waiting.queryKey).not.toEqual(progress.queryKey)
  })
})
