import { describe, expect, it } from 'vitest'
import { addDomainLink, domainsPageSearch, opensAddDomain } from '@/lib/shared/domains-permissions'

describe('Add domain link', () => {
  it('goes to Settings > Domains, asking for Add domain', () => {
    expect(addDomainLink()).toEqual({ to: '/admin/settings/domains', search: { add: '1' } })
    expect(opensAddDomain(addDomainLink().search)).toBe(true)
  })

  it('carries the section it was asked from', () => {
    expect(addDomainLink('help')).toEqual({
      to: '/admin/settings/domains',
      search: { add: '1', for: 'help' },
    })
  })

  it('reads add=1 however the router parsed it, and nothing else', () => {
    expect(opensAddDomain({ add: 1 })).toBe(true)
    expect(opensAddDomain({ add: '1' })).toBe(true)
    expect(opensAddDomain({})).toBe(false)
    expect(opensAddDomain({ add: '0' })).toBe(false)
    expect(opensAddDomain({ add: 'yes' })).toBe(false)
  })

  it('keeps for only when it names a section', () => {
    expect(domainsPageSearch({ add: 1, for: 'help' })).toEqual({ add: '1', for: 'help' })
    expect(domainsPageSearch({ add: '1', for: 'nope' })).toEqual({ add: '1' })
    expect(domainsPageSearch({ for: { evil: true } })).toEqual({})
  })
})
