import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  baseUrl: 'http://localhost:3000',
  settingsFindFirst: vi.fn(),
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: () => mocks.baseUrl,
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      settings: {
        findFirst: (...args: unknown[]) => mocks.settingsFindFirst(...args),
      },
    },
  },
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getEmailSafeUrl: vi.fn(),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({ error: vi.fn() }),
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: vi.fn(() => new Headers()),
}))

import { resolvePublicBaseUrl, rewriteUrlToPublicBaseUrl } from '@/lib/server/public-url'
import { getEmailSafeUrl } from '@/lib/server/storage/s3'
import { buildHookContext } from '../hook-context'

function headers(input: Record<string, string>): Headers {
  return new Headers(input)
}

describe('resolvePublicBaseUrl', () => {
  beforeEach(() => {
    mocks.baseUrl = 'http://localhost:3000'
    mocks.settingsFindFirst.mockReset()
    vi.mocked(getEmailSafeUrl).mockReset()
  })

  it('uses the current forwarded HTTPS origin when BASE_URL is local', () => {
    expect(
      resolvePublicBaseUrl(
        headers({
          host: 'localhost:3000',
          'x-forwarded-host': 'epic-shoppers-automotive-invited.trycloudflare.com',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://epic-shoppers-automotive-invited.trycloudflare.com')
  })

  it('keeps an externally usable configured base URL', () => {
    mocks.baseUrl = 'https://feedback.example.com/'

    expect(
      resolvePublicBaseUrl(
        headers({
          host: 'localhost:3000',
          'x-forwarded-host': 'epic-shoppers-automotive-invited.trycloudflare.com',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://feedback.example.com')
  })

  it('falls back to BASE_URL for local request origins', () => {
    expect(
      resolvePublicBaseUrl(
        headers({
          host: 'localhost:3000',
          'x-forwarded-proto': 'http',
        })
      )
    ).toBe('http://localhost:3000')
  })

  it('rewrites localhost auth email links to the forwarded public origin', () => {
    expect(
      rewriteUrlToPublicBaseUrl(
        'http://localhost:3000/auth/reset-password?token=reset-token',
        headers({
          host: 'localhost:3000',
          'x-forwarded-host': 'epic-shoppers-automotive-invited.trycloudflare.com',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe(
      'https://epic-shoppers-automotive-invited.trycloudflare.com/auth/reset-password?token=reset-token'
    )
  })
})

describe('buildHookContext', () => {
  beforeEach(() => {
    mocks.baseUrl = 'https://feedback.example.com'
    mocks.settingsFindFirst.mockReset()
    vi.mocked(getEmailSafeUrl).mockReset()
  })

  it('returns workspace name, public portal URL, and safe logo URL from settings', async () => {
    mocks.settingsFindFirst.mockResolvedValue({
      name: 'Acme Support',
      logoKey: 'logos/acme.png',
    })
    vi.mocked(getEmailSafeUrl).mockReturnValue('https://cdn.example.com/logos/acme.png')

    await expect(buildHookContext()).resolves.toEqual({
      workspaceName: 'Acme Support',
      portalBaseUrl: 'https://feedback.example.com',
      logoUrl: 'https://cdn.example.com/logos/acme.png',
    })
    expect(mocks.settingsFindFirst).toHaveBeenCalledWith({
      columns: { name: true, logoKey: true },
    })
  })

  it('returns null when workspace settings are missing', async () => {
    mocks.settingsFindFirst.mockResolvedValue(null)

    await expect(buildHookContext()).resolves.toBeNull()
  })
})
