import { test, expect } from '@playwright/test'

test.describe('Public Post List — chip filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('shows the implied Active only status by default', async ({ page }) => {
    const filters = page.getByRole('region', { name: 'Active filters' })
    await expect(filters.getByText('Active only')).toBeVisible()
  })

  test('picking a status from the implied chip filters by it', async ({ page }) => {
    const filters = page.getByRole('region', { name: 'Active filters' })
    await filters.getByText('Active only').click()
    await page.getByRole('button', { name: 'Complete', exact: true }).click()

    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    await expect(filters.getByText('Active only')).not.toBeVisible()
  })

  test('Filter → Vote count → 5+ filters posts and adds a chip', async ({ page }) => {
    await page.getByRole('button', { name: /^add filter$/i }).click()
    await page.getByRole('button', { name: /^Vote count$/i }).click()
    await page.getByRole('option', { name: '5+ votes', exact: true }).click()

    await expect(page).toHaveURL(/[?&]minVotes=5/, { timeout: 5000 })
    await expect(page.getByText(/min votes:/i)).toBeVisible()
  })

  test('Clear all wipes filters and the implied status returns', async ({ page }) => {
    await page.getByRole('button', { name: /^add filter$/i }).click()
    await page.getByRole('button', { name: /^Vote count$/i }).click()
    await page.getByRole('option', { name: '5+ votes', exact: true }).click()

    await page.getByRole('button', { name: /^add filter$/i }).click()
    await page.getByRole('button', { name: /^Created date$/i }).click()
    await page.getByRole('option', { name: /last 7 days/i }).click()

    await page.getByRole('button', { name: /clear all/i }).click()

    await expect(page).not.toHaveURL(/minVotes/)
    await expect(page).not.toHaveURL(/dateFrom/)
    await expect(page.getByText('Active only')).toBeVisible()
  })

  test('search finds a complete post that the default view hides', async ({ page }) => {
    // The route reads status as a JSON array, the way the app writes it.
    await page.goto(`/?status=${encodeURIComponent(JSON.stringify(['complete']))}`)
    const firstTitle = page.locator('[data-post-id] h3').first()
    await expect(firstTitle).toBeVisible()
    const title = (await firstTitle.innerText()).trim()

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill(title)

    await expect(page).toHaveURL(/[?&]search=/, { timeout: 5000 })
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Active filters' }).getByText('All', { exact: true })
    ).toBeVisible()
  })
})
