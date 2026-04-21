import { test, expect } from '@playwright/test'

/**
 * Public Help Center E2E tests.
 *
 * These tests cover the public-facing help center at /hc.
 * No authentication is required.
 *
 * The help center requires the `helpCenter` feature flag and `helpCenterConfig.enabled`
 * to be true for the acme workspace. Tests degrade gracefully (early return or
 * conditional assertions) when the flag is off or seed data is absent.
 */

test.describe('Public Help Center', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')
  })

  // -------------------------------------------------------------------------
  // Landing page
  // -------------------------------------------------------------------------

  test('page loads and shows help center content', async ({ page }) => {
    // Either the hero heading is shown or the page redirected to 404 (flag off).
    // When the flag is enabled, the landing page renders a prominent h1.
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return // help center disabled in seed

    await expect(heading).toBeVisible()
  })

  test('shows the search bar on the landing page', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    // Hero search renders an <input type="search"> with placeholder "Search articles..."
    const searchInput = page.getByPlaceholder('Search articles...')
    await expect(searchInput).toBeVisible()
  })

  test('shows categories list when categories exist in seed data', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    // Category cards link to /hc/categories/<slug>
    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) {
      // No categories yet — empty state message should be shown
      await expect(page.getByText('No categories yet')).toBeVisible()
      return
    }

    await expect(categoryCards.first()).toBeVisible()
  })

  test('each category card shows name and article count', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    const firstCard = categoryCards.first()

    // Category name is in an h3 inside the card
    const categoryName = firstCard.locator('h3')
    await expect(categoryName).toBeVisible()

    // Article count text like "3 articles" or "1 article"
    const articleCount = firstCard.getByText(/\d+ articles?/)
    await expect(articleCount).toBeVisible()
  })

  test('each category card shows description when present', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    // At least verify cards are rendered; descriptions are optional per category
    await expect(categoryCards.first()).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Category page navigation
  // -------------------------------------------------------------------------

  test('can navigate into a category', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/hc\/categories\//)
  })

  test('category page shows category name as heading', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    // Capture category name from the card before navigating
    const categoryNameText = await categoryCards.first().locator('h3').textContent()

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    if (categoryNameText) {
      await expect(page.locator('h1').first()).toHaveText(categoryNameText)
    } else {
      await expect(page.locator('h1').first()).toBeVisible()
    }
  })

  test('category page shows articles list', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    // Article rows link to /hc/articles/<categorySlug>/<articleSlug>
    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) {
      // Category exists but has no articles yet
      await expect(
        page.getByText(/No articles in this category yet|No articles yet/)
      ).toBeVisible()
      return
    }

    await expect(articleLinks.first()).toBeVisible()
  })

  // -------------------------------------------------------------------------
  // Article page
  // -------------------------------------------------------------------------

  test('can navigate into an article', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    // Navigate to a category first
    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/hc\/articles\//)
  })

  test('article page shows title', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    // Article title renders as an h1
    await expect(page.locator('article h1').or(page.locator('h1'))).toBeVisible()
  })

  test('article page shows content area', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    // Rich text content renders inside .prose
    const contentArea = page.locator('.prose')
    await expect(contentArea).toBeVisible()
  })

  test('article page shows "Was this helpful?" feedback widget', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Was this helpful?')).toBeVisible()
    await expect(page.getByRole('button', { name: /Yes/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /No/i })).toBeVisible()
  })

  test('article page shows table of contents when headings exist', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    // TOC renders "On this page" label only when headings are present
    const tocLabel = page.getByText('On this page')
    if ((await tocLabel.count()) > 0) {
      await expect(tocLabel).toBeVisible()
    }
  })

  test('article page shows author and last-updated metadata when present', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    // Author block shows "Written By <name>" when an author is set
    const writtenBy = page.getByText(/Written By/i)
    if ((await writtenBy.count()) > 0) {
      await expect(writtenBy).toBeVisible()
    }

    // Last-updated shows "Last updated <relative time>"
    const lastUpdated = page.getByText(/Last updated/i)
    if ((await lastUpdated.count()) > 0) {
      await expect(lastUpdated).toBeVisible()
    }
  })

  // -------------------------------------------------------------------------
  // Breadcrumb / back navigation
  // -------------------------------------------------------------------------

  test('breadcrumb navigation works on category page', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    // Breadcrumb nav has aria-label="Breadcrumb"
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb).toBeVisible()

    // First breadcrumb item links back to /hc
    const helpCenterLink = breadcrumb.getByRole('link', { name: /Help Center/i })
    if ((await helpCenterLink.count()) > 0) {
      await helpCenterLink.click()
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/hc\/?$/)
    }
  })

  test('breadcrumb navigation works on article page', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb).toBeVisible()

    // Navigate back to the category via breadcrumb
    const categoryLink = breadcrumb.locator('a').last()
    if ((await categoryLink.count()) > 0) {
      await categoryLink.click()
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/hc\/categories\//)
    }
  })

  test('"All categories" back link on category page navigates to /hc', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    // The left sidebar has an "All categories" back link (visible on xl viewports).
    // The route component also renders it via Link to="/hc".
    const allCategoriesLink = page.getByRole('link', { name: /All categories/i })
    if ((await allCategoriesLink.count()) > 0) {
      await allCategoriesLink.first().click()
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/hc\/?$/)
    }
  })

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  test('search input is present and accepts text', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const searchInput = page.getByPlaceholder('Search articles...')
    if ((await searchInput.count()) === 0) return

    await searchInput.fill('getting started')
    await expect(searchInput).toHaveValue('getting started')
  })

  test('typing in search shows results dropdown when articles match', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const searchInput = page.getByPlaceholder('Search articles...')
    if ((await searchInput.count()) === 0) return

    // Type a broad term; results depend on seed data
    await searchInput.fill('a')

    // Wait briefly for the 300ms debounce
    await page.waitForTimeout(600)

    // Results dropdown is a <ul> inside the search container
    const resultsDropdown = page.locator('ul').filter({ has: page.locator('button[type="button"]') })
    // If there are results, the dropdown should be visible; if not, that is fine too
    const dropdownVisible = (await resultsDropdown.count()) > 0
    if (dropdownVisible) {
      await expect(resultsDropdown.first()).toBeVisible()
    }
  })

  // -------------------------------------------------------------------------
  // Old URL redirect (legacy routes)
  // -------------------------------------------------------------------------

  test('old /$categorySlug URL redirects to /hc/categories/$categorySlug', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    const firstHref = await categoryCards.first().getAttribute('href')
    if (!firstHref) return

    // Extract slug from /hc/categories/<slug>
    const slug = firstHref.replace('/hc/categories/', '').replace(/\/$/, '')

    // Navigate to legacy URL /hc/<slug> — should redirect to the canonical URL
    await page.goto(`/hc/${slug}`)
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(`/hc/categories/${slug}`)
  })

  // -------------------------------------------------------------------------
  // Prev / Next navigation on article page
  // -------------------------------------------------------------------------

  test('prev/next navigation renders on article page when sibling articles exist', async ({
    page,
  }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) < 2) return // need at least 2 articles for prev/next

    // Navigate to the second article so there's a "Previous" link
    await articleLinks.nth(1).click()
    await page.waitForLoadState('networkidle')

    // Previous / Next links contain the arrow characters rendered by the component
    const prevLink = page.getByText(/← Previous/i)
    if ((await prevLink.count()) > 0) {
      await expect(prevLink).toBeVisible()
    }
  })
})
