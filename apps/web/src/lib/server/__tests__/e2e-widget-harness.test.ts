import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  isProduction: vi.fn(() => false),
}))

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  ensureWidgetSecret: vi.fn(async () => 'wgt_test_secret'),
}))

vi.mock('@/lib/server/widget/identity-token', () => ({
  createWidgetIdentityToken: vi.fn(
    (claims: { email: string }, _secret: string) => `jwt-for-${claims.email}`
  ),
}))

import { isProduction } from '@/lib/server/config'
import {
  isE2eWidgetHarnessEnabled,
  mintE2eWidgetHtml,
  parseE2eWidgetPersona,
} from '../e2e-widget-harness'

const savedBaseUrl = process.env.BASE_URL

describe('e2e widget harness', () => {
  afterEach(() => {
    vi.mocked(isProduction).mockReturnValue(false)
    delete process.env.E2E_HARNESS
    if (savedBaseUrl === undefined) delete process.env.BASE_URL
    else process.env.BASE_URL = savedBaseUrl
  })

  it('parses personas and defaults to anon', () => {
    expect(parseE2eWidgetPersona('customer')).toBe('customer')
    expect(parseE2eWidgetPersona('teammate')).toBe('teammate')
    expect(parseE2eWidgetPersona('nope')).toBe('anon')
  })

  it('is on in development without the flag', () => {
    vi.mocked(isProduction).mockReturnValue(false)
    expect(isE2eWidgetHarnessEnabled()).toBe(true)
  })

  it('is off in production unless E2E_HARNESS=1 on a loopback BASE_URL', () => {
    vi.mocked(isProduction).mockReturnValue(true)
    process.env.BASE_URL = 'http://acme.localhost:3000'
    expect(isE2eWidgetHarnessEnabled()).toBe(false)
    process.env.E2E_HARNESS = '1'
    expect(isE2eWidgetHarnessEnabled()).toBe(true)
  })

  it('stays off in production with the flag on a public BASE_URL', () => {
    vi.mocked(isProduction).mockReturnValue(true)
    process.env.E2E_HARNESS = '1'
    process.env.BASE_URL = 'https://feedback.example.com'
    expect(isE2eWidgetHarnessEnabled()).toBe(false)
  })

  it('mints a host page with an ssoToken for the customer persona', async () => {
    const html = await mintE2eWidgetHtml('customer', 'http://acme.localhost:3000')
    expect(html).toContain('jwt-for-e2e.customer@example.com')
    expect(html).toContain('/api/widget/sdk.js')
    expect(html).toContain("Quackback('init'")
    expect(html).toContain("Quackback('open')")
  })

  it('omits identity for the anon persona', async () => {
    const html = await mintE2eWidgetHtml('anon', 'http://acme.localhost:3000')
    expect(html).not.toContain('ssoToken')
  })
})
