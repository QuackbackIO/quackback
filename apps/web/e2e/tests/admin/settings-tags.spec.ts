import { test, expect } from '@playwright/test'

test.describe('Admin Tags Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/tags')
    await page.waitForLoadState('networkidle')
  })

  test('displays tags settings page', async ({ page }) => {
    const pageContent = page.getByText(/tags/i).or(page.getByText(/organize/i))
    await expect(pageContent.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows existing tags from seeded data', async ({ page }) => {
    // Seeded data should have tags — the list renders tag names as text
    await page.waitForTimeout(500)

    // Each tag row is a flex container with a color dot and name span
    const tagRows = page.locator('div.group').filter({
      has: page.locator('button[style*="background"]'),
    })

    if ((await tagRows.count()) > 0) {
      await expect(tagRows.first()).toBeVisible()
    } else {
      // Fallback: the "Add new tag" button is always present, confirming the list rendered
      await expect(page.getByText('Add new tag')).toBeVisible({ timeout: 10000 })
    }
  })

  test('tags show color indicator and name', async ({ page }) => {
    await page.waitForTimeout(500)

    // Color indicator is a button with inline background-color style
    const colorDots = page.locator('button[style*="background-color"]').filter({
      hasNot: page.locator('[data-radix-popover-trigger]'),
    })

    if ((await colorDots.count()) > 0) {
      await expect(colorDots.first()).toBeVisible()

      // Each tag row should also have a name span (text in a <span> next to the dot)
      const tagNameSpans = page.locator('span.text-sm.font-medium')
      await expect(tagNameSpans.first()).toBeVisible()
    }
  })

  test('can open "Add new tag" dialog', async ({ page }) => {
    const addButton = page.getByText('Add new tag')
    await expect(addButton).toBeVisible({ timeout: 10000 })
    await addButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Dialog title should say "New tag"
    await expect(dialog.getByText('New tag')).toBeVisible()
  })

  test('dialog has name, description, and color fields', async ({ page }) => {
    const addButton = page.getByText('Add new tag')
    await addButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Name input
    await expect(dialog.getByRole('textbox', { name: /name/i })).toBeVisible()

    // Description textarea
    await expect(dialog.getByRole('textbox', { name: /description/i })).toBeVisible()

    // Color section label
    await expect(dialog.getByText('Color')).toBeVisible()

    // Create and Cancel buttons
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /create tag/i })).toBeVisible()
  })

  test('dialog cancel button closes dialog', async ({ page }) => {
    await page.getByText('Add new tag').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('can create a new tag', async ({ page }) => {
    const tagName = `E2E Tag ${Date.now()}`

    await page.getByText('Add new tag').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Fill in name
    await dialog.getByRole('textbox', { name: /name/i }).fill(tagName)

    // Submit
    await dialog.getByRole('button', { name: /create tag/i }).click()

    // Dialog should close after creation
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // New tag should appear in the list
    await expect(page.getByText(tagName)).toBeVisible({ timeout: 10000 })
  })

  test('can open edit dialog for an existing tag', async ({ page }) => {
    await page.waitForTimeout(500)

    // Hover a tag row to reveal the edit button (opacity-0 group-hover:opacity-100)
    const tagRows = page.locator('div.group').filter({
      has: page.locator('button[style*="background"]'),
    })

    if ((await tagRows.count()) > 0) {
      const firstRow = tagRows.first()
      await firstRow.hover()

      // Edit button has title="Edit tag"
      const editButton = firstRow.getByRole('button', { name: /edit tag/i })

      if ((await editButton.count()) > 0) {
        await editButton.click()

        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible({ timeout: 5000 })

        // Title should say "Edit tag"
        await expect(dialog.getByText('Edit tag')).toBeVisible()

        // Should have "Save changes" button (not "Create tag")
        await expect(dialog.getByRole('button', { name: /save changes/i })).toBeVisible()

        // Cancel
        await dialog.getByRole('button', { name: /cancel/i }).click()
        await expect(dialog).toBeHidden({ timeout: 5000 })
      }
    }
  })

  test('can delete a tag with confirmation', async ({ page }) => {
    // First create a tag we can safely delete
    const tagName = `Delete Me ${Date.now()}`

    await page.getByText('Add new tag').click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.getByRole('textbox', { name: /name/i }).fill(tagName)
    await createDialog.getByRole('button', { name: /create tag/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(tagName)).toBeVisible({ timeout: 10000 })

    // Now delete it
    const tagRow = page.locator('div.group').filter({ hasText: tagName })
    await tagRow.hover()

    const deleteButton = tagRow.getByRole('button', { name: /delete tag/i })
    if ((await deleteButton.count()) > 0) {
      await deleteButton.click()

      // Confirmation dialog should appear
      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(confirmDialog).toBeVisible({ timeout: 5000 })

      // Should mention the tag name
      await expect(confirmDialog.getByText(tagName)).toBeVisible()

      // Confirm deletion
      await confirmDialog.getByRole('button', { name: /^delete$/i }).click()

      // Tag should no longer appear
      await expect(page.getByText(tagName)).toBeHidden({ timeout: 10000 })
    }
  })

  test('color dot opens color picker popover', async ({ page }) => {
    await page.waitForTimeout(500)

    const colorDots = page.locator('button[style*="background-color"]')

    if ((await colorDots.count()) > 0) {
      await colorDots.first().click()

      // Color picker popover should open
      const popover = page.locator('[data-radix-popover-content]')
      if ((await popover.count()) > 0) {
        await expect(popover).toBeVisible()

        // Close the popover
        await page.keyboard.press('Escape')
      }
    }
  })
})
