import { test, expect } from '@playwright/test'

test.describe('Admin Labs Settings', () => {
  test('Labs offers the Copilot on Home switch', async ({ page }) => {
    await page.goto('/admin/settings/labs')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Labs' })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByRole('switch', { name: 'Copilot on Home' })).toBeVisible()
    await expect(page.getByText('Ask questions and propose changes from Home.')).toBeVisible()
  })
})
