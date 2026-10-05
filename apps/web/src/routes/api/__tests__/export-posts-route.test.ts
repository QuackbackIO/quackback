/**
 * GET /api/export (posts CSV) is gated on the `post.export` permission from
 * the RBAC catalogue, so a custom role or preset that grants it can export and
 * one that does not cannot, whatever the caller's legacy role.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '@/lib/shared/errors'
import type { PermissionKey } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  granted: [] as string[],
  mockListPostsForExport: vi.fn(),
}))

// Honours the requested permission against the caller's resolved set, the
// contract the real requireAuth enforces.
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: async (opts?: { permission?: PermissionKey }) => {
    if (opts?.permission && !hoisted.granted.includes(opts.permission)) {
      throw new ForbiddenError('FORBIDDEN', 'denied')
    }
    return { settings: { slug: 'acme' }, principal: { role: 'member' } }
  },
}))
// The legacy path read the session's role; pin it to a non-admin so only a
// permission gate can let the caller through.
vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: async () => ({
    success: true,
    principal: { role: 'member' },
    settings: { slug: 'acme' },
  }),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  assertTierFeature: async () => {},
}))
vi.mock('@/lib/server/domains/posts/post.export', () => ({
  listPostsForExport: hoisted.mockListPostsForExport,
}))
vi.mock('@/lib/server/domains/boards/board.service', () => ({
  getBoardById: async () => ({}),
}))

async function get(): Promise<Response> {
  const mod = await import('../export')
  const handler = (
    mod.Route.options as unknown as {
      server: { handlers: { GET: (ctx: { request: Request }) => Promise<Response> } }
    }
  ).server.handlers.GET
  return handler({ request: new Request('https://app.test/api/export') })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockListPostsForExport.mockResolvedValue([])
})

describe('GET /api/export', () => {
  it('exports for a caller holding post.export', async () => {
    hoisted.granted = ['post.export']
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv')
    expect(hoisted.mockListPostsForExport).toHaveBeenCalledOnce()
  })

  it('refuses a caller without post.export', async () => {
    hoisted.granted = ['post.view_private', 'post.create']
    const res = await get()
    expect(res.status).toBe(403)
    expect(hoisted.mockListPostsForExport).not.toHaveBeenCalled()
  })
})
