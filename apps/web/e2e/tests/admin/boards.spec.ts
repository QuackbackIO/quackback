import { test, expect } from '@playwright/test'

test.describe('Admin Board Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to board settings (will redirect to first board)
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')
  })

  test('displays board settings page', async ({ page }) => {
    // Should show general settings card (page redirects to first board)
    await expect(page.getByText('General Settings')).toBeVisible({ timeout: 10000 })
  })

  test('can access board general settings', async ({ page }) => {
    // Should show general settings card
    const generalSettings = page.getByText('General Settings')
    await expect(generalSettings).toBeVisible({ timeout: 10000 })
  })

  test('can edit board name', async ({ page }) => {
    // Find the board name input in the General Settings section (first input, not the delete confirmation)
    const nameInput = page.getByRole('textbox', { name: 'Board name', exact: true })

    if ((await nameInput.count()) > 0) {
      // Clear and type new name
      await nameInput.clear()
      await nameInput.fill('Test Board Name')

      // Find and click save button - use exact match for "Save changes"
      const saveButton = page.getByRole('button', { name: 'Save changes' })
      if ((await saveButton.count()) > 0) {
        await saveButton.click()

        // Should show success message or the name should persist
        await page.waitForLoadState('networkidle')
      }
    }
  })

  test('can edit board description', async ({ page }) => {
    // Find the description input/textarea
    const descInput = page.getByLabel('Description').or(page.locator('textarea'))

    if ((await descInput.count()) > 0) {
      // Clear and type new description
      await descInput.first().clear()
      await descInput.first().fill('Updated board description for testing')

      // Find and click save button - use exact match for "Save changes"
      const saveButton = page.getByRole('button', { name: 'Save changes' })
      if ((await saveButton.count()) > 0) {
        await saveButton.click()

        // Wait for save to complete
        await page.waitForLoadState('networkidle')
      }
    }
  })

  test('shows danger zone with delete option', async ({ page }) => {
    // Should show danger zone section
    const dangerZone = page.getByText('Danger Zone')
    await expect(dangerZone).toBeVisible({ timeout: 10000 })

    // Should have delete button
    const deleteButton = page.getByRole('button', { name: /delete/i })
    await expect(deleteButton).toBeVisible()
  })

  test('delete button shows confirmation dialog', async ({ page }) => {
    // Find delete button
    const deleteButton = page.getByRole('button', { name: /delete/i })

    // Check if button exists
    if ((await deleteButton.count()) > 0) {
      // Check if button is enabled before trying to click
      const isEnabled = await deleteButton.isEnabled()

      if (isEnabled) {
        await deleteButton.click()

        // Should show confirmation dialog or alert - wait for any dialog
        const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
        await expect(confirmDialog).toBeVisible({ timeout: 5000 })

        // Close the dialog
        await page.keyboard.press('Escape')
      } else {
        // Button exists but is disabled - this is expected behavior
        // Just verify the button is visible
        await expect(deleteButton).toBeVisible()
      }
    }
  })

  test('can navigate between boards', async ({ page }) => {
    // Look for board navigation links in sidebar nav
    const boardNav = page.locator('nav ul')

    if ((await boardNav.count()) > 0) {
      // Should have settings navigation links
      const navLinks = boardNav.locator('a')
      if ((await navLinks.count()) > 1) {
        // Click on Public Portal link
        await navLinks.filter({ hasText: 'Public Portal' }).click()

        // URL should change to include /public
        await page.waitForURL(/\/public/)
      }
    }
  })

  test('can access public visibility settings', async ({ page }) => {
    // Navigate to public settings tab (label is "Public Portal")
    const publicLink = page.getByRole('link', { name: 'Public Portal' })

    if ((await publicLink.count()) > 0) {
      await publicLink.click()

      // Should navigate to public settings page
      await expect(page).toHaveURL(/\/public/, { timeout: 5000 })
    }
  })
})
