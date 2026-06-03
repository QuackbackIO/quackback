/**
 * Tests for updateModerationDefaultFn.
 *
 * Admin-only mutation — changes the workspace-wide post-approval policy
 * that applies to every board. The test pins: the isAdmin gate, the
 * audit event shape, and all four valid requireApproval values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Handler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const hoisted = vi.hoisted(() => ({ handlers: [] as Handler[] }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: Handler) {
        hoisted.handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const mockRequireAuth = vi.fn()
vi.mock('./auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}))

// Settings domain mocks
const mockGetPortalConfig = vi.fn()
const mockUpdatePortalConfig = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: (...args: unknown[]) => mockGetPortalConfig(...args),
  updatePortalConfig: (...args: unknown[]) => mockUpdatePortalConfig(...args),
  // stub the other exports boards.ts / other imports may pull
  getPublicPortalConfig: vi.fn(),
  getPublicAuthConfig: vi.fn(),
  getDeveloperConfig: vi.fn(),
  updateDeveloperConfig: vi.fn(),
}))

// Other settings.ts deps that get pulled along at import time
vi.mock('@/lib/server/domains/settings/settings.media', () => ({
  getBrandingConfig: vi.fn(),
  updateBrandingConfig: vi.fn(),
  saveLogoKey: vi.fn(),
  deleteLogoKey: vi.fn(),
  saveHeaderLogoKey: vi.fn(),
  deleteHeaderLogoKey: vi.fn(),
  updateHeaderDisplayMode: vi.fn(),
  updateHeaderDisplayName: vi.fn(),
  updateWorkspaceName: vi.fn(),
  getCustomCss: vi.fn(),
  updateCustomCss: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: vi.fn() }))

vi.mock('@/lib/server/auth/session', () => ({ getSession: vi.fn() }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findMany: vi.fn(), findFirst: vi.fn() },
      user: { findFirst: vi.fn() },
      invitation: { findMany: vi.fn() },
      account: { findFirst: vi.fn() },
    },
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn() })) })),
  },
  principal: {},
  user: {},
  invitation: {},
  account: {},
  session: {},
  settings: {},
  eq: vi.fn(),
  ne: vi.fn(),
  and: vi.fn(),
  max: vi.fn(),
  sql: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings', () => ({
  DEFAULT_PORTAL_CONFIG: {
    oauth: {},
    features: {},
    moderationDefault: { requireApproval: 'none' },
  },
}))

const state: { auditEvents: Array<Record<string, unknown>> } = { auditEvents: [] }

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(async (e: Record<string, unknown>) => {
    state.auditEvents.push(e)
  }),
  actorFromAuth: vi.fn(
    (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
      userId: auth.user.id,
      email: auth.user.email,
      role: auth.principal.role,
    })
  ),
}))

import { ForbiddenError } from '@/lib/shared/errors'
import * as settingsModule from '../settings'

function getUpdateModerationDefaultFn(): Handler {
  expect(settingsModule).toHaveProperty('updateModerationDefaultFn')
  // The handler registered for updateModerationDefaultFn is the last one
  // captured during module import (settings.ts appends it after all
  // prior createServerFn calls).
  return hoisted.handlers[hoisted.handlers.length - 1]
}

const AUTH_ADMIN = {
  user: { id: 'u_admin', email: 'admin@x', name: 'Admin', image: null },
  principal: { id: 'p_admin', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}
const AUTH_MEMBER = {
  ...AUTH_ADMIN,
  principal: { ...AUTH_ADMIN.principal, role: 'member' as const },
}
const AUTH_USER = {
  ...AUTH_ADMIN,
  principal: { ...AUTH_ADMIN.principal, role: 'user' as const },
}

const BEFORE_CONFIG = { moderationDefault: { requireApproval: 'none' } }

beforeEach(() => {
  state.auditEvents = []
  mockRequireAuth.mockReset()
  mockGetPortalConfig.mockReset()
  mockUpdatePortalConfig.mockReset()

  mockGetPortalConfig.mockResolvedValue(BEFORE_CONFIG)
  mockUpdatePortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: 'all' } })
})

describe('updateModerationDefaultFn — isAdmin gate', () => {
  it('rejects role=user with ForbiddenError', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_USER)
    await expect(
      getUpdateModerationDefaultFn()({ data: { requireApproval: 'all' } })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(mockUpdatePortalConfig).not.toHaveBeenCalled()
    expect(state.auditEvents).toHaveLength(0)
  })

  it('rejects role=member with ForbiddenError', async () => {
    mockRequireAuth.mockResolvedValue(AUTH_MEMBER)
    await expect(
      getUpdateModerationDefaultFn()({ data: { requireApproval: 'all' } })
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(mockUpdatePortalConfig).not.toHaveBeenCalled()
    expect(state.auditEvents).toHaveLength(0)
  })
})

describe('updateModerationDefaultFn — happy path (admin)', () => {
  beforeEach(() => mockRequireAuth.mockResolvedValue(AUTH_ADMIN))

  it('calls updatePortalConfig with moderationDefault payload', async () => {
    await getUpdateModerationDefaultFn()({ data: { requireApproval: 'all' } })
    expect(mockUpdatePortalConfig).toHaveBeenCalledWith({
      moderationDefault: { requireApproval: 'all' },
    })
  })

  it('records a moderation.default.changed audit event', async () => {
    await getUpdateModerationDefaultFn()({ data: { requireApproval: 'anonymous' } })
    expect(state.auditEvents).toHaveLength(1)
    expect(state.auditEvents[0].event).toBe('moderation.default.changed')
  })

  it('audit event carries correct before/after', async () => {
    mockUpdatePortalConfig.mockResolvedValue({
      moderationDefault: { requireApproval: 'anonymous' },
    })
    await getUpdateModerationDefaultFn()({ data: { requireApproval: 'anonymous' } })
    const ev = state.auditEvents[0]
    expect((ev.before as { moderationDefault: unknown }).moderationDefault).toEqual({
      requireApproval: 'none',
    })
    expect((ev.after as { moderationDefault: unknown }).moderationDefault).toEqual({
      requireApproval: 'anonymous',
    })
  })

  it('returns { moderationDefault } from the updated config', async () => {
    mockUpdatePortalConfig.mockResolvedValue({
      moderationDefault: { requireApproval: 'authenticated' },
    })
    const result = await getUpdateModerationDefaultFn()({
      data: { requireApproval: 'authenticated' },
    })
    expect(result).toEqual({ moderationDefault: { requireApproval: 'authenticated' } })
  })

  it.each(['none', 'anonymous', 'authenticated', 'all'] as const)(
    'accepts requireApproval=%s',
    async (ra) => {
      mockUpdatePortalConfig.mockResolvedValue({ moderationDefault: { requireApproval: ra } })
      await expect(
        getUpdateModerationDefaultFn()({ data: { requireApproval: ra } })
      ).resolves.toBeDefined()
      expect(mockUpdatePortalConfig).toHaveBeenCalledWith({
        moderationDefault: { requireApproval: ra },
      })
    }
  )
})

describe('updateModerationDefaultFn — audit target shape', () => {
  beforeEach(() => mockRequireAuth.mockResolvedValue(AUTH_ADMIN))

  it('targets settings / portal-config', async () => {
    await getUpdateModerationDefaultFn()({ data: { requireApproval: 'all' } })
    const ev = state.auditEvents[0]
    expect(ev.target).toEqual({ type: 'settings', id: 'portal-config' })
  })
})
