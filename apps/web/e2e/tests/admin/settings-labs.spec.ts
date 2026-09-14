import { test, expect } from '@playwright/test'

test.describe('Admin Labs Settings', () => {
  test('Labs is in settings navigation and empty until an operator reveals an experiment', async ({
    page,
  }) => {
    await page.goto('/admin/settings/labs')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Labs' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('No experiments are available right now.')).toBeVisible()
    await expect(page.getByText('Refreshed UI')).toHaveCount(0)
    await expect(page.locator('html')).not.toHaveAttribute('data-visual-theme', 'refined')
  })
})
