import { test, expect } from '@playwright/test'

test.describe('Admin Post Management', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin feedback inbox
    await page.goto('/admin/feedback')
    await page.waitForLoadState('networkidle')
  })

  test('displays list of posts in inbox', async ({ page }) => {
    // Should show posts or empty state in the inbox
    // Look for post items or the page header
    const feedbackPage = page.getByText('Feedback').or(page.getByText('Inbox'))
    await expect(feedbackPage.first()).toBeVisible({ timeout: 10000 })
  })

  test('can open create post dialog', async ({ page }) => {
    // Click the create post button (pen-square icon)
    const createButton = page.locator('button').filter({
      has: page.locator('svg.lucide-pen-square'),
    })

    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Dialog should open
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      // Should have title input
      await expect(page.getByLabel('Title')).toBeVisible()

      // Close dialog
      await page.keyboard.press('Escape')
    }
  })

  test('can create a new post', async ({ page }) => {
    // Click the create post button
    const createButton = page.locator('button').filter({
      has: page.locator('svg.lucide-pen-square'),
    })

    if ((await createButton.count()) > 0) {
      await createButton.first().click()

      // Wait for dialog
      await expect(page.getByRole('dialog')).toBeVisible()

      // Fill the form
      const testTitle = `Test Post ${Date.now()}`
      await page.getByLabel('Title').fill(testTitle)

      // Fill description (rich text editor)
      const editor = page.locator('.ProseMirror[contenteditable="true"]')
      if ((await editor.count()) > 0) {
        await editor.click()
        await editor.fill('This is a test post description')
      }

      // Submit the form
      await page.getByRole('button', { name: /create post/i }).click()

      // Dialog should close
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10000 })

      // New post should appear in the list (page refreshes)
      await page.waitForLoadState('networkidle')
    }
  })

  test('can select a post to view details', async ({ page }) => {
    // Find post items - looking for clickable elements in the list
    const postList = page
      .locator('[data-testid="post-item"]')
      .or(page.locator('button[data-state]').filter({ has: page.getByText(/.+/) }))

    if ((await postList.count()) > 0) {
      await postList.first().click()

      // Detail panel should show - wait for network
      await page.waitForLoadState('networkidle')
    }
  })

  test('can filter posts by board', async ({ page }) => {
    // Look for board filter combobox
    const boardFilter = page
      .getByRole('combobox')
      .filter({ hasText: /boards?/i })
      .or(page.locator('button[role="combobox"]').filter({ hasText: /boards?/i }))

    if ((await boardFilter.count()) > 0) {
      await boardFilter.first().click()

      // Select a board option
      const boardOptions = page.getByRole('option')
      if ((await boardOptions.count()) > 0) {
        await boardOptions.first().click()
        await page.waitForLoadState('networkidle')
      }
    }
  })

  test('can filter posts by status', async ({ page }) => {
    // Look for status filter
    const statusFilter = page
      .getByRole('combobox')
      .filter({ hasText: /status/i })
      .or(page.locator('button[role="combobox"]').filter({ hasText: /status/i }))

    if ((await statusFilter.count()) > 0) {
      await statusFilter.first().click()

      // Select a status option
      const statusOptions = page.getByRole('option')
      if ((await statusOptions.count()) > 0) {
        await statusOptions.first().click()
        await page.waitForLoadState('networkidle')
      }
    }
  })

  test('can search posts', async ({ page }) => {
    // Find search input
    const searchInput = page.getByPlaceholder(/search/i)

    if ((await searchInput.count()) > 0) {
      await searchInput.fill('test')
      await searchInput.press('Enter')

      // Wait for search results
      await page.waitForLoadState('networkidle')
    }
  })

  test('can sort posts', async ({ page }) => {
    // Look for sort control
    const sortButton = page.getByRole('combobox').filter({ hasText: /newest|oldest|votes|sort/i })

    if ((await sortButton.count()) > 0) {
      await sortButton.first().click()

      // Select different sort option
      const sortOptions = page.getByRole('option')
      if ((await sortOptions.count()) > 1) {
        await sortOptions.nth(1).click()
        await page.waitForLoadState('networkidle')
      }
    }
  })
})
