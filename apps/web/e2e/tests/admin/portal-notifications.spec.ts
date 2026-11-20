import { test, expect } from '@playwright/test'

test('a signed-in person opens the portal Notifications page', async ({ page }) => {
  await page.goto('/notifications')
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByRole('heading', { name: /^notifications/i })).toBeVisible({
    timeout: 10000,
  })
})
