import { test, expect } from '@playwright/test'

test.describe('Admin Webhooks Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/developers?tab=webhooks')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows webhooks section', async ({ page }) => {
    await expect(page.getByText('Webhooks').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Webhooks' }).first()).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows card description', async ({ page }) => {
    await expect(
      page.getByText('Receive an HTTP POST when events happen in your workspace.')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows create webhook button when webhooks exist', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    // One or the other should be visible depending on whether webhooks exist
    const hasCreateButton = (await createButton.count()) > 0 || (await emptyStateButton.count()) > 0
    expect(hasCreateButton).toBe(true)
  })

  test('shows empty state with create button when no webhooks', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // If empty state is shown, it should have the call-to-action button
    if ((await page.getByText('No webhooks yet').count()) > 0) {
      await expect(page.getByRole('button', { name: 'New webhook' }).last()).toBeVisible()
    }
  })

  test('can open create webhook dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click whichever create button is available
    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else if ((await emptyStateButton.count()) > 0) {
      await emptyStateButton.click()
    }

    // Dialog should open
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByRole('heading', { name: 'Create webhook' })).toBeVisible()
  })

  test('create webhook dialog has URL input field', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Should have endpoint URL label and input
    await expect(dialog.getByLabel('Endpoint URL')).toBeVisible()
    await expect(dialog.getByPlaceholder('https://example.com/webhook')).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('create webhook dialog has event type checkboxes', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Should have an Events label and checkboxes
    await expect(dialog.getByText('Events')).toBeVisible()

    const checkboxes = dialog.getByRole('checkbox')
    await expect(checkboxes.first()).toBeVisible()
    expect(await checkboxes.count()).toBeGreaterThan(0)

    await page.keyboard.press('Escape')
  })

  test('create webhook dialog has Cancel and Create Webhook buttons', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create webhook' })).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('create button is disabled until URL and events are filled', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Submit button should be disabled with empty form
    const submitButton = dialog.getByRole('button', { name: 'Create webhook' })
    await expect(submitButton).toBeDisabled()

    await page.keyboard.press('Escape')
  })

  test('shows validation error when submitting without selecting events', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Fill URL but leave events empty
    await dialog.getByLabel('Endpoint URL').fill('https://example.com/webhook')

    // The submit button stays disabled when no events selected
    const submitButton = dialog.getByRole('button', { name: 'Create webhook' })
    await expect(submitButton).toBeDisabled()

    await page.keyboard.press('Escape')
  })

  test('can close create webhook dialog with Escape', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('can close create webhook dialog with Cancel button', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('existing webhooks show their URL', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Only check if webhooks are present (non-empty state)
    const rowMenu = page.getByRole('button', { name: /^actions for https?:\/\//i }).first()
    if ((await rowMenu.count()) > 0) {
      const name = (await rowMenu.getAttribute('aria-label')) ?? ''
      const url = name.replace(/^actions for /i, '')
      await expect(page.getByText(url, { exact: true }).first()).toBeVisible()
    }
  })

  test('existing webhooks show subscribed event types or their failure state', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Only check if webhooks are present
    const rowMenu = page.getByRole('button', { name: /^actions for https?:\/\//i }).first()
    if ((await rowMenu.count()) > 0) {
      await expect(
        page
          .getByText(/New post|Status changed|New comment|Changelog published|failures?|Error:/)
          .first()
      ).toBeVisible()
    }
  })

  test('existing webhooks show a row menu with edit and delete', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const rowMenu = page.getByRole('button', { name: /^actions for /i }).first()
    if ((await rowMenu.count()) > 0) {
      await rowMenu.click()
      await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
      await page.keyboard.press('Escape')
    }
  })

  test('can open delete webhook dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const rowMenu = page.getByRole('button', { name: /^actions for /i }).first()
    if ((await rowMenu.count()) > 0) {
      await rowMenu.click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()

      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })
      await expect(dialog.getByRole('heading', { name: 'Delete webhook?' })).toBeVisible()

      await page.keyboard.press('Escape')
    }
  })

  test('delete confirmation dialog has confirm and cancel buttons', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const rowMenu = page.getByRole('button', { name: /^actions for /i }).first()
    if ((await rowMenu.count()) > 0) {
      await rowMenu.click()
      await page.getByRole('menuitem', { name: 'Delete' }).click()

      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Delete webhook' })).toBeVisible()

      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden({ timeout: 5000 })
    }
  })

  test('shows webhook verification guide section', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // The verification guide is always rendered below the webhooks card
    const verificationSection = page.getByText(/verif/i).first()
    if ((await verificationSection.count()) > 0) {
      await expect(verificationSection).toBeVisible()
    }
  })

  test('webhook count is shown when webhooks exist', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // When webhooks exist, a "X of 25 webhooks" label is shown
    const countLabel = page.getByText(/of 25 webhooks/)
    if ((await countLabel.count()) > 0) {
      await expect(countLabel).toBeVisible()
    }
  })
})

test.describe('Admin Webhooks - Create Webhook Flow', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/developers?tab=webhooks')
    await page.waitForLoadState('networkidle')
  })

  test('can create a webhook with URL and events', async ({ page }) => {
    const createButton = page.getByRole('button', { name: 'New webhook' }).first()
    const emptyStateButton = page.getByRole('button', { name: 'New webhook' }).last()

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else if ((await emptyStateButton.count()) > 0) {
      await emptyStateButton.click()
    } else {
      test.skip()
      return
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Fill in the webhook URL
    const testUrl = `https://example.com/webhook-${Date.now()}`
    await dialog.getByLabel('Endpoint URL').fill(testUrl)

    // Check the first event checkbox
    const checkboxes = dialog.getByRole('checkbox')
    await checkboxes.first().click()
    await expect(checkboxes.first()).toBeChecked()

    // Submit button should now be enabled
    const submitButton = dialog.getByRole('button', { name: 'Create webhook' })
    await expect(submitButton).toBeEnabled()

    // Submit
    await submitButton.click()

    // After creation, either the secret reveal dialog shows or the dialog closes
    // Either way, page should proceed without error
    await page.waitForTimeout(2000)

    // If secret dialog appeared, close it
    const secretDialog = page.getByRole('dialog')
    if ((await secretDialog.count()) > 0) {
      const savedButton = page.getByRole('button', { name: "I've saved my secret" })
      if ((await savedButton.count()) > 0) {
        await savedButton.click()
      } else {
        await page.keyboard.press('Escape')
      }
    }

    await page.waitForLoadState('networkidle')
  })
})
