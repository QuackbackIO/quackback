/**
 * Differential-coverage tests for settings server functions.
 *
 * Targets the private support-access helpers (normalizeSupportAccessForCompare
 * and validateSupportAccessInput) reached through updatePortalConfigFn and
 * updateWidgetConfigFn. Exercises:
 *   - anonymous-not-allowed rejection (portal) vs allowed (widget)
 *   - selected-mode-with-no-targets rejection
 *   - segment existence check (valid + missing)
 *   - principal existence check (valid + missing)
 *   - the before/after audit comparison path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
type Chain = {
  validator(): Chain
  handler(fn: AnyHandler): Chain
  __handler?: AnyHandler
}

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Chain = {
      validator() {
        return chain
      },
      handler(fn: AnyHandler) {
        chain.__handler = fn
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockGetPortalConfig: vi.fn(),
  mockUpdatePortalConfig: vi.fn(),
  // FIFO queue of rows returned by db.select(...).from(...).where(...).
  // The helper queries segments first (when segmentIds present), then
  // principals (when principalIds present), so tests push in that order.
  whereResults: [] as Array<Array<{ id: string }>>,
  // widget config service
  mockGetWidgetConfig: vi.fn(),
  mockUpdateWidgetConfig: vi.fn(),
}))

vi.mock('./auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: hoisted.mockGetPortalConfig,
  getPublicPortalConfig: vi.fn(),
  getPublicAuthConfig: vi.fn(),
  updatePortalConfig: hoisted.mockUpdatePortalConfig,
  getDeveloperConfig: vi.fn(),
  updateDeveloperConfig: vi.fn(),
}))

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

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: hoisted.mockGetWidgetConfig,
  updateWidgetConfig: hoisted.mockUpdateWidgetConfig,
  getWidgetSecret: vi.fn(),
  regenerateWidgetSecret: vi.fn(),
}))

vi.mock('@/lib/server/storage/s3', () => ({ getPublicUrlOrNull: vi.fn() }))
vi.mock('@/lib/server/auth/session', () => ({ getSession: vi.fn() }))

// db.select(...).from(...).where(...) resolves to the next queued rows.
// segments is queried first; principals second within validateSupportAccessInput.
vi.mock('@/lib/server/db', () => {
  const selectChain = {
    from() {
      return selectChain
    },
    where(): Promise<Array<{ id: string }>> {
      // Shift the next queued result. Empty queue → no matching rows.
      return Promise.resolve(hoisted.whereResults.shift() ?? [])
    },
  }
  return {
    db: {
      query: {
        principal: { findMany: vi.fn(), findFirst: vi.fn() },
        user: { findFirst: vi.fn() },
        invitation: { findMany: vi.fn() },
        account: { findFirst: vi.fn() },
      },
      select: () => selectChain,
    },
    principal: { id: 'principal.id', role: 'principal.role', type: 'principal.type' },
    user: {},
    invitation: {},
    account: {},
    segments: { id: 'segments.id', deletedAt: 'segments.deletedAt' },
    session: {},
    eq: vi.fn(() => 'eq'),
    ne: vi.fn(() => 'ne'),
    and: vi.fn(() => 'and'),
    inArray: vi.fn(() => 'inArray'),
    isNull: vi.fn(() => 'isNull'),
    max: vi.fn(),
    sql: vi.fn(),
  }
})

vi.mock('@/lib/server/domains/settings', () => ({
  DEFAULT_PORTAL_CONFIG: { oauth: {}, features: {} },
  DEFAULT_PORTAL_SUPPORT_ACCESS: { mode: 'authenticated', segmentIds: [], principalIds: [] },
  DEFAULT_WIDGET_SUPPORT_ACCESS: { mode: 'anonymous', segmentIds: [], principalIds: [] },
}))

import { ValidationError } from '@/lib/shared/errors'
import * as settings from '../settings'

function handlerFor(fnName: keyof typeof settings): AnyHandler {
  const fn = (settings[fnName] as unknown as Chain).__handler
  expect(fn, `${String(fnName)} handler not captured`).toBeTypeOf('function')
  return fn as AnyHandler
}

const AUTH_ADMIN = {
  user: { id: 'u_admin', email: 'admin@x', name: 'Admin', image: null },
  principal: { id: 'p_admin', role: 'admin' as const, type: 'user' },
  settings: { id: 'ws_1', slug: 'x', name: 'X', logoKey: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.whereResults = []
  hoisted.mockRequireAuth.mockResolvedValue(AUTH_ADMIN)
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
})

describe('updatePortalConfigFn — validateSupportAccessInput (allowAnonymous: false)', () => {
  it('rejects anonymous mode for portal support', async () => {
    hoisted.mockGetPortalConfig.mockResolvedValue({ support: { access: undefined } })

    await expect(
      handlerFor('updatePortalConfigFn')({
        data: {
          support: {
            enabled: true,
            access: { mode: 'anonymous', segmentIds: [], principalIds: [] },
          },
        },
      })
    ).rejects.toBeInstanceOf(ValidationError)
    expect(hoisted.mockUpdatePortalConfig).not.toHaveBeenCalled()
  })

  it('rejects selected mode with no segments or principals', async () => {
    hoisted.mockGetPortalConfig.mockResolvedValue({ support: { access: undefined } })

    await expect(
      handlerFor('updatePortalConfigFn')({
        data: {
          support: {
            enabled: true,
            access: { mode: 'selected', segmentIds: [], principalIds: [] },
          },
        },
      })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects when a selected segment is unknown/deleted', async () => {
    hoisted.mockGetPortalConfig.mockResolvedValue({ support: { access: undefined } })
    // Segment query returns no rows → the requested segment is "missing".
    hoisted.whereResults = [[]]

    await expect(
      handlerFor('updatePortalConfigFn')({
        data: {
          support: {
            enabled: true,
            access: { mode: 'selected', segmentIds: ['segment_missing'], principalIds: [] },
          },
        },
      })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects when a selected principal is unknown', async () => {
    hoisted.mockGetPortalConfig.mockResolvedValue({ support: { access: undefined } })
    // No segmentIds → segment query skipped; first where() serves principals.
    hoisted.whereResults = [[]] // principal query → empty → missing

    await expect(
      handlerFor('updatePortalConfigFn')({
        data: {
          support: {
            enabled: true,
            access: { mode: 'selected', segmentIds: [], principalIds: ['principal_missing'] },
          },
        },
      })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('passes validation and records an audit event when access changes', async () => {
    hoisted.mockGetPortalConfig.mockResolvedValue({
      support: { access: { mode: 'authenticated', segmentIds: [], principalIds: [] } },
    })
    // Segment query (1st) then principal query (2nd) return the requested ids.
    hoisted.whereResults = [[{ id: 'segment_a' }], [{ id: 'principal_b' }]]
    hoisted.mockUpdatePortalConfig.mockResolvedValue({
      support: {
        access: { mode: 'selected', segmentIds: ['segment_a'], principalIds: ['principal_b'] },
      },
    })

    const result = await handlerFor('updatePortalConfigFn')({
      data: {
        support: {
          enabled: true,
          access: { mode: 'selected', segmentIds: ['segment_a'], principalIds: ['principal_b'] },
        },
      },
    })

    expect(hoisted.mockUpdatePortalConfig).toHaveBeenCalled()
    // before (authenticated) !== after (selected) → audit emitted.
    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).toContain('portal.support_access.changed')
    expect(result).toBeDefined()
  })

  it('does NOT record an audit event when before/after access matches', async () => {
    const access = { mode: 'authenticated', segmentIds: [], principalIds: [] }
    hoisted.mockGetPortalConfig.mockResolvedValue({ support: { access } })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({ support: { access } })

    await handlerFor('updatePortalConfigFn')({
      data: { support: { enabled: true, access } },
    })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).not.toContain('portal.support_access.changed')
  })

  it('returns undefined access path (no support.access) without touching the db', async () => {
    hoisted.mockGetPortalConfig.mockResolvedValue({ support: { access: undefined } })
    hoisted.mockUpdatePortalConfig.mockResolvedValue({ welcomeCard: { enabled: true } })

    // No support in payload → before stays null, validateSupportAccessInput
    // returns undefined for absent access.
    await handlerFor('updatePortalConfigFn')({ data: { welcomeCard: { enabled: true } } })

    expect(hoisted.mockUpdatePortalConfig).toHaveBeenCalled()
    expect(hoisted.mockGetPortalConfig).not.toHaveBeenCalled()
  })
})

describe('updateWidgetConfigFn — validateSupportAccessInput (allowAnonymous: true)', () => {
  it('accepts anonymous mode for widget chat access', async () => {
    hoisted.mockGetWidgetConfig.mockResolvedValue({
      chat: { access: { mode: 'authenticated', segmentIds: [], principalIds: [] } },
    })
    hoisted.mockUpdateWidgetConfig.mockResolvedValue({
      chat: { access: { mode: 'anonymous', segmentIds: [], principalIds: [] } },
    })

    const result = await handlerFor('updateWidgetConfigFn')({
      data: {
        chat: { enabled: true, access: { mode: 'anonymous', segmentIds: [], principalIds: [] } },
      },
    })

    expect(hoisted.mockUpdateWidgetConfig).toHaveBeenCalled()
    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).toContain('widget.chat_access.changed')
    expect(result).toBeDefined()
  })

  it('dedups segmentIds before validating', async () => {
    hoisted.mockGetWidgetConfig.mockResolvedValue({
      chat: { access: { mode: 'authenticated', segmentIds: [], principalIds: [] } },
    })
    hoisted.whereResults = [[{ id: 'segment_a' }]]
    hoisted.mockUpdateWidgetConfig.mockResolvedValue({
      chat: { access: { mode: 'selected', segmentIds: ['segment_a'], principalIds: [] } },
    })

    await handlerFor('updateWidgetConfigFn')({
      data: {
        chat: {
          enabled: true,
          access: { mode: 'selected', segmentIds: ['segment_a', 'segment_a'], principalIds: [] },
        },
      },
    })

    expect(hoisted.mockUpdateWidgetConfig).toHaveBeenCalled()
  })
})
