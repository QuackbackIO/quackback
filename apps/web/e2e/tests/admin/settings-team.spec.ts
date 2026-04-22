import { test, expect } from '@playwright/test'

test.describe('Admin Team Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/team')
    await page.waitForLoadState('networkidle')
  })

  test('displays team members page', async ({ page }) => {
    const pageContent = page.getByText(/team members/i).or(page.getByText(/manage who/i))
    await expect(pageContent.first()).toBeVisible({ timeout: 10000 })
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

  test('shows "Invite member" button', async ({ page }) => {
    const inviteButton = page.getByRole('button', { name: /invite member/i })
    await expect(inviteButton).toBeVisible({ timeout: 10000 })
  })

  test('shows search input for filtering members', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search by name, email, or role/i)
    await expect(searchInput).toBeVisible({ timeout: 10000 })
  })

  test('search input filters the member list', async ({ page }) => {
    const searchInput = page.getByPlaceholder(/search by name, email, or role/i)
    await searchInput.fill('nonexistentuserxyz')

    await page.waitForTimeout(300)

    // Should show "No results found" when nothing matches
    const noResults = page.getByText(/no results found|no team members/i)
    await expect(noResults).toBeVisible({ timeout: 5000 })

    // Clear search
    await searchInput.fill('')
  })

  test('can open invite member dialog', async ({ page }) => {
    const inviteButton = page.getByRole('button', { name: /invite member/i })
    await inviteButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.getByText(/invite team member/i)).toBeVisible()
  })

  test('invite dialog has name, email, and role fields', async ({ page }) => {
    await page.getByRole('button', { name: /invite member/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Name field
    await expect(dialog.getByRole('textbox', { name: /^name$/i })).toBeVisible()

    // Email field
    await expect(dialog.getByRole('textbox', { name: /email address/i })).toBeVisible()

    // Role selector
    await expect(dialog.getByRole('combobox')).toBeVisible()

    // Action buttons
    await expect(dialog.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /send invitation/i })).toBeVisible()
  })

  test('invite dialog cancel closes the dialog', async ({ page }) => {
    await page.getByRole('button', { name: /invite member/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toBeHidden({ timeout: 5000 })
  })

  test('invite dialog shows validation error for invalid email', async ({ page }) => {
    await page.getByRole('button', { name: /invite member/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Fill in an invalid email and submit
    await dialog.getByRole('textbox', { name: /email address/i }).fill('not-an-email')
    await dialog.getByRole('button', { name: /send invitation/i }).click()

    // Should show a validation message near the email field
    const validationMsg = dialog.getByText(/invalid|valid email|email/i)
    await expect(validationMsg.first()).toBeVisible({ timeout: 5000 })

    // Close dialog
    await dialog.getByRole('button', { name: /cancel/i }).click()
  })

  test('invite dialog role selector shows admin and member options', async ({ page }) => {
    await page.getByRole('button', { name: /invite member/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // Open role selector
    await dialog.getByRole('combobox').click()

    // Should list member and admin options
    await expect(page.getByRole('option', { name: /^member/i })).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('option', { name: /^admin/i })).toBeVisible({ timeout: 8000 })

    await page.keyboard.press('Escape')
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
