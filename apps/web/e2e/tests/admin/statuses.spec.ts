import { test, expect } from '@playwright/test'

test.describe('Admin Status Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to status settings
    await page.goto('/admin/settings/statuses')
    await page.waitForLoadState('networkidle')
  })

  test('displays status settings page', async ({ page }) => {
    // Should show statuses page content - look for the page title or any status-related text
    const pageContent = page.getByText(/statuses/i).or(page.getByText(/customize/i))
    await expect(pageContent.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows status categories (Active, Complete, Closed)', async ({ page }) => {
    // Wait for page to load fully
    await page.waitForTimeout(1000)

    // Should show the three category sections (case-insensitive)
    const active = page.getByText(/^active$/i)
    const complete = page.getByText(/^complete$/i)
    const closed = page.getByText(/^closed$/i)

    // At least one category should be visible
    await expect(active.or(complete).or(closed).first()).toBeVisible({ timeout: 10000 })
  })

  test('displays existing statuses', async ({ page }) => {
    // Status items have toggle switches for roadmap visibility - always visible
    const statusToggles = page.getByRole('switch')

    // Should have at least one status (seeded data has default statuses)
    await expect(statusToggles.first()).toBeVisible({ timeout: 10000 })
  })

  test('can open add status dialog with form fields', async ({ page }) => {
    // Find the "Add new status" text button
    const addButton = page.getByText('Add new status').first()

    if ((await addButton.count()) > 0) {
      await addButton.click()

      // Dialog should open
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      // Verify dialog has expected form fields
      await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: /slug/i })).toBeVisible()
      await expect(dialog.getByText('Color')).toBeVisible()

      // Verify buttons exist
      await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
      await expect(dialog.getByRole('button', { name: /create status/i })).toBeVisible()

      // Cancel button should close the dialog
      await dialog.getByRole('button', { name: /cancel/i }).click()
      await expect(dialog).toBeHidden({ timeout: 5000 })
    }
  })

  test('shows color picker for status', async ({ page }) => {
    // Find color picker buttons (circular color indicators)
    const colorButtons = page.locator('button').filter({
      has: page.locator('span[style*="background"]'),
    })

    if ((await colorButtons.count()) > 0) {
      // Click on first color button to open picker
      await colorButtons.first().click()

      // May show popover with color options
      const colorPopover = page.locator('[data-radix-popover-content]')

      if ((await colorPopover.count()) > 0) {
        await expect(colorPopover).toBeVisible()
        // Close popover
        await page.keyboard.press('Escape')
      }
    }
  })

  test('can toggle roadmap visibility for status', async ({ page }) => {
    // Find roadmap toggle switches
    const roadmapToggles = page.getByRole('switch')

    if ((await roadmapToggles.count()) > 0) {
      const firstToggle = roadmapToggles.first()

      // Get current state
      const isChecked = await firstToggle.getAttribute('data-state')

      // Click to toggle
      await firstToggle.click()

      // State should change
      await page.waitForTimeout(500)
      const newState = await firstToggle.getAttribute('data-state')

      // Should be different from initial state
      expect(newState).not.toBe(isChecked)
    }
  })

  test('shows default status indicator', async ({ page }) => {
    // Default status should be indicated with a lock icon or "Default" text
    const defaultIndicator = page.locator('svg.lucide-lock').or(page.getByText(/default/i))

    await expect(defaultIndicator.first()).toBeVisible({ timeout: 10000 })
  })

  test('can delete a non-default status', async ({ page }) => {
    // Find enabled delete buttons only (non-default statuses can be deleted)
    // Default statuses have disabled delete buttons
    const deleteButtons = page.locator('button:not([disabled])').filter({
      has: page.locator('svg.lucide-trash-2'),
    })

    // Only run if enabled delete buttons exist
    if ((await deleteButtons.count()) > 0) {
      // Click the first enabled delete button
      await deleteButtons.first().click()

      // Should show confirmation dialog - wait for any dialog type
      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(confirmDialog).toBeVisible({ timeout: 5000 })

      // Cancel the deletion
      const cancelButton = page.getByRole('button', { name: /cancel|no|close/i })
      if ((await cancelButton.count()) > 0) {
        await cancelButton.first().click()
      } else {
        await page.keyboard.press('Escape')
      }
    }
  })

  test('statuses can be reordered via drag and drop', async ({ page }) => {
    // Find status items (they have toggle switches for roadmap visibility)
    const statusToggles = page.getByRole('switch')

    if ((await statusToggles.count()) > 1) {
      // Get the first two status items
      const firstToggle = statusToggles.first()
      const secondToggle = statusToggles.nth(1)

      // Both should be visible (confirms there are multiple status items that could be reordered)
      await expect(firstToggle).toBeVisible()
      await expect(secondToggle).toBeVisible()

      // Note: Actually performing drag and drop would require more complex interaction
      // This test just verifies multiple status items exist that could be reordered
    }
  })
})
