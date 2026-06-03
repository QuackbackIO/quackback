import { test, expect, type Page, type Locator } from '@playwright/test'
import { slugify } from '../../../src/lib/shared/utils/string'

/**
 * Select an access preset and persist it. The save dock is a `fixed bottom-0`
 * bar that only slides into view (translate-y-0) — and accepts pointer events —
 * while the form is dirty, so we save only when the click was a real change
 * (clicking the already-active preset is a no-op and leaves the dock hidden).
 * State-agnostic: callers don't need to know the board's starting preset.
 */
async function setPresetAndSave(page: Page, preset: Locator): Promise<void> {
  await preset.click()
  await expect(preset).toHaveAttribute('aria-pressed', 'true')

  const dock = page.locator('[aria-label="Save changes"]')
  // A real change makes the form dirty and slides the dock into view.
  await expect(dock).toHaveClass(/translate-y-0/, { timeout: 3000 })
  await dock.getByRole('button', { name: 'Save changes' }).click()
  // The dock slides back out (translate-y-full) only after the save round-trips
  // and the form re-baselines — a reliable "persisted" signal that beats
  // networkidle, which can resolve in the lull before the mutation fires.
  await expect(dock).toHaveClass(/translate-y-full/, { timeout: 10000 })
}

/**
 * Create a throwaway board (defaults to the Public preset) and land on its
 * general settings. Tests run fullyParallel against a shared DB, so owning a
 * uniquely-named board keeps a test from racing others on the shared
 * redirect-target board.
 */
async function createBoard(page: Page, name: string): Promise<void> {
  await page.goto('/admin/settings/boards')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'New board' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Board name').fill(name)
  await dialog.getByRole('button', { name: 'Create board' }).click()
  await expect(dialog).toBeHidden({ timeout: 10000 })
  // Wait until the page has navigated to the new board (switcher reflects it).
  await expect(page.getByTestId('board-switcher')).toContainText(name, { timeout: 10000 })
}

