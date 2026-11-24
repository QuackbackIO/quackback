/**
 * Test-side client for the provider fake (stand-ins/fake-provider.ts) and the
 * test-only connect route.
 *
 *   const { integrationId } = await connectIntegration(request, { type: 'linear' })
 *   await fakeProvider.script({ marker, host: 'api.linear.app', status: 429, headers: { 'retry-after': '30' } })
 *   ... make the app call the provider with `marker` in the request ...
 *   const [req] = await fakeProvider.waitForRequests({ contains: marker, host: 'api.linear.app' })
 *
 * Always script and look up by a marker unique to the test: the fake is shared
 * by every worker.
 */
import { expect, type APIRequestContext } from '@playwright/test'
import type { FakeProviderRule, RecordedProviderRequest } from './stand-ins/fake-provider'
import { SLACK_REQUIRED_SCOPES } from '../../src/integrations/slack/scopes'
import { pollFor } from './db'
import { supportEnv } from './env'

export type { FakeProviderRule, RecordedProviderRequest }

function url(path: string): string {
  return `${supportEnv().providerFakeUrl}${path}`
}

export const fakeProvider = {
  /** Add a rule: requests containing `marker` get this answer. */
  async script(rule: FakeProviderRule): Promise<void> {
    const res = await fetch(url('/__fake/rules'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rule),
    })
    if (!res.ok) throw new Error(`provider fake script failed: ${res.status} ${await res.text()}`)
  },

  /** Drop every rule for a marker. */
  async clear(marker: string): Promise<void> {
    await fetch(url(`/__fake/rules?marker=${encodeURIComponent(marker)}`), { method: 'DELETE' })
  },

  /** Requests the fake received that contain `contains` (and went to `host`). */
  async requests(
    opts: { contains?: string; host?: string } = {}
  ): Promise<RecordedProviderRequest[]> {
    const params = new URLSearchParams()
    if (opts.contains) params.set('contains', opts.contains)
    if (opts.host) params.set('host', opts.host)
    const res = await fetch(url(`/__fake/requests?${params}`))
    if (!res.ok) throw new Error(`provider fake requests failed: ${res.status}`)
    return (await res.json()) as RecordedProviderRequest[]
  },

  /** Wait until at least `count` matching requests arrived. */
  async waitForRequests(
    opts: { contains: string; host?: string; count?: number },
    timeoutMs = 20_000
  ): Promise<RecordedProviderRequest[]> {
    const count = opts.count ?? 1
    return pollFor(
      `${count} provider fake request(s) containing "${opts.contains}"`,
      async () => {
        const found = await fakeProvider.requests(opts)
        return found.length >= count ? found : null
      },
      { timeoutMs }
    )
  },
}

export interface ConnectIntegrationInput {
  /** The integration type, e.g. 'slack', 'linear'. */
  type: string
  accessToken?: string
  config?: Record<string, unknown>
  secrets?: Record<string, unknown>
  /** Who connected it (defaults to the workspace's first admin). */
  principalId?: string
  /**
   * Reuse the provider's row when it is already connected (default true).
   * Pass false only to test a (re)connect: it moves the installation, which
   * cancels sync work other tests still have queued for that provider.
   */
  reuseExisting?: boolean
}

/** Config each provider's connect would have stored, filled in when not given. */
const DEFAULT_CONFIG: Record<string, Record<string, unknown>> = {
  slack: {
    workspaceId: 'T0FAKE',
    workspaceName: 'Fake',
    scopes: SLACK_REQUIRED_SCOPES.join(','),
    botUserId: 'U0BOT',
    enterpriseId: null,
  },
  linear: { orgId: 'org-fake', workspaceName: 'Fake' },
}

/**
 * Connect an integration with a test token through the app's own install path
 * (`POST /api/e2e/integrations/connect`). One row per integration type per
 * workspace, shared by every test: by default an already connected row is
 * reused as it is (token and config included). No refresh token is stored, so
 * the app never calls a token endpoint.
 */
export async function connectIntegration(
  request: APIRequestContext,
  input: ConnectIntegrationInput
): Promise<{ integrationId: string; integrationType: string }> {
  const res = await request.post(`${supportEnv().baseUrl}/api/e2e/integrations/connect`, {
    data: {
      accessToken: `${input.type}-e2e-token`,
      reuseExisting: true,
      ...input,
      config: { ...(DEFAULT_CONFIG[input.type] ?? {}), ...(input.config ?? {}) },
    },
  })
  expect(res.status(), await res.text()).toBe(200)
  const body = (await res.json()) as { integrationId: string; integrationType: string }
  return { integrationId: body.integrationId, integrationType: body.integrationType }
}
