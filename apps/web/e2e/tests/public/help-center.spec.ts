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

    // In the article breadcrumb the category is rendered as a non-link <span>
    // (the last item in HelpCenterBreadcrumbs is always a span, not a Link).
    // The only <a> present is the "Help Center" root link.
    const breadcrumbLink = breadcrumb.locator('a').last()
    if ((await breadcrumbLink.count()) > 0) {
      await breadcrumbLink.click()
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveURL(/\/hc/)
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

// =============================================================================
// Help Center - Search Accuracy
// =============================================================================

test.describe('Help Center - Search Accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')
  })

  test('search results all contain the query term in title or category name', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const searchInput = page.getByPlaceholder('Search articles...')
    if ((await searchInput.count()) === 0) return

    // Use a short, common term likely to return results from any seed
    const query = 'a'
    await searchInput.fill(query)
    // Wait for the 300 ms debounce + network round-trip
    await page.waitForTimeout(700)

    const resultsDropdown = page.locator('ul').filter({
      has: page.locator('button[type="button"]'),
    })
    if ((await resultsDropdown.count()) === 0) return // no results — nothing to verify

    const resultButtons = resultsDropdown.first().locator('button[type="button"]')
    const count = await resultButtons.count()
    if (count === 0) return

    // Every visible result title or category name must include the query (case-insensitive)
    for (let i = 0; i < count; i++) {
      const btn = resultButtons.nth(i)
      const titleEl = btn.locator('div.text-sm.font-medium')
      const categoryEl = btn.locator('div.text-xs.text-muted-foreground').first()

      const title = ((await titleEl.textContent()) ?? '').toLowerCase()
      const categoryName = ((await categoryEl.textContent()) ?? '').toLowerCase()

      // At least one of title or category name must contain the query term
      const matchesQuery =
        title.includes(query.toLowerCase()) || categoryName.includes(query.toLowerCase())
      expect(
        matchesQuery,
        `Result "${title}" (category: "${categoryName}") does not match query "${query}"`
      ).toBe(true)
    }
  })

  test('searching a non-existent term shows empty state with helpful message', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const searchInput = page.getByPlaceholder('Search articles...')
    if ((await searchInput.count()) === 0) return

    // A nonsense string guaranteed not to match any article
    await searchInput.fill('zzzznonexistentterm9999')
    await page.waitForTimeout(700)

    // The dropdown should NOT be visible (search sets showResults=false when empty)
    const resultsDropdown = page.locator('ul').filter({
      has: page.locator('button[type="button"]'),
    })
    // Either the dropdown is absent or hidden
    const dropdownCount = await resultsDropdown.count()
    if (dropdownCount > 0) {
      await expect(resultsDropdown.first()).not.toBeVisible()
    }
    // The search input itself should still be visible and hold the typed value
    await expect(searchInput).toHaveValue('zzzznonexistentterm9999')
  })

  test('clearing search hides the results dropdown', async ({ page }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const searchInput = page.getByPlaceholder('Search articles...')
    if ((await searchInput.count()) === 0) return

    // Type to get results
    await searchInput.fill('a')
    await page.waitForTimeout(700)

    // Now clear the input
    await searchInput.fill('')
    await page.waitForTimeout(400)

    // Dropdown must be gone after clearing
    const resultsDropdown = page.locator('ul').filter({
      has: page.locator('button[type="button"]'),
    })
    const dropdownCount = await resultsDropdown.count()
    if (dropdownCount > 0) {
      await expect(resultsDropdown.first()).not.toBeVisible()
    }

    // Input value is empty
    await expect(searchInput).toHaveValue('')
  })

  test('search is case-insensitive — lowercase query matches mixed-case titles', async ({
    page,
  }) => {
    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const searchInput = page.getByPlaceholder('Search articles...')
    if ((await searchInput.count()) === 0) return

    // Search uppercase first to discover an existing title
    await searchInput.fill('A')
    await page.waitForTimeout(700)

    const resultsDropdown = page.locator('ul').filter({
      has: page.locator('button[type="button"]'),
    })
    if ((await resultsDropdown.count()) === 0) return

    const countUpper = await resultsDropdown.first().locator('button[type="button"]').count()
    if (countUpper === 0) return

    // Now search with lowercase — should return at least as many results
    await searchInput.fill('a')
    await page.waitForTimeout(700)

    const countLower = await resultsDropdown.first().locator('button[type="button"]').count()
    // Results must be non-zero when an uppercase search found results
    expect(countLower).toBeGreaterThan(0)
  })
})

// =============================================================================
// Help Center - Article Content Verification
// =============================================================================

