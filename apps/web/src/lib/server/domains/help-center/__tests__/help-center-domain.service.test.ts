import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HelpCenterDomainConfig } from '@/lib/server/domains/settings/settings.types'

const mockGetHelpCenterConfig = vi.fn()
const mockUpdateHelpCenterConfig = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getHelpCenterConfig: (...args: unknown[]) => mockGetHelpCenterConfig(...args),
  updateHelpCenterConfig: (...args: unknown[]) => mockUpdateHelpCenterConfig(...args),
  getWorkspaceSettings: async () => ({ settings: { cloud: null } }),
}))

const mockResolve4 = vi.fn()
const mockResolve6 = vi.fn()

vi.mock('@/lib/server/dns/resolver', () => ({
  systemResolver: {
    resolve4: (...args: unknown[]) => mockResolve4(...args),
    resolve6: (...args: unknown[]) => mockResolve6(...args),
  },
}))

const {
  resolveHelpCenterDomainRedirect,
  resolveHelpCenterBaseUrl,
  checkHelpCenterDomainStatus,
  setHelpCenterDomain,
  verifyHelpCenterDomain,
} = await import('../help-center-domain.service')

const verifiedDomain: HelpCenterDomainConfig = {
  domain: 'help.acme.com',
  verifiedAt: '2026-07-01T00:00:00.000Z',
}

/** A lookup failure as node:dns reports one, with its code. */
const dnsFailure = (code: string) => Object.assign(new Error(code), { code })

const unverifiedDomain: HelpCenterDomainConfig = {
  domain: 'help.acme.com',
  verifiedAt: null,
}

describe('resolveHelpCenterDomainRedirect', () => {
  it('returns null when no domain is configured', () => {
    expect(
      resolveHelpCenterDomainRedirect({
        domainConfig: { domain: null, verifiedAt: null },
        currentHost: 'app.quackback.io',
        pathname: '/hc',
        search: '',
      })
    ).toBeNull()
  })

  it('returns null when the domain is configured but not verified', () => {
    expect(
      resolveHelpCenterDomainRedirect({
        domainConfig: unverifiedDomain,
        currentHost: 'app.quackback.io',
        pathname: '/hc',
        search: '',
      })
    ).toBeNull()
  })

  it('returns null when the request already arrived on the custom domain', () => {
    expect(
      resolveHelpCenterDomainRedirect({
        domainConfig: verifiedDomain,
        currentHost: 'help.acme.com',
        pathname: '/hc/categories/billing',
        search: '',
      })
    ).toBeNull()
  })

  it('redirects the default host to the verified custom domain, preserving path and search', () => {
    expect(
      resolveHelpCenterDomainRedirect({
        domainConfig: verifiedDomain,
        currentHost: 'app.quackback.io',
        pathname: '/hc/articles/billing/invoices',
        search: '?utm_source=x',
      })
    ).toBe('https://help.acme.com/hc/articles/billing/invoices?utm_source=x')
  })

  it('ignores the port when comparing hosts', () => {
    expect(
      resolveHelpCenterDomainRedirect({
        domainConfig: verifiedDomain,
        currentHost: 'app.quackback.io:3000',
        pathname: '/hc',
        search: '',
      })
    ).toBe('https://help.acme.com/hc')
  })

  it('returns null when no request host is available (e.g. client-side nav)', () => {
    expect(
      resolveHelpCenterDomainRedirect({
        domainConfig: verifiedDomain,
        currentHost: null,
        pathname: '/hc',
        search: '',
      })
    ).toBeNull()
  })
})

describe('resolveHelpCenterBaseUrl', () => {
  const fallback = 'https://app.quackback.io'

  it('falls back to BASE_URL when no domain is configured', () => {
    expect(
      resolveHelpCenterBaseUrl({
        domainConfig: { domain: null, verifiedAt: null },
        currentHost: 'app.quackback.io',
        fallback,
      })
    ).toBe(fallback)
  })

  it('falls back to BASE_URL when the domain is unverified', () => {
    expect(
      resolveHelpCenterBaseUrl({
        domainConfig: unverifiedDomain,
        currentHost: 'help.acme.com',
        fallback,
      })
    ).toBe(fallback)
  })

  it('falls back to BASE_URL when the request did not arrive on the custom domain', () => {
    expect(
      resolveHelpCenterBaseUrl({
        domainConfig: verifiedDomain,
        currentHost: 'app.quackback.io',
        fallback,
      })
    ).toBe(fallback)
  })

  it('uses the custom domain when the request arrived on it and it is verified', () => {
    expect(
      resolveHelpCenterBaseUrl({
        domainConfig: verifiedDomain,
        currentHost: 'help.acme.com',
        fallback,
      })
    ).toBe('https://help.acme.com')
  })
})

describe('checkHelpCenterDomainStatus', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    mockResolve4.mockReset()
    mockResolve6.mockReset()
    globalThis.fetch = originalFetch
  })

  it('is verified when DNS resolves and the instance answers', async () => {
    mockResolve4.mockResolvedValue(['1.2.3.4'])
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

    const status = await checkHelpCenterDomainStatus('help.acme.com')
    expect(status).toEqual({ dnsResolved: true, instanceReachable: true, verified: true })
    expect(mockResolve4).toHaveBeenCalledWith('help.acme.com')
  })

  it('counts an AAAA-only domain as resolving', async () => {
    mockResolve4.mockRejectedValue(Object.assign(new Error('no data'), { code: 'ENODATA' }))
    mockResolve6.mockResolvedValue(['2001:db8::1'])
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

    const status = await checkHelpCenterDomainStatus('help.acme.com')
    expect(status.dnsResolved).toBe(true)
    expect(mockResolve6).toHaveBeenCalledWith('help.acme.com')
  })

  it('is unverified when DNS fails to resolve', async () => {
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'))
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'))
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch

    const status = await checkHelpCenterDomainStatus('help.acme.com')
    expect(status).toEqual({ dnsResolved: false, instanceReachable: true, verified: false })
  })

  it('is unverified when the instance does not answer', async () => {
    mockResolve4.mockResolvedValue(['1.2.3.4'])
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch

    const status = await checkHelpCenterDomainStatus('help.acme.com')
    expect(status).toEqual({ dnsResolved: true, instanceReachable: false, verified: false })
  })
})

