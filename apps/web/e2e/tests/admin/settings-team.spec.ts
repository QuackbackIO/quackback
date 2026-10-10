import { test, expect } from '@playwright/test'

test.describe('Admin Team Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/members')
    await page.waitForLoadState('networkidle')
  })

  test('displays team members page', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Members & Teams' })).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows at least one team member', async ({ page }) => {
    await page.waitForTimeout(500)

    // Each member row renders an Avatar and name/email — look for table rows
    const tableRows = page.locator('tbody tr')
    await expect(tableRows.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows member email in table', async ({ page }) => {
    // The seeded admin user has an email — it appears as muted text in the name cell
    const emailCell = page.locator('p.text-sm.text-muted-foreground').filter({ hasText: /@/ })
    await expect(emailCell.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows role badge for members', async ({ page }) => {
    // Role column renders a Badge with "admin" or "member"
    const roleBadge = page.getByText(/^admin$/i).or(page.getByText(/^member$/i))
    await expect(roleBadge.first()).toBeVisible({ timeout: 10000 })
  })

  test('shows "Add people" button', async ({ page }) => {
    const addButton = page.getByRole('button', { name: /add people/i })
    await expect(addButton).toBeVisible({ timeout: 10000 })
  })

  test('shows search input for filtering members', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search by name, email or role/i)
    await expect(searchInput).toBeVisible({ timeout: 10000 })
  })

  test('search input filters the member list', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search by name, email or role/i)
    await searchInput.fill('nonexistentuserxyz')

    await page.waitForTimeout(300)

    // Should show "No results found" when nothing matches
    const noResults = page.getByText(/no results found|no team members/i)
    await expect(noResults).toBeVisible({ timeout: 5000 })

    // Clear search
    await searchInput.fill('')
  })

  test('can open the add people dialog', async ({ page }) => {
    await page.getByRole('button', { name: /add people/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByRole('heading', { name: 'Add people' })).toBeVisible()
  })

  test('add people dialog has the people field, role and actions', async ({ page }) => {
    await page.getByRole('button', { name: /add people/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.getByRole('combobox', { name: 'People' })).toBeVisible()
    await expect(dialog.getByText('Role', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    // Nothing chosen yet, so there is nothing to add.
    await expect(dialog.getByRole('button', { name: /^add people$/i })).toBeDisabled()
  })

  test('add people dialog cancel closes the dialog', async ({ page }) => {
    await page.getByRole('button', { name: /add people/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('typing a new full email offers to invite it', async ({ page }) => {
    await page.getByRole('button', { name: /add people/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    const address = `e2e-${Date.now()}@example.com`
    await dialog.getByRole('combobox', { name: 'People' }).fill(address)
    await dialog.getByRole('option', { name: `Invite ${address}` }).click()
    await expect(dialog.getByRole('button', { name: `Remove ${address}` })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^invite 1 person$/i })).toBeEnabled()

    await dialog.getByRole('button', { name: /cancel/i }).click()
  })

  test('shows "you" label next to the current user', async ({ page }) => {
    // The current admin user row renders "(you)" next to their name
    const youLabel = page.locator('span').filter({ hasText: /\(you\)/ })
    await expect(youLabel).toBeVisible({ timeout: 10000 })
  })

  test('shows "Invited" badge for pending invitations if any exist', async ({ page }) => {
    await page.waitForTimeout(500)

    const invitedBadge = page.getByText('Invited')

    // Invited badge may not exist in a fresh seed — guard with count check
    if ((await invitedBadge.count()) > 0) {
      await expect(invitedBadge.first()).toBeVisible()
    }
  })
})
