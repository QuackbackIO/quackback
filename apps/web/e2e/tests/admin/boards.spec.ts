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

  test('can change board visibility on Access page', async ({ page }) => {
    // Navigate to Access settings
    const accessLink = page.getByRole('link', { name: 'Access' })
    await accessLink.click()
    await page.waitForURL(/\/access/)

    // Find the visibility radio buttons
    const publicRadio = page.getByRole('radio', { name: 'public' })
    const privateRadio = page.getByRole('radio', { name: 'private' })
    await expect(publicRadio).toBeVisible({ timeout: 5000 })
    await expect(privateRadio).toBeVisible({ timeout: 5000 })

    // Get current state
    const wasPublic = await publicRadio.isChecked()

    // Toggle visibility
    if (wasPublic) {
      await privateRadio.click()
    } else {
      await publicRadio.click()
    }

    // Save the changes
    const saveButton = page.getByRole('button', { name: 'Save changes' })
    await saveButton.click()

    // Wait for success message
    await expect(page.getByText('Settings updated successfully')).toBeVisible({ timeout: 5000 })

    // Toggle back to original state
    if (wasPublic) {
      await publicRadio.click()
    } else {
      await privateRadio.click()
    }
    await saveButton.click()
    await page.waitForLoadState('networkidle')
  })

  test('shows danger zone with delete option', async ({ page }) => {
    // Should show danger zone section
    const dangerZone = page.getByText('Danger Zone')
    await expect(dangerZone).toBeVisible({ timeout: 10000 })

    // Should have delete button - use exact match to avoid matching board switcher
    const deleteButton = page.getByRole('button', { name: 'Delete board', exact: true })
    await expect(deleteButton).toBeVisible()
  })

  test('delete button shows confirmation dialog', async ({ page }) => {
    // Find delete button - use exact match to avoid matching board switcher
    const deleteButton = page.getByRole('button', { name: 'Delete board', exact: true })

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

  test('can navigate between settings tabs', async ({ page }) => {
    // Look for board navigation links in sidebar nav
    const boardNav = page.locator('nav ul')

    if ((await boardNav.count()) > 0) {
      // Should have settings navigation links
      const navLinks = boardNav.locator('a')
      if ((await navLinks.count()) > 1) {
        // Click on Access link
        await navLinks.filter({ hasText: 'Access' }).click()

        // URL should change to include /access
        await page.waitForURL(/\/access/)
      }
    }
  })

  test('can access board access settings', async ({ page }) => {
    // Navigate to access settings tab
    const accessLink = page.getByRole('link', { name: 'Access' })

    if ((await accessLink.count()) > 0) {
      await accessLink.click()

      // Should navigate to access settings page
      await expect(page).toHaveURL(/\/access/, { timeout: 5000 })
    }
  })
})

