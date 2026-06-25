/**
 * Multi-provider identity-provider e2e (Phase 2 capstone).
 *
 * Covers the two visibility/routing shapes the provider model introduces:
 *  (1) A button-only provider (enabled, creds, NO verified domain) surfaces in
 *      the portal login's public OIDC button list ("Continue with <label>").
 *  (2) A domain-bound ENFORCED provider:
 *        - an email at its verified domain routes to it: `lookupAuthMethodsFn`
 *          returns `{ kind: 'sso-redirect', providerId: <that provider> }`;
 *        - password is hard-bound (blocked) for that domain at the auth endpoint;
 *        - the same provider is routed-only — it does NOT appear in the public
 *          button list.
 *
 * No mock IdP exists, so we assert the `lookupAuthMethods` RESPONSE and the
 * hard-binding redirect rather than completing a real OIDC handshake. Providers
 * are seeded via a DB helper script and removed in `afterAll`.
 */
import { test, expect } from '@playwright/test'
import { seedIdentityProvider, removeIdentityProvider } from '../../utils/access-helpers'

const BUTTON_RID = 'e2e-idp-button'
const BUTTON_LABEL = 'E2E Button IdP'

const ENFORCED_RID = 'e2e-idp-enforced'
const ENFORCED_LABEL = 'E2E Enforced IdP'
// A non-reserved TLD: `normalizeDomain` rejects RFC 6761 suffixes
// (.test/.example/.invalid/.localhost), which would null out the email-domain
// match and skip routing entirely.
const ENFORCED_DOMAIN = 'e2e-idp-enforced.com'
const ENFORCED_EMAIL = `routed-user@${ENFORCED_DOMAIN}`

const DISCOVERY_URL = 'https://idp.example.org/.well-known/openid-configuration'

// Serial: both tests share the seeded workspace state.
test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  // Button-only: enabled + creds, no verified domain → public button.
  seedIdentityProvider({
    registrationId: BUTTON_RID,
    label: BUTTON_LABEL,
    clientId: 'e2e-button-client',
    discoveryUrl: DISCOVERY_URL,
    enabled: true,
  })
  // Domain-bound + enforced: enabled + creds + verified enforced domain →
  // routed-only (hidden from buttons), hard-binds its domain to SSO.
  seedIdentityProvider({
    registrationId: ENFORCED_RID,
    label: ENFORCED_LABEL,
    clientId: 'e2e-enforced-client',
    discoveryUrl: DISCOVERY_URL,
    enabled: true,
    domain: { name: ENFORCED_DOMAIN, verified: true, enforced: true },
  })
})

test.afterAll(() => {
  removeIdentityProvider(BUTTON_RID)
  removeIdentityProvider(ENFORCED_RID)
})

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies()
})

// (1) Button-only provider renders on the portal login; the routed-only
//     enforced provider does not.
test('(1) button-only provider surfaces in the portal OIDC button list', async ({ page }) => {
  await page.goto('/auth/login')
  await page.waitForLoadState('networkidle')

  // The button-only provider renders its "Continue with <label>" button.
  await expect(
    page.getByRole('button', { name: new RegExp(`Continue with ${BUTTON_LABEL}`, 'i') })
  ).toBeVisible({ timeout: 15000 })

  // The enforced provider is routed-only (verified domain + showButton:false),
  // so it must NOT appear as a public button.
  await expect(
    page.getByRole('button', { name: new RegExp(`Continue with ${ENFORCED_LABEL}`, 'i') })
  ).toHaveCount(0)
})

// (2) Enforced-domain email routes to SSO; password is hard-bound.
test('(2) enforced-domain email routes to SSO and password is hard-bound', async ({ page }) => {
  // (a) Password is hard-bound for an email at the enforced domain: the sign-in
  // pre-check redirects to the unified login with the enforcement error. Issued
  // FIRST, before any page navigation — an APIRequestContext call from a
  // navigated page attaches an `Origin` header that better-auth's CSRF check
  // rejects (403); pre-navigation there is none, mirroring a server-to-server
  // call. A unique local-part dodges the per-email rate limit on repeat runs;
  // the account need not exist — hard-binding fires before credential check.
  const pwEmail = `pw-${Date.now()}@${ENFORCED_DOMAIN}`
  const res = await page.request.post('/api/auth/sign-in/email', {
    data: { email: pwEmail, password: 'definitely-not-the-password' },
    maxRedirects: 0,
    failOnStatusCode: false,
  })
  expect(res.status()).toBe(302)
  expect(res.headers()['location']).toContain('verified_domain_requires_sso')

  // (b) An email at the enforced domain routes to the owning provider with no
  // methods escape. Capture the lookupAuthMethods server-fn response (TanStack
  // posts it to /_serverFn/...; the routing kind is inlined in the serialized
  // body). Set the wait up before submitting.
  await page.goto('/auth/login')
  await page.waitForLoadState('networkidle')
  const lookupResponse = page.waitForResponse(
    async (resp) => {
      if (resp.request().method() !== 'POST') return false
      if (!resp.url().includes('/_serverFn/')) return false
      try {
        return (await resp.text()).includes('sso-redirect')
      } catch {
        return false
      }
    },
    { timeout: 20000 }
  )

  await page.locator('input[type="email"]').fill(ENFORCED_EMAIL)
  await page.locator('input[type="email"]').press('Enter')

  const body = await (await lookupResponse).text()
  expect(body).toContain('sso-redirect')
  expect(body).toContain(ENFORCED_RID)
})
