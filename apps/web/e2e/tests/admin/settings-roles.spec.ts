import { test, expect } from '@playwright/test'

test.describe('Admin Roles Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/members?tab=roles')
    await page.waitForLoadState('networkidle')
  })

  test('displays the four preset roles', async ({ page }) => {
    for (const name of ['Owner', 'Admin', 'Manager', 'Contributor']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 10000 })
    }
    await expect(page.getByText('Preset').first()).toBeVisible()
  })

  test('expands a preset to show its permission keys', async ({ page }) => {
    await page.getByText('Contributor', { exact: true }).first().click()
    await expect(page.getByText('post.view_private').first()).toBeVisible({ timeout: 10000 })
  })

  test('duplicate, edit, save, and delete a custom role end to end', async ({ page }) => {
    const roleName = `E2E Role ${Date.now().toString(36)}`

    // Duplicate the Manager preset.
    const managerCard = page.locator('div.rounded-lg.border').filter({ hasText: 'Manager' }).first()
    await managerCard.getByRole('button', { name: 'Duplicate' }).click()
    const nameInput = page.getByLabel('Name')
    await nameInput.fill(roleName)
    await page.getByRole('button', { name: 'Create & edit' }).click()

    // Lands in the editor with the duplicated set staged.
    await expect(page.getByDisplayValue(roleName)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/of \d+ granted/).first()).toBeVisible()

    // Toggle one permission off and save.
    await page.getByLabel('post.view_private', { exact: true }).click()
    await page.getByRole('button', { name: 'Save role' }).click()

    // Back on the roles tab, the custom card exists.
    const customCard = page.locator('div.rounded-lg.border').filter({ hasText: roleName }).first()
    await expect(customCard).toBeVisible({ timeout: 15000 })
    await expect(customCard.getByText('Custom')).toBeVisible()

    // Delete it (no holders, so no reassignment needed).
    await customCard.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete role' }).click()
    await expect(page.getByText(roleName)).toHaveCount(0, { timeout: 15000 })
  })
})
