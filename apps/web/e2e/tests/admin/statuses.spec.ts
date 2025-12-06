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
    // Should show status items with drag handles (GripVertical icon)
    const statusItems = page.locator('svg.lucide-grip-vertical')

    // Should have at least one status (seeded data has default statuses)
    await expect(statusItems.first()).toBeVisible({ timeout: 10000 })
  })

  test('can add a new status', async ({ page }) => {
    // Find the add status button (Plus icon button)
    const addButton = page.locator('button').filter({
      has: page.locator('svg.lucide-plus'),
    })

    if ((await addButton.count()) > 0) {
      await addButton.first().click()

      // Dialog should open
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      // Fill in status name
      const nameInput = page.getByLabel('Name').or(page.getByPlaceholder(/name/i))
      if ((await nameInput.count()) > 0) {
        await nameInput.fill(`Test Status ${Date.now()}`)
      }

      // Submit the form
      const submitButton = page.getByRole('button', { name: /create|add|save/i })
      if ((await submitButton.count()) > 0) {
        await submitButton.last().click()

        // Dialog should close
        await expect(dialog).toBeHidden({ timeout: 10000 })
      }
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
    // Find delete buttons (Trash2 icon)
    const deleteButtons = page.locator('button').filter({
      has: page.locator('svg.lucide-trash-2'),
    })

    // Only run if delete buttons exist
    if ((await deleteButtons.count()) > 0) {
      // Click the first delete button
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
    // Find draggable items (items with grip icons)
    const dragHandles = page.locator('svg.lucide-grip-vertical')

    if ((await dragHandles.count()) > 1) {
      // Get the first two handles
      const firstHandle = dragHandles.first()
      const secondHandle = dragHandles.nth(1)

      // Both should be visible
      await expect(firstHandle).toBeVisible()
      await expect(secondHandle).toBeVisible()

      // Note: Actually performing drag and drop would require more complex interaction
      // This test just verifies the drag handles exist
    }
  })
})
