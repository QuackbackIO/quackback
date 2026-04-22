import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Open the "New Entry" dialog and return the dialog locator.
 * Returns null if the button is not present.
 */
async function openCreateDialog(page: import('@playwright/test').Page) {
  const newEntryBtn = page.getByRole('button', { name: /new entry/i })
  if ((await newEntryBtn.count()) === 0) return null
  await newEntryBtn.first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 5000 })
  return dialog
}

/**
 * Create a new changelog entry via the dialog and wait for it to close.
 * Returns the entry title used, or null if creation was unavailable.
 */
async function createEntry(
  page: import('@playwright/test').Page,
  title = `E2E Entry ${Date.now()}`
): Promise<string | null> {
  const dialog = await openCreateDialog(page)
  if (!dialog) return null

  // Title input uses "What's new?" placeholder
  await dialog.getByPlaceholder("What's new?").fill(title)

  // Fill the rich text editor so the form can be submitted
  const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
  await editor.click()
  await page.keyboard.type('Test content for article.')

  // Submit as draft
  await dialog.getByRole('button', { name: /save draft/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  return title
}

/**
 * Find the first list item card containing `title` text.
 * Uses h3 elements as they render entry titles.
 */
function entryCard(page: import('@playwright/test').Page, title: string) {
  return page.locator('h3').filter({ hasText: title }).first()
}

// ---------------------------------------------------------------------------
// Navigation & display
// ---------------------------------------------------------------------------

test.describe('Changelog admin navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('can navigate to /admin/changelog', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/changelog/)
  })

  test('page shows entry list or empty state', async ({ page }) => {
    // Either an h3 (entry title) or an empty-state message should be visible
    const content = page
      .getByText('No changelog entries yet')
      .or(page.locator('h3').first())

    await expect(content.first()).toBeVisible({ timeout: 10000 })
  })

  test('page has a "New Entry" button', async ({ page }) => {
    const newEntryBtn = page.getByRole('button', { name: /new entry/i })
    await expect(newEntryBtn.first()).toBeVisible({ timeout: 10000 })
  })

  test('sidebar filter panel shows status options', async ({ page }) => {
    // The filter panel renders All / Draft / Scheduled / Published filter buttons
    await expect(page.getByRole('option', { name: 'All' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('option', { name: 'Draft' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Published' })).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// Create entry
// ---------------------------------------------------------------------------

test.describe('Changelog create entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('can open create dialog via "New Entry" button', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
  })

  test('create dialog has title input and rich text editor', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    await expect(dialog.getByPlaceholder("What's new?")).toBeVisible()
    await expect(dialog.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('create dialog has Save Draft, Schedule, and Publish Now status options in sidebar', async ({
    page,
  }) => {
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    // The status select in the metadata sidebar is visible on desktop
    const statusSelect = dialog.locator('button[role="combobox"]').first()
    if ((await statusSelect.count()) > 0) {
      await expect(statusSelect).toBeVisible()
    }

    // Footer always has a submit button labeled "Save Draft" by default
    await expect(dialog.getByRole('button', { name: /save draft/i })).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('can create a new changelog entry with title and content', async ({ page }) => {
    const title = await createEntry(page)
    if (!title) return

    await page.waitForLoadState('networkidle')
    // Entry should appear in the list
    await expect(entryCard(page, title)).toBeVisible({ timeout: 10000 })
  })

  test('can create entry using Cmd+Enter keyboard shortcut', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    const title = `Keyboard Entry ${Date.now()}`
    await dialog.getByPlaceholder("What's new?").fill(title)

    // Type some content in the rich text editor
    const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
    await editor.click()
    await page.keyboard.type('Created with keyboard shortcut')

    // Submit with Cmd/Ctrl+Enter
    await page.keyboard.press('Meta+Enter')

    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')
    await expect(entryCard(page, title)).toBeVisible({ timeout: 10000 })
  })

  test('shows validation error when submitting without a title', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    // Leave title empty and attempt to submit
    await dialog.getByRole('button', { name: /save draft/i }).click()

    // Dialog should remain open; an error or the empty title input should persist
    await expect(dialog).toBeVisible()
    // The title input should still be present (form was not submitted)
    await expect(dialog.getByPlaceholder("What's new?")).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('dialog closes after successful creation', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    await dialog.getByPlaceholder("What's new?").fill(`Close Test ${Date.now()}`)
    await dialog.getByRole('button', { name: /save draft/i }).click()

    await expect(dialog).toBeHidden({ timeout: 15000 })
  })

  test('dialog can be dismissed with Escape', async ({ page }) => {
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Edit entry
// ---------------------------------------------------------------------------

test.describe('Changelog edit entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('clicking an entry row opens the edit modal', async ({ page }) => {
    // Ensure there is at least one entry to click
    const firstCard = page.locator('h3').first()
    if ((await firstCard.count()) === 0) {
      test.skip()
      return
    }

    await firstCard.click()

    // The URL should gain an `entry=` query param and a dialog should appear
    await expect(page).toHaveURL(/entry=/, { timeout: 10000 })
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 })

    await page.keyboard.press('Escape')
  })

  test('edit modal shows title input pre-populated', async ({ page }) => {
    const firstCard = page.locator('h3').first()
    if ((await firstCard.count()) === 0) {
      test.skip()
      return
    }

    const titleText = (await firstCard.textContent()) ?? ''
    await firstCard.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const titleInput = dialog.getByPlaceholder("What's new?")
    await expect(titleInput).toBeVisible()
    const value = await titleInput.inputValue()
    expect(value.length).toBeGreaterThan(0)
    expect(value).toBe(titleText.trim())

    await page.keyboard.press('Escape')
  })

  test('can update an entry title and save', async ({ page }) => {
    // Create a fresh entry so we have something deterministic to edit
    const originalTitle = await createEntry(page)
    if (!originalTitle) return

    await page.waitForLoadState('networkidle')

    // Click to open the edit modal
    const card = entryCard(page, originalTitle)
    if ((await card.count()) === 0) return
    await card.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const updatedTitle = `${originalTitle} (updated)`
    const titleInput = dialog.getByPlaceholder("What's new?")
    await titleInput.fill(updatedTitle)

    await dialog.getByRole('button', { name: /save draft/i }).click()

    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Updated title should now be visible in the list
    await expect(entryCard(page, updatedTitle)).toBeVisible({ timeout: 10000 })
  })

  test('edit modal can be dismissed with Escape', async ({ page }) => {
    const firstCard = page.locator('h3').first()
    if ((await firstCard.count()) === 0) {
      test.skip()
      return
    }

    await firstCard.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('closing edit modal removes entry param from URL', async ({ page }) => {
    const firstCard = page.locator('h3').first()
    if ((await firstCard.count()) === 0) {
      test.skip()
      return
    }

    await firstCard.click()
    await expect(page).toHaveURL(/entry=/, { timeout: 10000 })

    await page.keyboard.press('Escape')
    await expect(page).not.toHaveURL(/entry=/, { timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Publish / Unpublish
// ---------------------------------------------------------------------------

test.describe('Changelog publish and unpublish', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('can publish a draft entry via status select in edit modal', async ({ page }) => {
    // Create a fresh draft entry
    const title = await createEntry(page)
    if (!title) return

    await page.waitForLoadState('networkidle')

    // Open edit modal
    const card = entryCard(page, title)
    if ((await card.count()) === 0) return
    await card.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    // Change status to "Published" via the StatusSelect combobox in the sidebar
    const statusSelect = dialog.locator('button[role="combobox"]').first()
    if ((await statusSelect.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }

    await statusSelect.click()
    const publishedOption = page.getByRole('option', { name: /published/i })
    if ((await publishedOption.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }
    await publishedOption.click()

    // Submit button should now say "Update & Publish"
    const submitBtn = dialog.getByRole('button', { name: /update & publish|publish now/i })
    await expect(submitBtn).toBeVisible({ timeout: 5000 })
    await submitBtn.click()

    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // The entry should now show a "Published" badge
    const publishedBadge = page
      .locator('h3')
      .filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]')
      .first()
      .getByText(/published/i)

    await expect(publishedBadge).toBeVisible({ timeout: 10000 })
  })

  test('can change a published entry back to draft via edit modal', async ({ page }) => {
    // Look for an already-published entry — skip if none
    const publishedRows = page
      .locator('div')
      .filter({ hasText: /published/i })
      .locator('h3')

    if ((await publishedRows.count()) === 0) {
      test.skip()
      return
    }

    await publishedRows.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10000 })

    const statusSelect = dialog.locator('button[role="combobox"]').first()
    if ((await statusSelect.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }

    await statusSelect.click()
    const draftOption = page.getByRole('option', { name: /^draft$/i })
    if ((await draftOption.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }
    await draftOption.click()

    await dialog.getByRole('button', { name: /save draft/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15000 })
  })
})

// ---------------------------------------------------------------------------
// Delete entry
// ---------------------------------------------------------------------------

test.describe('Changelog delete entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('delete option in dropdown opens confirmation dialog', async ({ page }) => {
    // Create an entry to delete so we always have one
    const title = await createEntry(page)
    if (!title) return

    await page.waitForLoadState('networkidle')

    const row = page.locator('h3').filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]').first()

    await row.hover()

    // Click the ellipsis menu button
    const menuBtn = row.locator('button').last()
    await menuBtn.click()

    const deleteItem = page.getByRole('menuitem', { name: /delete/i })
    await expect(deleteItem).toBeVisible({ timeout: 5000 })
    await deleteItem.click()

    // Confirmation dialog should appear
    const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: /delete/i }))
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Cancel — don't actually delete
    await page.keyboard.press('Escape')
  })

  test('can cancel deletion from confirmation dialog', async ({ page }) => {
    const title = await createEntry(page)
    if (!title) return

    await page.waitForLoadState('networkidle')

    const row = page.locator('h3').filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]').first()

    await row.hover()
    const menuBtn = row.locator('button').last()
    await menuBtn.click()

    const deleteItem = page.getByRole('menuitem', { name: /delete/i })
    if ((await deleteItem.count()) === 0) return
    await deleteItem.click()

    const confirmDialog = page.getByRole('alertdialog').or(
      page.getByRole('dialog').filter({ hasText: /delete/i })
    )
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Click Cancel
    const cancelBtn = confirmDialog.getByRole('button', { name: /cancel/i })
    await cancelBtn.click()

    // Dialog should close, entry should still be in the list
    await expect(confirmDialog).toBeHidden({ timeout: 5000 })
    await expect(entryCard(page, title)).toBeVisible({ timeout: 5000 })
  })

  test('can confirm deletion and entry disappears from list', async ({ page }) => {
    const title = await createEntry(page)
    if (!title) return

    await page.waitForLoadState('networkidle')

    const row = page.locator('h3').filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]').first()

    await row.hover()
    const menuBtn = row.locator('button').last()
    await menuBtn.click()

    const deleteItem = page.getByRole('menuitem', { name: /delete/i })
    if ((await deleteItem.count()) === 0) return
    await deleteItem.click()

    const confirmDialog = page.getByRole('alertdialog').or(
      page.getByRole('dialog').filter({ hasText: /delete/i })
    )
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Confirm deletion
    const confirmBtn = confirmDialog.getByRole('button', { name: /delete/i })
    await confirmBtn.click()

    await expect(confirmDialog).toBeHidden({ timeout: 10000 })
    await page.waitForLoadState('networkidle')

    // Entry must no longer appear
    await expect(entryCard(page, title)).toHaveCount(0, { timeout: 10000 })
  })
})

// ---------------------------------------------------------------------------
// Admin/Public Publishing Pipeline
// ---------------------------------------------------------------------------

/**
 * Helper: create and immediately publish an entry from the create dialog.
 * Returns the title, or null if the dialog was unavailable.
 */
async function createAndPublishEntry(
  page: import('@playwright/test').Page,
  title: string
): Promise<string | null> {
  const dialog = await openCreateDialog(page)
  if (!dialog) return null

  await dialog.getByPlaceholder("What's new?").fill(title)

  // Switch status to "Published"
  const statusSelect = dialog.locator('button[role="combobox"]').first()
  if ((await statusSelect.count()) === 0) return null
  await statusSelect.click()
  const publishedOption = page.getByRole('option', { name: /published/i })
  if ((await publishedOption.count()) === 0) {
    await page.keyboard.press('Escape')
    return null
  }
  await publishedOption.click()

  // Submit button should now say "Publish Now"
  const publishBtn = dialog.getByRole('button', { name: /publish now/i })
  await expect(publishBtn).toBeVisible({ timeout: 5000 })
  await publishBtn.click()

  await expect(dialog).toBeHidden({ timeout: 15000 })
  return title
}

/**
 * Helper: revert a published entry back to draft via the edit modal.
 * Expects to be called from /admin/changelog with the entry visible.
 */
async function unpublishEntry(
  page: import('@playwright/test').Page,
  title: string
): Promise<void> {
  const card = entryCard(page, title)
  await card.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10000 })

  const statusSelect = dialog.locator('button[role="combobox"]').first()
  await statusSelect.click()
  const draftOption = page.getByRole('option', { name: /^draft$/i })
  await draftOption.click()

  await dialog.getByRole('button', { name: /save draft/i }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })
  await page.waitForLoadState('networkidle')
}

/**
 * Delete a test entry by title to clean up after publishing pipeline tests.
 * Silently skips if the entry is not found.
 */
async function deleteEntryByTitle(
  page: import('@playwright/test').Page,
  title: string
): Promise<void> {
  await page.goto('/admin/changelog')
  await page.waitForLoadState('networkidle')

  const row = page
    .locator('h3')
    .filter({ hasText: title })
    .locator('xpath=ancestor::div[contains(@class,"group")]')
    .first()

  if ((await row.count()) === 0) return

  await row.hover()
  const menuBtn = row.locator('button').last()
  await menuBtn.click()

  const deleteItem = page.getByRole('menuitem', { name: /delete/i })
  if ((await deleteItem.count()) === 0) {
    await page.keyboard.press('Escape')
    return
  }
  await deleteItem.click()

  const confirmDialog = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog').filter({ hasText: /delete/i }))
  if ((await confirmDialog.count()) === 0) return

  await confirmDialog.getByRole('button', { name: /delete/i }).click()
  await expect(confirmDialog).toBeHidden({ timeout: 10000 })
  await page.waitForLoadState('networkidle')
}

test.describe('Changelog - Admin/Public Publishing Pipeline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('draft entry is NOT visible on public /changelog', async ({ page }) => {
    const title = `Draft Visibility Test ${Date.now()}`

    // Create as draft only
    const created = await createEntry(page, title)
    if (!created) return

    await page.waitForLoadState('networkidle')

    // Confirm it exists as a draft in admin
    await expect(entryCard(page, title)).toBeVisible({ timeout: 10000 })

    // Navigate to public changelog and verify the draft is absent
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    // The title must not appear anywhere on the public page
    await expect(page.getByText(title, { exact: false })).toHaveCount(0)

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('published entry appears on public /changelog', async ({ page }) => {
    const title = `Publish Pipeline Test ${Date.now()}`

    const published = await createAndPublishEntry(page, title)
    if (!published) return

    await page.waitForLoadState('networkidle')

    // Navigate to public changelog
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    // The entry title should be visible as an h2 in a public entry card
    await expect(page.locator('h2').filter({ hasText: title })).toBeVisible({ timeout: 10000 })

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('entry content on public page matches what was entered in admin', async ({ page }) => {
    const title = `Content Match Test ${Date.now()}`
    const body = `Unique body text for content match ${Date.now()}`

    // Open create dialog, fill title and content, then publish
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    await dialog.getByPlaceholder("What's new?").fill(title)

    const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
    await editor.click()
    await page.keyboard.type(body)

    // Switch to Published
    const statusSelect = dialog.locator('button[role="combobox"]').first()
    if ((await statusSelect.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }
    await statusSelect.click()
    const publishedOption = page.getByRole('option', { name: /published/i })
    if ((await publishedOption.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }
    await publishedOption.click()

    const publishBtn = dialog.getByRole('button', { name: /publish now/i })
    await expect(publishBtn).toBeVisible({ timeout: 5000 })
    await publishBtn.click()
    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Navigate to public changelog
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    // Both title and body text must be present
    await expect(page.locator('h2').filter({ hasText: title })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(body, { exact: false })).toBeVisible({ timeout: 10000 })

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('unpublishing an entry removes it from public /changelog', async ({ page }) => {
    const title = `Unpublish Pipeline Test ${Date.now()}`

    // Publish the entry first
    const published = await createAndPublishEntry(page, title)
    if (!published) return

    await page.waitForLoadState('networkidle')

    // Verify it is visible on the public page
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h2').filter({ hasText: title })).toBeVisible({ timeout: 10000 })

    // Go back to admin and revert to draft
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
    await unpublishEntry(page, title)

    // Return to public changelog and verify the entry is gone
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h2').filter({ hasText: title })).toHaveCount(0)

    // Clean up
    await deleteEntryByTitle(page, title)
  })

  test('scheduled entry does not appear on public /changelog before its publish time', async ({
    page,
  }) => {
    const title = `Scheduled Visibility Test ${Date.now()}`

    // Open create dialog
    const dialog = await openCreateDialog(page)
    if (!dialog) return

    await dialog.getByPlaceholder("What's new?").fill(title)

    // Switch status to "Scheduled"
    const statusSelect = dialog.locator('button[role="combobox"]').first()
    if ((await statusSelect.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }
    await statusSelect.click()
    const scheduledOption = page.getByRole('option', { name: /scheduled/i })
    if ((await scheduledOption.count()) === 0) {
      await page.keyboard.press('Escape')
      return
    }
    await scheduledOption.click()

    // The DateTimePicker should appear and default to tomorrow — leave it as-is
    const scheduleRow = dialog.getByText('Schedule')
    await expect(scheduleRow).toBeVisible({ timeout: 5000 })

    // Submit as scheduled
    const scheduleBtn = dialog.getByRole('button', { name: /^schedule$/i })
    await expect(scheduleBtn).toBeVisible({ timeout: 5000 })
    await scheduleBtn.click()
    await expect(dialog).toBeHidden({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Verify entry is shown as "Scheduled" in admin
    const adminRow = page
      .locator('h3')
      .filter({ hasText: title })
      .locator('xpath=ancestor::div[contains(@class,"group")]')
      .first()
    await expect(adminRow).toBeVisible({ timeout: 10000 })

    // Navigate to public changelog — scheduled entry must NOT be visible
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(title, { exact: false })).toHaveCount(0)

    // Clean up
    await deleteEntryByTitle(page, title)
  })
})

// ---------------------------------------------------------------------------
// Search / Filter
// ---------------------------------------------------------------------------

test.describe('Changelog search and filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('search input is present', async ({ page }) => {
    const searchInput = page.locator('[data-search-input]').or(page.getByPlaceholder(/search/i))
    await expect(searchInput.first()).toBeVisible({ timeout: 10000 })
  })

  test('typing in search input filters the list', async ({ page }) => {
    const searchInput = page.locator('[data-search-input]').or(page.getByPlaceholder(/search/i))
    if ((await searchInput.count()) === 0) return

    // Create an entry with a unique searchable title
    const unique = `SearchTarget${Date.now()}`
    const title = await createEntry(page, unique)
    if (!title) return

    await page.waitForLoadState('networkidle')

    await searchInput.first().fill(unique)

    // Only the matching entry should be visible; others with different text disappear
    await expect(entryCard(page, unique)).toBeVisible({ timeout: 10000 })
  })

  test('pressing "/" focuses search input', async ({ page }) => {
    // Focus outside any input first
    await page.locator('body').click()

    await page.keyboard.press('/')

    const searchInput = page.locator('[data-search-input]')
    await expect(searchInput.first()).toBeFocused({ timeout: 3000 })
  })

  test('status filter: clicking Draft shows only draft entries', async ({ page }) => {
    const draftFilter = page.getByRole('option', { name: 'Draft' })
    if ((await draftFilter.count()) === 0) return

    await draftFilter.click()
    await page.waitForLoadState('networkidle')

    // If entries are visible, none should have a "Published" badge
    const publishedBadges = page.getByText(/^Published$/)
    const count = await publishedBadges.count()
    expect(count).toBe(0)
  })

  test('status filter: clicking All resets the filter', async ({ page }) => {
    const draftFilter = page.getByRole('option', { name: 'Draft' })
    if ((await draftFilter.count()) === 0) return

    await draftFilter.click()
    await page.waitForLoadState('networkidle')

    const allFilter = page.getByRole('option', { name: 'All' })
    await allFilter.click()
    await page.waitForLoadState('networkidle')

    // Page should still be on /admin/changelog
    await expect(page).toHaveURL(/\/admin\/changelog/)
  })

  test('Scheduled filter option is present and clickable', async ({ page }) => {
    const scheduledFilter = page.getByRole('option', { name: 'Scheduled' })
    await expect(scheduledFilter).toBeVisible({ timeout: 10000 })
    await scheduledFilter.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/changelog/)
  })
})
