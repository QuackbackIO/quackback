/**
 * Differential-coverage test for reopenWidgetTicket — POSTs to the reopen
 * endpoint via widgetFetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/client/widget-auth', () => ({ getWidgetAuthHeaders: () => ({}) }))

import { reopenWidgetTicket } from '../tickets-api'

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('reopenWidgetTicket', () => {
  it('POSTs to the ticket reopen endpoint', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 't1', status: 'open' } }), { status: 200 })
      )
    await reopenWidgetTicket('t1')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/widget/tickets/t1/reopen',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
