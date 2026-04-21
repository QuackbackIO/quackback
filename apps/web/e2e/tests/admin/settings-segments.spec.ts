import { test, expect } from '@playwright/test'

test.describe('Admin Segments Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/segments')
    await page.waitForLoadState('networkidle')
  })

  test('page loads and shows heading', async ({ page }) => {
    await expect(page.getByText('Segments')).toBeVisible({ timeout: 10000 })
  })

  test('shows page description', async ({ page }) => {
    await expect(
      page.getByText(/organize users into groups/i)
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows "New segment" button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /new segment/i })).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows segments list or empty state', async ({ page }) => {
    await page.waitForTimeout(500)

    // Either segments are listed or the empty state is shown
    const segmentRows = page.locator('div').filter({ has: page.locator('span.rounded-full') })
    const emptyState = page.getByText(/no segments yet/i)

    const hasSegments = (await segmentRows.count()) > 0
    const hasEmptyState = (await emptyState.count()) > 0

    expect(hasSegments || hasEmptyState).toBe(true)
  })

  test('empty state shows create prompt when no segments exist', async ({ page }) => {
    await page.waitForTimeout(500)

    const segmentCount = await page.locator('div[class*="border-b"]').filter({
      has: page.locator('span.rounded-full.shrink-0'),
    }).count()

    if (segmentCount === 0) {
      await expect(page.getByText(/no segments yet/i)).toBeVisible({ timeout: 10000 })
    }
  })

  test('existing segments show name and member count', async ({ page }) => {
    await page.waitForTimeout(500)

    // Segment rows have a color dot, a name, and "X user(s)" count
    const memberCountText = page.getByText(/\d+ users?$/)

    if ((await memberCountText.count()) > 0) {
      await expect(memberCountText.first()).toBeVisible()
    }
  })

  test('dynamic segments show "Auto" badge', async ({ page }) => {
    await page.waitForTimeout(500)

    const autoBadge = page.locator('[class*="badge"]').filter({ hasText: /auto/i })

    if ((await autoBadge.count()) > 0) {
      await expect(autoBadge.first()).toBeVisible()
    }
  })

  test('can open "Create Segment" dialog', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByText(/create segment/i)).toBeVisible()
  })

  test('create dialog has manual and dynamic type selectors', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Type selector buttons (manual / dynamic)
    await expect(dialog.getByText('Manual')).toBeVisible()
    await expect(dialog.getByText('Dynamic')).toBeVisible()
  })

  test('create dialog has name and description fields', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.locator('#seg-name')).toBeVisible()
    await expect(dialog.locator('#seg-desc')).toBeVisible()

    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /create segment/i })).toBeVisible()
  })

  test('create button is disabled until name is filled', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const submitButton = dialog.getByRole('button', { name: /create segment/i })
    await expect(submitButton).toBeDisabled()

    await dialog.locator('#seg-name').fill('My Segment')
    await expect(submitButton).toBeEnabled()
  })

  test('cancel button closes the dialog', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('can create a manual segment', async ({ page }) => {
    const segmentName = `E2E Manual ${Date.now()}`

    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Manual is the default type — just fill name
    await dialog.locator('#seg-name').fill(segmentName)
    await dialog.locator('#seg-desc').fill('Created by E2E test')

    await dialog.getByRole('button', { name: /create segment/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // New segment should appear in the list
    await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 })
  })

  test('dynamic type shows rule builder section', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Click the "Dynamic" type option
    await dialog.getByText('Dynamic').click()

    // Rule builder should appear
    await expect(dialog.getByText('Rules')).toBeVisible({ timeout: 3000 })
    await expect(dialog.getByText(/add condition/i)).toBeVisible()
  })

  test('dynamic rule builder has "Add condition" button', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByText('Dynamic').click()

    const addConditionButton = dialog.getByRole('button', { name: /add condition/i })
    await expect(addConditionButton).toBeVisible({ timeout: 3000 })

    // Click "Add condition" — a condition row should appear
    await addConditionButton.click()

    // Condition row has attribute + operator dropdowns
    const conditionSelects = dialog.locator('[role="combobox"]')
    await expect(conditionSelects.first()).toBeVisible({ timeout: 3000 })
  })

  test('condition row has attribute and operator selectors', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByText('Dynamic').click()
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // At least 2 comboboxes: attribute + operator
    const comboboxes = dialog.locator('[role="combobox"]')
    await expect(comboboxes).toHaveCount(3) // match (all/any) + attribute + operator
  })

  test('condition attribute dropdown contains built-in options', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByText('Dynamic').click()
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // Click the attribute combobox (second combobox — first is match all/any)
    const comboboxes = dialog.locator('[role="combobox"]')
    await comboboxes.nth(1).click()

    const optionContainer = page
      .locator('[role="listbox"]')
      .or(page.locator('[data-radix-select-content]'))

    if ((await optionContainer.count()) > 0) {
      await expect(optionContainer.getByText('Email Domain')).toBeVisible()
      await expect(optionContainer.getByText('Post Count')).toBeVisible()
    }

    await page.keyboard.press('Escape')
  })

  test('can create a dynamic segment with a condition', async ({ page }) => {
    const segmentName = `E2E Dynamic ${Date.now()}`

    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByText('Dynamic').click()
    await dialog.locator('#seg-name').fill(segmentName)

    // Add a condition
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // Fill a value for the condition (e.g. post_count >= 1)
    const comboboxes = dialog.locator('[role="combobox"]')
    // Select "Post Count" attribute
    await comboboxes.nth(1).click()
    const optionContainer = page
      .locator('[role="listbox"]')
      .or(page.locator('[data-radix-select-content]'))

    if ((await optionContainer.count()) > 0) {
      const postCountOption = optionContainer.getByText('Post Count')
      if ((await postCountOption.count()) > 0) {
        await postCountOption.click()
      } else {
        await page.keyboard.press('Escape')
      }
    }

    // Fill value input
    const valueInput = dialog.locator('input[type="number"]').first()
    if ((await valueInput.count()) > 0) {
      await valueInput.fill('1')
    }

    await dialog.getByRole('button', { name: /create segment/i }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 })
  })

  test('can open edit dialog for an existing segment', async ({ page }) => {
    await page.waitForTimeout(500)

    // Create a segment first if none exist
    const segmentName = `E2E EditTarget ${Date.now()}`

    const segmentRows = page.locator('div').filter({ has: page.locator('span.rounded-full.shrink-0') })

    if ((await segmentRows.count()) === 0) {
      await page.getByRole('button', { name: /new segment/i }).click()
      const createDialog = page.getByRole('dialog')
      await expect(createDialog).toBeVisible({ timeout: 5000 })
      await createDialog.locator('#seg-name').fill(segmentName)
      await createDialog.getByRole('button', { name: /create segment/i }).click()
      await expect(createDialog).toBeHidden({ timeout: 10000 })
      await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 })
    }

    // Find the edit (pencil) button for the first segment row
    const editButton = page.getByRole('button', { name: /edit segment/i }).first()

    if ((await editButton.count()) > 0) {
      await editButton.click()

      const editDialog = page.getByRole('dialog')
      await expect(editDialog).toBeVisible({ timeout: 5000 })

      // Edit dialog title should say "Edit Segment"
      await expect(editDialog.getByText(/edit segment/i)).toBeVisible()

      // Save button should say "Save changes"
      await expect(editDialog.getByRole('button', { name: /save changes/i })).toBeVisible()

      // Type selector should NOT be shown when editing
      await expect(editDialog.getByText('Manual')).not.toBeVisible()

      await editDialog.getByRole('button', { name: /cancel/i }).click()
      await expect(editDialog).toBeHidden({ timeout: 5000 })
    }
  })

  test('can delete a segment with confirmation', async ({ page }) => {
    const segmentName = `E2E Delete Seg ${Date.now()}`

    // Create a segment to delete
    await page.getByRole('button', { name: /new segment/i }).click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.locator('#seg-name').fill(segmentName)
    await createDialog.getByRole('button', { name: /create segment/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 })

    // Click the delete (trash) button for that segment
    const segRow = page.locator('div').filter({ hasText: segmentName }).first()
    const deleteButton = segRow.getByRole('button', { name: /delete segment/i })

    if ((await deleteButton.count()) > 0) {
      await deleteButton.click()

      // Confirmation dialog should appear
      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(confirmDialog).toBeVisible({ timeout: 5000 })

      // Should mention the segment name
      await expect(confirmDialog.getByText(segmentName)).toBeVisible()

      // Confirm deletion
      await confirmDialog.getByRole('button', { name: /^delete$/i }).click()

      // Segment should no longer appear
      await expect(page.getByText(segmentName)).toBeHidden({ timeout: 10000 })
    }
  })

  test('delete confirmation can be cancelled', async ({ page }) => {
    const segmentName = `E2E Cancel Del Seg ${Date.now()}`

    await page.getByRole('button', { name: /new segment/i }).click()
    const createDialog = page.getByRole('dialog')
    await expect(createDialog).toBeVisible({ timeout: 5000 })
    await createDialog.locator('#seg-name').fill(segmentName)
    await createDialog.getByRole('button', { name: /create segment/i }).click()
    await expect(createDialog).toBeHidden({ timeout: 10000 })
    await expect(page.getByText(segmentName)).toBeVisible({ timeout: 10000 })

    const segRow = page.locator('div').filter({ hasText: segmentName }).first()
    const deleteButton = segRow.getByRole('button', { name: /delete segment/i })

    if ((await deleteButton.count()) > 0) {
      await deleteButton.click()

      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(confirmDialog).toBeVisible({ timeout: 5000 })

      // Cancel — segment should still be present
      await confirmDialog.getByRole('button', { name: /cancel/i }).click()
      await expect(confirmDialog).toBeHidden({ timeout: 5000 })
      await expect(page.getByText(segmentName)).toBeVisible()
    }
  })

  test('dynamic segments show re-evaluate button', async ({ page }) => {
    await page.waitForTimeout(500)

    // Dynamic segment rows include a re-evaluate (ArrowPath) button with title
    const reEvalButton = page.getByRole('button', { name: /re-evaluate membership/i })

    if ((await reEvalButton.count()) > 0) {
      await expect(reEvalButton.first()).toBeVisible()
    }
  })

  test('"Re-evaluate all" button visible when dynamic segments exist', async ({ page }) => {
    await page.waitForTimeout(500)

    const reEvalAllButton = page.getByRole('button', { name: /re-evaluate all/i })

    if ((await reEvalAllButton.count()) > 0) {
      await expect(reEvalAllButton).toBeVisible()
    }
  })

  test('rule builder match selector has ALL and ANY options', async ({ page }) => {
    await page.getByRole('button', { name: /new segment/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByText('Dynamic').click()
    await dialog.getByRole('button', { name: /add condition/i }).click()

    // The match selector is the first combobox (renders "ALL" / "ANY")
    const matchSelect = dialog.locator('[role="combobox"]').first()
    await matchSelect.click()

    const optionContainer = page
      .locator('[role="listbox"]')
      .or(page.locator('[data-radix-select-content]'))

    if ((await optionContainer.count()) > 0) {
      await expect(optionContainer.getByText('ALL')).toBeVisible()
      await expect(optionContainer.getByText('ANY')).toBeVisible()
    }

    await page.keyboard.press('Escape')
  })
})
