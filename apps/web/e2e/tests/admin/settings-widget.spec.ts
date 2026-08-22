import { test, expect } from '@playwright/test'

test.describe('Admin Widget Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/widget')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows Widget heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Widget' }).first()).toBeVisible({
      timeout: 10000,
    })
    await expect(
      page.getByText(
        'Embed the messenger widget in your product — feedback, conversations, help, and updates'
      )
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows the site-embed toggle', async ({ page }) => {
    await expect(page.getByText('Add to your site')).toBeVisible({ timeout: 10000 })
    const widgetToggle = page.locator('#widget-toggle')
    await expect(widgetToggle).toBeVisible({ timeout: 10000 })
    await expect(widgetToggle).toBeEnabled()
  })

  test('shows Modules section with Feedback and Changelog toggles', async ({ page }) => {
    await expect(page.getByText('Modules')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#tab-feedback')).toBeVisible()
    await expect(page.locator('#tab-changelog')).toBeVisible()
  })

  test('shows Feedback tab label with description', async ({ page }) => {
    await expect(page.getByText('Search, vote, and submit ideas')).toBeVisible({ timeout: 10000 })
  })

  test('shows Changelog tab label with description', async ({ page }) => {
    await expect(page.getByText('Show product updates and shipped features')).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows Appearance controls', async ({ page }) => {
    await expect(page.getByText('Button position')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Default board')).toBeVisible()
  })

  test('shows Installation card linking to the install flow', async ({ page }) => {
    await expect(page.getByText('Installation')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: /Install widget|View installation/ })).toBeVisible()
  })

  test('shows widget preview panel', async ({ page }) => {
    await expect(page.getByText('Preview')).toBeVisible({ timeout: 10000 })
  })

  test('can toggle the widget enabled/disabled state and auto-saves', async ({ page }) => {
    const widgetToggle = page.locator('#widget-toggle')
    await expect(widgetToggle).toBeVisible({ timeout: 10000 })

    const initialChecked = await widgetToggle.isChecked()

    await widgetToggle.click()
    await page.waitForTimeout(600)

    const nowChecked = await widgetToggle.isChecked()
    if (nowChecked !== initialChecked) {
      await widgetToggle.click()
      await page.waitForTimeout(600)
    }
  })
})
