import { test, expect } from '@playwright/test'

test.describe('Admin Portal Settings', () => {
  test('Settings > Portal summarises the look and leads to Customise', async ({ page }) => {
    await page.goto('/admin/settings/portal')
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Look and navigation')).toBeVisible()
    for (const label of [
      'Header',
      'Light and dark',
      'Main colour',
      'Font',
      'Corners',
      'Navigation',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
    await page.getByRole('link', { name: 'Customise' }).click()
    await expect(page).toHaveURL(/\/admin\/settings\/portal\/customise/)
  })

  test('/admin/settings/branding redirects to portal', async ({ page }) => {
    await page.goto('/admin/settings/branding')
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/settings\/portal/)
    await expect(page.getByRole('heading', { name: 'Portal' })).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Admin Portal Customise', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/portal/customise')
    await page.waitForLoadState('networkidle')
  })

  test('shows the sections and a live preview, without the app sidebar', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Customise' })).toBeVisible({ timeout: 10000 })
    for (const section of ['Colours', 'Font and shape', 'Header and tabs', 'Advanced CSS']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${section}`) })).toBeVisible()
    }
    await expect(page.locator('iframe[title="Portal preview"]')).toBeVisible()
    await expect(page.getByRole('link', { name: 'View portal' })).toHaveCount(0)
  })

  test('switches theme mode in Colours', async ({ page }) => {
    await page.getByRole('button', { name: /^Colours/ }).click()
    const dark = page.getByRole('radio', { name: 'Dark' })
    await dark.click()
    await expect(dark).toBeChecked()
    await page.getByRole('radio', { name: 'Visitor chooses' }).click()
    await expect(page.getByRole('radio', { name: 'Visitor chooses' })).toBeChecked()
  })

  test('publish waits for a change, and leaving with one asks first', async ({ page }) => {
    const publish = page.getByRole('button', { name: 'Publish' })
    await expect(publish).toBeDisabled()
    await page.getByRole('button', { name: /^Font and shape/ }).click()
    await page.getByRole('radio', { name: 'Match corners' }).click()
    await expect(publish).toBeEnabled()
    await expect(page.getByText('1 change')).toBeVisible()

    await page.getByRole('link', { name: 'Portal' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Leave without publishing?')
    await dialog.getByRole('button', { name: 'Keep editing' }).click()
    await expect(page).toHaveURL(/\/customise/)
  })

  test('Feedback tab is always on in Header and tabs', async ({ page }) => {
    await page.getByRole('button', { name: /^Header and tabs/ }).click()
    await expect(page.getByText('Always on').first()).toBeVisible({ timeout: 10000 })
  })

  test('opens the CSS editor beside the preview', async ({ page }) => {
    await page.getByRole('button', { name: /^Advanced CSS/ }).click()
    await page.getByRole('button', { name: 'Open the CSS editor' }).click()
    await expect(page.getByRole('link', { name: /tweakcn\.com/ })).toBeVisible()
    await expect(page.locator('iframe[title="Portal preview"]')).toBeVisible()
  })
})