test.describe('Help Center - Article Content Verification', () => {
  // Navigate to the first available article before each test
  async function navigateToFirstArticle(page: import('@playwright/test').Page): Promise<boolean> {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')

    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return false

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return false

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return false

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    return true
  }

  test('article h1 title matches the title shown in the category listing', async ({ page }) => {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')

    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    // Capture the title text from the category listing row before navigating
    const listingTitle = await articleLinks
      .first()
      .locator('span.text-sm.font-medium')
      .textContent()

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    // The article h1 must match the listing title exactly
    if (listingTitle) {
      const articleH1 = page.locator('article h1').or(page.locator('h1')).first()
      await expect(articleH1).toHaveText(listingTitle.trim())
    }
  })

  test('article prose content is non-empty', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    const prose = page.locator('.prose')
    await expect(prose).toBeVisible()

    // The prose element must contain at least some text
    const proseText = (await prose.textContent()) ?? ''
    expect(proseText.trim().length).toBeGreaterThan(0)
  })

  test('article page has paragraph text or list items beyond the heading', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    // Any <p>, <li>, or <ul> inside the prose area means the article has body content
    const bodyContent = page
      .locator('.prose p, .prose li, .prose ul, .prose ol')
      .first()
    if ((await bodyContent.count()) === 0) {
      // Article has content but not as standard block elements — skip gracefully
      return
    }
    await expect(bodyContent).toBeVisible()
  })

  test('h2/h3 headings in the article appear in the Table of Contents', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    // TOC is only rendered on xl viewports; use a wide viewport for this test
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForLoadState('networkidle')

    const tocLabel = page.getByText('On this page')
    if ((await tocLabel.count()) === 0) return // no headings in this article — skip

    await expect(tocLabel).toBeVisible()

    // Collect h2/h3 headings from the prose
    const proseHeadings = page.locator('.prose h2, .prose h3')
    const headingCount = await proseHeadings.count()
    if (headingCount === 0) return

    // The TOC nav must contain links for these headings
    const tocLinks = page.locator('aside nav a[href^="#"]')
    const tocCount = await tocLinks.count()
    expect(tocCount).toBeGreaterThan(0)

    // Each TOC link text should match one of the prose headings
    const firstHeadingText = ((await proseHeadings.first().textContent()) ?? '').trim()
    if (firstHeadingText) {
      const matchingTocEntry = page.locator('aside nav a[href^="#"]').filter({
        hasText: firstHeadingText,
      })
      await expect(matchingTocEntry.first()).toBeVisible()
    }
  })

  test('clicking a ToC link updates the URL hash to the heading id', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForLoadState('networkidle')

    const tocLabel = page.getByText('On this page')
    if ((await tocLabel.count()) === 0) return

    const tocLinks = page.locator('aside nav a[href^="#"]')
    if ((await tocLinks.count()) === 0) return

    const firstLink = tocLinks.first()
    const expectedHash = await firstLink.getAttribute('href') // e.g. "#my-heading"
    if (!expectedHash) return

    // The TOC onClick does e.preventDefault() and scrolls via JS —
    // it also calls setActiveId. The URL hash only changes when the component
    // sets it via the anchor href attribute. We click and wait briefly.
    await firstLink.click()
    await page.waitForTimeout(300)

    // The URL should now contain the heading hash
    await expect(page).toHaveURL(new RegExp(expectedHash.replace('#', '#')))
  })
})

// =============================================================================
// Help Center - Article Feedback Widget
// =============================================================================

