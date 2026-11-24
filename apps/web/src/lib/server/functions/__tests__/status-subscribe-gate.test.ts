/**
 * subscribeStatusFn asks the status page's own gate before it stores a
 * subscription: someone the page would 404 (private portal, unpublished page,
 * audience they are outside of) cannot subscribe and take a subscriber slot.
 * A component subscription must name at least one service, and only services
 * the caller can see on the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))

const CALLER = 'principal_01h455vb4pex5vsknk084sn02q'
const auth = vi.hoisted(() => ({ type: 'user' as string }))
vi.mock('../auth-helpers', async (importOriginal) => {
  const real = await importOriginal<typeof import('../auth-helpers')>()
  const ctx = () => ({ principal: { id: CALLER, role: 'user', type: auth.type }, permissions: [] })
  return {
    ...real,
    requireAuth: async () => ctx(),
    getOptionalAuth: async () => ctx(),
    policyActorFromAuth: async () => ({
      principalId: CALLER,
      role: 'user',
      principalType: auth.type,
      segmentIds: new Set(),
    }),
  }
})

const gate = vi.hoisted(() => ({
  portalGranted: true,
  statusPage: true,
  status: { enabled: true, audience: 'public' as string, allowedSegmentIds: [] as string[] },
}))
vi.mock('../portal-access', () => ({
  resolvePortalAccessForRequest: async () =>
    gate.portalGranted
      ? { granted: true, reason: 'public' }
      : { granted: false, reason: 'unauthorized' },
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: async (flag: string) => (flag === 'statusPage' ? gate.statusPage : true),
}))
vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: async () => ({ ...gate.status, emailsDisabled: false, pageDescription: null }),
  updateStatusSettings: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceStatusComponentLimit: vi.fn(),
}))

const API = 'status_component_01h455vb4pex5vsknk084sn02a'
const BILLING = 'status_component_01h455vb4pex5vsknk084sn02b'
const mockSubscribe = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/domains/status', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/status')>()),
  subscribe: (...args: unknown[]) => mockSubscribe(...args),
  // The caller can see API (on its own) and Billing (in a group).
  getStatusPageSnapshot: async () => ({
    ungroupedComponents: [{ id: API }],
    groups: [{ components: [{ id: BILLING }] }],
  }),
}))

import { subscribeStatusFn } from '../status-subscriptions'

const subscribe = subscribeStatusFn as unknown as (args: {
  data: { scope: 'page' | 'components'; componentIds?: string[] }
}) => Promise<{ subscribed: boolean }>

beforeEach(() => {
  auth.type = 'user'
  gate.portalGranted = true
  gate.statusPage = true
  gate.status = { enabled: true, audience: 'public', allowedSegmentIds: [] }
  mockSubscribe.mockReset().mockResolvedValue(undefined)
})

describe('subscribeStatusFn gate', () => {
  it('subscribes a signed-in caller the page lets in', async () => {
    await expect(subscribe({ data: { scope: 'page' } })).resolves.toEqual({ subscribed: true })
    expect(mockSubscribe).toHaveBeenCalledWith(CALLER, 'page', [], 'self_serve')
  })

  it('still refuses an anonymous session with the message the portal listens for', async () => {
    auth.type = 'anonymous'
    await expect(subscribe({ data: { scope: 'page' } })).rejects.toThrow(
      'Anonymous interaction is not enabled'
    )
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it.each([
    ['the portal turns the caller away', () => (gate.portalGranted = false)],
    ['the page is unpublished', () => (gate.status.enabled = false)],
    ['the status page product is off', () => (gate.statusPage = false)],
    [
      'the page is for a segment the caller is outside of',
      () => (gate.status = { enabled: true, audience: 'segments', allowedSegmentIds: ['seg'] }),
    ],
  ])('refuses when %s, as the page would', async (_, close) => {
    close()
    await expect(subscribe({ data: { scope: 'page' } })).rejects.toMatchObject({
      code: 'STATUS_PAGE_NOT_FOUND',
    })
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('subscribes to the services the caller chose', async () => {
    await subscribe({ data: { scope: 'components', componentIds: [BILLING, API, BILLING] } })
    expect(mockSubscribe).toHaveBeenCalledWith(CALLER, 'components', [BILLING, API], 'self_serve')
  })

  it.each([
    ['no services', undefined],
    ['an empty list', []],
    ['a service the caller cannot see', [API, 'status_component_01h455vb4pex5vsknk084sn02z']],
  ])('refuses a component subscription with %s', async (_, componentIds) => {
    await expect(subscribe({ data: { scope: 'components', componentIds } })).rejects.toMatchObject({
      code: 'INVALID_STATUS_COMPONENTS',
    })
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('ignores a service list sent with a whole-page subscription', async () => {
    await subscribe({ data: { scope: 'page', componentIds: [API] } })
    expect(mockSubscribe).toHaveBeenCalledWith(CALLER, 'page', [], 'self_serve')
  })
})
