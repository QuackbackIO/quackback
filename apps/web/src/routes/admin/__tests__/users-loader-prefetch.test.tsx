// @vitest-environment happy-dom
/**
 * The people page's route loader warms every read the page makes on load, so
 * the server-rendered page is complete and the browser has nothing left to
 * fetch after hydration: the list, the filters' reference data, the lifecycle
 * nav counts and the companies directory. The reads mounted here are the
 * page's own hooks, so a key the loader and a hook disagree on shows up as a
 * fetch after the warm-up.
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
function stub<T>(name: string, value: T) {
  return (args?: { data?: { lifecycle?: string; limit?: number } }) => {
    const suffix = name === 'people' && args?.data?.limit === 1 ? `:${args.data.lifecycle}` : ''
    calls.push(name + suffix)
    return Promise.resolve(value)
  }
}

vi.mock('@/lib/server/functions/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/admin')>()),
  listPortalUsersFn: stub('people', { items: [], total: 3, hasMore: false }),
  listSegmentsFn: stub('segments', []),
  listUserAttributesFn: stub('userAttributes', []),
  listUserTagsFn: stub('userTags', []),
}))
vi.mock('@/lib/server/functions/company-attributes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/company-attributes')>()),
  listCompanyAttributesFn: stub('companyAttributes', []),
}))
vi.mock('@/lib/server/functions/companies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/companies')>()),
  listCompaniesPageFn: stub('companies', { items: [], hasMore: false, nextCursor: null }),
  countCompaniesFn: stub('companyCount', 0),
}))
vi.mock('@/lib/server/functions/portal-invites', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/portal-invites')>()),
  fetchPortalInvitesFn: stub('invites', []),
}))

const { Route } = await import('@/routes/admin/users')
const { usePortalUsers, useTotalUserCount } = await import('@/lib/client/hooks/use-users-queries')
const { useSegments } = await import('@/lib/client/hooks/use-segments-queries')
const { useUserAttributes } = await import('@/lib/client/hooks/use-user-attributes-queries')
const { useCompanyAttributes } = await import('@/lib/client/hooks/use-company-attributes-queries')
const { useUserTags } = await import('@/lib/client/hooks/use-user-tags')
const { usePortalInvites } = await import('@/components/admin/users/use-portal-invites')
const { companiesDirectoryQueries } = await import('@/lib/client/queries/users-page')

type LoaderFn = (ctx: {
  context: { principal: { role: string }; queryClient: QueryClient }
}) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: LoaderFn } }).options.loader

/** The page's reads on load, as UsersContainer and UsersList make them. */
function usePageReads(role: string) {
  const companies = role === 'admin' || role === 'member'
  usePortalUsers({ filters: { sort: 'newest' } })
  useTotalUserCount()
  useTotalUserCount('leads')
  useSegments()
  useUserAttributes()
  useCompanyAttributes()
  useUserTags()
  usePortalInvites({ enabled: role === 'admin' })
  useInfiniteQuery({
    ...companiesDirectoryQueries.page(undefined, undefined),
    enabled: companies,
  })
  useQuery({ ...companiesDirectoryQueries.count(), enabled: companies })
}

let client: QueryClient
beforeEach(() => {
  calls.length = 0
  // The app's client defaults (router.tsx): a warmed read stays fresh for 30s.
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function mountAfterLoader(role: string) {
  await loader({ context: { principal: { role }, queryClient: client } })
  const warmed = [...calls].sort()
  calls.length = 0
  renderHook(() => usePageReads(role), { wrapper })
  // Anything the warm-up missed goes out on mount; give it a tick to show.
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return { warmed, afterMount: [...calls] }
}

describe('/admin/users loader', () => {
  it('warms every read an admin page makes, so mounting it fetches nothing', async () => {
    const { warmed, afterMount } = await mountAfterLoader('admin')
    expect(afterMount).toEqual([])
    expect(warmed).toEqual(
      [
        'people',
        'people:users',
        'people:leads',
        'segments',
        'userAttributes',
        'companyAttributes',
        'userTags',
        'invites',
        'companies',
        'companyCount',
      ].sort()
    )
  })

  it('leaves out what a member cannot read (invites need settings.manage)', async () => {
    const { warmed, afterMount } = await mountAfterLoader('member')
    expect(afterMount).toEqual([])
    expect(warmed).not.toContain('invites')
    expect(warmed).toContain('companies')
  })
})
