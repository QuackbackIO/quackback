// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type LoaderDepsFn = (input: { search: Record<string, unknown> }) => Record<string, unknown>
type LoaderFn = (input: {
  deps: Record<string, unknown>
  context: {
    principal: { role: string }
    queryClient: { ensureQueryData: (q: unknown) => unknown }
  }
}) => Promise<unknown>

type RouteOptions = {
  loaderDeps: LoaderDepsFn
  loader: LoaderFn
}

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((opts: unknown) => {
    const err = new Error('REDIRECT') as Error & { __redirect: unknown }
    err.__redirect = opts
    return err
  }),
  ensureQueryData: vi.fn(async () => undefined),
  portalUsers: vi.fn((p: unknown) => ({ queryKey: ['admin', 'portal-users', p] })),
  segments: vi.fn(() => ({ queryKey: ['admin', 'segments'] })),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: mocks.redirect,
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: vi.fn(() => ({ data: [] })),
}))

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    portalUsers: mocks.portalUsers,
    segments: mocks.segments,
  },
}))

vi.mock('@/components/admin/users/users-container', () => ({
  UsersContainer: () => null,
}))

vi.mock('@/components/ui/alert', () => ({
  Alert: ({ children }: { children?: unknown }) => children,
  AlertDescription: ({ children }: { children?: unknown }) => children,
  AlertTitle: ({ children }: { children?: unknown }) => children,
}))

vi.mock('@heroicons/react/24/solid', () => ({
  ExclamationCircleIcon: () => null,
}))

vi.mock('@/components/ui/button', () => ({
  Button: () => null,
}))

const mod = await import('../users')
const { parseSearchToQueryParams, Route } = mod

function routeOptions(): RouteOptions {
  return (Route as unknown as { options: RouteOptions }).options
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('users.tsx parseSearchToQueryParams', () => {
  it('maps verified=true and parses dates/segments/activity/custom attrs', () => {
    const result = parseSearchToQueryParams({
      search: 'jane',
      verified: 'true',
      dateFrom: '2024-01-01',
      dateTo: '2024-02-01',
      emailDomain: 'acme.com',
      postCount: 'gt:5',
      voteCount: 'gte:2',
      commentCount: 'lt:9',
      customAttrs: 'plan:eq:pro,tier:gte:3',
      includeAnonymous: 'true',
      sort: 'name',
      segments: 'seg_1,seg_2',
    } as never)
    expect(result.verified).toBe(true)
    expect(result.dateFrom).toBeInstanceOf(Date)
    expect(result.dateTo).toBeInstanceOf(Date)
    expect(result.emailDomain).toBe('acme.com')
    expect(result.postCount).toEqual({ op: 'gt', value: 5 })
    expect(result.voteCount).toEqual({ op: 'gte', value: 2 })
    expect(result.commentCount).toEqual({ op: 'lt', value: 9 })
    expect(result.customAttrs).toEqual([
      { key: 'plan', op: 'eq', value: 'pro' },
      { key: 'tier', op: 'gte', value: '3' },
    ])
    expect(result.includeAnonymous).toBe(true)
    expect(result.segmentIds).toEqual(['seg_1', 'seg_2'])
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
  })

  it('maps verified=false and leaves optional filters undefined', () => {
    const result = parseSearchToQueryParams({ verified: 'false', sort: 'newest' } as never)
    expect(result.verified).toBe(false)
    expect(result.dateFrom).toBeUndefined()
    expect(result.dateTo).toBeUndefined()
    expect(result.postCount).toBeUndefined()
    expect(result.customAttrs).toBeUndefined()
    expect(result.segmentIds).toBeUndefined()
    expect(result.includeAnonymous).toBe(false)
  })

  it('drops malformed activity and custom-attr fragments', () => {
    const result = parseSearchToQueryParams({
      postCount: 'noColonHere',
      customAttrs: 'missingop,key:op:val',
    } as never)
    // "noColonHere".split(':') => val undefined -> undefined
    expect(result.postCount).toBeUndefined()
    expect(result.customAttrs).toEqual([{ key: 'key', op: 'op', value: 'val' }])
  })
})

describe('users.tsx loaderDeps', () => {
  it('selects the search fields including selected and invites', () => {
    const deps = routeOptions().loaderDeps({
      search: {
        search: 'q',
        verified: 'true',
        dateFrom: 'd',
        dateTo: 'd2',
        emailDomain: 'e',
        postCount: 'p',
        voteCount: 'v',
        commentCount: 'c',
        customAttrs: 'ca',
        includeAnonymous: 'true',
        sort: 'name',
        segments: 's',
        selected: 'sel_1',
        invites: 'pending',
      },
    })
    expect(deps.selected).toBe('sel_1')
    expect(deps.invites).toBe('pending')
    expect(deps.sort).toBe('name')
  })
})

describe('users.tsx loader', () => {
  it('redirects to /admin/customers/people when no filters are set', async () => {
    await expect(
      routeOptions().loader({
        deps: { sort: 'newest' },
        context: {
          principal: { role: 'admin' },
          queryClient: { ensureQueryData: mocks.ensureQueryData },
        },
      })
    ).rejects.toThrow('REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith({ to: '/admin/customers/people' })
    expect(mocks.ensureQueryData).not.toHaveBeenCalled()
  })

  it('prefetches data and returns the member role when filters are present', async () => {
    const result = await routeOptions().loader({
      deps: { search: 'jane', sort: 'newest' },
      context: {
        principal: { role: 'admin' },
        queryClient: { ensureQueryData: mocks.ensureQueryData },
      },
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.portalUsers).toHaveBeenCalledTimes(1)
    expect(mocks.segments).toHaveBeenCalledTimes(1)
    expect(mocks.ensureQueryData).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ currentMemberRole: 'admin' })
  })
})
