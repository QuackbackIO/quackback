import { describe, expect, it } from 'vitest'
import { PROVEN_ZONE_PROOFS_ENV, provenZoneProofsAccepted } from '../proven-zone-proofs'

describe('provenZoneProofsAccepted', () => {
  it('is on only when the operator sets the flag to true', () => {
    expect(provenZoneProofsAccepted({ [PROVEN_ZONE_PROOFS_ENV]: 'true' })).toBe(true)
    expect(provenZoneProofsAccepted({ [PROVEN_ZONE_PROOFS_ENV]: ' TRUE ' })).toBe(true)
  })

  it('is off by default and for anything else', () => {
    expect(provenZoneProofsAccepted({})).toBe(false)
    for (const value of ['false', '1', 'yes', '']) {
      expect(provenZoneProofsAccepted({ [PROVEN_ZONE_PROOFS_ENV]: value })).toBe(false)
    }
  })
})
