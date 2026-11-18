/**
 * A paused custom domain: after the plan limits grace on a plan without custom
 * domains, requests on a custom hostname get a temporary redirect to the workspace's own
 * hostname with the same path and query, and links generated while serving
 * name that hostname. Domain records are never touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sources: null as Record<string, unknown> | null,
  workspace: null as { workspaceKey: string; routing: Record<string, unknown> } | null,
  baseUrl: 'https://acme.example.com',
}))

vi.mock('@/lib/server/domains/settings/settings.plan-limits', async () =>
  (
    await import('@/lib/server/domains/plan-limits/__tests__/settings-plan-limits-double')
  ).settingsPlanLimitsDouble(() => h.sources)
)
vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () => h.workspace,
}))
vi.mock('@/lib/server/config', async () => {
  const { baseUrlOverride } = await import('@/lib/server/base-url-override')
  return {
    config: {
      get baseUrl() {
        return baseUrlOverride() ?? h.baseUrl
      },
    },
    configuredBaseUrl: () => h.baseUrl,
  }
})
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { runWithLogContext } from '@/lib/server/log-context'
import { readPlanLimitsSources } from '@/lib/server/domains/settings/settings.plan-limits'
import { config } from '@/lib/server/config'
import {
  handlePausedCustomDomain,
  withPausedCustomDomainOrigin,
} from '../plan-limits.custom-domain'
import { FEATURE_STATES, planLimitsServiceDouble, setFeatureState } from './feature-states'

const NOW = '2026-11-01T00:00:00.000Z'

function identity(custom: string[], platformHostname: string | null = 'acme.example.com') {
  return {
    version: 1,
    displayName: 'Acme',
    canonicalOrigin: `https://${custom[0] ?? platformHostname}`,
    platformHostname,
    customDomains: custom.map((hostname, i) => ({
      hostname,
      readiness: 'ready',
      isPrimary: i === 0,
      updatedAt: NOW,
    })),
    updatedAt: NOW,
  }
}

function withSources(cloudIdentity: unknown, sectionHostnames: string[] = []) {
  h.sources = {
    planLimitsState: null,
    tierLimits: null,
    cloud: null,
    cloudIdentity,
    customCss: null,
    sectionHostnames,
    autoTranslate: false,
  }
}

function request(url: string, method = 'GET'): Request {
  return new Request(url, { method, headers: { host: new URL(url).host } })
}

/** Run the middleware inside a request store, reporting what `next` saw. */
async function serve(req: Request) {
  const seen = { called: false, baseUrl: '' }
  const result = await runWithLogContext({} as never, () =>
    handlePausedCustomDomain({
      request: req,
      next: async () => {
        seen.called = true
        seen.baseUrl = config.baseUrl
        return 'next'
      },
    })
  )
  return { result, ...seen }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.workspace = null
  h.baseUrl = 'https://feedback.acme.test'
  withSources(identity(['feedback.acme.test']))
  setFeatureState('flagOff')
})

