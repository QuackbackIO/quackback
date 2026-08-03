/**
 * Differential-coverage tests for the client query-option factories
 * (tickets / business-hours / routing-rules / signals / audit). Each factory
 * method is invoked and its queryFn executed so the closure bodies + key
 * derivation run; server functions and fetch are stubbed.
 */
// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const fn = vi.fn((..._a: unknown[]) => Promise.resolve({ nextCursor: 'c2' }))
  const fns = (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, (...a: unknown[]) => fn(n, ...a)]))
  return { fn, ensureData: vi.fn((...a: unknown[]) => a[0]), fns }
})

vi.mock('@/lib/server/functions/tickets', () =>
  m.fns(
    'listTicketsFn',
    'getTicketFn',
    'listThreadsFn',
    'listParticipantsFn',
    'listSharesFn',
    'listTicketStatusesFn',
    'listTicketActivityFn'
  )
)
vi.mock('@/lib/server/functions/sla', () =>
  m.fns('getTicketSlaClocksFn', 'listBusinessHoursFn', 'getBusinessHoursFn')
)
vi.mock('@/lib/server/functions/inboxes', () => m.fns('listMyInboxesFn'))
vi.mock('@/lib/server/functions/routing', () => m.fns('listRoutingRulesFn', 'getRoutingRuleFn'))
vi.mock('@/lib/server/functions/merge-suggestions', () =>
  m.fns(
    'getMergeSuggestionsForPostFn',
    'fetchMergeSuggestionSummaryFn',
    'fetchMergeSuggestionCountsForPostsFn'
  )
)
vi.mock('@/lib/server/functions/audit', () =>
  m.fns('listUnifiedAuditEventsFn', 'getUnifiedAuditActionsFn')
)
vi.mock('@/lib/client/query/ensure-data', () => ({
  ensureData: (...a: unknown[]) => m.ensureData(...a),
}))

import { ticketQueries } from '../tickets'
import { businessHoursQueries } from '../business-hours'
import { routingRuleQueries } from '../routing-rules'
import { mergeSuggestionQueries } from '../signals'
import { auditQueries, rangeToFromIso, defaultAuditFilters } from '../audit'

beforeEach(() => {
  vi.clearAllMocks()
  m.fn.mockResolvedValue({ nextCursor: 'c2' })
})

// Invoke a queryOptions object's queryFn (executes the closure body).
const run = (opts: unknown, ctx?: { pageParam?: unknown }) =>
  (opts as { queryFn?: (c?: { pageParam?: unknown }) => unknown }).queryFn?.(ctx)

describe('ticketQueries', () => {
  const tid = 't1' as never
  it('runs every read factory queryFn', async () => {
    await run(
      ticketQueries.list({ scope: 'all', statusCategory: 'open', search: 'x', inboxId: null })
    )
    await run(ticketQueries.detail(tid))
    await run(ticketQueries.threads(tid))
    await run(ticketQueries.participants(tid))
    await run(ticketQueries.shares(tid))
    await run(ticketQueries.statuses())
    await run(ticketQueries.slaClocks(tid, true))
    await run(ticketQueries.activity(tid, { limit: 5, before: 'x' }))
    await run(ticketQueries.myInboxes())
    expect(await run(ticketQueries.externalLinks(tid))).toEqual([])
  })
  it('attachments: fetches and parses, and throws on a bad response', async () => {
    const okFetch = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ id: 'a1' }] }) }))
    vi.stubGlobal('fetch', okFetch)
    expect(await run(ticketQueries.attachments(tid, 'thr1' as never))).toEqual([{ id: 'a1' }])

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, statusText: 'Boom', json: async () => ({}) }))
    )
    await expect(run(ticketQueries.attachments(tid, 'thr1' as never))).rejects.toThrow(
      'Failed to load attachments'
    )

    // array-shaped response fallback
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => [{ id: 'b1' }] }))
    )
    expect(await run(ticketQueries.attachments(tid, 'thr1' as never))).toEqual([{ id: 'b1' }])
    vi.unstubAllGlobals()
  })
})

describe('businessHours + routingRule factories', () => {
  it('runs list + detail queryFns', async () => {
    await run(businessHoursQueries.list({ includeArchived: true }))
    await run(businessHoursQueries.detail('bh1' as never))
    await run(routingRuleQueries.list({ inboxIdScope: 'workspace', enabledOnly: true }))
    await run(routingRuleQueries.detail('rr1' as never))
    expect(m.fn).toHaveBeenCalled()
  })
})

describe('mergeSuggestionQueries', () => {
  it('runs summary / counts / forPost (and gates counts on empty ids)', async () => {
    await run(mergeSuggestionQueries.summary())
    const empty = mergeSuggestionQueries.countsForPosts([])
    expect((empty as { enabled?: boolean }).enabled).toBe(false)
    const some = mergeSuggestionQueries.countsForPosts(['p1'] as never)
    expect((some as { enabled?: boolean }).enabled).toBe(true)
    await run(some)
    await run(mergeSuggestionQueries.forPost('p1' as never))
    expect(m.ensureData).toHaveBeenCalled()
  })
})

describe('auditQueries + helpers', () => {
  it('rangeToFromIso covers all branches; defaultAuditFilters builds a 30d window', () => {
    expect(rangeToFromIso('all')).toBeUndefined()
    expect(rangeToFromIso('custom')).toBeUndefined()
    expect(typeof rangeToFromIso('7d')).toBe('string')
    expect(typeof rangeToFromIso('30d')).toBe('string')
    expect(typeof rangeToFromIso('90d')).toBe('string')
    expect(defaultAuditFilters().fromIso).toBeDefined()
  })
  it('list: runs the infinite queryFn with and without a cursor, and getNextPageParam', async () => {
    const opts = auditQueries.list({ action: 'ticket.created' }) as unknown as {
      queryFn: (c: { pageParam?: unknown }) => unknown
      getNextPageParam: (l: unknown) => unknown
    }
    await opts.queryFn({ pageParam: 'cursor_1' })
    // no action -> excludeSecurityActions path
    const opts2 = auditQueries.list({}) as unknown as {
      queryFn: (c: { pageParam?: unknown }) => unknown
    }
    await opts2.queryFn({ pageParam: undefined })
    expect(opts.getNextPageParam({ nextCursor: 'c3' })).toBe('c3')
    expect(opts.getNextPageParam({ nextCursor: null })).toBeUndefined()
    await run(auditQueries.actions())
  })
})