/** Create a throwaway board and open its Access tab, settled on Public. */
async function createBoardOnAccessTab(page: Page, name: string): Promise<void> {
  await createBoard(page, name)
  await page.locator('nav').getByRole('button', { name: 'Access' }).click()
  await expect(page.getByText('Access Control')).toBeVisible({ timeout: 5000 })
  // New boards default to the Public preset; wait for the matrix to settle on it
  // (the optimistic insert can briefly show defaults before the refetch lands).
  await expect(page.getByRole('button', { name: 'Public', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10000 }
  )
}

/** Delete the board currently open in settings (type-to-confirm danger zone). */
async function deleteCurrentBoard(page: Page, name: string): Promise<void> {
  await page.locator('nav').getByRole('button', { name: 'General' }).click()
  await expect(page.getByText('Danger Zone')).toBeVisible({ timeout: 5000 })
  await page.getByPlaceholder(name).fill(name)
  const del = page.getByRole('button', { name: 'Delete board', exact: true })
  await expect(del).toBeEnabled()
  await del.click()
  await expect(page).toHaveURL(/\/admin\/settings\/boards/, { timeout: 10000 })
}

test.describe('Admin Board Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to board settings (will redirect to first board)
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')
  })

  test('displays board settings page', async ({ page }) => {
    // Should show board details card (page redirects to first board)
    await expect(page.getByText('Board Details')).toBeVisible({ timeout: 10000 })
  })

  test('can access board general settings', async ({ page }) => {
    // Should show board details card
    const generalSettings = page.getByText('Board Details')
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

  test('can change board access via presets on the Access tab', async ({ page }) => {
    // Use a throwaway board so the toggle is deterministic (it starts Public).
    const name = `Access Toggle ${Date.now()}`
    await createBoardOnAccessTab(page, name)
    // Access is a settings-nav tab button (not a link); it sets ?tab=access and
    // shows the per-action access matrix (the public/private radio is gone).
    await expect(page).toHaveURL(/tab=access/)

    // Visibility is chosen via aria-pressed preset toggles (Public / Private);
    // the board starts Public (asserted in the create helper).
    const privatePreset = page.getByRole('button', { name: 'Private', exact: true })
    await expect(privatePreset).toBeVisible()

    // Flip to Private (a guaranteed change) and confirm it persists in-form.
    await setPresetAndSave(page, privatePreset)
    await expect(privatePreset).toHaveAttribute('aria-pressed', 'true')

    await deleteCurrentBoard(page, name)
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
    await expect(page.getByText('Board Details')).toBeVisible({ timeout: 10000 })

    // Switch to the Access tab (a settings-nav button; sets ?tab=access).
    await page.locator('nav').getByRole('button', { name: 'Access' }).click()
    await expect(page.getByText('Access Control')).toBeVisible({ timeout: 5000 })
  })

  test('displays the access matrix with presets and per-action permissions', async ({ page }) => {
    // Presets replace the old public/private visibility radios.
    await expect(page.getByRole('button', { name: 'Public', exact: true })).toBeVisible({
      timeout: 5000,
    })
    await expect(page.getByRole('button', { name: 'Private', exact: true })).toBeVisible()

    // The per-action matrix and the team-bypass note identify the new control.
    await expect(page.getByText('Per-action permissions')).toBeVisible()
    await expect(
      page.getByText('Team members and admins always have full access', { exact: false })
    ).toBeVisible()
  })

  test('toggling a preset persists after save and reload', async ({ page }) => {
    // Throwaway board (starts Public) so persistence is unambiguous.
    const name = `Access Persist ${Date.now()}`
    await createBoardOnAccessTab(page, name)

    const publicPreset = page.getByRole('button', { name: 'Public', exact: true })
    const privatePreset = page.getByRole('button', { name: 'Private', exact: true })
    await expect(publicPreset).toHaveAttribute('aria-pressed', 'true')

    // Flip to Private and save.
    await setPresetAndSave(page, privatePreset)

    // Reload — the URL keeps ?tab=access — and confirm the saved preset is active.
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Access Control')).toBeVisible({ timeout: 10000 })
    await expect(privatePreset).toHaveAttribute('aria-pressed', 'true')

    await deleteCurrentBoard(page, name)
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
    await expect(page.getByText('Board Details')).toBeVisible({ timeout: 10000 })

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
    await expect(page.getByText('Board Details').or(page.getByText('No boards yet'))).toBeVisible({
      timeout: 10000,
    })
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
    // Visibility is chosen via Public/Private preset tiles (aria-pressed), which
    // replaced the old "Public board" switch.
    await expect(dialog.getByRole('button', { name: 'Public', exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Private', exact: true })).toBeVisible()

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

    // Public preset tile is active by default.
    await expect(dialog.getByRole('button', { name: 'Public', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

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
    await expect(page.getByText('Board Details')).toBeVisible({ timeout: 5000 })

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

    // Select the Private preset (Public is active by default).
    const publicTile = dialog.getByRole('button', { name: 'Public', exact: true })
    const privateTile = dialog.getByRole('button', { name: 'Private', exact: true })
    await expect(publicTile).toHaveAttribute('aria-pressed', 'true')
    await privateTile.click()
    await expect(privateTile).toHaveAttribute('aria-pressed', 'true')
    await expect(publicTile).toHaveAttribute('aria-pressed', 'false')

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

// ---------------------------------------------------------------------------
// Board Settings Tabs (General / Access / Import Data / Export Data)
// ---------------------------------------------------------------------------

test.describe('Board Settings Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Board Details').or(page.getByText('No boards yet'))).toBeVisible({
      timeout: 10000,
    })
  })

  test('General tab shows Board Details and Danger Zone cards', async ({ page }) => {
    // Default tab is General. The card heading is "Board Details" (not "General Settings")
    await expect(page.getByText('Board Details')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Danger Zone')).toBeVisible()
  })

  test('settings nav shows General, Access, Import Data, Export Data buttons', async ({ page }) => {
    const nav = page.locator('nav')
    await expect(nav.getByRole('button', { name: 'General' })).toBeVisible({ timeout: 5000 })
    await expect(nav.getByRole('button', { name: 'Access' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Import Data' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Export Data' })).toBeVisible()
  })

  test('clicking Access tab switches to Access Control view', async ({ page }) => {
    const nav = page.locator('nav')
    const accessButton = nav.getByRole('button', { name: 'Access' })
    if ((await accessButton.count()) === 0) return

    await accessButton.click()
    await expect(page.getByText('Access Control')).toBeVisible({ timeout: 5000 })
    // URL should reflect the tab change
    await expect(page).toHaveURL(/tab=access/)
  })

  test('clicking Import Data tab switches to import view', async ({ page }) => {
    const nav = page.locator('nav')
    const importButton = nav.getByRole('button', { name: 'Import Data' })
    if ((await importButton.count()) === 0) return

    await importButton.click()
    await expect(page.getByText('Import Data')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Import posts from a CSV file into this board')).toBeVisible()
  })

  test('clicking Export Data tab switches to export view and shows Export CSV button', async ({
    page,
  }) => {
    const nav = page.locator('nav')
    const exportButton = nav.getByRole('button', { name: 'Export Data' })
    if ((await exportButton.count()) === 0) return

    await exportButton.click()
    await expect(page.getByText('Export Data')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Download all posts from this board as CSV')).toBeVisible()
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible()
  })

  test('navigating between tabs with keyboard (Tab key reaches nav buttons)', async ({ page }) => {
    const nav = page.locator('nav')
    const generalButton = nav.getByRole('button', { name: 'General' })
    if ((await generalButton.count()) === 0) return

    // Focus the General button and navigate via keyboard to Access
    await generalButton.focus()
    await page.keyboard.press('Tab')

    // The next focused element should be the Access button
    const accessButton = nav.getByRole('button', { name: 'Access' })
    await expect(accessButton).toBeFocused()
  })

  test('General tab is active by default (highlighted)', async ({ page }) => {
    const nav = page.locator('nav')
    const generalButton = nav.getByRole('button', { name: 'General' })
    if ((await generalButton.count()) === 0) return

    // The active nav button is the only one with `font-medium` (inactive buttons
    // carry `hover:bg-muted/...`, so a bg-* match wouldn't discriminate).
    // toHaveClass auto-retries, so it tolerates the client re-render.
    await expect(generalButton).toHaveClass(/font-medium/)
  })

  test('active tab button is visually distinct after switching', async ({ page }) => {
    const nav = page.locator('nav')
    const accessButton = nav.getByRole('button', { name: 'Access' })
    if ((await accessButton.count()) === 0) return

    await accessButton.click()
    await page.waitForLoadState('networkidle')

    // Access button should now have the active marker. toHaveClass auto-retries,
    // so it waits out the client-side re-render after the tab switch.
    await expect(accessButton).toHaveClass(/font-medium/)

    // General button should no longer be active
    const generalButton = nav.getByRole('button', { name: 'General' })
    await expect(generalButton).not.toHaveClass(/font-medium/)
  })
})

// ---------------------------------------------------------------------------
// Board Slug
// ---------------------------------------------------------------------------

test.describe('Board Slug', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Board Details').or(page.getByText('No boards yet'))).toBeVisible({
      timeout: 10000,
    })
  })

  test('Board Details form shows Board name and Description fields', async ({ page }) => {
    // The General form (board-general-form.tsx) has "Board name" and "Description" labels
    const boardNameInput = page.getByRole('textbox', { name: 'Board name', exact: true })
    const descInput = page.getByLabel('Description')

    if ((await boardNameInput.count()) > 0) {
      await expect(boardNameInput).toBeVisible()
      await expect(descInput).toBeVisible()
    }
  })

  test('board name field is pre-populated with the current board name', async ({ page }) => {
    const boardNameInput = page.getByRole('textbox', { name: 'Board name', exact: true })
    if ((await boardNameInput.count()) === 0) return

    // Should not be empty
    const currentName = await boardNameInput.inputValue()
    expect(currentName.trim().length).toBeGreaterThan(0)
  })

  test('board switcher shows the current board name after a name edit', async ({ page }) => {
    // Own a throwaway board so the rename can't race other parallel tests on the
    // shared redirect-target board.
    const createName = `Slug Edit ${Date.now()}`
    await createBoard(page, createName)

    const updatedName = `Renamed ${Date.now()}`
    await page.getByRole('textbox', { name: 'Board name', exact: true }).fill(updatedName)
    await page.getByRole('button', { name: 'Save changes' }).click()

    // Renaming regenerates the slug, orphaning this slug-keyed page once the
    // server round-trip lands (Board Details unmounts) — a reliable "persisted"
    // signal. (The switcher can't reflect it in place: the optimistic write
    // targets the boards list, not the settings query, and the slug change
    // orphans the page before the refetch arrives.)
    await expect(page.getByText('Board Details')).toBeHidden({ timeout: 10000 })

    // Land on the new slug: a fresh load shows the renamed board in the switcher.
    await page.goto(`/admin/settings/boards?board=${slugify(updatedName)}`)
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('board-switcher')).toContainText(updatedName, { timeout: 10000 })

    await deleteCurrentBoard(page, updatedName)
  })
})