describe('requests on a custom hostname', () => {
  it.each(FEATURE_STATES)('redirect only when enforced (%s)', async (state) => {
    setFeatureState(state, 'customDomain')
    const { result, called } = await serve(
      request('https://feedback.acme.test/b/ideas?sort=top&page=2')
    )
    if (state === 'enforced') {
      expect(called).toBe(false)
      const response = result as Response
      // Temporary: the pause ends on upgrade, so neither browsers nor
      // search engines may treat the move as permanent.
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toBe(
        'https://acme.example.com/b/ideas?sort=top&page=2'
      )
      // A cached redirect would outlive an upgrade.
      expect(response.headers.get('cache-control')).toBe('no-store')
    } else {
      expect(result).toBe('next')
    }
  })

  it('redirects auth callbacks, so a sign-in link from before the pause still lands', async () => {
    setFeatureState('enforced', 'customDomain')
    const { result } = await serve(
      request('https://feedback.acme.test/api/auth/magic-link/verify?token=t1&callbackURL=%2Fadmin')
    )
    expect((result as Response).headers.get('location')).toBe(
      'https://acme.example.com/api/auth/magic-link/verify?token=t1&callbackURL=%2Fadmin'
    )
  })

  it("serves an auth call made by a script in place, such as the widget frame's token call", async () => {
    setFeatureState('enforced', 'customDomain')
    const req = new Request('https://feedback.acme.test/api/auth/one-time-token/generate', {
      headers: { host: 'feedback.acme.test', 'sec-fetch-mode': 'cors' },
    })
    expect((await serve(req)).result).toBe('next')
  })

  it('redirects a browser navigation to an auth callback', async () => {
    setFeatureState('enforced', 'customDomain')
    const req = new Request('https://feedback.acme.test/api/auth/callback/acme?code=c1&state=s1', {
      headers: { host: 'feedback.acme.test', 'sec-fetch-mode': 'navigate' },
    })
    expect(((await serve(req)).result as Response).headers.get('location')).toBe(
      'https://acme.example.com/api/auth/callback/acme?code=c1&state=s1'
    )
  })

  it.each([
    ['a write', 'https://feedback.acme.test/b/ideas', 'POST'],
    ['a widget API call from an embed', 'https://feedback.acme.test/api/widget/config', 'GET'],
    ['the widget frame of an embed', 'https://feedback.acme.test/widget', 'GET'],
    ['the REST API', 'https://feedback.acme.test/api/v1/posts', 'GET'],
    ['discovery metadata', 'https://feedback.acme.test/.well-known/openid-configuration', 'GET'],
    ['a server function', 'https://feedback.acme.test/_serverFn/abc', 'GET'],
  ])('serves %s in place, with links on the default hostname', async (_label, url, method) => {
    setFeatureState('enforced', 'customDomain')
    const { result, baseUrl } = await serve(request(url, method))
    expect(result).toBe('next')
    expect(baseUrl).toBe('https://acme.example.com')
  })

  it('does not redirect the default hostname, and generates links on it', async () => {
    setFeatureState('enforced', 'customDomain')
    const { result, baseUrl } = await serve(request('https://acme.example.com/b/ideas'))
    expect(result).toBe('next')
    expect(baseUrl).toBe('https://acme.example.com')
  })

  it('keeps links on the custom hostname while it serves', async () => {
    setFeatureState('grace', 'customDomain')
    expect((await serve(request('https://acme.example.com/'))).baseUrl).toBe(
      'https://feedback.acme.test'
    )
  })

  it('reads neither the plan state nor the full sources on the default host with no custom hostname', async () => {
    withSources(identity([]))
    setFeatureState('enforced', 'customDomain')
    const { result, baseUrl } = await serve(request('https://acme.example.com/'))
    expect(result).toBe('next')
    expect(baseUrl).toBe('https://feedback.acme.test')
    expect(planLimitsServiceDouble.isFeaturePaused).not.toHaveBeenCalled()
    expect(planLimitsServiceDouble.getPlanLimits).not.toHaveBeenCalled()
    expect(readPlanLimitsSources).not.toHaveBeenCalled()
  })

  it('reads nothing for the build assets, even on a paused custom hostname', async () => {
    setFeatureState('enforced', 'customDomain')
    const { result } = await serve(request('https://feedback.acme.test/assets/main-abc123.js'))
    expect(result).toBe('next')
    expect(readPlanLimitsSources).not.toHaveBeenCalled()
    expect(planLimitsServiceDouble.isFeaturePaused).not.toHaveBeenCalled()
  })

  it('serves in place when the workspace has no default hostname to send people to', async () => {
    withSources(identity(['feedback.acme.test'], null))
    setFeatureState('enforced', 'customDomain')
    const { result, baseUrl } = await serve(request('https://feedback.acme.test/'))
    expect(result).toBe('next')
    expect(baseUrl).toBe('https://feedback.acme.test')
  })

  it('serves in place when the routing record does not route the default hostname here', async () => {
    h.workspace = {
      workspaceKey: 'ws_acme',
      routing: { hostnames: ['feedback.acme.test'], baseUrl: 'https://feedback.acme.test' },
    }
    setFeatureState('enforced', 'customDomain')
    expect((await serve(request('https://feedback.acme.test/'))).result).toBe('next')
  })

  it('redirects under pooled routing when the default hostname routes here', async () => {
    h.workspace = {
      workspaceKey: 'ws_acme',
      routing: {
        hostnames: ['acme.example.com', 'feedback.acme.test'],
        baseUrl: 'https://feedback.acme.test',
      },
    }
    setFeatureState('enforced', 'customDomain')
    const { result } = await serve(request('https://feedback.acme.test/hc/en/refunds'))
    expect((result as Response).headers.get('location')).toBe(
      'https://acme.example.com/hc/en/refunds'
    )
  })

  // The primary domain sends a section's paths to its own host with a
  // permanent redirect that browsers cache. Redirecting that host back to the
  // default host would loop, so it keeps serving in place while paused.
  it("serves a section's own host in place, so a cached redirect to it cannot loop", async () => {
    h.baseUrl = 'https://acme.example.com'
    withSources(null, ['help.acme.test'])
    setFeatureState('enforced', 'customDomain')
    const { result, baseUrl } = await serve(request('https://help.acme.test/hc/refunds?q=1'))
    expect(result).toBe('next')
    // Links generated there still name the default host.
    expect(baseUrl).toBe('https://acme.example.com')
  })

  it("serves a section's host in place even when it is also a workspace custom domain", async () => {
    withSources(identity(['feedback.acme.test', 'status.acme.test']), ['status.acme.test'])
    setFeatureState('enforced', 'customDomain')
    expect((await serve(request('https://status.acme.test/status'))).result).toBe('next')
    expect(
      ((await serve(request('https://feedback.acme.test/hc/x'))).result as Response).status
    ).toBe(307)
  })

  it('fails open when the settings cannot be read', async () => {
    h.sources = null
    setFeatureState('enforced', 'customDomain')
    expect((await serve(request('https://feedback.acme.test/'))).result).toBe('next')
  })
})

describe('background work', () => {
  it.each(FEATURE_STATES)(
    'generates links on the default hostname only when enforced (%s)',
    async (state) => {
      setFeatureState(state, 'customDomain')
      const seen = await withPausedCustomDomainOrigin(async () => config.baseUrl)
      expect(seen).toBe(
        state === 'enforced' ? 'https://acme.example.com' : 'https://feedback.acme.test'
      )
    }
  )
})
