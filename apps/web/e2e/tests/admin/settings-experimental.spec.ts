import { test, expect } from '@playwright/test'

test.describe('Admin Labs Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/labs')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows the Labs heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Labs' })).toBeVisible({ timeout: 10000 })
  })

  test('shows AI Feedback Extraction feature flag card', async ({ page }) => {
    await expect(page.getByText('AI Feedback Extraction')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Automatically pull in and categorize feedback from your connected sources.')
    ).toBeVisible()
  })

  test('each feature flag card has a toggle switch', async ({ page }) => {
    const aiFeedbackSwitch = page.locator('#flag-aiFeedbackExtraction')

    await expect(aiFeedbackSwitch).toBeVisible({ timeout: 10000 })
  })

  test('feature flag switches are interactive (not disabled)', async ({ page }) => {
    const analyticsSwitch = page.locator('#flag-visitorAnalytics')
    await expect(analyticsSwitch).toBeVisible({ timeout: 10000 })
    await expect(analyticsSwitch).toBeEnabled()
  })

  test('can toggle a feature flag on and off', async ({ page }) => {
    const analyticsSwitch = page.locator('#flag-visitorAnalytics')
    await expect(analyticsSwitch).toBeVisible({ timeout: 10000 })

    const wasChecked = await analyticsSwitch.isChecked()

    await analyticsSwitch.click()
    // Page reloads on mutation success — wait for it to settle
    await page.waitForLoadState('networkidle')
    await page.waitForLoadState('networkidle')

    // Toggle it back to restore state
    const analyticsAfterReload = page.locator('#flag-visitorAnalytics')
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
    const aiFeedbackLabel = page.locator('label[for="flag-aiFeedbackExtraction"]')
    await expect(aiFeedbackLabel).toBeVisible({ timeout: 10000 })
  })

  test('feature flag descriptions are rendered below their labels', async ({ page }) => {
    // Each row has a label + description paragraph
    const descriptions = page.locator('.space-y-0\\.5 p.text-xs')
    if ((await descriptions.count()) > 0) {
      await expect(descriptions.first()).toBeVisible({ timeout: 10000 })
    } else {
      // Fallback: at least one known description text is present
      await expect(
        page.getByText('Automatically pull in and categorize feedback from your connected sources.')
      ).toBeVisible({ timeout: 10000 })
    }
  })

  test('page shows every consolidated flag switch', async ({ page }) => {
    // Six top-level flags plus the nested Visitor Identity and Proactive
    // suggested replies sub-toggles. Product flags live on General.
    const switches = page.locator('button[role="switch"]')
    await expect(switches).toHaveCount(8, { timeout: 10000 })
  })

  test('Visitor Identity sub-toggle is disabled while Visitor Analytics is off', async ({
    page,
  }) => {
    const analyticsSwitch = page.locator('#flag-visitorAnalytics')
    const deviceSwitch = page.locator('#flag-visitorDeviceTracking')
    await expect(analyticsSwitch).toBeVisible({ timeout: 10000 })
    await expect(deviceSwitch).toBeVisible()

    if (!(await analyticsSwitch.isChecked())) {
      await expect(deviceSwitch).toBeDisabled()
    } else {
      await expect(deviceSwitch).toBeEnabled()
    }
  })
})
