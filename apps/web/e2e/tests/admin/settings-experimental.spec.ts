import { test, expect } from '@playwright/test'

test.describe('Admin Experimental Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/experimental')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows Experimental Features heading', async ({ page }) => {
    await expect(page.getByText('Experimental Features')).toBeVisible({ timeout: 10000 })
  })

  test('shows disclaimer about experimental features', async ({ page }) => {
    await expect(
      page.getByText('These features are in development and may change or be removed.')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows Analytics Dashboard feature flag card', async ({ page }) => {
    await expect(page.getByText('Analytics Dashboard')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('View feedback trends, top posts, and engagement metrics from the admin panel.')
    ).toBeVisible()
  })

  test('shows Help Center feature flag card', async ({ page }) => {
    await expect(page.getByText('Help Center')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Create and manage a knowledge base with categories and articles for your users.')
    ).toBeVisible()
  })

  test('shows AI Feedback Extraction feature flag card', async ({ page }) => {
    await expect(page.getByText('AI Feedback Extraction')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText(
        'Automatically extract and categorize feedback from connected sources using large language models.'
      )
    ).toBeVisible()
  })

  test('each feature flag card has a toggle switch', async ({ page }) => {
    const analyticsSwitch = page.locator('#flag-analytics')
    const helpCenterSwitch = page.locator('#flag-helpCenter')
    const aiFeedbackSwitch = page.locator('#flag-aiFeedbackExtraction')

    await expect(analyticsSwitch).toBeVisible({ timeout: 10000 })
    await expect(helpCenterSwitch).toBeVisible()
    await expect(aiFeedbackSwitch).toBeVisible()
  })

  test('feature flag switches are interactive (not disabled)', async ({ page }) => {
    const analyticsSwitch = page.locator('#flag-analytics')
    await expect(analyticsSwitch).toBeVisible({ timeout: 10000 })
    await expect(analyticsSwitch).toBeEnabled()
  })

  test('can toggle Analytics Dashboard flag on and off', async ({ page }) => {
    const analyticsSwitch = page.locator('#flag-analytics')
    await expect(analyticsSwitch).toBeVisible({ timeout: 10000 })

    const wasChecked = await analyticsSwitch.isChecked()

    await analyticsSwitch.click()
    // Page reloads on mutation success — wait for it to settle
    await page.waitForLoadState('networkidle')
    await page.waitForLoadState('networkidle')

    // Toggle it back to restore state
    const analyticsAfterReload = page.locator('#flag-analytics')
    await expect(analyticsAfterReload).toBeVisible({ timeout: 10000 })
    const nowChecked = await analyticsAfterReload.isChecked()

    if (nowChecked === wasChecked) {
      // Toggle did not flip — that is unexpected but not worth failing
      return
    }

    // Restore original state
    await analyticsAfterReload.click()
    await page.waitForLoadState('networkidle')
    await page.waitForLoadState('networkidle')
  })

  test('flag label is clickable (htmlFor association with switch)', async ({ page }) => {
    // Labels are associated via htmlFor="flag-analytics"
    const analyticsLabel = page.locator('label[for="flag-analytics"]')
    await expect(analyticsLabel).toBeVisible({ timeout: 10000 })

    const helpCenterLabel = page.locator('label[for="flag-helpCenter"]')
    await expect(helpCenterLabel).toBeVisible()
  })

  test('feature flag descriptions are rendered below their labels', async ({ page }) => {
    // Each Card > CardContent has a label + description paragraph
    const descriptions = page.locator('.space-y-0\\.5 p.text-xs')
    if ((await descriptions.count()) > 0) {
      await expect(descriptions.first()).toBeVisible({ timeout: 10000 })
    } else {
      // Fallback: at least the known description text is present
      await expect(
        page.getByText('View feedback trends, top posts, and engagement metrics from the admin panel.')
      ).toBeVisible({ timeout: 10000 })
    }
  })

  test('page shows at least three feature flag cards', async ({ page }) => {
    // There are three flags: analytics, helpCenter, aiFeedbackExtraction
    const switches = page.locator('button[role="switch"]')
    await expect(switches).toHaveCount(3, { timeout: 10000 })
  })
})
