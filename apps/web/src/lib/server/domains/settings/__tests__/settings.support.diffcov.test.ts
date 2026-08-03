/**
 * Differential-coverage tests for settings.support — surface enablement,
 * access-config normalisation, request-actor resolution (all the try/catch and
 * principal-type branches), and the support-access decision matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  getPortalConfig: vi.fn(),
  isLiveChatEnabled: vi.fn(),
  getLiveChatConfig: vi.fn(),
  getSession: vi.fn(),
  principalFindFirst: vi.fn(),
  getRequestHeaders: vi.fn((..._a: unknown[]) => ({})),
  segmentIdsForPrincipal: vi.fn(),
  canAccessSupportSurface: vi.fn(),
  isTeamActor: vi.fn(),
}))

vi.mock('../settings.service', () => ({
  isFeatureEnabled: (...a: unknown[]) => m.isFeatureEnabled(...a),
  getPortalConfig: (...a: unknown[]) => m.getPortalConfig(...a),
}))
vi.mock('../settings.widget', () => ({
  isLiveChatEnabled: (...a: unknown[]) => m.isLiveChatEnabled(...a),
  getLiveChatConfig: (...a: unknown[]) => m.getLiveChatConfig(...a),
}))
vi.mock('@/lib/server/auth/index', () => ({
  auth: { api: { getSession: (...a: unknown[]) => m.getSession(...a) } },
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { principal: { findFirst: (...a: unknown[]) => m.principalFindFirst(...a) } } },
  principal: { userId: 'principal.userId' },
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: (...a: unknown[]) => m.getRequestHeaders(...a),
}))
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: (...a: unknown[]) => m.segmentIdsForPrincipal(...a),
}))
vi.mock('@/lib/server/policy', () => ({
  canAccessSupportSurface: (...a: unknown[]) => m.canAccessSupportSurface(...a),
  isTeamActor: (...a: unknown[]) => m.isTeamActor(...a),
}))

import {
  isPortalSupportEnabled,
  isConversationsEnabled,
  isSupportSurfaceEnabled,
  getWidgetSupportAccessConfig,
  getPortalSupportAccessConfig,
  evaluateSupportAccessForActor,
  evaluateSupportAccessForRequest,
} from '../settings.support'

const actor = (over: Record<string, unknown> = {}) => ({
  principalId: 'p1',
  role: 'agent',
  principalType: 'user',
  segmentIds: new Set(),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.isFeatureEnabled.mockResolvedValue(true)
  m.getPortalConfig.mockResolvedValue({
    support: { enabled: true, access: { mode: 'authenticated' } },
  })
  m.isLiveChatEnabled.mockResolvedValue(true)
  m.getLiveChatConfig.mockResolvedValue({ access: { mode: 'anonymous' } })
  m.getSession.mockResolvedValue({ user: { id: 'user_1' } })
  m.principalFindFirst.mockResolvedValue({ id: 'p1', role: 'agent', type: 'user' })
  m.segmentIdsForPrincipal.mockResolvedValue(new Set(['seg_1']))
  m.canAccessSupportSurface.mockReturnValue({ allowed: true })
  m.isTeamActor.mockReturnValue(false)
})

describe('surface enablement', () => {
  it('isPortalSupportEnabled requires both flag and toggle', async () => {
    expect(await isPortalSupportEnabled()).toBe(true)
    m.isFeatureEnabled.mockResolvedValueOnce(false)
    expect(await isPortalSupportEnabled()).toBe(false)
    m.getPortalConfig.mockResolvedValueOnce({ support: { enabled: false } })
    expect(await isPortalSupportEnabled()).toBe(false)
  })

  it('isConversationsEnabled is the OR of widget and portal', async () => {
    expect(await isConversationsEnabled()).toBe(true)
    m.isLiveChatEnabled.mockResolvedValue(false)
    m.isFeatureEnabled.mockResolvedValue(false)
    expect(await isConversationsEnabled()).toBe(false)
  })

  it('isSupportSurfaceEnabled dispatches per surface', async () => {
    expect(await isSupportSurfaceEnabled('portal')).toBe(true)
    expect(await isSupportSurfaceEnabled('widget')).toBe(true)
  })
})

describe('access-config normalisation', () => {
  it('keeps a valid widget mode and coerces arrays', async () => {
    m.getLiveChatConfig.mockResolvedValueOnce({
      access: { mode: 'selected', segmentIds: ['s1'], principalIds: ['p1'] },
    })
    const cfg = await getWidgetSupportAccessConfig()
    expect(cfg).toEqual({ mode: 'selected', segmentIds: ['s1'], principalIds: ['p1'] })
  })

  it('falls back to default mode for an invalid value', async () => {
    m.getLiveChatConfig.mockResolvedValueOnce({ access: { mode: 'nonsense', segmentIds: 'x' } })
    const cfg = await getWidgetSupportAccessConfig()
    expect(cfg.segmentIds).toEqual([])
    expect(cfg.principalIds).toEqual([])
  })

  it('rejects anonymous mode on the portal surface (allowAnonymous false)', async () => {
    m.getPortalConfig.mockResolvedValueOnce({ support: { access: { mode: 'anonymous' } } })
    const cfg = await getPortalSupportAccessConfig()
    expect(cfg.mode).not.toBe('anonymous')
  })

  it('keeps a non-anonymous portal mode', async () => {
    m.getPortalConfig.mockResolvedValueOnce({ support: { access: { mode: 'team' } } })
    const cfg = await getPortalSupportAccessConfig()
    expect(cfg.mode).toBe('team')
  })
})

describe('evaluateSupportAccessForActor decision matrix', () => {
  it('returns disabled when the surface is off', async () => {
    m.isLiveChatEnabled.mockResolvedValue(false)
    const d = await evaluateSupportAccessForActor('widget', actor() as never)
    expect(d).toEqual({ granted: false, reason: 'disabled' })
  })

  it('grants team for a team actor', async () => {
    m.isTeamActor.mockReturnValue(true)
    const d = await evaluateSupportAccessForActor('widget', actor() as never)
    expect(d).toEqual({ granted: true, reason: 'team' })
  })

  it('grants the access mode (selected normalised)', async () => {
    m.getLiveChatConfig.mockResolvedValue({ access: { mode: 'selected' } })
    const d = await evaluateSupportAccessForActor('widget', actor() as never)
    expect(d).toEqual({ granted: true, reason: 'selected' })
  })

  it('grants the access mode (authenticated)', async () => {
    m.getPortalConfig.mockResolvedValue({
      support: { enabled: true, access: { mode: 'authenticated' } },
    })
    const d = await evaluateSupportAccessForActor('portal', actor() as never)
    expect(d).toEqual({ granted: true, reason: 'authenticated' })
  })

  it('denies an anonymous actor as unauthenticated', async () => {
    m.canAccessSupportSurface.mockReturnValue({ allowed: false })
    const d = await evaluateSupportAccessForActor(
      'widget',
      actor({ principalId: null, principalType: 'anonymous' }) as never
    )
    expect(d).toEqual({ granted: false, reason: 'unauthenticated' })
  })

  it('denies an authenticated actor as unauthorized', async () => {
    m.canAccessSupportSurface.mockReturnValue({ allowed: false })
    const d = await evaluateSupportAccessForActor('widget', actor() as never)
    expect(d).toEqual({ granted: false, reason: 'unauthorized' })
  })
})

describe('evaluateSupportAccessForRequest → actorForCurrentRequest', () => {
  it('treats a getSession throw as anonymous', async () => {
    m.getSession.mockRejectedValueOnce(new Error('no session'))
    const d = await evaluateSupportAccessForRequest('widget')
    expect(d.granted).toBe(true) // canAccessSupportSurface defaults to allowed
  })

  it('treats a missing user as anonymous', async () => {
    m.getSession.mockResolvedValueOnce({ user: null })
    await evaluateSupportAccessForRequest('widget')
    expect(m.principalFindFirst).not.toHaveBeenCalled()
  })

  it('treats a principal lookup throw as anonymous', async () => {
    m.principalFindFirst.mockRejectedValueOnce(new Error('db down'))
    const d = await evaluateSupportAccessForRequest('widget')
    expect(d.granted).toBe(true)
  })

  it('treats an anonymous principal row as anonymous', async () => {
    m.principalFindFirst.mockResolvedValueOnce({ id: 'p1', role: null, type: 'anonymous' })
    await evaluateSupportAccessForRequest('widget')
    expect(m.segmentIdsForPrincipal).not.toHaveBeenCalled()
  })

  it('resolves segments for a user principal', async () => {
    await evaluateSupportAccessForRequest('widget')
    expect(m.segmentIdsForPrincipal).toHaveBeenCalledWith('p1')
  })

  it('swallows a segment lookup failure', async () => {
    m.segmentIdsForPrincipal.mockRejectedValueOnce(new Error('seg fail'))
    const d = await evaluateSupportAccessForRequest('widget')
    expect(d.granted).toBe(true)
  })

  it('builds a service actor without segment lookup', async () => {
    m.principalFindFirst.mockResolvedValueOnce({ id: 'p1', role: null, type: 'service' })
    await evaluateSupportAccessForRequest('widget')
    expect(m.segmentIdsForPrincipal).not.toHaveBeenCalled()
  })
})
