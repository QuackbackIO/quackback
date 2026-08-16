import { describe, it, expect } from 'vitest'
import { resolveDefaultSlaPolicy } from '../settings.sla-default'
import { DEFAULT_SLA_POLICY_SETTINGS } from '@/lib/shared/sla/default-policy'

describe('resolveDefaultSlaPolicy', () => {
  it('defaults to no policy', () => {
    expect(resolveDefaultSlaPolicy(null)).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
    expect(resolveDefaultSlaPolicy('{}')).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
  })

  it('returns the stored metadata setting', () => {
    const meta = JSON.stringify({ defaultSlaPolicy: { policyId: 'sla_policy_1' } })
    expect(resolveDefaultSlaPolicy(meta)).toEqual({ policyId: 'sla_policy_1' })
  })

  it('preserves sibling metadata keys', () => {
    const meta = JSON.stringify({
      officeHours: { enabled: true },
      defaultSlaPolicy: { policyId: 'sla_policy_1' },
    })
    expect(resolveDefaultSlaPolicy(meta).policyId).toBe('sla_policy_1')
  })

  it('falls back to defaults on unparseable metadata', () => {
    expect(resolveDefaultSlaPolicy('not json')).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
  })

  it('ignores an invalid stored shape', () => {
    const meta = JSON.stringify({ defaultSlaPolicy: { policyId: '' } })
    expect(resolveDefaultSlaPolicy(meta)).toEqual(DEFAULT_SLA_POLICY_SETTINGS)
  })
})
