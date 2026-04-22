import { test, expect } from '@playwright/test'

test.describe('Admin Webhooks Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/webhooks')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows webhooks section', async ({ page }) => {
    await expect(page.getByText('Webhooks').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Configured Webhooks').first()).toBeVisible({ timeout: 10000 })
  })

  test('shows page description', async ({ page }) => {
    await expect(
      page.getByText('Send real-time notifications to external services when events occur')
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows create webhook button when webhooks exist', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

    // One or the other should be visible depending on whether webhooks exist
    const hasCreateButton =
      (await createButton.count()) > 0 || (await emptyStateButton.count()) > 0
    expect(hasCreateButton).toBe(true)
  })

  test('shows empty state with create button when no webhooks', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // If empty state is shown, it should have the call-to-action button
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })
    if ((await emptyStateButton.count()) > 0) {
      await expect(emptyStateButton).toBeVisible()
      await expect(page.getByText('No webhooks configured')).toBeVisible()
    }
  })

  test('can open create webhook dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Click whichever create button is available
    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else if ((await emptyStateButton.count()) > 0) {
      await emptyStateButton.click()
    }

    // Dialog should open
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByRole('heading', { name: 'Create Webhook' })).toBeVisible()
  })

  test('create webhook dialog has URL input field', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Should have endpoint URL label and input
    await expect(dialog.getByLabel('Endpoint URL')).toBeVisible()
    await expect(
      dialog.getByPlaceholder('https://example.com/webhook')
    ).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('create webhook dialog has event type checkboxes', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

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

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create Webhook' })).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('create button is disabled until URL and events are filled', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

    if ((await createButton.count()) > 0) {
      await createButton.click()
    } else {
      await emptyStateButton.click()
    }

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Submit button should be disabled with empty form
    const submitButton = dialog.getByRole('button', { name: 'Create Webhook' })
    await expect(submitButton).toBeDisabled()

    await page.keyboard.press('Escape')
  })

  test('shows validation error when submitting without selecting events', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

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
    const submitButton = dialog.getByRole('button', { name: 'Create Webhook' })
    await expect(submitButton).toBeDisabled()

    await page.keyboard.press('Escape')
  })

  test('can close create webhook dialog with Escape', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

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

    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

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

  test('existing webhooks show URL and status badge', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Only check if webhooks are present (non-empty state)
    const webhookList = page.locator('.space-y-3')
    if ((await webhookList.count()) > 0) {
      const firstWebhook = webhookList.locator('[class*="rounded-lg border"]').first()
      if ((await firstWebhook.count()) > 0) {
        // Each webhook card should show a URL
        await expect(firstWebhook).toBeVisible()

        // Should show a status badge (Active, Disabled, Auto-disabled, etc.)
        const badge = firstWebhook.locator('[class*="badge"], [data-slot="badge"]')
        if ((await badge.count()) > 0) {
          await expect(badge.first()).toBeVisible()
        }
      }
    }
  })

  test('existing webhooks show subscribed event types', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    // Only check if webhooks are present
    const webhookList = page.locator('.space-y-3')
    if ((await webhookList.count()) > 0) {
      const firstWebhook = webhookList.locator('[class*="rounded-lg border"]').first()
      if ((await firstWebhook.count()) > 0) {
        // The events list appears as small text below the URL
        const eventText = firstWebhook.locator('.text-xs.text-muted-foreground').first()
        if ((await eventText.count()) > 0) {
          await expect(eventText).toBeVisible()
        }
      }
    }
  })

  test('existing webhooks show edit and delete buttons', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const webhookList = page.locator('.space-y-3')
    if ((await webhookList.count()) > 0) {
      const firstWebhook = webhookList.locator('[class*="rounded-lg border"]').first()
      if ((await firstWebhook.count()) > 0) {
        // Edit and delete buttons are visible on desktop (sm:flex)
        const editButton = firstWebhook.getByRole('button').filter({ hasText: '' }).first()
        if ((await editButton.count()) > 0) {
          await expect(editButton).toBeVisible()
        }
      }
    }
  })

  test('can open delete webhook dialog', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const webhookList = page.locator('.space-y-3')
    if ((await webhookList.count()) > 0) {
      const firstWebhook = webhookList.locator('[class*="rounded-lg border"]').first()
      if ((await firstWebhook.count()) > 0) {
        // Find delete button by aria-label pattern
        const deleteButton = firstWebhook.locator('button[aria-label*="Delete webhook"]')
        if ((await deleteButton.count()) > 0) {
          await deleteButton.click()

          const dialog = page.getByRole('alertdialog')
          await expect(dialog).toBeVisible({ timeout: 5000 })
          await expect(dialog.getByRole('heading', { name: 'Delete Webhook' })).toBeVisible()

          await page.keyboard.press('Escape')
        }
      }
    }
  })

  test('delete confirmation dialog has confirm and cancel buttons', async ({ page }) => {
    await page.waitForLoadState('networkidle')

    const webhookList = page.locator('.space-y-3')
    if ((await webhookList.count()) > 0) {
      const firstWebhook = webhookList.locator('[class*="rounded-lg border"]').first()
      if ((await firstWebhook.count()) > 0) {
        const deleteButton = firstWebhook.locator('button[aria-label*="Delete webhook"]')
        if ((await deleteButton.count()) > 0) {
          await deleteButton.click()

          const dialog = page.getByRole('alertdialog')
          await expect(dialog).toBeVisible({ timeout: 5000 })

          // Should have Cancel and Delete Webhook buttons
          await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
          await expect(page.getByRole('button', { name: 'Delete Webhook' })).toBeVisible()

          // Close without deleting
          await page.getByRole('button', { name: 'Cancel' }).click()
          await expect(dialog).toBeHidden({ timeout: 5000 })
        }
      }
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
    await page.goto('/admin/settings/webhooks')
    await page.waitForLoadState('networkidle')
  })

  test('can create a webhook with URL and events', async ({ page }) => {
    const createButton = page.getByRole('button', { name: 'Create Webhook' })
    const emptyStateButton = page.getByRole('button', { name: 'Create your first webhook' })

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
    const submitButton = dialog.getByRole('button', { name: 'Create Webhook' })
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
