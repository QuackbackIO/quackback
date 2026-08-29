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
  await expect(page).toHaveURL(new RegExp(`/admin/settings/boards/${slugify(name)}(?:\\?|$)`), {
    timeout: 10000,
  })
  await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 10000 })
}

/** Open the first board row on the settings list. */
async function openFirstBoard(page: Page): Promise<void> {
  const row = page.locator('a[href*="/admin/settings/boards/"]').first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await expect(page).toHaveURL(/\/admin\/settings\/boards\/[^/?]+/)
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible({ timeout: 10000 })
}

/** Create a throwaway board and open its Access tab, settled on Public. */
async function createBoardOnAccessTab(page: Page, name: string): Promise<void> {
  await createBoard(page, name)
  await page.getByRole('tab', { name: 'Access' }).click()
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
  await page.getByRole('tab', { name: 'General' }).click()
  await expect(page.getByText('Danger Zone')).toBeVisible({ timeout: 5000 })
  await page.getByPlaceholder(name).fill(name)
  const del = page.getByRole('button', { name: 'Delete board', exact: true })
  await expect(del).toBeEnabled()
  await del.click()
  await expect(page).toHaveURL(/\/admin\/settings\/boards\/?(\?|$)/, { timeout: 10000 })
}

test.describe('Admin Board Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')
  })

  test('displays board settings page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Boards' })).toBeVisible({ timeout: 10000 })
  })

  test('can access board general settings', async ({ page }) => {
    await openFirstBoard(page)
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('textbox', { name: 'Board name', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
    await expect(page.getByTestId('board-switcher')).toHaveCount(0)
  })

  test('can edit board name', async ({ page }) => {
    await openFirstBoard(page)
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
    await openFirstBoard(page)
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
    await openFirstBoard(page)
    // Should show danger zone section
    const dangerZone = page.getByText('Danger Zone')
    await expect(dangerZone).toBeVisible({ timeout: 10000 })

    const deleteButton = page.getByRole('button', { name: 'Delete board', exact: true })
    await expect(deleteButton).toBeVisible()
  })

  test('delete button shows confirmation dialog', async ({ page }) => {
    await openFirstBoard(page)
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
    await openFirstBoard(page)
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
    await openFirstBoard(page)
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

    await openFirstBoard(page)

    // Switch to the Access tab (sets ?tab=access).
    await page.getByRole('tab', { name: 'Access' }).click()
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

    await expect(page.getByRole('heading', { name: testBoardName })).toBeVisible({ timeout: 10000 })
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
    await openFirstBoard(page)

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

    // Wait for page to be ready - either the boards list or empty state
    await expect(
      page.getByRole('heading', { name: 'Boards' }).or(page.getByText('No boards yet'))
    ).toBeVisible({
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

    await expect(page.getByRole('heading', { name: testBoardName })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(testBoardName)

    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('link', { name: new RegExp(testBoardName) })).toBeVisible({
      timeout: 10000,
    })
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
    await expect(
      page.getByRole('heading', { name: 'Boards' }).or(page.getByText('No boards yet'))
    ).toBeVisible({
      timeout: 10000,
    })
    if (await page.getByText('No boards yet').count()) return
    await openFirstBoard(page)
  })

  test('General tab shows the board form and Danger Zone', async ({ page }) => {
    await expect(page.getByRole('textbox', { name: 'Board name', exact: true })).toBeVisible({
      timeout: 10000,
    })
    await expect(page.getByText('Danger Zone')).toBeVisible()
  })

  test('settings nav shows General, Access, Import Data, Export Data buttons', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'General' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('tab', { name: 'Access' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Import Data' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Export Data' })).toBeVisible()
  })

  test('clicking Access tab switches to Access Control view', async ({ page }) => {
    const accessTab = page.getByRole('tab', { name: 'Access' })
    if ((await accessTab.count()) === 0) return

    await accessTab.click()
    await expect(page.getByText('Access Control')).toBeVisible({ timeout: 5000 })
    // URL should reflect the tab change
    await expect(page).toHaveURL(/tab=access/)
  })

  test('clicking Import Data tab switches to import view', async ({ page }) => {
    const importTab = page.getByRole('tab', { name: 'Import Data' })
    if ((await importTab.count()) === 0) return

    await importTab.click()
    await expect(page.getByText('Import Data')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Import posts from a CSV file into this board')).toBeVisible()
  })

  test('clicking Export Data tab switches to export view and shows Export CSV button', async ({
    page,
  }) => {
    const exportTab = page.getByRole('tab', { name: 'Export Data' })
    if ((await exportTab.count()) === 0) return

    await exportTab.click()
    await expect(page.getByText('Export Data')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Download all posts from this board as CSV')).toBeVisible()
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible()
  })

  test('arrow keys move between board settings tabs', async ({ page }) => {
    const generalTab = page.getByRole('tab', { name: 'General' })
    if ((await generalTab.count()) === 0) return

    await generalTab.focus()
    await page.keyboard.press('ArrowRight')

    await expect(page.getByRole('tab', { name: 'Access' })).toBeFocused()
  })

  test('General tab is active by default (highlighted)', async ({ page }) => {
    const generalTab = page.getByRole('tab', { name: 'General' })
    if ((await generalTab.count()) === 0) return

    await expect(generalTab).toHaveAttribute('data-state', 'active')
  })

  test('active tab button is visually distinct after switching', async ({ page }) => {
    const accessTab = page.getByRole('tab', { name: 'Access' })
    if ((await accessTab.count()) === 0) return

    await accessTab.click()
    await page.waitForLoadState('networkidle')

    await expect(accessTab).toHaveAttribute('data-state', 'active')
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'data-state',
      'inactive'
    )
  })
})

// ---------------------------------------------------------------------------
// Board Slug
// ---------------------------------------------------------------------------

test.describe('Board Slug', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/boards')
    await page.waitForLoadState('networkidle')
    await expect(
      page.getByRole('heading', { name: 'Boards' }).or(page.getByText('No boards yet'))
    ).toBeVisible({
      timeout: 10000,
    })
    if (await page.getByText('No boards yet').count()) return
    await openFirstBoard(page)
  })

  test('General form shows Board name and Description fields', async ({ page }) => {
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

  test('board heading shows the current board name after a name edit', async ({ page }) => {
    // Own a throwaway board so the rename can't race other parallel tests on the
    // shared redirect-target board.
    const createName = `Slug Edit ${Date.now()}`
    await createBoard(page, createName)

    const updatedName = `Renamed ${Date.now()}`
    await page.getByRole('textbox', { name: 'Board name', exact: true }).fill(updatedName)
    await page.getByRole('button', { name: 'Save changes' }).click()

    await expect(page).toHaveURL(
      new RegExp(`/admin/settings/boards/${slugify(updatedName)}(?:\\?|$)`),
      { timeout: 10000 }
    )
    await expect(page.getByRole('heading', { name: updatedName })).toBeVisible({ timeout: 10000 })

    await deleteCurrentBoard(page, updatedName)
  })
})
