/**
 * Viewer threading for the widget knowledge-base endpoints: the Bearer
 * widget session must resolve to a policy actor (with segment memberships)
 * that flows into search, and any failure or absence of a session must fail
 * CLOSED to the anonymous actor. The SQL gating itself is proven by the
 * help-center segment-gate integration test; this pins the wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, SegmentId } from '@quackback/ids'

const mockIsFeatureEnabled = vi.fn()
const mockGetHelpCenterConfig = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  getHelpCenterConfig: (...args: unknown[]) => mockGetHelpCenterConfig(...args),
}))

const mockHybridSearchForLocale = vi.fn()
vi.mock('@/lib/server/domains/help-center/help-center-search.service', () => ({
  hybridSearchForLocale: (...args: unknown[]) => mockHybridSearchForLocale(...args),
  resolveSearchLocale: (
    requested: string | undefined,
    enabled: string[],
    defaultLocale: string
  ) => (requested && enabled.includes(requested) ? requested : defaultLocale),
}))

const mockIncrementBucket = vi.fn()
vi.mock('@/lib/server/utils/redis-rate-bucket', () => ({
  incrementBucket: (...args: unknown[]) => mockIncrementBucket(...args),
  bucketRetryAfter: vi.fn().mockResolvedValue(30),
}))

const mockGetWidgetSession = vi.fn()
vi.mock('@/lib/server/functions/widget-auth', () => ({
  getWidgetSession: (...args: unknown[]) => mockGetWidgetSession(...args),
}))

const mockSegmentIdsForPrincipal = vi.fn()
vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: (...args: unknown[]) => mockSegmentIdsForPrincipal(...args),
}))

import { handleKbSearch } from '../kb-search'
import { ANONYMOUS_ACTOR } from '@/lib/server/policy/types'

const PRINCIPAL = 'principal_01hzuser0000000000000000000' as PrincipalId
const SEG = 'segment_01hzseg000000000000000000000' as SegmentId

function makeRequest(q = 'hello'): Request {
  const url = new URL('http://localhost/api/widget/kb-search')
  url.searchParams.set('q', q)
  return new Request(url, { headers: { 'x-forwarded-for': '203.0.113.9' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockGetHelpCenterConfig.mockResolvedValue({ locales: { additional: [], default: 'en' } })
  mockIncrementBucket.mockResolvedValue({ count: 1 })
  mockHybridSearchForLocale.mockResolvedValue([])
  mockGetWidgetSession.mockResolvedValue(null)
  mockSegmentIdsForPrincipal.mockResolvedValue(new Set())
})

describe('GET /api/widget/kb-search viewer threading', () => {
  it('unidentified callers search as the anonymous actor (fail closed)', async () => {
    const res = await handleKbSearch({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockHybridSearchForLocale).toHaveBeenCalledWith('hello', 'en', 10, ANONYMOUS_ACTOR)
  })

  it('an identified user session resolves segments and threads them into search', async () => {
    mockGetWidgetSession.mockResolvedValue({
      principal: { id: PRINCIPAL, role: 'user', type: 'user' },
    })
    mockSegmentIdsForPrincipal.mockResolvedValue(new Set([SEG]))

    const res = await handleKbSearch({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockSegmentIdsForPrincipal).toHaveBeenCalledWith(PRINCIPAL)
    expect(mockHybridSearchForLocale).toHaveBeenCalledWith('hello', 'en', 10, {
      principalId: PRINCIPAL,
      role: 'user',
      principalType: 'user',
      segmentIds: new Set([SEG]),
    })
  })

  it('an anonymous-tier widget principal never collapses onto user (gates stay closed)', async () => {
    mockGetWidgetSession.mockResolvedValue({
      principal: { id: PRINCIPAL, role: 'user', type: 'anonymous' },
    })

    await handleKbSearch({ request: makeRequest() })
    const viewer = mockHybridSearchForLocale.mock.calls[0][3] as { principalType: string }
    expect(viewer.principalType).toBe('anonymous')
  })

  it('viewer resolution failure falls back to the anonymous actor instead of failing the read', async () => {
    mockGetWidgetSession.mockRejectedValue(new Error('boom'))
    const res = await handleKbSearch({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockHybridSearchForLocale).toHaveBeenCalledWith('hello', 'en', 10, ANONYMOUS_ACTOR)
  })
})
