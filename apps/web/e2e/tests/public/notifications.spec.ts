import { test, expect } from '@playwright/test'

test.describe('Portal Notifications (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/notifications')
    await page.waitForLoadState('networkidle')
  })

  test('sends a signed-out visitor to sign in, and back to /notifications after', async ({
    page,
    baseURL,
  }) => {
    // Like the other signed-in-only portal pages, the page itself never shows:
    // the visitor lands on the portal home with the sign-in dialog open.
    const url = new URL(page.url())
    expect(url.origin).toBe(new URL(baseURL!).origin)
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('auth')).toBe('signin')
    expect(url.searchParams.get('callbackUrl')).toBe('/notifications')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /^notifications/i })).toHaveCount(0)

    // Signing in from that dialog lands back on the page (the seeded demo user).
    await dialog.getByLabel('Email').fill('demo@example.com')
    await dialog.getByRole('button', { name: /continue/i }).click()
    await dialog.getByLabel(/^password$/i).fill('password')
    await dialog.getByRole('button', { name: /^sign in$/i }).click()
    await expect(page).toHaveURL(/\/notifications$/, { timeout: 15000 })
    await expect(page.getByRole('heading', { name: /^notifications/i })).toBeVisible()
  })

  test('shows Log in and Sign up buttons on the portal header when unauthenticated', async ({
    page,
  }) => {
    // The redirect opens the sign-in dialog; check the header on a plain home page.
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const logInButton = page.getByRole('button', { name: /log in/i })
    const signUpButton = page.getByRole('button', { name: /sign up/i })

    await expect(logInButton.first()).toBeVisible({ timeout: 10000 })
    await expect(signUpButton.first()).toBeVisible({ timeout: 10000 })
  })

  test('notification bell icon is not shown when unauthenticated', async ({ page }) => {
    // The NotificationBell component is only rendered for logged-in users
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // The bell sits next to the avatar; it should be absent for anonymous visitors
    const bell = page.locator('[aria-label*="notification" i], [data-testid*="notification-bell"]')
    if ((await bell.count()) > 0) {
      await expect(bell.first()).not.toBeVisible()
    }
  })
})
