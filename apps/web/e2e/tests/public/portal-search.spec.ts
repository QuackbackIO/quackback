import { test, expect } from '@playwright/test'

test.describe('Portal search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('finds ideas from the first letters of a word, best match first', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('Zap')
    await expect(page).toHaveURL(/[?&]search=Zap/, { timeout: 5000 })
    await expect(page).toHaveURL(/[?&]sort=relevance/)
    await expect(page.getByRole('button', { name: 'Best match' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.locator('[data-post-id] h3').first()).toContainText(/Zapier/i)
  })

  test('clearing the search goes back to Trending', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('Zap')
    await expect(page).toHaveURL(/[?&]sort=relevance/, { timeout: 5000 })
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(page.getByRole('button', { name: 'Best match' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Trending' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('a search that finds nothing offers to post it as an idea', async ({ page }) => {
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('xyzzyplugh')
    await expect(page.getByText('No ideas match “xyzzyplugh”.')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Post it as a new idea' }).click()
    await expect(page.getByRole('textbox', { name: 'Feedback title' })).toHaveValue('xyzzyplugh')
  })
})

test.describe('Portal search, widened', () => {
  test('a misspelling finds the idea and says the match is close', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('searchbox', { name: 'Search ideas' }).fill('integraton')
    await expect(
      page.getByText('No exact matches. Showing ideas with a similar spelling.')
    ).toBeVisible({ timeout: 5000 })
    await expect(page.locator('[data-post-id] h3').first()).toContainText(/integration/i)
  })
})
