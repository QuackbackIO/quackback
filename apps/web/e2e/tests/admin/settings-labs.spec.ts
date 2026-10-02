import { test, expect } from '@playwright/test'

test.describe('Admin Labs Settings', () => {
  test('Labs shows an empty state while there are no experiments', async ({ page }) => {
    await page.goto('/admin/settings/labs')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { level: 1, name: 'Labs' })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByText('No experiments right now')).toBeVisible()
    await expect(
      page.getByText('Features you can try before they ship show up here.')
    ).toBeVisible()
  })
})
