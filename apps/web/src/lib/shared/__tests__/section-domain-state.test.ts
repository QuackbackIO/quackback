import { describe, expect, it } from 'vitest'
import { notAnsweringNote, sectionDomainState } from '../section-domains'

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

describe('notAnsweringNote', () => {
  it('gives the date the DNS has to be fixed by: seven days after it stopped answering', () => {
    expect(
      notAnsweringNote({ hostname: 'help.acme.com', verifiedAt: AT, unconfirmedSince: AT })
    ).toBe('Not answering. Fix DNS by November 8, 2026.')
  })

  it('says only that it is not answering when the mark cannot be read', () => {
    expect(
      notAnsweringNote({ hostname: 'help.acme.com', verifiedAt: AT, unconfirmedSince: 'soon' })
    ).toBe('Not answering.')
  })

  it('is null for a domain that answers', () => {
    expect(notAnsweringNote({ hostname: 'help.acme.com', verifiedAt: AT })).toBeNull()
  })
})
