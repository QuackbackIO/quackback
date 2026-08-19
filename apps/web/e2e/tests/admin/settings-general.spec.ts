import { test, expect } from '@playwright/test'

test.describe('Admin General Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/general')
    await page.waitForLoadState('networkidle')
  })

  test('shows one toggle for every workspace product', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible({ timeout: 10000 })

    for (const product of ['feedback', 'support', 'helpCenter', 'changelog', 'status']) {
      await expect(page.locator(`#product-${product}`)).toBeVisible()
    }

    await expect(page.locator('button[role="switch"]')).toHaveCount(5)
  })
})
