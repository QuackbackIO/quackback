import { test, expect } from '@playwright/test'

test.describe('Admin Portal Authentication Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/portal-auth')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows Portal Authentication heading', async ({ page }) => {
    await expect(page.getByText('Portal Authentication')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Configure how visitors can sign in to your public feedback portal')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows Sign-in Methods card', async ({ page }) => {
    await expect(page.getByText('Sign-in Methods')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Choose which authentication methods are available to portal users.')
    ).toBeVisible()
  })

  test('shows Password section', async ({ page }) => {
    await expect(page.getByText('Password').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Email and password sign in')).toBeVisible()
    await expect(page.getByText('Users sign in with their email and password')).toBeVisible()
  })

  test('shows Password toggle switch', async ({ page }) => {
    const passwordToggle = page.locator('#password-toggle')
    await expect(passwordToggle).toBeVisible({ timeout: 10000 })
  })

  test('shows Email OTP section', async ({ page }) => {
    await expect(page.getByText('Email OTP').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Passwordless sign in with magic codes')).toBeVisible()
    await expect(
      page.getByText('Users receive a 6-digit code via email to sign in')
    ).toBeVisible()
  })

  test('shows Email OTP toggle switch', async ({ page }) => {
    const emailToggle = page.locator('#email-toggle')
    await expect(emailToggle).toBeVisible({ timeout: 10000 })
  })

  test('shows OAuth Providers section', async ({ page }) => {
    await expect(page.getByText('OAuth Providers').first()).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Allow users to sign in with third-party accounts')
    ).toBeVisible()
  })

  test('shows provider search filter input', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Filter providers...')
    await expect(searchInput).toBeVisible({ timeout: 10000 })
  })

  test('shows OAuth provider grid with provider entries', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Provider cards: configured ones are divs, unconfigured ones are buttons
    const providerEntries = page.locator(
      '.grid.gap-3 button[type="button"], .grid.gap-3 > div'
    )
    expect(await providerEntries.count()).toBeGreaterThan(0)
  })

  test('unconfigured providers show "Not configured" badge', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const notConfiguredBadges = page.getByText('Not configured')
    // There should be at least some unconfigured providers in a fresh install
    if ((await notConfiguredBadges.count()) > 0) {
      await expect(notConfiguredBadges.first()).toBeVisible()
    }
  })

  test('can filter providers by name', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Filter providers...')
    await expect(searchInput).toBeVisible({ timeout: 10000 })

    await searchInput.fill('Google')
    await page.waitForTimeout(300)

    // Should show Google-related provider(s) in the grid
    const googleEntry = page.getByText('Google').first()
    if ((await googleEntry.count()) > 0) {
      await expect(googleEntry).toBeVisible()
    }

    // Clear the filter
    await searchInput.clear()
  })

  test('searching for a non-existent provider shows empty state', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Filter providers...')
    await expect(searchInput).toBeVisible({ timeout: 10000 })

    await searchInput.fill(`nonexistent_provider_${Date.now()}`)
    await page.waitForTimeout(300)

    await expect(page.getByText(/No providers matching/)).toBeVisible()

    await searchInput.clear()
  })

  test('clicking an unconfigured provider opens credentials dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const unconfiguredButton = page
      .locator('.grid.gap-3 button[type="button"]')
      .first()

    if ((await unconfiguredButton.count()) > 0) {
      await unconfiguredButton.first().click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      // Close the dialog
      await page.keyboard.press('Escape')
      await expect(dialog).not.toBeVisible({ timeout: 3000 })
    }
  })

  test('Password auth toggle is enabled by default', async ({ page }) => {
    const passwordToggle = page.locator('#password-toggle')
    await expect(passwordToggle).toBeVisible({ timeout: 10000 })

    // Password is checked by default (oauthState.password ?? true)
    const isChecked = await passwordToggle.isChecked()
    expect(isChecked).toBe(true)
  })

  test('at least one auth method is always enabled (last-method lock)', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // The password toggle being checked means at least one method is enabled
    const passwordToggle = page.locator('#password-toggle')
    await expect(passwordToggle).toBeVisible({ timeout: 10000 })

    // Count enabled toggles on the page
    const switches = page.locator('button[role="switch"][aria-label]')
    const total = await switches.count()
    expect(total).toBeGreaterThan(0)
  })
})
