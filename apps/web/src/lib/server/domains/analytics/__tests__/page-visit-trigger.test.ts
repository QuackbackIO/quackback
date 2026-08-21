// @vitest-environment node
/**
 * Coverage for the page.visited workflow trigger bridge (track.service.ts's
 * dispatchPageVisitWorkflows): an identified visitor's beacon dispatches
 * page.visited workflows against their latest conversation; an anonymous
 * device, a device with no conversation, or a failing dispatcher never
 * breaks the fire-and-forget beacon contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockDispatchWorkflowTrigger,
  mockIsFeatureEnabled,
  mockIncrementBucket,
  mockGetDailySalt,
  mockTouchVisitorDevice,
} = vi.hoisted(() => ({
  mockDispatchWorkflowTrigger: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
  mockIncrementBucket: vi.fn(),
  mockGetDailySalt: vi.fn(),
  mockTouchVisitorDevice: vi.fn(),
}))
vi.mock('@/lib/server/domains/workflows/dispatcher', () => ({
  dispatchWorkflowTrigger: mockDispatchWorkflowTrigger,
}))

// db.select is used for exactly two lookups, in order: the device's principal
// link (visitor_devices), then the visitor's latest conversation. Each test
// queues the rows each lookup returns.
const mockSelectQueue = vi.hoisted(() => ({ rows: [] as unknown[][] }))
const mockDbSelect = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: vi.fn(() => ({ values: vi.fn() })),
  },
  pageViews: {},
  visitorDevices: { deviceId: 'deviceId', principalId: 'principalId' },
  conversations: {
    id: 'id',
    visitorPrincipalId: 'visitorPrincipalId',
    lastMessageAt: 'lastMessageAt',
  },
  eq: (a: unknown, b: unknown) => ['eq', a, b],
  desc: (a: unknown) => ['desc', a],
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}))

vi.mock('@/lib/server/utils/rate-bucket', () => ({
  incrementBucket: mockIncrementBucket,
}))

vi.mock('../visitor-hash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../visitor-hash')>()
  return { ...actual, getDailySalt: mockGetDailySalt }
})

vi.mock('../device-link.service', () => ({
  touchVisitorDevice: mockTouchVisitorDevice,
  linkDeviceToPrincipal: vi.fn(),
}))

import { dispatchPageVisitWorkflows, recordPageView } from '../track.service'

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

beforeEach(() => {
  vi.clearAllMocks()
  mockSelectQueue.rows = []
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockIncrementBucket.mockResolvedValue({ count: 1 })
  mockGetDailySalt.mockResolvedValue('test-salt')
  mockTouchVisitorDevice.mockResolvedValue(undefined)
  mockDbSelect.mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    chain.from = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = async () => mockSelectQueue.rows.shift() ?? []
    return chain
  })
})

describe('dispatchPageVisitWorkflows', () => {
  it('dispatches a page.visited trigger for an identified visitor with a conversation', async () => {
    mockSelectQueue.rows = [[{ principalId: 'principal_1' }], [{ id: 'conversation_1' }]]

    await dispatchPageVisitWorkflows('device_1', '/pricing')

    expect(mockDispatchWorkflowTrigger).toHaveBeenCalledTimes(1)
    expect(mockDispatchWorkflowTrigger).toHaveBeenCalledWith({
      triggerType: 'page.visited',
      conversationId: 'conversation_1',
      actorType: 'user',
      subjectPrincipalId: 'principal_1',
      pagePath: '/pricing',
    })
  })

  it('does nothing for an anonymous device (no principal link)', async () => {
    mockSelectQueue.rows = [[{ principalId: null }]]

    await dispatchPageVisitWorkflows('device_1', '/pricing')

    expect(mockDispatchWorkflowTrigger).not.toHaveBeenCalled()
    // The conversation lookup must not even run.
    expect(mockDbSelect).toHaveBeenCalledTimes(1)
  })

  it('does nothing for an unknown device', async () => {
    mockSelectQueue.rows = [[]]

    await dispatchPageVisitWorkflows('device_1', '/pricing')

    expect(mockDispatchWorkflowTrigger).not.toHaveBeenCalled()
  })

  it('does nothing when the identified visitor has no conversation yet', async () => {
    mockSelectQueue.rows = [[{ principalId: 'principal_1' }], []]

    await dispatchPageVisitWorkflows('device_1', '/pricing')

    expect(mockDispatchWorkflowTrigger).not.toHaveBeenCalled()
  })

  it('swallows a dispatcher failure (beacon stays fire-and-forget)', async () => {
    mockSelectQueue.rows = [[{ principalId: 'principal_1' }], [{ id: 'conversation_1' }]]
    mockDispatchWorkflowTrigger.mockRejectedValue(new Error('boom'))

    await expect(dispatchPageVisitWorkflows('device_1', '/pricing')).resolves.toBeUndefined()
  })
})

describe('recordPageView page.visited hook', () => {
  function makeBeaconRequest(body: unknown): Request {
    const h = new Headers()
    h.set('user-agent', CHROME_UA)
    return new Request('http://localhost:3000/api/track', {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    })
  }

  it('kicks off the page.visited dispatch after recording an identified beacon', async () => {
    mockSelectQueue.rows = [[{ principalId: 'principal_1' }], [{ id: 'conversation_1' }]]

    await recordPageView(
      makeBeaconRequest({
        url: 'https://feedback.example.com/pricing',
        surface: 'portal',
        deviceId: 'device_1',
      })
    )

    await vi.waitFor(() => expect(mockDispatchWorkflowTrigger).toHaveBeenCalled())
    expect(mockDispatchWorkflowTrigger.mock.calls[0][0]).toMatchObject({
      triggerType: 'page.visited',
      pagePath: '/pricing',
      conversationId: 'conversation_1',
    })
  })

  it('never dispatches for a beacon without a deviceId', async () => {
    await recordPageView(
      makeBeaconRequest({ url: 'https://feedback.example.com/pricing', surface: 'portal' })
    )

    // Give any accidental fire-and-forget work a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(mockDispatchWorkflowTrigger).not.toHaveBeenCalled()
  })
})
