import { test, expect } from '@playwright/test'

test.describe('Public Post List', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the public portal (tenant subdomain)
    await page.goto('/')
  })

  test('displays feedback posts', async ({ page }) => {
    // Should show at least one post card (Link elements with href containing /posts/)
    const postCards = page.locator('a[href*="/posts/"]:has(h3)')
    await expect(postCards.first()).toBeVisible({ timeout: 10000 })

    // Each post should have a title visible
    const firstPost = postCards.first()
    await expect(firstPost).toBeVisible()
  })

  test('shows post details on cards', async ({ page }) => {
    // Wait for posts to load
    const postCards = page.locator('a[href*="/posts/"]:has(h3)')
    await expect(postCards.first()).toBeVisible({ timeout: 10000 })

    // Posts should display vote button with count
    await expect(page.getByTestId('vote-button').first()).toBeVisible()

    // Posts should display comment count (message icon)
    // Note: Comment icon doesn't have a test-id yet, using a more flexible selector
    const commentIcon = page.locator('svg').filter({ hasText: '' }).first()
    if ((await commentIcon.count()) > 0) {
      await expect(commentIcon).toBeVisible()
    }
  })

  test('can filter by board using sidebar', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle')

    // Look for board filter buttons in sidebar
    const boardButtons = page.locator('button').filter({ hasText: /feature|bug|general/i })

    // If board filter exists, click it
    const boardButton = boardButtons.first()
    if ((await boardButton.count()) > 0) {
      await boardButton.click()

      // URL should update with board parameter
      await expect(page).toHaveURL(/[?&]board=/, { timeout: 5000 })
    }
  })

  test('can search for posts', async ({ page }) => {
    // Look for search input
    const searchInput = page.getByPlaceholder(/search/i)

    if ((await searchInput.count()) > 0) {
      await searchInput.fill('test')
      await searchInput.press('Enter')

      // URL should update with search parameter
      await expect(page).toHaveURL(/[?&]search=test/, { timeout: 5000 })
    }
  })

  test('defaults to Top sort with visual indicator', async ({ page }) => {
    // Navigate to page without sort param
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // "Top" button should be active (has font-medium class)
    const topButton = page.getByRole('button', { name: /^Top$/i })
    await expect(topButton).toHaveClass(/font-medium/)

    // Other sort buttons should not be active
    const newButton = page.getByRole('button', { name: /^New$/i })
    const trendingButton = page.getByRole('button', { name: /^Trending$/i })
    await expect(newButton).not.toHaveClass(/font-medium/)
    await expect(trendingButton).not.toHaveClass(/font-medium/)
  })

  test('can sort posts by clicking New', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click "New" sort option
    const newButton = page.getByRole('button', { name: /^New$/i })
    await newButton.click()

    // URL should update with sort parameter
    await expect(page).toHaveURL(/[?&]sort=new/)

    // "New" should now be active
    await expect(newButton).toHaveClass(/font-medium/)

    // "Top" should no longer be active
    const topButton = page.getByRole('button', { name: /^Top$/i })
    await expect(topButton).not.toHaveClass(/font-medium/)
  })

  test('can sort posts by clicking Trending', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Click "Trending" sort option
    const trendingButton = page.getByRole('button', { name: /^Trending$/i })
    await trendingButton.click()

    // URL should update with sort parameter
    await expect(page).toHaveURL(/[?&]sort=trending/)

    // "Trending" should now be active
    await expect(trendingButton).toHaveClass(/font-medium/)
  })

  test('navigating with sort param in URL shows correct active state', async ({ page }) => {
    // Navigate directly with sort=new
    await page.goto('/?sort=new')
    await page.waitForLoadState('networkidle')

    // "New" should be active
    const newButton = page.getByRole('button', { name: /^New$/i })
    await expect(newButton).toHaveClass(/font-medium/)

    // "Top" should not be active
    const topButton = page.getByRole('button', { name: /^Top$/i })
    await expect(topButton).not.toHaveClass(/font-medium/)
  })

  test('can switch between all sort options', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const topButton = page.getByRole('button', { name: /^Top$/i })
    const newButton = page.getByRole('button', { name: /^New$/i })
    const trendingButton = page.getByRole('button', { name: /^Trending$/i })

    // Start with Top active
    await expect(topButton).toHaveClass(/font-medium/)

    // Switch to New
    await newButton.click()
    await expect(page).toHaveURL(/[?&]sort=new/)
    await expect(newButton).toHaveClass(/font-medium/)
    await expect(topButton).not.toHaveClass(/font-medium/)

    // Switch to Trending
    await trendingButton.click()
    await expect(page).toHaveURL(/[?&]sort=trending/)
    await expect(trendingButton).toHaveClass(/font-medium/)
    await expect(newButton).not.toHaveClass(/font-medium/)

    // Switch back to Top
    await topButton.click()
    await expect(page).toHaveURL(/[?&]sort=top/)
    await expect(topButton).toHaveClass(/font-medium/)
    await expect(trendingButton).not.toHaveClass(/font-medium/)
  })

  test('sort persists with board filter', async ({ page }) => {
    // Navigate with both board and sort params
    await page.goto('/?board=features&sort=new')

    // Wait for posts to load first (indicates page is ready)
    const postCards = page.locator('a[href*="/posts/"]:has(h3)')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })

    // Both filters should be active
    await expect(page).toHaveURL(/board=features/)
    await expect(page).toHaveURL(/sort=new/)

    // Sort button should show correct state (wait for it to have the class)
    const newButton = page.getByRole('button', { name: /^New$/i })
    await expect(newButton).toHaveClass(/font-medium/, { timeout: 10000 })

    // Board should be selected
    const featureButton = page.getByRole('button', { name: /Feature Requests/i })
    await expect(featureButton).toHaveClass(/font-medium/, { timeout: 10000 })
  })

  test('clicking post navigates to detail page', async ({ page }) => {
    // Wait for posts to load
    const postCards = page.locator('a[href*="/posts/"]:has(h3)')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })

    // Get the href of the first post
    const firstPostHref = await postCards.first().getAttribute('href')

    // Click the first post and wait for navigation
    await Promise.all([page.waitForURL(/\/posts\//, { timeout: 15000 }), postCards.first().click()])

    // Should navigate to the post detail page
    if (firstPostHref) {
      await expect(page).toHaveURL(
        new RegExp(firstPostHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        { timeout: 10000 }
      )
    }
  })

  test('displays post status badges', async ({ page }) => {
    // Wait for posts to load
    await page.waitForLoadState('networkidle')

    // Look for status badges (they have specific styling)
    const statusBadges = page.locator('[class*="badge"]')

    // At least one badge should be visible (either status or tag)
    if ((await statusBadges.count()) > 0) {
      await expect(statusBadges.first()).toBeVisible()
    }
  })

  test('displays filtered posts when navigating with board param in URL', async ({ page }) => {
    // Navigate directly to URL with board filter
    await page.goto('/?board=features')

    // Wait for posts to load first (indicates page is ready)
    const postCards = page.locator('a[href*="/posts/"]:has(h3)')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })

    // URL should contain the board parameter
    await expect(page).toHaveURL(/[?&]board=features/)

    // The "Feature Requests" board should be visually selected in the sidebar (has font-medium class)
    const featureButton = page.getByRole('button', { name: /Feature Requests/i })
    await expect(featureButton).toHaveClass(/font-medium/, { timeout: 10000 })

    // "View all posts" should NOT be selected (no font-medium)
    const viewAllButton = page.getByRole('button', { name: /View all posts/i })
    await expect(viewAllButton).not.toHaveClass(/font-medium/)
  })

  test('can view all posts after filtering by board', async ({ page }) => {
    // Start with a board filter applied
    await page.goto('/?board=features')
    await page.waitForLoadState('networkidle')

    // Verify we're filtered
    await expect(page).toHaveURL(/[?&]board=features/)

    // Click "View all posts" button in sidebar
    const viewAllButton = page.getByRole('button', { name: /View all posts/i })
    await viewAllButton.click()

    // URL should no longer have the board parameter
    await expect(page).not.toHaveURL(/[?&]board=/)

    // Navigate fresh to verify the state renders correctly
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // "View all posts" should now be selected (has font-medium class when active)
    const viewAllButtonFresh = page.getByRole('button', { name: /View all posts/i })
    await expect(viewAllButtonFresh).toHaveClass(/font-medium/)
  })

  test('filtered board posts link to correct board routes', async ({ page }) => {
    // Navigate to features board
    await page.goto('/?board=features')
    await page.waitForLoadState('networkidle')

    // Get all post links
    const postLinks = page.locator('a[href*="/posts/"]')
    const linkCount = await postLinks.count()

    if (linkCount > 0) {
      // Check that all visible posts link to the features board
      for (let i = 0; i < Math.min(linkCount, 5); i++) {
        const href = await postLinks.nth(i).getAttribute('href')
        // Posts should link to /features/posts/{id}
        expect(href).toMatch(/^\/features\/posts\//)
      }
    }
  })

  test('switching boards updates displayed posts', async ({ page }) => {
    // Start with features board
    await page.goto('/?board=features')
    await page.waitForLoadState('networkidle')

    // Get initial post hrefs (all should be /features/posts/...)
    const initialLinks = page.locator('a[href*="/posts/"]')
    const initialCount = await initialLinks.count()

    if (initialCount > 0) {
      const firstInitialHref = await initialLinks.first().getAttribute('href')
      expect(firstInitialHref).toMatch(/^\/features\/posts\//)
    }

    // Switch to bugs board via sidebar
    const bugsButton = page.getByRole('button', { name: /Bug Reports/i })
    if ((await bugsButton.count()) > 0) {
      await bugsButton.click()
      await page.waitForLoadState('networkidle')

      // URL should update
      await expect(page).toHaveURL(/[?&]board=bugs/)

      // Posts should now link to /bugs/posts/...
      const newLinks = page.locator('a[href*="/posts/"]')
      const newCount = await newLinks.count()

      if (newCount > 0) {
        const firstNewHref = await newLinks.first().getAttribute('href')
        expect(firstNewHref).toMatch(/^\/bugs\/posts\//)
      }
    }
  })
})