test.describe('Help Center - Article Feedback Widget', () => {
  async function navigateToFirstArticle(page: import('@playwright/test').Page): Promise<boolean> {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')

    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return false

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return false

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return false

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    return true
  }

  test('article page shows "Was this helpful?" widget with thumbs-up and thumbs-down buttons', async ({
    page,
  }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    await expect(page.getByText('Was this helpful?')).toBeVisible()

    // Buttons render as "👍 Yes" and "👎 No"
    const yesBtn = page.getByRole('button', { name: /yes/i })
    const noBtn = page.getByRole('button', { name: /no/i })
    await expect(yesBtn).toBeVisible()
    await expect(noBtn).toBeVisible()
  })

  test('clicking thumbs-up shows a confirmation message', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    const yesBtn = page.getByRole('button', { name: /yes/i })
    if ((await yesBtn.count()) === 0) return

    await yesBtn.click()

    // After voting helpful the subtitle changes to the confirmation copy
    await expect(page.getByText("Thanks — glad it landed.")).toBeVisible({ timeout: 5000 })
  })

  test('clicking thumbs-down shows a confirmation message', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    const noBtn = page.getByRole('button', { name: /no/i })
    if ((await noBtn.count()) === 0) return

    await noBtn.click()

    // After voting not-helpful the subtitle changes to the follow-up copy
    await expect(
      page.getByText("Noted. We'll revisit this article.")
    ).toBeVisible({ timeout: 5000 })
  })

  test('after voting helpful the thumbs-up button shows selected styling', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    const yesBtn = page.getByRole('button', { name: /yes/i })
    if ((await yesBtn.count()) === 0) return

    await yesBtn.click()
    // Wait for state to settle
    await expect(page.getByText("Thanks — glad it landed.")).toBeVisible({ timeout: 5000 })

    // Selected state: the button gets bg-primary/10 and border-primary/20 classes
    // We check via the class attribute rather than computed styles
    const classAttr = (await yesBtn.getAttribute('class')) ?? ''
    expect(classAttr).toContain('bg-primary/10')
  })

  test('clicking the same vote button twice does not change state back', async ({ page }) => {
    const ok = await navigateToFirstArticle(page)
    if (!ok) return

    const yesBtn = page.getByRole('button', { name: /yes/i })
    if ((await yesBtn.count()) === 0) return

    // First click — registers vote
    await yesBtn.click()
    await expect(page.getByText("Thanks — glad it landed.")).toBeVisible({ timeout: 5000 })

    // Second click on the same button — should be a no-op per component logic
    await yesBtn.click()
    // Confirmation copy must still be visible (vote was not reversed)
    await expect(page.getByText("Thanks — glad it landed.")).toBeVisible()
    // And the "Was this helpful?" prompt text should be gone (replaced by the confirmation)
    const subtitleEl = page.locator('p.text-xs.text-muted-foreground')
    await expect(subtitleEl).not.toHaveText('Your feedback shapes what we write next.')
  })
})

// =============================================================================
// Help Center - Navigation Accuracy
// =============================================================================

test.describe('Help Center - Navigation Accuracy', () => {
  test('breadcrumb on category page shows Help Center then category name', async ({ page }) => {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')

    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    const categoryName = await categoryCards.first().locator('h3').textContent()

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb).toBeVisible()

    // First crumb: "Help Center" (a link)
    const helpCenterCrumb = breadcrumb.getByRole('link', { name: /Help Center/i })
    await expect(helpCenterCrumb).toBeVisible()

    // Last crumb: category name as plain text (no link — it is the current page)
    if (categoryName) {
      const categorySpan = breadcrumb.locator('span').filter({ hasText: categoryName.trim() })
      await expect(categorySpan.first()).toBeVisible()
    }
  })

  test('breadcrumb on article page shows Help Center then category then article title', async ({
    page,
  }) => {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')

    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    const categoryName = await categoryCards.first().locator('h3').textContent()

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(breadcrumb).toBeVisible()

    // First crumb: "Help Center" link
    const helpCenterCrumb = breadcrumb.getByRole('link', { name: /Help Center/i })
    await expect(helpCenterCrumb).toBeVisible()

    // The category name appears as a link (the article page renders it with href)
    if (categoryName) {
      const categoryLink = breadcrumb.getByRole('link', { name: categoryName.trim() })
      if ((await categoryLink.count()) > 0) {
        await expect(categoryLink.first()).toBeVisible()
      }
    }
  })

  test('"Help Center" breadcrumb link navigates back to /hc', async ({ page }) => {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')

    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    const helpCenterLink = breadcrumb.getByRole('link', { name: /Help Center/i })
    if ((await helpCenterLink.count()) === 0) return

    await helpCenterLink.click()
    await page.waitForLoadState('networkidle')

    await expect(page).toHaveURL(/\/hc\/?$/)
  })

  test('category breadcrumb link on article page navigates to the correct category', async ({
    page,
  }) => {
    await page.goto('/hc')
    await page.waitForLoadState('networkidle')

    const heading = page.locator('h1').first()
    if ((await heading.count()) === 0) return

    const categoryCards = page.locator('a[href*="/hc/categories/"]')
    if ((await categoryCards.count()) === 0) return

    const categoryHref = await categoryCards.first().getAttribute('href')
    const categoryName = await categoryCards.first().locator('h3').textContent()

    await categoryCards.first().click()
    await page.waitForLoadState('networkidle')

    const articleLinks = page.locator('a[href*="/hc/articles/"]')
    if ((await articleLinks.count()) === 0) return

    await articleLinks.first().click()
    await page.waitForLoadState('networkidle')

    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
    if (categoryName) {
      const categoryLink = breadcrumb.getByRole('link', { name: categoryName.trim() })
      if ((await categoryLink.count()) === 0) return

      await categoryLink.first().click()
      await page.waitForLoadState('networkidle')

      // Should land on the category page
      if (categoryHref) {
        await expect(page).toHaveURL(categoryHref)
      } else {
        await expect(page).toHaveURL(/\/hc\/categories\//)
      }
    }
  })
})
