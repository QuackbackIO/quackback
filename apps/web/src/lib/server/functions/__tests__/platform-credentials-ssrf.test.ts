import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockSavePlatformCredentials: vi.fn(async () => undefined),
  mockGetTierLimits: vi.fn(),
  mockCheckUrlSafety: vi.fn(),
  mockGetIntegration: vi.fn(),
}))

vi.mock('../auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({ principal: { id: 'principal_admin' } })),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  savePlatformCredentials: hoisted.mockSavePlatformCredentials,
  deletePlatformCredentials: vi.fn(),
  getPlatformCredentials: vi.fn(),
  arePlatformCredentialsManaged: vi.fn(() => false),
}))
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))
vi.mock('@/lib/server/integrations', () => ({
  getIntegration: (...args: unknown[]) => hoisted.mockGetIntegration(...args),
}))
vi.mock('@/lib/server/content/ssrf-guard', () => ({
  checkUrlSafety: (...args: unknown[]) => hoisted.mockCheckUrlSafety(...args),
}))

import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import { savePlatformCredentialsFn } from '../platform-credentials'

const gitlabFields = [
  {
    key: 'instanceUrl',
    label: 'GitLab instance URL',
    sensitive: false,
    required: false,
    url: true,
  },
  { key: 'clientId', label: 'Application ID', sensitive: false },
  { key: 'clientSecret', label: 'Secret', sensitive: true },
]

describe('savePlatformCredentialsFn — SSRF URL guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockGetTierLimits.mockResolvedValue(OSS_TIER_LIMITS)
    hoisted.mockGetIntegration.mockReturnValue({ platformCredentials: gitlabFields })
  })

  it('rejects an instance URL that fails the SSRF guard, before storing', async () => {
    hoisted.mockCheckUrlSafety.mockResolvedValue({ safe: false, reason: 'ssrf-rejected' })

    await expect(
      savePlatformCredentialsFn({
        data: {
          integrationType: 'gitlab',
          credentials: {
            clientId: 'id',
            clientSecret: 'secret',
            instanceUrl: 'http://169.254.169.254',
          },
        },
      })
    ).rejects.toThrow(/valid public URL/i)

    expect(hoisted.mockCheckUrlSafety).toHaveBeenCalledWith('http://169.254.169.254')
    expect(hoisted.mockSavePlatformCredentials).not.toHaveBeenCalled()
  })

  it('rejects a non-http(s) instance URL', async () => {
    hoisted.mockCheckUrlSafety.mockResolvedValue({ safe: false, reason: 'scheme-rejected' })

    await expect(
      savePlatformCredentialsFn({
        data: {
          integrationType: 'gitlab',
          credentials: {
            clientId: 'id',
            clientSecret: 'secret',
            instanceUrl: 'javascript:alert(1)',
          },
        },
      })
    ).rejects.toThrow(/valid public URL/i)

    expect(hoisted.mockSavePlatformCredentials).not.toHaveBeenCalled()
  })

  it('stores a custom HTTPS instance URL when the guard passes', async () => {
    hoisted.mockCheckUrlSafety.mockResolvedValue({ safe: true, address: '203.0.113.7', family: 4 })

    await savePlatformCredentialsFn({
      data: {
        integrationType: 'gitlab',
        credentials: {
          clientId: 'id',
          clientSecret: 'secret',
          instanceUrl: 'https://gitlab.example.com/',
        },
      },
    })

    expect(hoisted.mockCheckUrlSafety).toHaveBeenCalledWith('https://gitlab.example.com/')
    expect(hoisted.mockSavePlatformCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          clientId: 'id',
          clientSecret: 'secret',
          instanceUrl: 'https://gitlab.example.com/',
        },
      })
    )
  })

  it('allows omitting the optional instance URL and skips the guard', async () => {
    await savePlatformCredentialsFn({
      data: {
        integrationType: 'gitlab',
        credentials: { clientId: 'id', clientSecret: 'secret' },
      },
    })

    expect(hoisted.mockCheckUrlSafety).not.toHaveBeenCalled()
    expect(hoisted.mockSavePlatformCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { clientId: 'id', clientSecret: 'secret' },
      })
    )
  })

  it('skips the guard for integrations with no URL fields', async () => {
    hoisted.mockGetIntegration.mockReturnValue({
      platformCredentials: [
        { key: 'clientId', label: 'Client ID', sensitive: false },
        { key: 'clientSecret', label: 'Client Secret', sensitive: true },
      ],
    })

    await savePlatformCredentialsFn({
      data: {
        integrationType: 'github',
        credentials: { clientId: 'g', clientSecret: 'g' },
      },
    })

    expect(hoisted.mockCheckUrlSafety).not.toHaveBeenCalled()
    expect(hoisted.mockSavePlatformCredentials).toHaveBeenCalledTimes(1)
  })
})
