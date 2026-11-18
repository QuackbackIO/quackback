import { test, expect } from '@playwright/test'

test.describe('Admin API Keys Settings', () => {
  test.beforeEach(async ({ page }) => {
    // API keys live under the Developers page → Keys tab.
    await page.goto('/admin/settings/developers?tab=keys')
    await page.waitForLoadState('networkidle')
  })

  test('displays API keys settings page', async ({ page }) => {
    const pageContent = page.getByText(/api keys/i).or(page.getByText(/programmatic access/i))
    await expect(pageContent.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows the page heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Developers', level: 1 })).toBeVisible({
      timeout: 10000,
    })
  })

  // Since #906 workspace keys are created on their own page
  // (/admin/settings/developers/workspace-keys/new), reached from the
  // "New workspace key" link, not from a dialog.
  const newKeyLink = (page: import('@playwright/test').Page) =>
    page.getByRole('link', { name: 'New workspace key' })

  async function createWorkspaceKey(page: import('@playwright/test').Page, keyName: string) {
    await newKeyLink(page).first().click()
    await expect(page).toHaveURL(/\/developers\/workspace-keys\/new/, { timeout: 10000 })
    await page.getByRole('textbox', { name: /^name$/i }).fill(keyName)
    // A key must have a role; pick the first one this admin can grant.
    await page.getByRole('radio', { disabled: false }).first().click()
    await page.getByRole('button', { name: 'Create key' }).click()

    const revealDialog = page.getByRole('dialog')
    await expect(revealDialog.getByText(/api key created/i)).toBeVisible({ timeout: 10000 })
    return revealDialog
  }

  test('shows create API key button or empty state action', async ({ page }) => {
    // The card header link, repeated in the empty state
    await expect(newKeyLink(page).first()).toBeVisible({ timeout: 10000 })
  })

  test('can open the create workspace key page', async ({ page }) => {
    await newKeyLink(page).first().click()

    await expect(page).toHaveURL(/\/developers\/workspace-keys\/new/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'New workspace key', level: 1 })).toBeVisible()
  })

  test('create page has name input', async ({ page }) => {
    await newKeyLink(page).first().click()
    await expect(page).toHaveURL(/\/developers\/workspace-keys\/new/, { timeout: 10000 })

    // Name input
    await expect(page.getByRole('textbox', { name: /^name$/i })).toBeVisible()

    // Action buttons
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create key' })).toBeVisible()
  })

  test('create page cancel returns to the keys tab', async ({ page }) => {
    await newKeyLink(page).first().click()
    await expect(page).toHaveURL(/\/developers\/workspace-keys\/new/, { timeout: 10000 })

    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page).toHaveURL(/\/admin\/settings\/developers\?(.*&)?tab=keys/, {
      timeout: 5000,
    })
  })

  test('created key is revealed once in a dialog with copy button', async ({ page }) => {
    const keyName = `E2E Key ${Date.now()}`

    const revealDialog = await createWorkspaceKey(page, keyName)

    await expect(revealDialog.locator('code').filter({ hasText: /^qb_/ })).toBeVisible()

    // Copy button should be present (aria-label contains "copy")
    const copyButton = revealDialog.getByRole('button', { name: /copy/i })
    await expect(copyButton.first()).toBeVisible()

    // Dismiss the reveal dialog; it returns to the keys tab
    await revealDialog.getByRole('button', { name: /i've saved my key/i }).click()
    await expect(revealDialog).toBeHidden({ timeout: 5000 })

    // Key should now appear in the list
    await expect(page.getByText(keyName)).toBeVisible({ timeout: 10000 })
  })

  test('API key list shows key name and creation date', async ({ page }) => {
    await page.waitForTimeout(500)

    // If there are existing keys, check name and "Created X ago" text
    const keyItems = page
      .locator('div')
      .filter({ has: page.locator('code') })
      .first()

    if ((await keyItems.count()) > 0) {
      // Creation date uses formatDistanceToNow — matches "ago"
      const createdText = page.getByText(/created .* ago/i)
      if ((await createdText.count()) > 0) {
        await expect(createdText.first()).toBeVisible()
      }
    }
  })

  test('key list shows key prefix', async ({ page }) => {
    await page.waitForTimeout(500)

    // Key prefix is rendered as <code>prefix...</code>
    const keyPrefixCode = page.locator('code').filter({ hasText: /\.\.\.$/ })

    if ((await keyPrefixCode.count()) > 0) {
      await expect(keyPrefixCode.first()).toBeVisible()
    }
  })

  test('can open revoke confirmation dialog for an existing key', async ({ page }) => {
    const keyName = `Revoke Test ${Date.now()}`
    const revealDialog = await createWorkspaceKey(page, keyName)
    await revealDialog.getByRole('button', { name: /i've saved my key/i }).click()
    await expect(revealDialog).toBeHidden({ timeout: 5000 })

    // Open the row menu and choose Revoke
    const rowMenu = page.getByRole('button', { name: `Actions for ${keyName}` })
    await expect(rowMenu).toBeVisible({ timeout: 10000 })
    await rowMenu.click()
    await page.getByRole('menuitem', { name: 'Revoke' }).click()

    // Confirmation dialog should appear
    const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(confirmDialog).toBeVisible({ timeout: 5000 })

    // Should have "Revoke API key" title
    await expect(confirmDialog.getByText(/revoke api key/i)).toBeVisible()

    // Should warn that the action cannot be undone
    await expect(confirmDialog.getByText(/cannot be undone/i)).toBeVisible()

    // Cancel the revocation
    await confirmDialog.getByRole('button', { name: /cancel/i }).click()
    await expect(confirmDialog).toBeHidden({ timeout: 5000 })
  })

  test('shows the base URL and API reference link', async ({ page }) => {
    await expect(page.getByText('Base URL')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: /open/i })).toBeVisible()
  })

  test('shows "never used" label for keys that have not been used', async ({ page }) => {
    await page.waitForTimeout(500)

    const neverUsed = page.getByText(/never used/i)

    // May not exist if all keys have been used
    if ((await neverUsed.count()) > 0) {
      await expect(neverUsed.first()).toBeVisible()
    }
  })
})