describe('setHelpCenterDomain', () => {
  beforeEach(() => {
    mockUpdateHelpCenterConfig.mockReset()
    mockUpdateHelpCenterConfig.mockImplementation(
      async (input: { domain: HelpCenterDomainConfig }) => ({
        domain: input.domain,
      })
    )
  })

  it('normalizes and persists a new domain, resetting verification', async () => {
    const result = await setHelpCenterDomain('Help.ACME.com')
    expect(mockUpdateHelpCenterConfig).toHaveBeenCalledWith({
      domain: { domain: 'help.acme.com', verifiedAt: null },
    })
    expect(result).toEqual({ domain: 'help.acme.com', verifiedAt: null })
  })

  it('clears the domain when passed null', async () => {
    await setHelpCenterDomain(null)
    expect(mockUpdateHelpCenterConfig).toHaveBeenCalledWith({
      domain: { domain: null, verifiedAt: null },
    })
  })

  it('rejects an invalid domain', async () => {
    await expect(setHelpCenterDomain('not a domain')).rejects.toThrow()
    expect(mockUpdateHelpCenterConfig).not.toHaveBeenCalled()
  })
})

describe('verifyHelpCenterDomain', () => {
  beforeEach(() => {
    mockGetHelpCenterConfig.mockReset()
    mockUpdateHelpCenterConfig.mockReset()
    mockResolve4.mockReset()
    mockResolve6.mockReset()
  })

  it('throws when no domain is configured', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ domain: { domain: null, verifiedAt: null } })
    await expect(verifyHelpCenterDomain()).rejects.toThrow()
  })

  it('persists verifiedAt when the check passes', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ domain: unverifiedDomain })
    mockResolve4.mockResolvedValue(['1.2.3.4'])
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    mockUpdateHelpCenterConfig.mockImplementation(
      async (input: { domain: HelpCenterDomainConfig }) => ({
        domain: input.domain,
      })
    )

    const { config, status } = await verifyHelpCenterDomain()
    expect(status.verified).toBe(true)
    expect(config.verifiedAt).not.toBeNull()
    expect(mockUpdateHelpCenterConfig).toHaveBeenCalledWith({
      domain: { domain: 'help.acme.com', verifiedAt: expect.any(String) },
    })
  })

  it('clears verifiedAt when a previously-verified domain stops answering', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ domain: verifiedDomain })
    mockResolve4.mockRejectedValue(dnsFailure('ENOTFOUND'))
    mockResolve6.mockRejectedValue(dnsFailure('ENOTFOUND'))
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch
    mockUpdateHelpCenterConfig.mockImplementation(
      async (input: { domain: HelpCenterDomainConfig }) => ({
        domain: input.domain,
      })
    )

    const { config, status } = await verifyHelpCenterDomain()
    expect(status.verified).toBe(false)
    expect(config.verifiedAt).toBeNull()
  })

  it('keeps verifiedAt when the DNS lookup goes unanswered', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ domain: verifiedDomain })
    mockResolve4.mockRejectedValue(dnsFailure('ETIMEOUT'))
    mockResolve6.mockRejectedValue(dnsFailure('ETIMEOUT'))
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch
    mockUpdateHelpCenterConfig.mockImplementation(
      async (input: { domain: HelpCenterDomainConfig }) => ({
        domain: input.domain,
      })
    )

    const { config, status } = await verifyHelpCenterDomain()
    expect(status.verified).toBe(false)
    expect(config.verifiedAt).toBe(verifiedDomain.verifiedAt)
    expect(mockUpdateHelpCenterConfig).not.toHaveBeenCalledWith({
      domain: { domain: 'help.acme.com', verifiedAt: null },
    })
  })

  it('keeps verifiedAt when one lookup fails and the other finds nothing', async () => {
    // AAAA answering empty says nothing about the A record that went unanswered.
    mockGetHelpCenterConfig.mockResolvedValue({ domain: verifiedDomain })
    mockResolve4.mockRejectedValue(dnsFailure('ESERVFAIL'))
    mockResolve6.mockRejectedValue(dnsFailure('ENODATA'))
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch
    mockUpdateHelpCenterConfig.mockImplementation(
      async (input: { domain: HelpCenterDomainConfig }) => ({
        domain: input.domain,
      })
    )

    const { config } = await verifyHelpCenterDomain()
    expect(config.verifiedAt).toBe(verifiedDomain.verifiedAt)
  })

  it('does not verify a never-verified domain whose lookup goes unanswered', async () => {
    mockGetHelpCenterConfig.mockResolvedValue({ domain: unverifiedDomain })
    mockResolve4.mockRejectedValue(dnsFailure('ETIMEOUT'))
    mockResolve6.mockRejectedValue(dnsFailure('ETIMEOUT'))
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    mockUpdateHelpCenterConfig.mockImplementation(
      async (input: { domain: HelpCenterDomainConfig }) => ({
        domain: input.domain,
      })
    )

    const { config } = await verifyHelpCenterDomain()
    expect(config.verifiedAt).toBeNull()
  })
})
