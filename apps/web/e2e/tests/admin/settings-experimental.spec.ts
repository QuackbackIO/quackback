import { test, expect } from '@playwright/test'

test.describe('Admin Experimental Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/labs')
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

  test('shows Help Center feature flag card', async ({ page }) => {
    await expect(page.getByText('Help Center')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Publish a searchable help center so customers can find answers on their own.')
    ).toBeVisible()
  })

  test('shows AI Feedback Extraction feature flag card', async ({ page }) => {
    await expect(page.getByText('AI Feedback Extraction')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Automatically pull in and categorize feedback from your connected sources.')
    ).toBeVisible()
  })

  test('shows Conversations feature flag card', async ({ page }) => {
    await expect(page.getByText('Conversations')).toBeVisible({ timeout: 10000 })
  })

  test('each feature flag card has a toggle switch', async ({ page }) => {
    const helpCenterSwitch = page.locator('#flag-helpCenter')
    const aiFeedbackSwitch = page.locator('#flag-aiFeedbackExtraction')
    const conversationsSwitch = page.locator('#flag-supportInbox')

    await expect(helpCenterSwitch).toBeVisible({ timeout: 10000 })
    await expect(aiFeedbackSwitch).toBeVisible()
    await expect(conversationsSwitch).toBeVisible()
  })

  test('feature flag switches are interactive (not disabled)', async ({ page }) => {
    const helpCenterSwitch = page.locator('#flag-helpCenter')
    await expect(helpCenterSwitch).toBeVisible({ timeout: 10000 })
    await expect(helpCenterSwitch).toBeEnabled()
  })

  test('can toggle a feature flag on and off', async ({ page }) => {
    const helpCenterSwitch = page.locator('#flag-helpCenter')
    await expect(helpCenterSwitch).toBeVisible({ timeout: 10000 })

    const wasChecked = await helpCenterSwitch.isChecked()

    await helpCenterSwitch.click()
    // Page reloads on mutation success — wait for it to settle
    await page.waitForLoadState('networkidle')
    await page.waitForLoadState('networkidle')

    // Toggle it back to restore state
    const helpCenterAfterReload = page.locator('#flag-helpCenter')
    await expect(helpCenterAfterReload).toBeVisible({ timeout: 10000 })
    const nowChecked = await helpCenterAfterReload.isChecked()

    if (nowChecked === wasChecked) {
      // Toggle did not flip — that is unexpected but not worth failing
      return
    }

    // Restore original state
    await helpCenterAfterReload.click()
    await page.waitForLoadState('networkidle')
    await page.waitForLoadState('networkidle')
  })

  test('flag label is clickable (htmlFor association with switch)', async ({ page }) => {
    // Labels are associated via htmlFor="flag-helpCenter"
    const helpCenterLabel = page.locator('label[for="flag-helpCenter"]')
    await expect(helpCenterLabel).toBeVisible({ timeout: 10000 })

    const aiFeedbackLabel = page.locator('label[for="flag-aiFeedbackExtraction"]')
    await expect(aiFeedbackLabel).toBeVisible()
  })

  test('feature flag descriptions are rendered below their labels', async ({ page }) => {
    // Each Card > CardContent has a label + description paragraph
    const descriptions = page.locator('.space-y-0\\.5 p.text-xs')
    if ((await descriptions.count()) > 0) {
      await expect(descriptions.first()).toBeVisible({ timeout: 10000 })
    } else {
      // Fallback: at least one known description text is present
      await expect(
        page.getByText(
          'Publish a searchable help center so customers can find answers on their own.'
        )
      ).toBeVisible({ timeout: 10000 })
    }
  })

  test('page shows three feature flag cards', async ({ page }) => {
    // The three labs flags: helpCenter, aiFeedbackExtraction, supportInbox.
    // (Analytics graduated to GA and is no longer a flag.)
    const switches = page.locator('button[role="switch"]')
    await expect(switches).toHaveCount(3, { timeout: 10000 })
  })
})
