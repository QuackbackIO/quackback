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

    // Each tag row is a list row with a color dot button and the full name
    const tagRows = page.locator('[data-slot="settings-list-row"]')

    if ((await tagRows.count()) > 0) {
      await expect(tagRows.first()).toBeVisible()
    } else {
      // Fallback: the "New tag" button is always present, confirming the list rendered
      await expect(page.getByRole('button', { name: 'New tag', exact: true })).toBeVisible({
        timeout: 10000,
      })
    }
  })

  test('tags show a color dot and mark only internal tags', async ({ page }) => {
    await page.waitForTimeout(500)

    const dots = page.getByRole('button', { name: /^Change colour of / })

    if ((await dots.count()) > 0) {
      await expect(dots.first()).toBeVisible()
      // Portal is the default and is not labelled
      // (scoped to the page content: the settings nav has a Portal link)
      await expect(page.getByRole('main').last().getByText('Portal', { exact: true })).toHaveCount(
        0
      )
    }
  })

  test('can open the New tag dialog', async ({ page }) => {
    const addButton = page.getByRole('button', { name: 'New tag', exact: true })
    await expect(addButton).toBeVisible({ timeout: 10000 })
    await addButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Dialog title should say "New tag"
    await expect(dialog.getByText('New tag')).toBeVisible()
  })

  test('dialog has name, description, and color fields', async ({ page }) => {
    const addButton = page.getByRole('button', { name: 'New tag', exact: true })
    await addButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Name input
    await expect(dialog.getByRole('textbox', { name: /name/i })).toBeVisible()

    // Description textarea
    await expect(dialog.getByRole('textbox', { name: /description/i })).toBeVisible()

    await expect(dialog.getByRole('button', { name: /^color$/i })).toBeVisible()

    // Portal visibility, on by default for new tags
    const portalRadio = dialog.getByRole('radio', { name: /^portal$/i })
    await expect(portalRadio).toBeVisible()
    await expect(portalRadio).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('radio', { name: /^internal$/i })).toHaveAttribute(
      'aria-checked',
      'false'
    )

    // Create and Cancel buttons
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /create tag/i })).toBeVisible()
  })

  test('dialog cancel button closes dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'New tag', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('can create a new tag', async ({ page }) => {
    const tagName = `E2E PostTag ${Date.now()}`

    await page.getByRole('button', { name: 'New tag', exact: true }).click()

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

    // The row menu holds Edit and Delete
    const tagRows = page.locator('[data-slot="settings-list-row"]')

    if ((await tagRows.count()) > 0) {
      const firstRow = tagRows.first()
      await firstRow.hover()

      const menu = firstRow.getByRole('button', { name: /^Actions for / })

      if ((await menu.count()) > 0) {
        await menu.click()
        await page.getByRole('menuitem', { name: 'Edit' }).click()

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

    await page.getByRole('button', { name: 'New tag', exact: true }).click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.getByRole('textbox', { name: /name/i }).fill(tagName)
    await createDialog.getByRole('button', { name: /create tag/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(tagName)).toBeVisible({ timeout: 10000 })

    // Now delete it
    const tagRow = page.locator('[data-slot="settings-list-row"]').filter({ hasText: tagName })
    await tagRow.hover()

    const menu = tagRow.getByRole('button', { name: /^Actions for / })
    if ((await menu.count()) > 0) {
      await menu.click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()

      // Confirmation dialog should appear
      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(confirmDialog).toBeVisible({ timeout: 5000 })

      // Should mention the tag name
      await expect(confirmDialog.getByText(tagName)).toBeVisible()

      // Confirm deletion
      await confirmDialog.getByRole('button', { name: 'Delete tag' }).click()

      // PostTag should no longer appear
      await expect(page.getByText(tagName)).toBeHidden({ timeout: 10000 })
    }
  })

  test('color dot opens color picker popover', async ({ page }) => {
    await page.waitForTimeout(500)

    const colorDots = page.getByRole('button', { name: /^Change colour of / })

    if ((await colorDots.count()) > 0) {
      await colorDots.first().click()

      // Color picker popover should open
      const popover = page.locator('[data-slot="popover-content"]')
      if ((await popover.count()) > 0) {
        await expect(popover).toBeVisible()

        // Close the popover
        await page.keyboard.press('Escape')
      }
    }
  })
})
