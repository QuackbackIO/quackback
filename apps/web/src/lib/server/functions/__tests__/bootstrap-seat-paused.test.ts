/**
 * The bootstrap's user role for a paused seat (the plan has fewer team seats
 * than members, after the grace): the portal is told `user`, so it shows no
 * admin links. The plan limits answer is a stand-in keyed on the principal, as
 * the real `isSeatPaused`; the real answer is proved in plan-limits.team.db.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  handlers: [] as Array<() => Promise<unknown>>,
  paused: new Set<string>(),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => ({
    handler(fn: () => Promise<unknown>) {
      hoisted.handlers.push(fn)
      return fn
    },
  }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () =>
    new Headers({ host: 'feedback.example', cookie: 'better-auth.session_token=t' }),
  getRequestUrl: () => new URL('https://feedback.example/'),
  setResponseHeader: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredAuthProviders: async () => ['password'],
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example' } }))
vi.mock('@/lib/server/domains/help-center/help-center-domain.service', () => ({
  resolveHelpCenterBaseUrl: ({ fallback }: { fallback: string }) => fallback,
}))
vi.mock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => false }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

vi.mock('@/lib/server/auth/request-session', () => ({
  IDENTITY_MEMO_PREFIX: 'identity:',
  getRequestSession: async () => ({
    session: {
      id: 'session_1',
      scope: 'dashboard',
      expiresAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    user: {
      id: 'user_1',
      name: 'Alex',
      email: 'alex@example.com',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  }),
  getRequestPrincipal: async () => ({ id: 'principal_1', role: 'admin', type: 'user' }),
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  isSeatPaused: async (id: string) => hoisted.paused.has(id),
}))

async function userRole(): Promise<string | null> {
  if (hoisted.handlers.length === 0) await import('../bootstrap')
  return ((await hoisted.handlers[0]!()) as { userRole: string | null }).userRole
}

describe('getBootstrapData user role', () => {
  beforeEach(() => {
    hoisted.paused.clear()
    hoisted.getWorkspaceSettings.mockResolvedValue(null)
  })

  it('reports a seat holder as the teammate they are', async () => {
    expect(await userRole()).toBe('admin')
  })

  it('reports a paused seat as a portal user', async () => {
    hoisted.paused.add('principal_1')
    expect(await userRole()).toBe('user')
  })
})
