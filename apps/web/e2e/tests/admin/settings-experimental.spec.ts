import { test, expect } from '@playwright/test'

test.describe('Admin Labs Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/labs')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows the Labs heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Labs' })).toBeVisible({ timeout: 10000 })
  })

  test('shows Connectors and Skills as the remaining lab flags', async ({ page }) => {
    await expect(page.getByText('Connectors', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Skills', { exact: true })).toBeVisible()
    await expect(page.locator('#flag-assistantConnectors')).toBeVisible()
    await expect(page.locator('#flag-assistantSkills')).toBeVisible()
  })

  test('does not show retired lab flags', async ({ page }) => {
    await expect(page.getByText('Assistant actions')).toHaveCount(0)
    await expect(page.locator('#flag-visitorAnalytics')).toHaveCount(0)
    await expect(page.locator('#flag-helpCenterAiAnswers')).toHaveCount(0)
  })
})
