import { describe, expect, it } from 'vitest'
import { ADD_DOMAIN_LINK, opensAddDomain } from '@/lib/shared/domains-permissions'

describe('Add domain link', () => {
  it('goes to Settings > Domains, asking for Add domain', () => {
    expect(ADD_DOMAIN_LINK).toEqual({ to: '/admin/settings/domains', search: { add: '1' } })
    expect(opensAddDomain(ADD_DOMAIN_LINK.search)).toBe(true)
  })

  it('reads add=1 however the router parsed it, and nothing else', () => {
    expect(opensAddDomain({ add: 1 })).toBe(true)
    expect(opensAddDomain({ add: '1' })).toBe(true)
    expect(opensAddDomain({})).toBe(false)
    expect(opensAddDomain({ add: '0' })).toBe(false)
    expect(opensAddDomain({ add: 'yes' })).toBe(false)
  })
})