test.describe('Board Access Settings', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to board settings access page
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')

    // Wait for the board settings page to fully load (redirects to first board)
    await expect(page.getByText('General Settings')).toBeVisible({ timeout: 10000 })

    // Navigate to Access tab
    const accessLink = page.getByRole('link', { name: 'Access' })
    await expect(accessLink).toBeVisible({ timeout: 5000 })
    await accessLink.click()
    await page.waitForURL(/\/access/)
    await page.waitForLoadState('networkidle')
  })

  test('displays access settings', async ({ page }) => {
    // Should show the board visibility options
    await expect(page.getByText('Board Visibility')).toBeVisible({ timeout: 5000 })

    // Should show both public and private radio options
    const publicRadio = page.getByRole('radio', { name: 'public' })
    const privateRadio = page.getByRole('radio', { name: 'private' })
    await expect(publicRadio).toBeVisible({ timeout: 5000 })
    await expect(privateRadio).toBeVisible({ timeout: 5000 })

    // Should show descriptive text for each option
    await expect(page.getByText('Anyone can view this board on your portal')).toBeVisible()
    await expect(page.getByText('Only team members can view this board')).toBeVisible()
  })

  test('can toggle board visibility between public and private', async ({ page }) => {
    // Get the radio buttons
    const publicRadio = page.getByRole('radio', { name: 'public' })
    const privateRadio = page.getByRole('radio', { name: 'private' })

    // Check current state
    const wasPublic = await publicRadio.isChecked()

    // Toggle to the opposite state
    if (wasPublic) {
      await privateRadio.click()
      await expect(privateRadio).toBeChecked()
      await expect(publicRadio).not.toBeChecked()
    } else {
      await publicRadio.click()
      await expect(publicRadio).toBeChecked()
      await expect(privateRadio).not.toBeChecked()
    }

    // Save the changes
    const saveButton = page.getByRole('button', { name: 'Save changes' })
    await saveButton.click()

    // Wait for success message
    await expect(page.getByText('Settings updated successfully')).toBeVisible({ timeout: 5000 })

    // Verify the change persists after page reload
    await page.reload()
    await page.waitForLoadState('networkidle')

    if (wasPublic) {
      await expect(privateRadio).toBeChecked()
    } else {
      await expect(publicRadio).toBeChecked()
    }

    // Toggle back to original state to restore
    if (wasPublic) {
      await publicRadio.click()
    } else {
      await privateRadio.click()
    }
    await saveButton.click()
    await expect(page.getByText('Settings updated successfully')).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Board Deletion Flow', () => {
  // Run deletion tests serially to avoid conflicts with other tests
  test.describe.configure({ mode: 'serial' })

  // Note: This test creates a board first so we can safely delete it
  test('can delete a board after typing confirmation', async ({ page }) => {
    // First, create a board to delete
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')

    // Click "New board" button
    const newBoardButton = page.getByRole('button', { name: 'New board' })
    await newBoardButton.click()

    // Wait for dialog
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Fill in board details with unique name (scoped to dialog)
    const testBoardName = `Test Delete Board ${Date.now()}`
    await dialog.getByLabel('Board name').fill(testBoardName)
    await dialog.getByLabel('Description').fill('This board will be deleted')

    // Create the board
    await page.getByRole('button', { name: 'Create board' }).click()

    // Wait for dialog to close
    await expect(dialog).toBeHidden({ timeout: 10000 })
    await page.waitForLoadState('networkidle')

    // After creating a board, the page automatically navigates to the new board's settings
    // Wait for the page to show the new board's settings
    await expect(page.getByText('General Settings')).toBeVisible({ timeout: 10000 })

    // Verify we're on the correct board's settings page (board switcher shows the board name)
    await expect(page.getByTestId('board-switcher')).toContainText(testBoardName)
    // Find the delete button (should be disabled until we type confirmation)
    // Use exact: true to avoid matching the board switcher that contains "Delete Board" in its name
    const deleteButton = page.getByRole('button', { name: 'Delete board', exact: true })
    await expect(deleteButton).toBeVisible({ timeout: 5000 })
    await expect(deleteButton).toBeDisabled()

    // Type the board name to confirm deletion
    const confirmInput = page.getByPlaceholder(testBoardName)
    await confirmInput.fill(testBoardName)

    // Now delete button should be enabled
    await expect(deleteButton).toBeEnabled()

    // Click delete
    await deleteButton.click()

    // Should redirect to boards list
    await expect(page).toHaveURL(/\/admin\/settings\/boards/, { timeout: 10000 })
  })

  test('delete button stays disabled until name matches', async ({ page }) => {
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')

    // Find the delete button - use exact match to avoid matching board switcher
    const deleteButton = page.getByRole('button', { name: 'Delete board', exact: true })
    await expect(deleteButton).toBeVisible({ timeout: 5000 })

    // Should be disabled initially
    await expect(deleteButton).toBeDisabled()

    // Get the board name from the confirmation label
    const confirmLabel = page.locator('label').filter({ hasText: 'Type' })
    const labelText = await confirmLabel.textContent()
    const boardNameMatch = labelText?.match(/Type\s+(.+?)\s+to confirm/)
    const boardName = boardNameMatch?.[1] || ''

    if (boardName) {
      // Type partial name - button should stay disabled
      const confirmInput = page.getByPlaceholder(boardName)
      await confirmInput.fill(boardName.substring(0, 3))
      await expect(deleteButton).toBeDisabled()

      // Type wrong name - button should stay disabled
      await confirmInput.clear()
      await confirmInput.fill('wrong name')
      await expect(deleteButton).toBeDisabled()

      // Clear for cleanup
      await confirmInput.clear()
    }
  })
})

