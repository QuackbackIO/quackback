import { describe, expect, it } from 'vitest'
import { sectionDomainState } from '../section-domain-state'

const AT = '2026-11-01T00:00:00.000Z'

describe('sectionDomainState', () => {
  it('is verified once the hostname reaches this server', () => {
    expect(sectionDomainState({ hostname: 'help.acme.com', verifiedAt: AT })).toBe('verified')
  })

  it('is pending until then', () => {
    expect(sectionDomainState({ hostname: 'help.acme.com', verifiedAt: null })).toBe('pending')
  })

  it('is not answering while a verification is only kept, before or after its grace', () => {
    expect(
      sectionDomainState({ hostname: 'help.acme.com', verifiedAt: AT, unconfirmedSince: AT })
    ).toBe('not-answering')
    expect(
      sectionDomainState({ hostname: 'help.acme.com', verifiedAt: null, unconfirmedSince: AT })
    ).toBe('not-answering')
  })
})
