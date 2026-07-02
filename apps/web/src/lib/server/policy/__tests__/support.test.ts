import { describe, expect, it } from 'vitest'
import type { PrincipalId, SegmentId } from '@quackback/ids'
import { canAccessSupportSurface } from '../support'
import { ANONYMOUS_ACTOR, type Actor } from '../types'
import type { SupportAccessConfig } from '@/lib/server/domains/settings/settings.types'

const admin: Actor = {
  principalId: 'principal_admin' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
}

const user: Actor = {
  principalId: 'principal_user' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const selectedUser: Actor = {
  principalId: 'principal_selected' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
}

const segmentMember: Actor = {
  principalId: 'principal_segment' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(['segment_vip' as SegmentId]),
}

const service: Actor = {
  principalId: 'principal_service' as PrincipalId,
  role: 'user',
  principalType: 'service',
  segmentIds: new Set(['segment_vip' as SegmentId]),
}

function access(input: Partial<SupportAccessConfig>): SupportAccessConfig {
  return {
    mode: 'anonymous',
    segmentIds: [],
    principalIds: [],
    ...input,
  }
}

describe('canAccessSupportSurface', () => {
  it('allows team actors for every mode', () => {
    for (const mode of ['anonymous', 'authenticated', 'selected', 'team'] as const) {
      expect(canAccessSupportSurface(admin, access({ mode })).allowed).toBe(true)
    }
  })

  it('allows anonymous mode to anonymous and signed-in visitors, but not service principals', () => {
    const cfg = access({ mode: 'anonymous' })
    expect(canAccessSupportSurface(ANONYMOUS_ACTOR, cfg).allowed).toBe(true)
    expect(canAccessSupportSurface(user, cfg).allowed).toBe(true)
    expect(canAccessSupportSurface(service, cfg).allowed).toBe(false)
  })

  it('requires a portal user for authenticated mode', () => {
    const cfg = access({ mode: 'authenticated' })
    expect(canAccessSupportSurface(ANONYMOUS_ACTOR, cfg).allowed).toBe(false)
    expect(canAccessSupportSurface(user, cfg).allowed).toBe(true)
  })

  it('allows selected users by explicit principal id', () => {
    const cfg = access({
      mode: 'selected',
      principalIds: ['principal_selected' as PrincipalId],
    })
    expect(canAccessSupportSurface(selectedUser, cfg).allowed).toBe(true)
    expect(canAccessSupportSurface(user, cfg).allowed).toBe(false)
  })

  it('allows selected users by segment membership', () => {
    const cfg = access({ mode: 'selected', segmentIds: ['segment_vip' as SegmentId] })
    expect(canAccessSupportSurface(segmentMember, cfg).allowed).toBe(true)
    expect(canAccessSupportSurface(user, cfg).allowed).toBe(false)
  })

  it('denies service principals even when they match a selected segment', () => {
    const cfg = access({ mode: 'selected', segmentIds: ['segment_vip' as SegmentId] })
    expect(canAccessSupportSurface(service, cfg).allowed).toBe(false)
  })

  it('fails closed for selected mode with empty allowlists', () => {
    expect(canAccessSupportSurface(user, access({ mode: 'selected' })).allowed).toBe(false)
  })

  it('denies visitors for team mode', () => {
    expect(canAccessSupportSurface(user, access({ mode: 'team' })).allowed).toBe(false)
  })
})
