import { describe, it, expect } from 'vitest'
import { isHelpCenterHost } from '../help-center-host'

describe('isHelpCenterHost', () => {
  const baseDomain = 'quackback.app'

  // -------------------------------------------------------------------------
  // Disabled / null config
  // -------------------------------------------------------------------------

  it('returns false when config is null', () => {
    expect(isHelpCenterHost('help.acme.quackback.app', null, 'acme', baseDomain)).toBe(false)
  })

  it('returns false when help center is disabled', () => {
    const config = { enabled: false, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('help.acme.quackback.app', config, 'acme', baseDomain)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Custom domain matching
  // -------------------------------------------------------------------------

  it('returns true for a verified custom domain', () => {
    const config = { enabled: true, customDomain: 'help.acme.com', domainVerified: true }
    expect(isHelpCenterHost('help.acme.com', config, 'acme', baseDomain)).toBe(true)
  })

  it('returns false for a custom domain that is not verified', () => {
    const config = { enabled: true, customDomain: 'help.acme.com', domainVerified: false }
    expect(isHelpCenterHost('help.acme.com', config, 'acme', baseDomain)).toBe(false)
  })

  it('returns false for a custom domain that is null even if verified flag is true', () => {
    const config = { enabled: true, customDomain: null, domainVerified: true }
    expect(isHelpCenterHost('help.acme.quackback.app', config, null, baseDomain)).toBe(false)
  })

  it('strips port before comparing custom domain', () => {
    const config = { enabled: true, customDomain: 'help.acme.com', domainVerified: true }
    expect(isHelpCenterHost('help.acme.com:3000', config, 'acme', baseDomain)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Convention subdomain matching: help.{slug}.{baseDomain}
  // -------------------------------------------------------------------------

  it('returns true for convention subdomain help.{slug}.{baseDomain}', () => {
    const config = { enabled: true, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('help.acme.quackback.app', config, 'acme', baseDomain)).toBe(true)
  })

  it('returns false when workspaceSlug is null', () => {
    const config = { enabled: true, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('help.acme.quackback.app', config, null, baseDomain)).toBe(false)
  })

  it('returns false for a non-matching subdomain', () => {
    const config = { enabled: true, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('portal.acme.quackback.app', config, 'acme', baseDomain)).toBe(false)
  })

  it('strips port before comparing convention subdomain', () => {
    const config = { enabled: true, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('help.acme.quackback.app:3000', config, 'acme', baseDomain)).toBe(true)
  })

  it('returns false for a different slug in convention subdomain', () => {
    const config = { enabled: true, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('help.other.quackback.app', config, 'acme', baseDomain)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Mixed: both custom domain and convention subdomain configured
  // -------------------------------------------------------------------------

  it('matches custom domain when both paths are configured', () => {
    const config = { enabled: true, customDomain: 'help.acme.com', domainVerified: true }
    expect(isHelpCenterHost('help.acme.com', config, 'acme', baseDomain)).toBe(true)
  })

  it('matches convention subdomain when custom domain does not match', () => {
    const config = { enabled: true, customDomain: 'help.acme.com', domainVerified: true }
    expect(isHelpCenterHost('help.acme.quackback.app', config, 'acme', baseDomain)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('returns false for the bare base domain', () => {
    const config = { enabled: true, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('quackback.app', config, 'acme', baseDomain)).toBe(false)
  })

  it('returns false for localhost (not matching any rule)', () => {
    const config = { enabled: true, customDomain: null, domainVerified: false }
    expect(isHelpCenterHost('localhost:3000', config, 'acme', baseDomain)).toBe(false)
  })

  it('handles case-sensitive matching (domains are case-insensitive in practice)', () => {
    const config = { enabled: true, customDomain: 'help.acme.com', domainVerified: true }
    // We do exact matching; callers should normalize if needed
    expect(isHelpCenterHost('help.acme.com', config, 'acme', baseDomain)).toBe(true)
  })
})
