import { test, expect } from '@playwright/test'

test.describe('Public Changelog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
  })

  test('page loads at /changelog', async ({ page }) => {
    await expect(page).toHaveURL(/\/changelog/)
  })

  test('page has correct title meta tag', async ({ page }) => {
    const title = await page.title()
    expect(title).toMatch(/changelog/i)
  })

  test('page header shows "Changelog" heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /changelog/i, level: 1 })).toBeVisible()
  })

  test('page header shows description text', async ({ page }) => {
    await expect(
      page.getByText(/stay up to date with the latest product updates/i)
    ).toBeVisible()
  })

  test('RSS feed button is visible', async ({ page }) => {
    // Button wraps an <a> linking to /changelog/feed
    const rssLink = page.locator('a[href="/changelog/feed"]')
    await expect(rssLink).toBeVisible()
  })

  test('shows changelog entries list or empty state', async ({ page }) => {
    // Either entries or the empty state message should be present
    const entries = page.locator('article')
    const emptyState = page.getByText(/no updates yet/i)

    const entryCount = await entries.count()
    const emptyCount = await emptyState.count()

    expect(entryCount + emptyCount).toBeGreaterThan(0)
  })

  test('each entry shows a title', async ({ page }) => {
    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    // Each article contains a heading (h2) for the entry title
    const firstTitle = entries.first().getByRole('heading').first()
    await expect(firstTitle).toBeVisible()
  })

  test('each entry shows a published date', async ({ page }) => {
    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    // Date is rendered in a <time> element
    const firstTime = entries.first().locator('time')
    await expect(firstTime.first()).toBeVisible()
    const dateText = await firstTime.first().textContent()
    // Should contain a year (4-digit number)
    expect(dateText).toMatch(/\d{4}/)
  })

  test('entry title links to detail page', async ({ page }) => {
    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    await expect(titleLink).toBeVisible()

    const href = await titleLink.getAttribute('href')
    expect(href).toMatch(/^\/changelog\//)
  })

  test('clicking an entry navigates to the detail page', async ({ page }) => {
    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    const href = await titleLink.getAttribute('href')

    await Promise.all([
      page.waitForURL(/\/changelog\/.+/, { timeout: 10000 }),
      titleLink.click(),
    ])

    if (href) {
      await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })

  test('empty state shows message when no entries exist', async ({ page }) => {
    const entries = page.locator('article')
    if ((await entries.count()) > 0) {
      // Data exists — empty state should not be shown
      await expect(page.getByText(/no updates yet/i)).not.toBeVisible()
    } else {
      await expect(page.getByText(/no updates yet/i)).toBeVisible()
      await expect(page.getByText(/check back soon/i)).toBeVisible()
    }
  })

  test('load more button appears when more entries exist', async ({ page }) => {
    const loadMoreBtn = page.getByRole('button', { name: /load more/i })
    // Only assert visibility conditionally — button only renders when hasNextPage is true
    if ((await loadMoreBtn.count()) > 0) {
      await expect(loadMoreBtn).toBeVisible()
    }
  })
})

test.describe('Public Changelog - Detail Page', () => {
  test('detail page loads when navigating to a valid entry', async ({ page }) => {
    // Start at the list and navigate to the first entry
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    await Promise.all([
      page.waitForURL(/\/changelog\/.+/, { timeout: 10000 }),
      titleLink.click(),
    ])

    await page.waitForLoadState('networkidle')

    // Detail page renders an <article> with an h1
    await expect(page.locator('article h1')).toBeVisible({ timeout: 10000 })
  })

  test('detail page shows entry title as h1', async ({ page }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    const listTitleText = await entries.first().getByRole('heading').first().textContent()

    await Promise.all([
      page.waitForURL(/\/changelog\/.+/, { timeout: 10000 }),
      titleLink.click(),
    ])
    await page.waitForLoadState('networkidle')

    const detailTitle = page.locator('article h1')
    await expect(detailTitle).toBeVisible({ timeout: 10000 })

    if (listTitleText) {
      await expect(detailTitle).toHaveText(listTitleText.trim())
    }
  })

  test('detail page shows entry content', async ({ page }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    await Promise.all([
      page.waitForURL(/\/changelog\/.+/, { timeout: 10000 }),
      titleLink.click(),
    ])
    await page.waitForLoadState('networkidle')

    // Content renders after the h1 — there should be some text content in the article
    const article = page.locator('article').first()
    await expect(article).toBeVisible({ timeout: 10000 })
    const articleText = await article.textContent()
    expect(articleText?.trim().length).toBeGreaterThan(0)
  })

  test('detail page shows published date', async ({ page }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    await Promise.all([
      page.waitForURL(/\/changelog\/.+/, { timeout: 10000 }),
      titleLink.click(),
    ])
    await page.waitForLoadState('networkidle')

    const dateEl = page.locator('article time').first()
    await expect(dateEl).toBeVisible({ timeout: 10000 })
    const dateText = await dateEl.textContent()
    expect(dateText).toMatch(/\d{4}/)
  })

  test('detail page has correct title meta tag', async ({ page }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    await Promise.all([
      page.waitForURL(/\/changelog\/.+/, { timeout: 10000 }),
      titleLink.click(),
    ])
    await page.waitForLoadState('networkidle')

    const title = await page.title()
    // Title should include "Changelog" and workspace name
    expect(title).toMatch(/changelog/i)
  })

  test('back navigation returns to changelog list', async ({ page }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')

    const entries = page.locator('article')
    if ((await entries.count()) === 0) {
      test.skip()
      return
    }

    const titleLink = entries.first().locator('a[href*="/changelog/"]').first()
    await Promise.all([
      page.waitForURL(/\/changelog\/.+/, { timeout: 10000 }),
      titleLink.click(),
    ])
    await page.waitForLoadState('networkidle')

    // BackLink renders as an <a> pointing to /changelog containing the text "Changelog"
    const backLink = page.locator('a[href="/changelog"]')
    await expect(backLink.first()).toBeVisible({ timeout: 10000 })
    await expect(backLink.first()).toContainText(/changelog/i)

    await Promise.all([
      page.waitForURL(/\/changelog$/, { timeout: 10000 }),
      backLink.first().click(),
    ])

    await expect(page).toHaveURL(/\/changelog$/)
  })

  test('detail page for non-existent entry shows not-found state', async ({ page }) => {
    await page.goto('/changelog/nonexistent-entry-id-that-does-not-exist')
    await page.waitForLoadState('networkidle')

    await expect(
      page.getByText(/changelog entry not found|not yet published|removed/i).first()
    ).toBeVisible({ timeout: 10000 })
  })
})
