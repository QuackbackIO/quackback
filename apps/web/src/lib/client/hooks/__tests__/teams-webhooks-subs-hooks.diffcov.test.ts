/**
 * Differential-coverage tests for the teams / webhook-deliveries / ticket-
 * subscription query hooks and the integration mutation hooks. react-query is
 * stubbed to capture each hook's options so the queryFn / getNextPageParam /
 * mutationFn / onSettled closures execute (including the null-id disabled keys).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const fn = vi.fn((..._a: unknown[]) => Promise.resolve('ok'))
  const svcFns = (...names: string[]) =>
    Object.fromEntries(names.map((n) => [n, (...a: unknown[]) => fn(n, ...a)]))
  return {
    queryOpts: [] as Array<Record<string, unknown>>,
    infiniteOpts: [] as Array<Record<string, unknown>>,
    mutationOpts: [] as Array<Record<string, unknown>>,
    invalidate: vi.fn(),
    fn,
    svcFns,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: Record<string, unknown>) => {
    m.queryOpts.push(o)
    return {}
  },
  useInfiniteQuery: (o: Record<string, unknown>) => {
    m.infiniteOpts.push(o)
    return {}
  },
  useMutation: (o: Record<string, unknown>) => {
    m.mutationOpts.push(o)
    return {}
  },
  useQueryClient: () => ({ invalidateQueries: m.invalidate }),
}))
vi.mock('@/lib/server/functions/teams', () =>
  m.svcFns('listTeamsFn', 'getTeamFn', 'listTeamMembersFn')
)
vi.mock('@/lib/server/functions/webhook-deliveries', () => m.svcFns('listWebhookDeliveriesFn'))
vi.mock('@/lib/server/functions/notifications', () => m.svcFns('listTicketSubscriptionsFn'))
vi.mock('@/lib/server/functions/integrations', () =>
  m.svcFns(
    'updateIntegrationFn',
    'deleteIntegrationFn',
    'addNotificationChannelFn',
    'updateNotificationChannelFn',
    'removeNotificationChannelFn',
    'addMonitoredChannelFn',
    'updateMonitoredChannelFn',
    'removeMonitoredChannelFn',
    'upsertUserMappingFn',
    'deleteUserMappingFn'
  )
)

import { useTeams, useTeam, useTeamMembers } from '../use-teams-queries'
import { useWebhookDeliveries } from '../use-webhook-deliveries-queries'
import { useTicketSubscriptions } from '../use-ticket-subscriptions-queries'
import * as integ from '../../mutations/integrations'

beforeEach(() => {
  vi.clearAllMocks()
  m.queryOpts = []
  m.infiniteOpts = []
  m.mutationOpts = []
})

describe('teams query hooks', () => {
  it('builds list/detail/members queries (with + without an id)', async () => {
    useTeams({ includeArchived: true, enabled: false })
    useTeam('team_1' as never)
    useTeam(null)
    useTeamMembers('team_1' as never)
    useTeamMembers(undefined)
    // run every captured queryFn closure
    for (const o of m.queryOpts) await (o.queryFn as () => unknown)()
    const disabled = m.queryOpts.filter((o) => o.enabled === false)
    expect(disabled.length).toBeGreaterThanOrEqual(2) // null team + null members
    expect(m.fn).toHaveBeenCalledWith('listTeamsFn', expect.anything())
  })
})

describe('webhook deliveries hook', () => {
  it('builds an infinite query, runs queryFn + getNextPageParam, and the null key', async () => {
    useWebhookDeliveries('wh_1' as never, { status: 'failed_retryable' })
    useWebhookDeliveries(null)
    const opts = m.infiniteOpts[0]!
    await (opts.queryFn as (c: { pageParam: unknown }) => unknown)({
      pageParam: { cursorAttemptedAt: 't', cursorId: 'd' },
    })
    await (opts.queryFn as (c: { pageParam: unknown }) => unknown)({ pageParam: null })
    const gnp = opts.getNextPageParam as (l: unknown) => unknown
    expect(gnp({ nextCursor: 'c2' })).toBe('c2')
    expect(gnp({})).toBeUndefined()
    expect(m.infiniteOpts[1]!.enabled).toBe(false)
  })
})

describe('ticket subscriptions hook', () => {
  it('builds the query with + without a ticket id', async () => {
    useTicketSubscriptions('ticket_1' as never)
    useTicketSubscriptions(null)
    await (m.queryOpts[0]!.queryFn as () => unknown)()
    expect(m.queryOpts[1]!.enabled).toBe(false)
  })
})

describe('integration mutation hooks', () => {
  it('every mutation runs its mutationFn + onSettled invalidation', async () => {
    const hooks = [
      integ.useUpdateIntegration,
      integ.useDeleteIntegration,
      integ.useAddNotificationChannel,
      integ.useUpdateNotificationChannel,
      integ.useRemoveNotificationChannel,
      integ.useAddMonitoredChannel,
      integ.useUpdateMonitoredChannel,
      integ.useRemoveMonitoredChannel,
      integ.useUpsertUserMapping,
      integ.useDeleteUserMapping,
    ]
    for (const h of hooks) h()
    expect(m.mutationOpts).toHaveLength(10)
    for (const o of m.mutationOpts) {
      await (o.mutationFn as (i: unknown) => unknown)({})
      ;(o.onSettled as () => void)()
    }
    expect(m.invalidate).toHaveBeenCalledTimes(10)
  })
})
