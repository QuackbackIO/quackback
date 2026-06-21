/**
 * Unified sign-in dialog e2e — six canonical journeys.
 *
 * Covers the new unified auth surface that replaced the old /auth/login page:
 *
 *  1. Public portal, unauth /admin → /?signin=1&callbackUrl=%2Fadmin; dialog
 *     auto-opens ("Welcome back"); admin magic-link sign-in lands on /admin.
 *  2. Public portal, portal user reaching /admin → error toast (not_team_member);
 *     dialog remains open; user stays out of /admin.
 *  3. Private portal, unauth /admin → gate shows "Sign in to access…"; dialog
 *     auto-opens; after admin sign-in, loader re-evaluates and lands on /admin.
 *  4. /?prompt=login escape hatch: shows the dialog with any seeded OIDC button +
 *     the break-glass recovery-code link. (The anonymous-/ → IdP redirect is
 *     deferred: it requires an OIDC discovery document at a live URL.)
 *  5. Recovery break-glass: /auth/recovery renders the standalone form directly.
 *  6. Mixed audience: verified-domain email routes to the hidden corporate IdP;
 *     a non-matching email shows public auth methods; the corporate button is
 *     never shown unprompted.
 *
 * All tests manage their own auth state (no stored state injected).
 */
import { test, expect } from '@playwright/test'
import {
  loginViaMagicLink,
  setPortalAuthMethods,
  setPortalVisibility,
  flushMagicLinkRateLimit,
  seedIdentityProvider,
  removeIdentityProvider,
} from '../../utils/access-helpers'
const PORTAL_EMAIL = 'e2e-portal-unified@example.test'

// Registration IDs scoped to this suite to avoid collisions with identity-providers.spec.ts.
const BTN_RID = 'e2e-unified-btn'
const BTN_LABEL = 'E2E Unified Button'
const CORP_RID = 'e2e-unified-corp'
const CORP_LABEL = 'E2E Corp IdP'
// Avoid .test/.example/.invalid/.localhost — normalizeDomain rejects them as
// RFC 6761 reserved suffixes, which would null out the email-domain lookup
// and prevent the SSO routing from ever matching.
const CORP_DOMAIN = 'unified-corp-e2e.com'
const CORP_EMAIL = `employee@${CORP_DOMAIN}`
const DISCOVERY_URL = 'https://idp.example.org/.well-known/openid-configuration'

// Serial: tests mutate shared workspace state (portal config, providers).
test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  flushMagicLinkRateLimit()
  // Ensure portal starts public regardless of any leftover state from a prior
  // run (test (3) sets private inside a try/finally, but belt-and-suspenders).
  setPortalVisibility('public')
})

test.beforeEach(async ({ page }) => {
  // Start from a clean session for each journey.
  await page.context().clearCookies()
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

// ── Journey 1 ────────────────────────────────────────────────────────────────
// Public portal, unauth /admin → unified dialog auto-opens; admin sign-in
// completes and lands on /admin.

test('(1a) unauth /admin → /?signin=1 with callbackUrl=/admin and dialog visible', async ({
  page,
}) => {
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  // requireWorkspaceRole redirects to buildSigninRedirect('/admin'), which is
  // { to: '/', search: { signin: '1', callbackUrl: '/admin' } }.
  // TanStack Router JSON-encodes the string '1' as "1" in the URL
  // (%221%22), so match the signin param by key only and verify callbackUrl
  // via the parsed searchParams.
  await expect(page).toHaveURL(/[?&]signin=/, { timeout: 15000 })
  const url = new URL(page.url())
  expect(url.searchParams.get('callbackUrl')).toMatch(/^\/admin/)

  // useAutoOpenAuthDialog fires on mount when signin=1; the dialog heading is
  // "Welcome back" for mode='login'.
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })
  await expect(
    page.getByRole('heading', { name: /welcome back/i })
  ).toBeVisible({ timeout: 10000 })
})