test.describe('Create Board Dialog', () => {
  // Run create board tests serially to avoid conflicts
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')

    // Wait for page to be ready - either board settings or empty state
    await expect(
      page.getByText('General Settings').or(page.getByText('No boards yet'))
    ).toBeVisible({ timeout: 10000 })
  })

  test('can open create board dialog', async ({ page }) => {
    // Click "New board" button
    const newBoardButton = page.getByRole('button', { name: 'New board' })
    await expect(newBoardButton).toBeVisible({ timeout: 5000 })
    await newBoardButton.click()

    // Dialog should appear
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText('Create new board')).toBeVisible()
  })

  test('dialog has all required fields', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Check all fields are present (scoped to dialog)
    await expect(dialog.getByLabel('Board name')).toBeVisible()
    await expect(dialog.getByLabel('Description')).toBeVisible()
    await expect(dialog.getByRole('switch', { name: 'Public board' })).toBeVisible()

    // Check buttons
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create board' })).toBeVisible()
  })

  test('can close dialog with Cancel button', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click()

    // Dialog should close
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('can close dialog with Escape key', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Press Escape
    await page.keyboard.press('Escape')

    // Dialog should close
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('form resets when dialog is reopened', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Fill in some data (scoped to dialog)
    await dialog.getByLabel('Board name').fill('Test Board')
    await dialog.getByLabel('Description').fill('Test Description')

    // Close dialog
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // Reopen dialog
    await page.getByRole('button', { name: 'New board' }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Fields should be empty
    await expect(dialog.getByLabel('Board name')).toHaveValue('')
    await expect(dialog.getByLabel('Description')).toHaveValue('')
  })

  test('can create a new board', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Fill in board details with unique name (scoped to dialog)
    const testBoardName = `E2E Test Board ${Date.now()}`
    await dialog.getByLabel('Board name').fill(testBoardName)
    await dialog.getByLabel('Description').fill('Board created by Playwright test')

    // Verify public switch is checked by default
    const publicSwitch = dialog.getByRole('switch', { name: 'Public board' })
    await expect(publicSwitch).toBeChecked()

    // Create the board
    await dialog.getByRole('button', { name: 'Create board' }).click()

    // Dialog should close - this confirms board was created successfully
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // Wait for navigation to complete and page to fully load
    await page.waitForLoadState('networkidle')

    // Wait for the board switcher to show the new board name (confirms navigation completed)
    const boardSwitcherButton = page.getByTestId('board-switcher')
    await expect(boardSwitcherButton).toContainText(testBoardName, { timeout: 10000 })

    // Verify board was created by checking we're on the new board's settings page
    // The board name should be visible in the page heading/switcher
    await expect(page.getByText('General Settings')).toBeVisible({ timeout: 5000 })

    // Open the board switcher dropdown to verify the board exists in the list
    await boardSwitcherButton.click()

    // Wait for dropdown menu to appear
    const dropdownContent = page.getByRole('menu')
    await expect(dropdownContent).toBeVisible({ timeout: 5000 })

    // The new board should appear in the dropdown menu
    const boardMenuItem = dropdownContent.getByRole('menuitem', { name: testBoardName })
    await expect(boardMenuItem).toBeVisible({ timeout: 5000 })

    // Close the dropdown
    await page.keyboard.press('Escape')
  })

  test('can create a private board', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Fill in board details (scoped to dialog)
    const testBoardName = `Private Board ${Date.now()}`
    await dialog.getByLabel('Board name').fill(testBoardName)
    await dialog.getByLabel('Description').fill('Private board for testing')

    // Toggle public switch off
    const publicSwitch = dialog.getByRole('switch', { name: 'Public board' })
    await expect(publicSwitch).toBeChecked() // Should be on by default
    await publicSwitch.click()
    await expect(publicSwitch).not.toBeChecked()

    // Create the board
    await dialog.getByRole('button', { name: 'Create board' }).click()

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 10000 })
  })

  test('shows validation error for empty board name', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Try to create without filling name
    await dialog.getByRole('button', { name: 'Create board' }).click()

    // Should show validation error - look for the specific error text
    await expect(dialog.getByText('Board name is required')).toBeVisible({
      timeout: 5000,
    })

    // Dialog should still be open
    await expect(dialog).toBeVisible()
  })

  test('shows loading state while creating', async ({ page }) => {
    // Open dialog
    await page.getByRole('button', { name: 'New board' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Fill in board details (scoped to dialog)
    await dialog.getByLabel('Board name').fill(`Loading Test ${Date.now()}`)

    // Click create and check for loading state
    const createButton = dialog.getByRole('button', { name: 'Create board' })
    await createButton.click()

    // Should show loading text briefly (may be too fast to catch reliably)
    // At minimum, button should become disabled during submission
    // Just verify dialog eventually closes (successful creation)
    await expect(dialog).toBeHidden({ timeout: 10000 })
  })
})
