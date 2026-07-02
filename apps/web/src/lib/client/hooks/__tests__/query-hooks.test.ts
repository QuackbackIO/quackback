// @vitest-environment happy-dom
/* eslint-disable max-lines */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditKeys, useAuditEvents, useAuditEventsInfinite } from '../use-audit-queries'
import { authzKeys, useHasPermission, useMyPermissions } from '../use-authz-queries'
import {
  inboxesKeys,
  useInbox,
  useInboxChannels,
  useInboxMemberships,
  useInboxes,
  useMyInboxes,
} from '../use-inboxes-queries'
import {
  contactsKeys,
  orgsKeys,
  useContact,
  useContactLinks,
  useContactSearch,
  useContactsForOrganization,
  useOrganization,
  useOrganizations,
} from '../use-orgs-contacts-queries'
import { routingKeys, useRoutingRule, useRoutingRules } from '../use-routing-queries'
import {
  businessHoursKeys,
  slaKeys,
  useBreachingClocks,
  useBusinessHours,
  useBusinessHoursList,
  useEscalationRules,
  useSlaPolicies,
  useSlaPolicy,
  useTicketSlaClocks,
} from '../use-sla-queries'

type QueryOptions = {
  queryKey: readonly unknown[]
  queryFn: (context?: { pageParam?: unknown }) => unknown
  getNextPageParam?: (last: { nextCursor?: string | null }) => unknown
  enabled?: boolean
  staleTime?: number
  refetchInterval?: number
  initialPageParam?: unknown
}

const mocks = vi.hoisted(() => ({
  queryOptions: [] as QueryOptions[],
  infiniteOptions: [] as QueryOptions[],
  queryResult: { data: undefined as unknown, isLoading: false },
  listAuditEventsPagedFn: vi.fn(),
  getMyPermissionsFn: vi.fn(),
  listInboxesFn: vi.fn(),
  getInboxFn: vi.fn(),
  listInboxChannelsFn: vi.fn(),
  listInboxMembershipsFn: vi.fn(),
  listMyInboxesFn: vi.fn(),
  listOrganizationsFn: vi.fn(),
  getOrganizationFn: vi.fn(),
  searchContactsFn: vi.fn(),
  listContactsForOrganizationFn: vi.fn(),
  getContactFn: vi.fn(),
  listLinksForContactFn: vi.fn(),
  listRoutingRulesFn: vi.fn(),
  getRoutingRuleFn: vi.fn(),
  listBusinessHoursFn: vi.fn(),
  getBusinessHoursFn: vi.fn(),
  listSlaPoliciesFn: vi.fn(),
  getSlaPolicyFn: vi.fn(),
  listEscalationRulesFn: vi.fn(),
  getTicketSlaClocksFn: vi.fn(),
  listBreachingClocksFn: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: QueryOptions) => {
    mocks.queryOptions.push(options)
    return mocks.queryResult
  },
  useInfiniteQuery: (options: QueryOptions) => {
    mocks.infiniteOptions.push(options)
    return mocks.queryResult
  },
}))

vi.mock('@/lib/server/functions/audit', () => ({
  listAuditEventsPagedFn: (input: unknown) => mocks.listAuditEventsPagedFn(input),
}))

vi.mock('@/lib/server/functions/authz', () => ({
  getMyPermissionsFn: () => mocks.getMyPermissionsFn(),
}))

vi.mock('@/lib/server/functions/inboxes', () => ({
  listInboxesFn: (input: unknown) => mocks.listInboxesFn(input),
  getInboxFn: (input: unknown) => mocks.getInboxFn(input),
  listInboxChannelsFn: (input: unknown) => mocks.listInboxChannelsFn(input),
  listInboxMembershipsFn: (input: unknown) => mocks.listInboxMembershipsFn(input),
  listMyInboxesFn: () => mocks.listMyInboxesFn(),
}))

vi.mock('@/lib/server/functions/organizations', () => ({
  listOrganizationsFn: (input: unknown) => mocks.listOrganizationsFn(input),
  getOrganizationFn: (input: unknown) => mocks.getOrganizationFn(input),
}))

vi.mock('@/lib/server/functions/contacts', () => ({
  searchContactsFn: (input: unknown) => mocks.searchContactsFn(input),
  listContactsForOrganizationFn: (input: unknown) => mocks.listContactsForOrganizationFn(input),
  getContactFn: (input: unknown) => mocks.getContactFn(input),
  listLinksForContactFn: (input: unknown) => mocks.listLinksForContactFn(input),
}))

vi.mock('@/lib/server/functions/routing', () => ({
  listRoutingRulesFn: (input: unknown) => mocks.listRoutingRulesFn(input),
  getRoutingRuleFn: (input: unknown) => mocks.getRoutingRuleFn(input),
}))