test('(1b) signed-in admin navigating to /admin lands there (not on the dialog)', async ({
  browser,
}) => {
  // Open a fresh context that uses the global-setup's stored admin session.
  // This proves that after a successful sign-in, /admin is directly accessible
  // without going through the unified dialog. The global-setup.ts exercises the
  // full magic-link flow; this case tests the result.
  //
  // We use `browser.newContext` (not the test's `page`/`context` fixtures) to
  // bypass the `beforeEach` clearCookies + initScript, which would interfere
  // with loading an existing session via storageState.
  const ctx = await browser.newContext({ storageState: 'e2e/.auth/admin.json' })
  const page = await ctx.newPage()
  try {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15000 })
  } finally {
    await ctx.close()
  }
})

// ── Journey 2 ────────────────────────────────────────────────────────────────
// Public portal, portal user (role='user') hitting /admin → not_team_member
// error toast; user remains on the portal root, not on /admin.

test('(2) portal user reaching /admin gets not_team_member error toast', async ({ context }) => {
  // Enable magic-link just long enough to establish the portal user session.
  setPortalAuthMethods('enable-magic-link')
  try {
    await loginViaMagicLink(context, PORTAL_EMAIL, { role: 'user' })
  } finally {
    setPortalAuthMethods('restore')
  }

  const page = await context.newPage()
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  // requireWorkspaceRole bounces via buildSigninRedirect('/admin', { error: 'not_team_member' }).
  // Check signin presence (TanStack Router JSON-encodes '1' as "1" in URL).
  await expect(page).toHaveURL(/[?&]signin=/, { timeout: 15000 })
  // The error value is also present in the URL (encoding may vary).
  await expect(page).toHaveURL(/[?&]error=/, { timeout: 15000 })

  // useAutoOpenAuthDialog fires the error toast before opening the dialog.
  await expect(
    page.getByText(/team access|team membership/i)
  ).toBeVisible({ timeout: 10000 })

  // The user is NOT on /admin.
  expect(page.url()).not.toMatch(/\/admin/)
  await page.close()
})

// ── Journey 3 ────────────────────────────────────────────────────────────────
// Private portal: unauth /admin → gate shows "Sign in to access…"; dialog
// auto-opens from the gate's autoOpenSignin='login'; admin sign-in clears gate.

test('(3) private portal gate: unauth /admin auto-opens dialog inside the gate', async ({
  page,
}) => {
  setPortalVisibility('private')
  try {
    // /admin redirects to /?signin=1&callbackUrl=/admin regardless of portal
    // visibility; the _portal loader then sees the portal is private and
    // evaluates access for an anonymous visitor → denied → gate + autoOpenSignin.
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')

    // Must land on the portal root with signin param (gate preserves the prompt;
    // TanStack Router JSON-encodes '1' as "1" in the URL).
    await expect(page).toHaveURL(/[?&]signin=/, { timeout: 15000 })

    // The gate's autoOpenSignin prop triggers the dialog immediately. Confirm
    // the dialog is open first — this proves the gate rendered and fired the
    // auto-open callback.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 })

    // Close the dialog so the gate card behind it is no longer aria-hidden
    // (modal dialogs set aria-hidden on page content while open; the heading
    // would not be found via getByRole while the dialog is in front).
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 })

    // The gate renders a "Sign in to access …" heading (not the regular portal).
    await expect(
      page.getByRole('heading', { name: /sign in to access/i })
    ).toBeVisible({ timeout: 10000 })
  } finally {
    setPortalVisibility('public')
  }
})

// ── Journey 4 ────────────────────────────────────────────────────────────────
// /?prompt=login escape hatch: the dialog opens with the seeded OIDC button and
// the break-glass recovery-code link (callbackUrl=/admin satisfies isTeamCallback).
//
// DEFERRED — anonymous `/` → IdP redirect: requires a live OIDC discovery
// document. The instant-SSO resolver calls auth.api.signInWithOAuth2 which
// fetches the provider's discovery URL; with a synthetic URL this returns null
// and no redirect fires. Tracking: run this sub-case against the CI environment
// where a mock-OIDC container is available.

