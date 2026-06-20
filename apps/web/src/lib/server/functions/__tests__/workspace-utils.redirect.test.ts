import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `requireWorkspaceRole` guards team routes in `beforeLoad`. When an
 * unauthenticated caller hits a team-only route it must land on the
 * unified login carrying `callbackUrl=/admin` (so `isTeamCallback`
 * renders the team break-glass form), not the legacy `/admin/login`
 * redirect stub. Portal-allowed routes still fall back to `/`.
 *
 * The handler is a `createServerFn`, so we stub `createServerFn` to
 * capture the raw handler and invoke it directly — the same pattern the
 * other function-handler tests use.
 */

const hoisted = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.mockGetSession }))

vi.mock('@/lib/server/db', () => ({
  db: { query: { settings: { findFirst: vi.fn() }, principal: { findFirst: vi.fn() } } },
  principal: {},
  eq: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

type AnyHandler = (args: { data: { allowedRoles: string[] } }) => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

let requireWorkspaceRole: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  if (handlers.length === 0) await import('../workspace-utils')
  requireWorkspaceRole = handlers[0]
})

describe('requireWorkspaceRole redirect target', () => {
  it('sends unauthenticated team-only callers to /auth/login?callbackUrl=/admin', async () => {
    hoisted.mockGetSession.mockResolvedValue(null)

    const err = await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'member'] } })
      .then(() => null)
      .catch((e) => e as { to?: string; search?: { callbackUrl?: string }; options?: { to?: string; search?: { callbackUrl?: string } } })

    expect(err?.to ?? err?.options?.to).toBe('/auth/login')
    const search = err?.search ?? err?.options?.search
    expect(search?.callbackUrl).toBe('/admin')
  })

  it('leaves portal-allowed (non-team) callers on /', async () => {
    hoisted.mockGetSession.mockResolvedValue(null)

    const err = await requireWorkspaceRole({ data: { allowedRoles: ['admin', 'user'] } })
      .then(() => null)
      .catch((e) => e as { to?: string; options?: { to?: string } })

    expect(err?.to ?? err?.options?.to).toBe('/')
  })
})
