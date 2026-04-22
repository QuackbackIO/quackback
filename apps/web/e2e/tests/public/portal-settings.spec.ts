import { test, expect } from '@playwright/test'

/**
 * Portal Settings E2E tests — unauthenticated access.
 *
 * These tests verify that settings pages are protected and that an unauthenticated
 * visitor is redirected away rather than served the settings UI.
 *
 * The settings layout (`/_portal/settings`) redirects to `/` when there is no
 * session. `/settings/` itself further redirects to `/settings/profile`.
 * Neither destination should be accessible without a logged-in portal user.
 */

test.describe('Portal Settings — unauthenticated access', () => {
  // -------------------------------------------------------------------------
  // /settings redirect behaviour
  // -------------------------------------------------------------------------

  test('navigating to /settings redirects unauthenticated visitor away from settings', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The settings layout redirects to "/" when there is no session.
    // We should NOT end up on a /settings path.
    await expect(page).not.toHaveURL(/\/settings/)
  })

  test('navigating to /settings/profile redirects unauthenticated visitor away', async ({
    page,
  }) => {
    await page.goto('/settings/profile')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/\/settings/)
  })

  test('navigating to /settings/preferences redirects unauthenticated visitor away', async ({
    page,
  }) => {
    await page.goto('/settings/preferences')
    await page.waitForLoadState('networkidle')

    await expect(page).not.toHaveURL(/\/settings/)
  })

  // -------------------------------------------------------------------------
  // Redirect destination is the public portal homepage
  // -------------------------------------------------------------------------

  test('/settings redirect lands on the public portal homepage', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // The beforeLoad guard throws redirect({ to: '/' }); URL may include default search params
    await expect(page).toHaveURL(/^http:\/\/acme\.localhost:3000\//)
  })

  test('/settings/profile redirect lands on the public portal homepage', async ({ page }) => {
    await page.goto('/settings/profile')
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/^http:\/\/acme\.localhost:3000\//)
  })

  // -------------------------------------------------------------------------
  // Portal homepage shows auth options (not settings UI)
  // -------------------------------------------------------------------------

  test('after redirect, the portal shows "Log in" button for unauthenticated users', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Portal header renders a "Log in" button when no session is present
    await expect(page.getByRole('button', { name: /Log in/i })).toBeVisible()
  })

  test('after redirect, the portal shows "Sign up" button for unauthenticated users', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('button', { name: /Sign up/i })).toBeVisible()
  })

  test('settings UI (Profile heading) is not visible after redirect', async ({ page }) => {
    await page.goto('/settings/profile')
    await page.waitForLoadState('networkidle')

    // The Profile settings page renders an h1 / page header titled "Profile".
    // It must not be shown to unauthenticated users.
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).not.toBeVisible()
  })

  test('settings UI (Preferences heading) is not visible after redirect', async ({ page }) => {
    await page.goto('/settings/preferences')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Preferences', exact: true })).not.toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Auth dialog triggered from portal homepage
  // -------------------------------------------------------------------------

  test('clicking "Log in" opens the auth dialog', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const logInButton = page.getByRole('button', { name: /Log in/i })
    await expect(logInButton).toBeVisible()
    await logInButton.click()

    // Auth dialog renders with title "Welcome back"
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Welcome back')).toBeVisible()
  })

  test('clicking "Sign up" opens the auth dialog in signup mode', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const signUpButton = page.getByRole('button', { name: /Sign up/i })
    await expect(signUpButton).toBeVisible()
    await signUpButton.click()

    // Auth dialog renders with title "Create an account" in signup mode
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Create an account')).toBeVisible()
  })
})
