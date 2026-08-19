import { test, expect } from '@playwright/test'

test.describe('Admin Roles Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/members?tab=roles')
    await page.waitForLoadState('networkidle')
  })

  test('displays the four preset roles as cards', async ({ page }) => {
    for (const name of ['Owner', 'Admin', 'Manager', 'Contributor']) {
      await expect(page.getByRole('link', { name: new RegExp(name) }).first()).toBeVisible({
        timeout: 10000,
      })
    }
    await expect(page.getByText('Preset').first()).toBeVisible()
  })

  test('clicking a preset opens its read-only detail page', async ({ page }) => {
    await page
      .getByRole('link', { name: /Contributor/ })
      .first()
      .click()

    // Read-only: a heading (not an editable name field), a Duplicate action,
    // and no Save button.
    await expect(page.getByRole('heading', { name: 'Contributor' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('button', { name: 'Duplicate' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save role' })).toHaveCount(0)

    // Its permissions are browsable (categories expand).
    await page.getByRole('button', { name: /Feedback/ }).click()
    await expect(page.getByText('post.view_private').first()).toBeVisible({ timeout: 10000 })
  })

  test('create via duplicate, edit, and delete a custom role end to end', async ({ page }) => {
    const roleName = `E2E Role ${Date.now().toString(36)}`

    // Open the Manager preset and duplicate it -> full-page create surface.
    await page
      .getByRole('link', { name: /Manager/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Duplicate' }).click()

    await expect(page.getByText('Start from')).toBeVisible({ timeout: 15000 })
    await page.getByLabel('Name').fill(roleName)
    await expect(page.getByText(/of \d+ selected/).first()).toBeVisible()

    // Trim one permission and create.
    await page.getByRole('button', { name: /Feedback/ }).click()
    await page.getByLabel('post.view_private', { exact: true }).click()
    await page.getByRole('button', { name: 'Create role' }).click()

    // Back on the tab, the custom card exists and links to its editor.
    const customCard = page.getByRole('link', { name: new RegExp(roleName) }).first()
    await expect(customCard).toBeVisible({ timeout: 15000 })
    await expect(customCard.getByText('Custom')).toBeVisible()

    // Open it and delete from the detail page (no holders -> no reassignment).
    await customCard.click()
    await expect(page.getByRole('button', { name: 'Save role' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete role' }).click()

    await expect(page.getByRole('link', { name: new RegExp(roleName) })).toHaveCount(0, {
      timeout: 15000,
    })
  })
})