vi.mock('@/lib/server/functions/sla', () => ({
  listBusinessHoursFn: (input: unknown) => mocks.listBusinessHoursFn(input),
  getBusinessHoursFn: (input: unknown) => mocks.getBusinessHoursFn(input),
  listSlaPoliciesFn: (input: unknown) => mocks.listSlaPoliciesFn(input),
  getSlaPolicyFn: (input: unknown) => mocks.getSlaPolicyFn(input),
  listEscalationRulesFn: (input: unknown) => mocks.listEscalationRulesFn(input),
  getTicketSlaClocksFn: (input: unknown) => mocks.getTicketSlaClocksFn(input),
  listBreachingClocksFn: (input: unknown) => mocks.listBreachingClocksFn(input),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryOptions = []
  mocks.infiniteOptions = []
  mocks.queryResult = { data: undefined, isLoading: false }
})

describe('audit query hooks', () => {
  it('builds paged and first-page audit queries', () => {
    renderHook(() => useAuditEventsInfinite({ actionPrefix: 'ticket.' }, false))
    const infinite = mocks.infiniteOptions[0]!

    expect(infinite.queryKey).toEqual(auditKeys.list({ actionPrefix: 'ticket.' }))
    expect(infinite.enabled).toBe(false)
    expect(infinite.staleTime).toBe(30_000)
    infinite.queryFn({ pageParam: 'cursor_1' })
    expect(mocks.listAuditEventsPagedFn).toHaveBeenCalledWith({
      data: { actionPrefix: 'ticket.', cursor: 'cursor_1', limit: 50 },
    })
    expect(infinite.getNextPageParam?.({ nextCursor: 'cursor_2' })).toBe('cursor_2')
    expect(infinite.getNextPageParam?.({ nextCursor: null })).toBeUndefined()

    renderHook(() => useAuditEvents({ source: 'api' }))
    const firstPage = mocks.queryOptions[0]!
    expect(firstPage.queryKey).toEqual([...auditKeys.list({ source: 'api' }), 'first'])
    firstPage.queryFn()
    expect(mocks.listAuditEventsPagedFn).toHaveBeenCalledWith({
      data: { source: 'api', limit: 50 },
    })
  })
})

describe('authz query hooks', () => {
  it('loads permissions and evaluates workspace, team, fallback, and loading states', () => {
    renderHook(() => useMyPermissions(false))
    const permissionsQuery = mocks.queryOptions[0]!
    expect(permissionsQuery.queryKey).toEqual(authzKeys.me())
    expect(permissionsQuery.enabled).toBe(false)
    permissionsQuery.queryFn()
    expect(mocks.getMyPermissionsFn).toHaveBeenCalled()

    mocks.queryResult = { data: undefined, isLoading: true }
    expect(
      renderHook(() => useHasPermission('ticket.view_all' as never, { loadingFallback: true }))
        .result.current
    ).toBe(true)

    mocks.queryResult = {
      isLoading: false,
      data: {
        workspacePermissions: ['ticket.view_all'],
        teamPermissions: [{ teamId: 'team_1', permissions: ['ticket.reply'] }],
      },
    }
    expect(renderHook(() => useHasPermission('ticket.view_all' as never)).result.current).toBe(true)
    expect(
      renderHook(() => useHasPermission('ticket.reply' as never, { teamId: 'team_1' as never }))
        .result.current
    ).toBe(true)
    expect(renderHook(() => useHasPermission('ticket.reply' as never)).result.current).toBe(true)
    expect(
      renderHook(() => useHasPermission('ticket.delete' as never, { teamId: 'team_1' as never }))
        .result.current
    ).toBe(false)
  })
})

describe('inbox query hooks', () => {
  it('builds list, mine, detail, channel, and membership queries', () => {
    renderHook(() => useInboxes({ includeArchived: true, enabled: false }))
    let query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(inboxesKeys.list({ includeArchived: true }))
    expect(query.enabled).toBe(false)
    query.queryFn()
    expect(mocks.listInboxesFn).toHaveBeenCalledWith({
      data: { includeArchived: true },
    })

    renderHook(() => useMyInboxes(false))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(inboxesKeys.myList())
    expect(query.enabled).toBe(false)
    query.queryFn()
    expect(mocks.listMyInboxesFn).toHaveBeenCalled()

    renderHook(() => useInbox('inbox_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(inboxesKeys.detail('inbox_1' as never))
    query.queryFn()
    expect(mocks.getInboxFn).toHaveBeenCalledWith({ data: { inboxId: 'inbox_1' } })

    renderHook(() => useInbox(null))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['inboxes', 'detail', 'none'],
      enabled: false,
    })

    renderHook(() => useInboxChannels('inbox_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(inboxesKeys.channels('inbox_1' as never))
    query.queryFn()
    expect(mocks.listInboxChannelsFn).toHaveBeenCalledWith({ data: { inboxId: 'inbox_1' } })

    renderHook(() => useInboxMemberships('inbox_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(inboxesKeys.memberships('inbox_1' as never))
    query.queryFn()
    expect(mocks.listInboxMembershipsFn).toHaveBeenCalledWith({
      data: { inboxId: 'inbox_1' },
    })
  })
})

describe('organization and contact query hooks', () => {
  it('builds organization and contact query options', () => {
    renderHook(() => useOrganizations({ query: 'acme', includeArchived: true }))
    let query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(orgsKeys.list({ query: 'acme', includeArchived: true }))
    query.queryFn()
    expect(mocks.listOrganizationsFn).toHaveBeenCalledWith({
      data: { search: 'acme', includeArchived: true },
    })

    renderHook(() => useOrganization('org_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(orgsKeys.detail('org_1' as never))
    query.queryFn()
    expect(mocks.getOrganizationFn).toHaveBeenCalledWith({
      data: { organizationId: 'org_1' },
    })

    renderHook(() => useContactSearch('melih', false))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(contactsKeys.search('melih'))
    expect(query.enabled).toBe(false)
    query.queryFn()
    expect(mocks.searchContactsFn).toHaveBeenCalledWith({ data: { query: 'melih' } })

    renderHook(() => useContactsForOrganization('org_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(contactsKeys.byOrg('org_1' as never))
    query.queryFn()
    expect(mocks.listContactsForOrganizationFn).toHaveBeenCalledWith({
      data: { organizationId: 'org_1' },
    })

    renderHook(() => useContact('contact_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(contactsKeys.detail('contact_1' as never))
    query.queryFn()
    expect(mocks.getContactFn).toHaveBeenCalledWith({ data: { contactId: 'contact_1' } })

    renderHook(() => useContactLinks('contact_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(contactsKeys.links('contact_1' as never))
    query.queryFn()
    expect(mocks.listLinksForContactFn).toHaveBeenCalledWith({
      data: { contactId: 'contact_1' },
    })

    renderHook(() => useContactLinks(null))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['contacts', 'links', 'none'],
      enabled: false,
    })
  })
})

describe('routing query hooks', () => {
  it('builds routing list and detail queries', () => {
    renderHook(() => useRoutingRules({ inboxIdScope: 'workspace', enabledOnly: true }))
    let query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(
      routingKeys.list({ inboxIdScope: 'workspace', enabledOnly: true })
    )
    query.queryFn()
    expect(mocks.listRoutingRulesFn).toHaveBeenCalledWith({
      data: { inboxIdScope: 'workspace', enabledOnly: true },
    })

    renderHook(() => useRoutingRule('routing_rule_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(routingKeys.detail('routing_rule_1' as never))
    query.queryFn()
    expect(mocks.getRoutingRuleFn).toHaveBeenCalledWith({
      data: { ruleId: 'routing_rule_1' },
    })

    renderHook(() => useRoutingRule(undefined))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['routing', 'detail', 'none'],
      enabled: false,
    })
  })
})

describe('sla and business-hours query hooks', () => {
  it('builds SLA policy, escalation, clock, and business-hours queries', () => {
    renderHook(() => useSlaPolicies({ includeArchived: true, enabled: false }))
    let query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(slaKeys.policies(true))
    expect(query.enabled).toBe(false)
    query.queryFn()
    expect(mocks.listSlaPoliciesFn).toHaveBeenCalledWith({
      data: { includeArchived: true },
    })

    renderHook(() => useSlaPolicy('sla_policy_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(slaKeys.policy('sla_policy_1' as never))
    query.queryFn()
    expect(mocks.getSlaPolicyFn).toHaveBeenCalledWith({ data: { id: 'sla_policy_1' } })

    renderHook(() => useEscalationRules('sla_policy_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(slaKeys.escalations('sla_policy_1' as never))
    query.queryFn()
    expect(mocks.listEscalationRulesFn).toHaveBeenCalledWith({
      data: { policyId: 'sla_policy_1' },
    })

    renderHook(() => useTicketSlaClocks('ticket_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(slaKeys.ticketClocks('ticket_1' as never))
    expect(query.refetchInterval).toBe(30_000)
    query.queryFn()
    expect(mocks.getTicketSlaClocksFn).toHaveBeenCalledWith({
      data: { ticketId: 'ticket_1' },
    })

    renderHook(() => useBreachingClocks(false))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(slaKeys.breaching())
    expect(query.enabled).toBe(false)
    expect(query.refetchInterval).toBe(60_000)
    query.queryFn()
    expect(mocks.listBreachingClocksFn).toHaveBeenCalledWith({ data: {} })

    renderHook(() => useBusinessHoursList({ includeArchived: true }))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(businessHoursKeys.list(true))
    query.queryFn()
    expect(mocks.listBusinessHoursFn).toHaveBeenCalledWith({
      data: { includeArchived: true },
    })

    renderHook(() => useBusinessHours('business_hours_1' as never))
    query = mocks.queryOptions.at(-1)!
    expect(query.queryKey).toEqual(businessHoursKeys.detail('business_hours_1' as never))
    query.queryFn()
    expect(mocks.getBusinessHoursFn).toHaveBeenCalledWith({
      data: { id: 'business_hours_1' },
    })

    renderHook(() => useBusinessHours(null))
    expect(mocks.queryOptions.at(-1)).toMatchObject({
      queryKey: ['businessHours', 'detail', 'none'],
      enabled: false,
    })
  })
})
