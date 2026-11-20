// @vitest-environment happy-dom
/**
 * The inbox and the conversation panel read a few lists whose server
 * functions need a permission an inbox-only custom role may not hold: the
 * team roster and teammates (member.view), the company picker (company.view)
 * and a person's block state (people.view). For such a role each read must
 * stay quiet: no request the server will refuse (and log), just no data, so
 * the control it feeds stays hidden or empty. With the permission, each read
 * asks as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  permissions: [] as string[],
  listTeamsFn: vi.fn(),
  fetchTeamMembers: vi.fn(),
  listCompaniesFn: vi.fn(),
  getPersonBlockStatusFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts?: { select?: (context: unknown) => unknown }) => {
    const context = { permissions: hoisted.permissions }
    return opts?.select ? opts.select(context) : context
  },
}))
vi.mock('@/lib/server/functions/teams', () => ({ listTeamsFn: hoisted.listTeamsFn }))
vi.mock('@/lib/server/functions/admin', () => ({ fetchTeamMembers: hoisted.fetchTeamMembers }))
vi.mock('@/lib/server/functions/companies', () => ({ listCompaniesFn: hoisted.listCompaniesFn }))
vi.mock('@/lib/server/functions/blocking', () => ({
  getPersonBlockStatusFn: hoisted.getPersonBlockStatusFn,
  blockPersonFn: vi.fn(),
  unblockPersonFn: vi.fn(),
}))

const { useInboxTeams } = await import('@/lib/client/queries/inbox-teams')
const { useInboxCompanies } = await import('@/lib/client/queries/inbox-companies')
const { useAdminTeamMembers } = await import('@/lib/client/hooks/use-team-members')
const { usePersonBlockStatus } = await import('@/components/admin/users/block-person-control')

/** The custom inbox-only role that reproduced the 500. */
const INBOX_ONLY: PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.TICKET_VIEW,
]

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.listTeamsFn.mockResolvedValue([
    { id: 'team_1', name: 'Billing', icon: null, color: null, memberCount: 2 },
  ])
  hoisted.fetchTeamMembers.mockResolvedValue([{ id: 'principal_agent', name: 'Ada' }])
  hoisted.listCompaniesFn.mockResolvedValue([{ id: 'company_1', name: 'Acme' }])
  hoisted.getPersonBlockStatusFn.mockResolvedValue({ blockedAt: '2026-11-01T00:00:00.000Z' })
})

afterEach(cleanup)

/** Lets any query that was going to start do so before asserting it did not. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('team roster (member.view)', () => {
  it('does not ask without member.view and has no teams', async () => {
    hoisted.permissions = INBOX_ONLY
    const { result } = renderHook(() => useInboxTeams(), { wrapper })
    await settle()
    expect(hoisted.listTeamsFn).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it('loads the teams with member.view', async () => {
    hoisted.permissions = [...INBOX_ONLY, PERMISSIONS.MEMBER_VIEW]
    const { result } = renderHook(() => useInboxTeams(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(hoisted.listTeamsFn).toHaveBeenCalledTimes(1)
  })
})

describe('teammates (member.view)', () => {
  it('does not ask without member.view and has no teammates', async () => {
    hoisted.permissions = INBOX_ONLY
    const { result } = renderHook(() => useAdminTeamMembers(), { wrapper })
    await settle()
    expect(hoisted.fetchTeamMembers).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it('loads the teammates with member.view', async () => {
    hoisted.permissions = [...INBOX_ONLY, PERMISSIONS.MEMBER_VIEW]
    const { result } = renderHook(() => useAdminTeamMembers(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
  })
})

describe('company picker (company.view)', () => {
  it('does not ask without company.view and has no companies', async () => {
    hoisted.permissions = INBOX_ONLY
    const { result } = renderHook(() => useInboxCompanies(), { wrapper })
    await settle()
    expect(hoisted.listCompaniesFn).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })

  it('loads the companies with company.view', async () => {
    hoisted.permissions = [...INBOX_ONLY, PERMISSIONS.COMPANY_VIEW]
    const { result } = renderHook(() => useInboxCompanies(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
  })
})

describe('block state (people.view)', () => {
  const principalId = 'principal_visitor' as PrincipalId

  it('does not ask without people.view and reports not blocked', async () => {
    hoisted.permissions = INBOX_ONLY
    const { result } = renderHook(() => usePersonBlockStatus(principalId), { wrapper })
    await settle()
    expect(hoisted.getPersonBlockStatusFn).not.toHaveBeenCalled()
    expect(result.current).toEqual({ blocked: false, isLoading: false })
  })

  it('reads the block state with people.view', async () => {
    hoisted.permissions = [...INBOX_ONLY, PERMISSIONS.PEOPLE_VIEW]
    const { result } = renderHook(() => usePersonBlockStatus(principalId), { wrapper })
    await waitFor(() => expect(result.current.blocked).toBe(true))
    expect(hoisted.getPersonBlockStatusFn).toHaveBeenCalledTimes(1)
  })
})
