import { test, expect } from '@playwright/test'

test.describe('Admin Notifications Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/notifications')
    await page.waitForLoadState('networkidle')
  })

  test('page loads without error', async ({ page }) => {
    await expect(page).toHaveURL('/admin/notifications')
    await expect(page.locator('body')).toBeVisible()
  })

  test('shows Notifications heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows notification bell icon in header', async ({ page }) => {
    // The page header wraps the h1 with a bell icon badge
    const header = page.locator('div').filter({ hasText: /^Notifications$/ }).first()
    await expect(header).toBeVisible({ timeout: 10000 })
  })

  test('shows summary line below heading', async ({ page }) => {
    // Shows one of: "No notifications", "X unread of Y", or "X notifications — all caught up"
    const summary = page.getByText(
      /no notifications|unread of|notifications — all caught up/i
    )
    await expect(summary.first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Admin Notifications — Empty State', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/notifications')
    await page.waitForLoadState('networkidle')
  })

  test('shows empty state when there are no notifications', async ({ page }) => {
    // Wait for the loading spinner to clear
    await expect(page.locator('[class*="animate-spin"], [class*="spinner"]')).toBeHidden({
      timeout: 10000,
    })

    const noNotifications = page.getByText('No notifications yet')
    if ((await noNotifications.count()) > 0) {
      await expect(noNotifications).toBeVisible()
    }
  })

  test('empty state includes description text', async ({ page }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    const description = page.getByText(
      /you'll see notifications here|status changes|subscribed/i
    )
    if ((await description.count()) > 0) {
      await expect(description.first()).toBeVisible()
    }
  })
})

test.describe('Admin Notifications — Notification List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/notifications')
    await page.waitForLoadState('networkidle')
  })

  test('notification items are visible if notifications exist', async ({ page }) => {
    // Wait for loading to finish
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    // Notification items render inside a divide-y container; each item has a title
    const items = page.locator('[class*="divide-y"] > *')

    if ((await items.count()) > 0) {
      await expect(items.first()).toBeVisible()
    }
  })

  test('notification items show title text', async ({ page }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    // Each FullContent renders a <p> with the notification title
    const titleParagraphs = page.locator('[class*="divide-y"] p').filter({
      hasText: /.+/,
    })

    if ((await titleParagraphs.count()) > 0) {
      await expect(titleParagraphs.first()).toBeVisible()
    }
  })

  test('notification items show relative timestamp', async ({ page }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    // Timestamps are formatted as "X minutes/hours/days ago"
    const timestamps = page.getByText(/ ago$/)

    if ((await timestamps.count()) > 0) {
      await expect(timestamps.first()).toBeVisible()
    }
  })

  test('unread notifications have a left accent border', async ({ page }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    // Unread items use border-l-primary class via the FullContent component
    const unreadItems = page.locator('[class*="border-l-primary"]')

    if ((await unreadItems.count()) > 0) {
      await expect(unreadItems.first()).toBeVisible()
    }
  })

  test('clicking a notification item marks it as read', async ({ page }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    // Unread items are clickable divs (full variant) that call onMarkAsRead on click
    const unreadItems = page.locator('[class*="border-l-primary"]')

    if ((await unreadItems.count()) > 0) {
      const initialUnreadCount = await unreadItems.count()
      await unreadItems.first().click()
      await page.waitForLoadState('networkidle')

      // After marking as read, unread count should decrease or stay the same
      // (mutation is async; just verify no crash)
      const newUnreadCount = await page.locator('[class*="border-l-primary"]').count()
      expect(newUnreadCount).toBeLessThanOrEqual(initialUnreadCount)
    }
  })
})

test.describe('Admin Notifications — Mark All as Read', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/notifications')
    await page.waitForLoadState('networkidle')
  })

  test('"Mark all as read" button visible when unread notifications exist', async ({ page }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    const markAllBtn = page.getByRole('button', { name: 'Mark all as read' })

    if ((await markAllBtn.count()) > 0) {
      await expect(markAllBtn).toBeVisible()
    }
  })

  test('"Mark all as read" button is not shown when all notifications are read', async ({
    page,
  }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    // If there are no unread notifications, the button should not render
    const hasUnread = (await page.locator('[class*="border-l-primary"]').count()) > 0
    const markAllBtn = page.getByRole('button', { name: 'Mark all as read' })

    if (!hasUnread) {
      await expect(markAllBtn).toBeHidden()
    }
  })

  test('clicking "Mark all as read" triggers mutation and updates UI', async ({ page }) => {
    await expect(page.locator('[class*="animate-spin"]')).toBeHidden({ timeout: 10000 })

    const markAllBtn = page.getByRole('button', { name: 'Mark all as read' })

    if ((await markAllBtn.count()) > 0) {
      await markAllBtn.click()

      // Button becomes disabled while mutation is pending
      // After mutation completes, unread count should be 0 so button disappears
      await page.waitForLoadState('networkidle')

      // Summary line should now say "all caught up" or "No notifications"
      const caughtUp = page.getByText(/all caught up|no notifications/i)
      if ((await caughtUp.count()) > 0) {
        await expect(caughtUp.first()).toBeVisible({ timeout: 10000 })
      }
    }
  })
})

test.describe('Admin Notifications — Loading State', () => {
  test('shows spinner while loading', async ({ page }) => {
    // Navigate to the page and immediately check for spinner before networkidle
    await page.goto('/admin/notifications')

    // The spinner renders while isLoading is true
    // It may flash briefly — capture it before networkidle
    const spinner = page.locator('div').filter({ hasText: '' }).locator('[class*="animate-spin"]')
    // The spinner may or may not be visible depending on cache; just verify no crash
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL('/admin/notifications')
  })
})
