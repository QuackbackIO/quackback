import { describe, it, expect, vi } from 'vitest'
import { db } from '@/lib/server/db'

/**
 * `requireWorkspaceRole` is a server function, so its return value is sent to
 * whichever browser called it, and the caller chooses `allowedRoles`: a portal
 * visitor with nothing more than an anonymous session can ask for
 * `['user']` and pass. What it returns must therefore be the caller's own
 * identity and nothing about the workspace.
 */

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  findSettingsCached: vi.fn(),
  handlers: [] as Array<(args: { data: { allowedRoles: string[] } }) => Promise<unknown>>,
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  findSettingsCached: hoisted.findSettingsCached,
}))
vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: async () => new Set(['post.vote']),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { settings: { findFirst: vi.fn() }, principal: { findFirst: vi.fn() } } },
  eq: vi.fn(),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: (typeof hoisted.handlers)[number]) {
        hoisted.handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const WIDGET_SECRET = 'wsec_must_not_leave_the_server'

describe('requireWorkspaceRole response', () => {
  it('carries the caller identity and none of the settings row', async () => {
    await import('../workspace-utils')
    const requireWorkspaceRole = hoisted.handlers[0]!
    hoisted.getSession.mockResolvedValue({
      session: { scope: 'portal' },
      user: { id: 'user_visitor', name: 'Visitor' },
    })
    hoisted.findSettingsCached.mockResolvedValue({
      id: 'workspace_1',
      widgetSecret: WIDGET_SECRET,
    })
    vi.mocked(db.query.principal.findFirst).mockResolvedValue({
      id: 'principal_visitor',
      role: 'user',
    } as never)

    const result = (await requireWorkspaceRole({ data: { allowedRoles: ['user'] } })) as Record<
      string,
      unknown
    >

    expect(JSON.stringify(result)).not.toContain(WIDGET_SECRET)
    expect(Object.keys(result).sort()).toEqual(['permissions', 'principal', 'user'])
    expect(result.permissions).toEqual(['post.vote'])
  })
})
