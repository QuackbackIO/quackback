// @vitest-environment node
/**
 * Signing in while the custom domain is paused after the plan limits grace:
 * a sign-in requested on either hostname mails a magic link on the workspace's
 * own hostname, and both the link and the page it returns to are served there
 * without another redirect. Runs the real request middleware, the real
 * `config.baseUrl` and the real sign-in request; only the mint's database row
 * and the mail transport are doubled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sendMagicLinkEmail: vi.fn(async (_: unknown) => undefined) }))

vi.mock('@/lib/server/auth/magic-link-mint', async (original) => {
  const real = await original<typeof import('@/lib/server/auth/magic-link-mint')>()
  return {
    ...real,
    // The verification row is the database's business; the URL is the real one.
    mintMagicLinkUrl: async (opts: {
      email: string
      portalUrl: string
      callbackPath: string
      errorCallbackPath?: string
    }) => ({
      url: real.buildVerifyMagicLinkUrl({
        origin: opts.portalUrl,
        token: 't1',
        callbackPath: opts.callbackPath,
        errorCallbackPath: opts.errorCallbackPath,
      }),
      token: 't1',
      sealedAddress: opts.email,
    }),
  }
})
vi.mock('@/lib/server/auth/signup-policy', async (original) => ({
  ...(await original<typeof import('@/lib/server/auth/signup-policy')>()),
  isAccountCreationAllowed: vi.fn(async () => true),
}))
vi.mock('@/lib/server/auth/index', () => ({
  getAuth: vi.fn(async () => ({ api: { createVerificationOTP: async () => '123456' } })),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: { query: { settings: { findFirst: vi.fn(async () => null) } } },
}))
vi.mock('@quackback/email', () => ({
  isEmailConfigured: () => true,
  sendMagicLinkEmail: h.sendMagicLinkEmail,
  sendSignupNotAllowedEmail: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceEmailBudget: async () => undefined,
  emailBudgetAvailable: async () => true,
}))
vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => []),
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: vi.fn(async () => new Set()),
  getSsoSignInState: async () => ({ ssoLive: true, providersConfigured: false }),
}))
// Email sign-in on: the method gate has its own suite (email-signin-method).
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => ({ authConfig: { oauth: { magicLink: true } } })),
}))
vi.mock('@/lib/server/domains/settings/settings.plan-limits', async () =>
  (
    await import('@/lib/server/domains/plan-limits/__tests__/settings-plan-limits-double')
  ).settingsPlanLimitsDouble(() => ({
    cloudIdentity: {
      version: 1,
      displayName: 'Acme',
      canonicalOrigin: 'https://feedback.acme.test',
      platformHostname: 'acme.example.com',
      customDomains: [
        {
          hostname: 'feedback.acme.test',
          readiness: 'ready',
          isPrimary: true,
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-11-01T00:00:00.000Z',
    },
    sectionHostnames: [],
  }))
)
vi.mock(
  '@/lib/server/domains/plan-limits/plan-limits.service',
  async () =>
    (await import('@/lib/server/domains/plan-limits/__tests__/feature-states'))
      .planLimitsServiceDouble
)

import { runWithLogContext } from '@/lib/server/log-context'
import { resetConfig } from '@/lib/server/config'
import { requestEmailSignin } from '@/lib/server/auth/email-signin'
import { handlePausedCustomDomain } from '../plan-limits.custom-domain'
import { setFeatureState } from './feature-states'

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  vi.clearAllMocks()
  saved = { ...process.env }
  delete process.env.QUACKBACK_TENANCY
  Object.assign(process.env, {
    // The custom domain is the configured origin.
    BASE_URL: 'https://feedback.acme.test',
    SECRET_KEY: 'x'.repeat(48),
    DATABASE_URL: 'postgresql://app@localhost:5432/quackback',
  })
  resetConfig()
  setFeatureState('enforced', 'customDomain')
})
afterEach(() => {
  process.env = saved
  resetConfig()
  setFeatureState('tierOff')
})

/** One request through the real middleware, signed in with a session cookie. */
function serve(url: string, method = 'GET', next: () => Promise<unknown> = async () => 'served') {
  const request = new Request(url, {
    method,
    headers: {
      host: new URL(url).host,
      cookie: 'better-auth.session_token=acme-session',
      'sec-fetch-mode': 'navigate',
    },
  })
  return runWithLogContext({} as never, () => handlePausedCustomDomain({ request, next }))
}

async function signInRequestedOn(host: string): Promise<URL> {
  await serve(`https://${host}/api/auth/sign-in/email`, 'POST', () =>
    requestEmailSignin({ email: 'jess@example.com', callbackURL: '/admin' })
  )
  const sent = h.sendMagicLinkEmail.mock.calls[0]?.[0] as { signInUrl: string } | undefined
  if (!sent) throw new Error('No sign-in email was sent')
  return new URL(sent.signInUrl)
}

describe('signing in while the custom domain is paused', () => {
  it.each(['acme.example.com', 'feedback.acme.test'])(
    'mails a magic link on the default host when requested on %s',
    async (host) => {
      const link = await signInRequestedOn(host)
      expect(link.host).toBe('acme.example.com')
      expect(new URL(link.searchParams.get('callbackURL')!).host).toBe('acme.example.com')
      expect(new URL(link.searchParams.get('errorCallbackURL')!).host).toBe('acme.example.com')
    }
  )

  it('serves the link and the page it lands on without another redirect', async () => {
    const link = await signInRequestedOn('acme.example.com')
    expect(await serve(link.toString())).toBe('served')
    expect(await serve(link.searchParams.get('callbackURL')!)).toBe('served')
  })

  it('redirects a signed-in visit on the custom host once, temporarily, to a page that is then served', async () => {
    const first = (await serve('https://feedback.acme.test/admin/feedback?view=new')) as Response
    expect(first.status).toBe(307)
    const location = first.headers.get('location')!
    expect(location).toBe('https://acme.example.com/admin/feedback?view=new')
    expect(await serve(location)).toBe('served')
  })

  it('mails a link on the custom host when it is not paused', async () => {
    setFeatureState('grace', 'customDomain')
    expect((await signInRequestedOn('feedback.acme.test')).host).toBe('feedback.acme.test')
  })
})
