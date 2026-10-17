import { test, expect } from '@playwright/test'

test.describe('Admin feedback search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/feedback')
    await page.waitForLoadState('networkidle')
  })

  test('sorts by best match while searching, and back to newest when cleared', async ({ page }) => {
    const search = page.getByPlaceholder('Search posts...')
    await search.fill('Zap')
    await expect(page).toHaveURL(/[?&]sort=relevance/, { timeout: 5000 })
    await expect(page.getByText(/Zapier/i).first()).toBeVisible()

    await search.fill('')
    await expect(page).not.toHaveURL(/[?&]sort=/, { timeout: 5000 })
  })

  test('a misspelling finds the post and says the match is close', async ({ page }) => {
    await page.getByPlaceholder('Search posts...').fill('integraton')
    await expect(
      page.getByText('No exact matches. Showing posts with a similar spelling.')
    ).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/integration/i).first()).toBeVisible()
  })

  test('a search no post has every word of shows posts with most of them', async ({ page }) => {
    await page.getByPlaceholder('Search posts...').fill('csv export option')
    await expect(
      page.getByText('No post has all your words. Showing posts with most of them.')
    ).toBeVisible({ timeout: 5000 })
  })
})
