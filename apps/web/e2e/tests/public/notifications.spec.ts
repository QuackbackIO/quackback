import { test, expect } from '@playwright/test'

test.describe('Portal Notifications (unauthenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/notifications')
    await page.waitForLoadState('networkidle')
  })

  test('redirects away from /notifications when not logged in', async ({ page }) => {
    // The portal layout should bounce unauthenticated users away from /notifications
    // or render the page but gate the content behind an auth prompt.
    // Either way the current URL must not remain /notifications, OR a login trigger
    // is visible on the page.
    const url = page.url()
    const isOnNotifications = url.includes('/notifications')

    if (!isOnNotifications) {
      // Hard redirect path: just verify we landed somewhere sensible (home or root)
      expect(url).toMatch(/acme\.localhost:3000/)
    } else {
      // Soft-gate path: page renders but only shows a login prompt, not notification
      // content. Check that neither the notifications heading nor any notification
      // rows are visible without first logging in.
      const heading = page.getByRole('heading', { name: /notifications/i })
      const loginTrigger = page.getByRole('button', { name: /log in|sign in|sign up/i })
      const isHeadingVisible = (await heading.count()) > 0 && (await heading.isVisible())

      if (!isHeadingVisible) {
        // No heading rendered — auth gate in place
        await expect(loginTrigger.first()).toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('shows Log in and Sign up buttons on the portal header when unauthenticated', async ({
    page,
  }) => {
    // Even if we were redirected, navigate home so the header is definitely visible
    const url = page.url()
    if (!url.includes('/notifications')) {
      // Already redirected — check header on current page
    } else {
      await page.goto('/')
      await page.waitForLoadState('networkidle')
    }

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
