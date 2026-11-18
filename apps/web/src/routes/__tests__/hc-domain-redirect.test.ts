// @vitest-environment node
/**
 * The help center layout's default-host redirect to a verified custom domain
 * is permanent but never cached: once the custom domain pauses after the plan
 * limits grace, the default host must serve /hc again, and a cached redirect
 * would keep sending visitors to the paused domain.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<typeof import('@tanstack/react-start')>()),
  createIsomorphicFn: () => ({
    client: () => ({ server: (fn: () => unknown) => fn }),
  }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ host: 'feedback.example.com' }),
}))

import { Route } from '../_portal/hc'

type BeforeLoad = (args: unknown) => Promise<void>
const beforeLoad = (Route as unknown as { options: { beforeLoad: BeforeLoad } }).options.beforeLoad

function settings(domain: { domain: string | null; verifiedAt: string | null }) {
  return { featureFlags: { helpCenter: true }, helpCenterConfig: { domain } }
}

async function thrown(domain: { domain: string | null; verifiedAt: string | null }) {
  try {
    await beforeLoad({
      context: { settings: settings(domain) },
      location: { pathname: '/hc/en/refunds', searchStr: '?q=1' },
    })
    return null
  } catch (err) {
    return err as { options?: { href?: string; statusCode?: number; headers?: HeadersInit } }
  }
}

describe('help center default-host redirect', () => {
  it('redirects to the verified custom domain without letting the redirect be cached', async () => {
    const redirect = await thrown({
      domain: 'help.acme.com',
      verifiedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(redirect?.options?.href).toBe('https://help.acme.com/hc/en/refunds?q=1')
    expect(redirect?.options?.statusCode).toBe(301)
    expect(new Headers(redirect?.options?.headers).get('cache-control')).toBe('no-store')
  })

  it('serves /hc on the default host when no custom domain is offered (a paused one included)', async () => {
    expect(await thrown({ domain: null, verifiedAt: null })).toBeNull()
  })
})