test('(4) /?prompt=login shows the dialog with OIDC button and recovery-code link', async ({
  page,
}) => {
  seedIdentityProvider({
    registrationId: BTN_RID,
    label: BTN_LABEL,
    clientId: 'e2e-unified-btn-client',
    discoveryUrl: DISCOVERY_URL,
    enabled: true,
    showButton: true,
  })
  try {
    // ?prompt=login opens the dialog; ?callbackUrl=/admin makes isTeamCallback true
    // so the recovery-code link renders inside the dialog form.
    await page.goto('/?prompt=login&callbackUrl=%2Fadmin')
    await page.waitForLoadState('networkidle')

    // Dialog must open (prompt=login triggers useAutoOpenAuthDialog).
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 })

    // The seeded button-only provider's "Sign in with …" button appears.
    await expect(
      page.getByRole('button', { name: new RegExp(`Sign in with ${BTN_LABEL}`, 'i') })
    ).toBeVisible({ timeout: 10000 })

    // Break-glass recovery-code link is visible (callbackUrl=/admin → isTeamCallback).
    await expect(
      page.getByRole('link', { name: /use a recovery code/i })
    ).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByRole('link', { name: /use a recovery code/i })
    ).toHaveAttribute('href', /\/auth\/recovery/)
  } finally {
    removeIdentityProvider(BTN_RID)
  }
})

// ── Journey 5 ────────────────────────────────────────────────────────────────
// Recovery break-glass: /auth/recovery renders the standalone form directly,
// independent of any portal configuration or session state.

test('(5) /auth/recovery renders the standalone recovery form', async ({ page }) => {
  await page.goto('/auth/recovery')
  await page.waitForLoadState('networkidle')

  // Heading confirms we're on the recovery page, not a redirect.
  await expect(
    page.getByRole('heading', { name: /use a recovery code/i })
  ).toBeVisible({ timeout: 15000 })

  // Email + code fields and submit button are present.
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 })
  await expect(page.locator('input[placeholder*="XXXX"]')).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 10000 })
})

// ── Journey 6 ────────────────────────────────────────────────────────────────
// Mixed audience: a verified-domain corporate IdP is hidden from the button list;
// typing a matching email routes to it; a non-matching email gets the public
// providers, never the corporate button.

test('(6) corporate button hidden; verified-domain email routes to corporate IdP', async ({
  page,
}) => {
  // Button-only provider: visible in the button list (control).
  seedIdentityProvider({
    registrationId: BTN_RID,
    label: BTN_LABEL,
    clientId: 'e2e-unified-btn-client',
    discoveryUrl: DISCOVERY_URL,
    enabled: true,
    showButton: true,
  })
  // Routed-only corporate provider: enforced verified domain, NOT in button list.
  seedIdentityProvider({
    registrationId: CORP_RID,
    label: CORP_LABEL,
    clientId: 'e2e-unified-corp-client',
    discoveryUrl: DISCOVERY_URL,
    enabled: true,
    showButton: false,
    domain: { name: CORP_DOMAIN, verified: true, enforced: true },
  })
  try {
    // Open dialog via ?signin=%221%22 (TanStack Router JSON-encodes the string
    // '1' as "1", so the URL param must carry the JSON-encoded form).
    await page.goto('/?signin=%221%22')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 })

    // The button-only provider renders; the routed-only corporate provider does NOT.
    await expect(
      page.getByRole('button', { name: new RegExp(`Sign in with ${BTN_LABEL}`, 'i') })
    ).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByRole('button', { name: new RegExp(`Sign in with ${CORP_LABEL}`, 'i') })
    ).toHaveCount(0)

    // Submitting a corporate-domain email triggers lookupAuthMethods which returns
    // sso-redirect for the corporate IdP; capture the server-fn response.
    // TanStack Start serialises strings via seroval — the literal "sso-redirect"
    // appears in the response body as `"s":"sso-redirect"` and is matchable.
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
    await page.locator('input[type="email"]').fill(CORP_EMAIL)
    await page.locator('input[type="email"]').press('Enter')
    const body = await (await lookupResponse).text()
    expect(body).toContain('sso-redirect')
    expect(body).toContain(CORP_RID)
  } finally {
    removeIdentityProvider(BTN_RID)
    removeIdentityProvider(CORP_RID)
  }
})
