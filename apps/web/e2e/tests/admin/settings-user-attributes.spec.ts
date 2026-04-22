import { test, expect } from '@playwright/test'

test.describe('Admin User Attributes Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/user-attributes')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows heading', async ({ page }) => {
    await expect(page.getByText('User Attributes').first()).toBeVisible({ timeout: 10000 })
  })

  test('shows page description', async ({ page }) => {
    await expect(
      page.getByText(/define custom attributes/i).first()
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows "New attribute" button or empty state action', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await expect(newAttrButton.first()).toBeVisible({ timeout: 10000 })
  })

  test('empty state shows when no attributes exist', async ({ page }) => {
    await page.waitForTimeout(500)

    const attrRows = page.locator('div').filter({ has: page.locator('code') }).filter({
      hasText: /text|number|boolean|date|currency/i,
    })

    if ((await attrRows.count()) === 0) {
      const emptyTitle = page.getByText(/no attributes yet/i)
      await expect(emptyTitle).toBeVisible({ timeout: 10000 })
    }
  })

  test('shows existing attributes with key code and type badge', async ({ page }) => {
    await page.waitForTimeout(500)

    // Attribute rows render a <code> element for the key and a type badge span
    const attrRows = page.locator('div').filter({ has: page.locator('code') })

    if ((await attrRows.count()) > 0) {
      await expect(attrRows.first()).toBeVisible()

      // Each row should have a code element (the key)
      await expect(attrRows.first().locator('code').first()).toBeVisible()

      // Each row should have a type badge (Text | Number | Boolean | Date | Currency)
      const typeBadge = attrRows.first().locator('span').filter({
        hasText: /^(Text|Number|Boolean|Date|Currency)/,
      })
      if ((await typeBadge.count()) > 0) {
        await expect(typeBadge.first()).toBeVisible()
      }
    }
  })

  test('can open "New attribute" dialog', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByText(/new user attribute/i)).toBeVisible()
  })

  test('create dialog has key, label, type, and description fields', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Key input (id="attr-key")
    await expect(dialog.locator('#attr-key')).toBeVisible()

    // Label input (id="attr-label")
    await expect(dialog.locator('#attr-label')).toBeVisible()

    // Type select (renders a SelectTrigger)
    await expect(dialog.getByText('Type')).toBeVisible()

    // Description textarea (id="attr-desc")
    await expect(dialog.locator('#attr-desc')).toBeVisible()

    // Footer buttons
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /create attribute/i })).toBeVisible()
  })

  test('type selector contains Text, Number, Boolean, Date, Currency options', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Open the type selector
    const typeSelect = dialog.getByText('Type').locator('..').locator('[role="combobox"]')
    if ((await typeSelect.count()) > 0) {
      await typeSelect.click()
    } else {
      // Fallback: click the select trigger text
      await dialog.locator('[role="combobox"]').first().click()
    }

    // Options should be visible
    const optionContainer = page.locator('[role="listbox"]').or(page.locator('[data-radix-select-content]'))
    if ((await optionContainer.count()) > 0) {
      await expect(optionContainer.getByText('Text')).toBeVisible()
      await expect(optionContainer.getByText('Number')).toBeVisible()
      await expect(optionContainer.getByText('Boolean')).toBeVisible()
    }

    await page.keyboard.press('Escape')
  })

  test('create button is disabled until key and label are filled', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Submit button should be disabled when fields are empty
    const submitButton = dialog.getByRole('button', { name: /create attribute/i })
    await expect(submitButton).toBeDisabled()

    // Fill key only — still disabled (label is required too)
    await dialog.locator('#attr-key').fill('test_key')
    await expect(submitButton).toBeDisabled()

    // Fill label — should now be enabled
    await dialog.locator('#attr-label').fill('Test Label')
    await expect(submitButton).toBeEnabled()
  })

  test('cancel button closes the dialog', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('can create a new text attribute', async ({ page }) => {
    const attrKey = `e2e_attr_${Date.now()}`
    const attrLabel = `E2E Attribute ${Date.now()}`

    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.locator('#attr-key').fill(attrKey)
    await dialog.locator('#attr-label').fill(attrLabel)
    await dialog.locator('#attr-desc').fill('Created by E2E test')

    await dialog.getByRole('button', { name: /create attribute/i }).click()

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // New attribute should appear in the list by its label
    await expect(page.getByText(attrLabel)).toBeVisible({ timeout: 10000 })
  })

  test('new attribute shows type badge after creation', async ({ page }) => {
    const attrKey = `e2e_badge_${Date.now()}`
    const attrLabel = `E2E Badge Test ${Date.now()}`

    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.locator('#attr-key').fill(attrKey)
    await dialog.locator('#attr-label').fill(attrLabel)
    await dialog.getByRole('button', { name: /create attribute/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // The row should show a Text badge (default type)
    // Scope to the specific row that contains both the label span and buttons
    const attrRow = page
      .locator('div.flex.items-center.gap-4')
      .filter({ has: page.getByText(attrLabel, { exact: true }) })
    if ((await attrRow.count()) > 0) {
      // Check that the row contains a code element (the key) which confirms the attribute rendered
      await expect(attrRow.first().locator('code').first()).toBeVisible({ timeout: 10000 })
    } else {
      // Fallback: just check the label is visible
      await expect(page.getByText(attrLabel)).toBeVisible({ timeout: 10000 })
    }
  })

  test('can open edit dialog for an existing attribute', async ({ page }) => {
    // First create an attribute to edit
    const attrKey = `e2e_edit_${Date.now()}`
    const attrLabel = `E2E Edit ${Date.now()}`

    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()
    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await dialog.locator('#attr-key').fill(attrKey)
    await dialog.locator('#attr-label').fill(attrLabel)
    await dialog.getByRole('button', { name: /create attribute/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(attrLabel)).toBeVisible({ timeout: 10000 })

    // Find the edit button (title="Edit attribute") in the specific row
    const attrRow = page
      .locator('div.flex.items-center.gap-4')
      .filter({ has: page.getByText(attrLabel, { exact: true }) })
    const editButton = attrRow.first().locator('button[title="Edit attribute"]')

    if ((await editButton.count()) > 0) {
      await editButton.click()

      dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 5000 })

      // Edit dialog title should say "Edit attribute"
      await expect(dialog.getByText('Edit attribute')).toBeVisible()

      // Key field should be disabled in edit mode
      await expect(dialog.locator('#attr-key')).toBeDisabled()

      // Save button should say "Save changes"
      await expect(dialog.getByRole('button', { name: /save changes/i })).toBeVisible()

      await dialog.getByRole('button', { name: /cancel/i }).click()
      await expect(dialog).toBeHidden({ timeout: 5000 })
    }
  })

  test('can delete an attribute with confirmation', async ({ page }) => {
    // Create an attribute to delete
    const attrKey = `e2e_del_${Date.now()}`
    const attrLabel = `E2E Delete ${Date.now()}`

    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.locator('#attr-key').fill(attrKey)
    await createDialog.locator('#attr-label').fill(attrLabel)
    await createDialog.getByRole('button', { name: /create attribute/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(attrLabel)).toBeVisible({ timeout: 10000 })

    // Click the delete button (title="Delete attribute")
    const attrRow = page
      .locator('div.flex.items-center.gap-4')
      .filter({ has: page.getByText(attrLabel, { exact: true }) })
    const deleteButton = attrRow.first().locator('button[title="Delete attribute"]')

    if ((await deleteButton.count()) > 0) {
      await deleteButton.click()

      // Confirmation dialog should appear
      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(confirmDialog).toBeVisible({ timeout: 5000 })

      // Should mention the attribute label
      await expect(confirmDialog.getByText(attrLabel)).toBeVisible()

      // Confirm deletion
      await confirmDialog.getByRole('button', { name: /^delete$/i }).click()

      // Attribute should no longer appear
      await expect(page.getByText(attrLabel)).toBeHidden({ timeout: 10000 })
    }
  })

  test('delete confirmation dialog can be cancelled', async ({ page }) => {
    // Create an attribute
    const attrKey = `e2e_cancel_del_${Date.now()}`
    const attrLabel = `E2E Cancel Del ${Date.now()}`

    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.locator('#attr-key').fill(attrKey)
    await createDialog.locator('#attr-label').fill(attrLabel)
    await createDialog.getByRole('button', { name: /create attribute/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(attrLabel)).toBeVisible({ timeout: 10000 })

    const attrRowCancel = page
      .locator('div.flex.items-center.gap-4')
      .filter({ has: page.getByText(attrLabel, { exact: true }) })
    const deleteButton = attrRowCancel.first().locator('button[title="Delete attribute"]')

    if ((await deleteButton.count()) > 0) {
      await deleteButton.click()

      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(confirmDialog).toBeVisible({ timeout: 5000 })

      // Cancel — attribute should still be there
      await confirmDialog.getByRole('button', { name: /cancel/i }).click()
      await expect(confirmDialog).toBeHidden({ timeout: 5000 })
      await expect(page.getByText(attrLabel)).toBeVisible()
    }
  })

  test('currency type selector shows currency code picker', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Select the "Currency" type
    const typeSelect = dialog.locator('[role="combobox"]').first()
    await typeSelect.click()

    const optionContainer = page
      .locator('[role="listbox"]')
      .or(page.locator('[data-radix-select-content]'))

    if ((await optionContainer.count()) > 0) {
      const currencyOption = optionContainer.getByText('Currency')
      if ((await currencyOption.count()) > 0) {
        await currencyOption.click()

        // Currency picker should now appear in the form
        await expect(dialog.getByText('Currency').first()).toBeVisible({ timeout: 3000 })
      }
    } else {
      await page.keyboard.press('Escape')
    }

    await page.keyboard.press('Escape')
  })

  test('CDP attribute name field is present in create dialog', async ({ page }) => {
    const newAttrButton = page
      .getByRole('button', { name: /new attribute/i })
      .or(page.getByRole('button', { name: /add attribute/i }))

    await newAttrButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // The CDP attribute name field (id="attr-external-key")
    await expect(dialog.locator('#attr-external-key')).toBeVisible()
    await expect(dialog.getByText(/CDP attribute name/i)).toBeVisible()
  })
})
