/**
 * Unified login e2e — Phase 1 capstone.
 *
 * Covers:
 *  (a) Unauthenticated /admin → /auth/login?callbackUrl=/admin, team form visible
 *  (b) Admin magic-link sign-in with callbackUrl=/admin lands on /admin
 *  (c) Portal-only user reaching /admin bounced to /auth/login with not_team_member error
 *  (d) With all portal public sign-in methods disabled, team break-glass form still
 *      shows email input + magic-link affordance + /auth/recovery recovery-code link
 *  (e) /auth/login?callbackUrl=/complete-signup/<id> serves the team form, not portal form
 *
 * Tests manage their own auth state (no stored state injected by Playwright config).
 */
import { test, expect } from '@playwright/test'
import {
  loginViaMagicLink,
  setPortalAuthMethods,
  flushMagicLinkRateLimit,
} from '../../utils/access-helpers'
import { getMagicLinkToken } from '../../utils/db-helpers'

const ADMIN_EMAIL = 'demo@example.com'
const PORTAL_EMAIL = 'e2e-portal-only@example.test'

// Run serially: magic-link rate limit is per-email; serialising avoids
// two tests racing on the same email address.
test.describe.configure({ mode: 'serial' })

// Clear per-email magic-link rate-limit keys before the suite so repeated
// runs on the same addresses don't flake.
test.beforeAll(() => {
  flushMagicLinkRateLimit()
})

test.beforeEach(async ({ page }) => {
  // Always start from a clean session so these cases are independent.
  await page.context().clearCookies()
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
})

// (a) Unauthenticated /admin redirect → team form on /auth/login
test('(a) unauthenticated /admin redirects to /auth/login with team form', async ({ page }) => {
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  // Must land on /auth/login with callbackUrl=/admin
  await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15000 })
  const url = new URL(page.url())
  expect(url.searchParams.get('callbackUrl')).toMatch(/^\/admin/)

  // Team form: email input must be visible
  const emailInput = page.locator('input[type="email"]')
  await expect(emailInput).toBeVisible({ timeout: 10000 })

  // Recovery code link (break-glass escape hatch) must be present
  const recoveryLink = page.getByRole('link', { name: /recovery code/i })
  await expect(recoveryLink).toBeVisible()
  await expect(recoveryLink).toHaveAttribute('href', /\/auth\/recovery/)
})

// (b) Admin sign-in via magic-link with callbackUrl=/admin lands on /admin
test('(b) admin magic-link sign-in with callbackUrl=/admin lands on /admin', async ({ context }) => {
  // Trigger the magic-link (same pattern as global-setup)
  const request = context.request
  const send = await request.post('/api/auth/sign-in/magic-link', {
    data: { email: ADMIN_EMAIL, callbackURL: '/admin' },
  })
  expect(send.ok(), 'magic-link send should succeed').toBeTruthy()

  const token = getMagicLinkToken(ADMIN_EMAIL)
  expect(token.length).toBeGreaterThan(8)

  const verify = await request.get(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/admin')}`,
    { maxRedirects: 10 }
  )
  expect(verify.ok(), 'magic-link verify should succeed').toBeTruthy()

  // Session cookie is now set on the context — navigate to /admin
  const page = await context.newPage()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin/, { timeout: 15000 })
  // Admin nav is the concrete signal that the shell hydrated with admin auth
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15000 })
  await page.close()
})

// (c) Portal-only user reaching /admin is bounced with not_team_member error
test('(c) portal user reaching /admin bounced with not_team_member error', async ({ context }) => {
  // Sign in as a portal-only user (role='user' — not admin/member). Passing the
  // role explicitly ensures the account is never accidentally promoted so the
  // not_team_member bounce is genuine, not a false pass via case (a)'s unauth redirect.
  //
  // Portal magic-link is off by default; the auth hook blocks magic-link sends for
  // existing role='user' principals, so we enable it just for this setup call then
  // restore. On first run the user doesn't exist yet and bypasses the hook; on
  // repeat runs this prevents a silent "no token in DB" failure.
  setPortalAuthMethods('enable-magic-link')
  try {
    await loginViaMagicLink(context, PORTAL_EMAIL, { role: 'user' })
  } finally {
    setPortalAuthMethods('restore')
  }

  const page = await context.newPage()
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')

  // Must be bounced back to /auth/login with error=not_team_member
  await expect(page).toHaveURL(/\/auth\/login/, { timeout: 15000 })
  const url = new URL(page.url())
  expect(url.searchParams.get('error')).toBe('not_team_member')

  // The error message from AUTH_BLOCK_MESSAGES['not_team_member'] must render
  await expect(page.getByText(/team membership is by invitation only/i)).toBeVisible({
    timeout: 10000,
  })
  await page.close()
})

// (d) Team break-glass: email input + magic-link affordance visible even when
//     ALL portal public sign-in methods are disabled.
//     Invariant: team members must never be locked out by an admin turning off
//     public portal auth — the TeamLoginForm is always served for team-bound URLs.
test('(d) team break-glass form visible with all portal auth methods disabled', async ({
  page,
}) => {
  setPortalAuthMethods('disable')
  try {
    await page.goto('/auth/login?callbackUrl=%2Fadmin')
    await page.waitForLoadState('networkidle')

    // Team form must render regardless of portal method settings
    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible({ timeout: 15000 })

    // Continue button is the magic-link affordance (stage 1 of TeamLoginForm)
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible()

    // Recovery code link confirms break-glass path is intact
    const recoveryLink = page.getByRole('link', { name: /recovery code/i })
    await expect(recoveryLink).toBeVisible()
    await expect(recoveryLink).toHaveAttribute('href', /\/auth\/recovery/)
  } finally {
    // Always restore so subsequent tests and dev sessions aren't left with a
    // broken portal, even on assertion failure.
    setPortalAuthMethods('restore')
  }
})

// (e) /auth/login?callbackUrl=/complete-signup/<id> serves the team form
test('(e) /auth/login with complete-signup callbackUrl serves team form', async ({ page }) => {
  // Using a synthetic invitation id — the /auth/login loader only reads callbackUrl
  // to call isTeamCallback(); it does NOT fetch or validate the invitation record.
  // (Confirmed: auth.login.tsx loader calls isSafeCallbackUrl + isTeamCallback only.)
  const fakeId = '01jz000000faketest000000000'
  await page.goto(`/auth/login?callbackUrl=%2Fcomplete-signup%2F${fakeId}`)
  await page.waitForLoadState('networkidle')

  // isTeamCallback('/complete-signup/<id>') === true → TeamLoginForm must render
  const emailInput = page.locator('input[type="email"]')
  await expect(emailInput).toBeVisible({ timeout: 15000 })

  // Continue button (stage 1 of TeamLoginForm) must be present
  await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible()

  // Recovery code link confirms this is the team form path
  await expect(page.getByRole('link', { name: /recovery code/i })).toBeVisible()

  // Must NOT show the portal "Welcome back" heading (that's the portal form)
  await expect(page.getByRole('heading', { name: /welcome back/i })).not.toBeVisible()
})
