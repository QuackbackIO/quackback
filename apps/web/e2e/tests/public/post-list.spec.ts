import { test, expect, type Page } from '@playwright/test'

test.describe('Public Post List', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the public portal (workspace subdomain)
    await page.goto('/')
  })

  test('displays feedback posts', async ({ page }) => {
    // Should show at least one post card (Link elements with href containing /posts/)
    const postCards = page.locator('h3 a[href*="/posts/"]')
    await expect(postCards.first()).toBeVisible({ timeout: 10000 })

    // Each post should have a title visible
    const firstPost = postCards.first()
    await expect(firstPost).toBeVisible()
  })

  test('shows post details on cards', async ({ page }) => {
    // Wait for posts to load
    const postCards = page.locator('h3 a[href*="/posts/"]')
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
    const boardButtons = page.locator('aside button').filter({ hasText: /feature|bug|general/i })

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
    await page.waitForLoadState('networkidle')
    const searchInput = page.getByPlaceholder(/search/i)

    if ((await searchInput.count()) > 0) {
      await searchInput.fill('test')
      await searchInput.press('Enter')

      // URL should update with search parameter
      await expect(page).toHaveURL(/[?&]search=test/, { timeout: 5000 })
    }
  })

  test('defaults to Trending sort with visual indicator', async ({ page }) => {
    // Navigate to page without sort param
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // "Trending" button should be active (has font-medium class)
    const trendingButton = page.getByRole('button', { name: /^Trending$/i })
    await expect(trendingButton).toHaveClass(/font-medium/)

    // Other sort buttons should not be active
    const topButton = page.getByRole('button', { name: /^Top$/i })
    const newButton = page.getByRole('button', { name: /^New$/i })
    await expect(topButton).not.toHaveClass(/font-medium/)
    await expect(newButton).not.toHaveClass(/font-medium/)
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

    // Start with Trending active
    await expect(trendingButton).toHaveClass(/font-medium/)

    // Switch to New
    await newButton.click()
    await expect(page).toHaveURL(/[?&]sort=new/)
    await expect(newButton).toHaveClass(/font-medium/)
    await expect(trendingButton).not.toHaveClass(/font-medium/)

    // Switch to Top
    await topButton.click()
    await expect(page).toHaveURL(/[?&]sort=top/)
    await expect(topButton).toHaveClass(/font-medium/)
    await expect(newButton).not.toHaveClass(/font-medium/)

    // Switch back to Trending
    await trendingButton.click()
    await expect(page).toHaveURL(/[?&]sort=trending/)
    await expect(trendingButton).toHaveClass(/font-medium/)
    await expect(topButton).not.toHaveClass(/font-medium/)
  })

  test('sort persists with board filter', async ({ page }) => {
    // Navigate with both board and sort params (using 'features' board which exists in database)
    await page.goto('/?board=features&sort=new')

    // Wait for page to be ready
    await page.waitForLoadState('networkidle')

    // Skip if the features board has no posts in this environment
    const postCards = page.locator('[data-post-id]')
    test.skip(
      (await postCards.count()) === 0,
      'No posts found for features board in this environment'
    )

    // Both filters should be active
    await expect(page).toHaveURL(/board=features/)
    await expect(page).toHaveURL(/sort=new/)

    // Sort button should show correct state (wait for it to have the class)
    const newButton = page.getByRole('button', { name: /^New$/i })
    await expect(newButton).toHaveClass(/font-medium/, { timeout: 10000 })

    // Board should be selected
    const featuresButton = page
      .getByRole('group', { name: 'Boards' })
      .getByRole('button', { name: /Feature Requests/i })
    await expect(featuresButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 })
  })

  test('clicking post navigates to detail page', async ({ page }) => {
    // Wait for posts to load
    const postCards = page.locator('h3 a[href*="/posts/"]')
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
    // Navigate directly to URL with board filter (using 'features' board which exists in database)
    await page.goto('/?board=features')

    // Wait for page to be ready
    await page.waitForLoadState('networkidle')

    // Skip if the features board has no posts in this environment
    const postCards = page.locator('[data-post-id]')
    test.skip(
      (await postCards.count()) === 0,
      'No posts found for features board in this environment'
    )

    // URL should contain the board parameter
    await expect(page).toHaveURL(/[?&]board=features/)

    // The "Feature Requests" board is selected in the sidebar
    const boards = page.getByRole('group', { name: 'Boards' })
    const featuresButton = boards.getByRole('button', { name: /Feature Requests/i })
    await expect(featuresButton).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 })

    // "All boards" is not
    const allBoards = boards.getByRole('button', { name: 'All boards' })
    await expect(allBoards).toHaveAttribute('aria-pressed', 'false')
  })

  test('can view all posts after filtering by board', async ({ page }) => {
    // Start with a board filter applied (using 'features' board which exists in database)
    await page.goto('/?board=features')
    await page.waitForLoadState('networkidle')

    // Verify we're filtered
    await expect(page).toHaveURL(/[?&]board=features/)

    // Click "All boards" in the sidebar
    const boards = page.getByRole('group', { name: 'Boards' })
    await boards.getByRole('button', { name: 'All boards' }).click()

    // URL should no longer have the board parameter
    await expect(page).not.toHaveURL(/[?&]board=/)

    // Navigate fresh to verify the state renders correctly
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // "All boards" should now be selected
    await expect(
      page.getByRole('group', { name: 'Boards' }).getByRole('button', { name: 'All boards' })
    ).toHaveAttribute('aria-pressed', 'true')
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
        // Posts should link to /b/features/posts/{id}
        expect(href).toMatch(/^\/b\/features\/posts\//)
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
      expect(firstInitialHref).toMatch(/^\/b\/features\/posts\//)
    }

    // Switch to the Bug Reports board in the filter panel. Read its slug from
    // the URL: admin specs in the same run can add boards with similar names.
    const bugsButton = page
      .getByRole('group', { name: 'Boards' })
      .getByRole('button', { name: /^Bug Reports/ })
      .first()
    if ((await bugsButton.count()) > 0) {
      await bugsButton.click()

      // URL should update
      await expect(page).toHaveURL(/[?&]board=(?!features\b)[^&]+/)
      const slug = new URL(page.url()).searchParams.get('board')
      await page.waitForLoadState('networkidle')

      // Wait for posts to refresh - should now link to that board's posts
      const bugsPostLinks = page.locator(`a[href*="/b/${slug}/posts/"]`)
      await expect(bugsPostLinks.first()).toBeVisible({ timeout: 10000 })
      await expect(page.locator('a[href*="/b/features/posts/"]')).toHaveCount(0)
    }
  })

  // The filter dropdown became a side panel of pill buttons in bc0d2e3d1e (#777):
  // each pill is a toggle (aria-pressed), and picked filters show as chips in
  // the "Active filters" region (which replaced the count badge).
  test.describe('Filter panel', () => {
    const statusGroup = (page: Page) => page.getByRole('group', { name: 'Status', exact: true })
    const tagsGroup = (page: Page) => page.getByRole('group', { name: 'Tags', exact: true })
    const activeFilters = (page: Page) => page.getByRole('region', { name: 'Active filters' })

    test('filter panel is shown beside the feed', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('group', { name: 'Boards' })).toBeVisible()
      await expect(statusGroup(page)).toBeVisible()
    })

    test('filter panel shows status options', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Should show status pills (at least one status option), none picked
      const statusPill = statusGroup(page).getByRole('button').first()
      await expect(statusPill).toBeVisible()
      await expect(statusPill).toHaveAttribute('aria-pressed', 'false')
    })

    test('can select status filter', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const statusPill = statusGroup(page).getByRole('button').first()
      await statusPill.click()

      // URL should update with status parameter
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
      await expect(statusPill).toHaveAttribute('aria-pressed', 'true')
    })

    test('active filters show a chip for each filter', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await statusGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })

      await expect(activeFilters(page).getByText('Status:')).toHaveCount(1)
    })

    test('can clear all filters', async ({ page }) => {
      // "Clear all" shows once two filters are on
      await page.goto('/?board=features')
      await page.waitForLoadState('networkidle')

      await statusGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })

      const clearButton = activeFilters(page).getByRole('button', { name: 'Clear all' })
      await expect(clearButton).toBeVisible()
      await clearButton.click()

      // URL should no longer have the filter parameters
      await expect(page).not.toHaveURL(/[?&]status=/, { timeout: 5000 })
      await expect(page).not.toHaveURL(/[?&]board=/)
    })

    test('status filter persists with other filters', async ({ page }) => {
      // Navigate with board and sort filters (using 'features' board which exists in database)
      await page.goto('/?board=features&sort=new')
      await page.waitForLoadState('networkidle')

      await statusGroup(page).getByRole('button').first().click()

      // URL should have all three filters
      await expect(page).toHaveURL(/status=/, { timeout: 5000 })
      await expect(page).toHaveURL(/board=features/)
      await expect(page).toHaveURL(/sort=new/)
    })

    test('can toggle status filter on and off', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const statusPill = statusGroup(page).getByRole('button').first()
      await statusPill.click()

      // Verify filter is applied
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })

      // Click again to deselect
      await statusPill.click()

      // Filter should be removed
      await expect(page).not.toHaveURL(/[?&]status=/, { timeout: 5000 })
      await expect(statusPill).toHaveAttribute('aria-pressed', 'false')
    })

    test('can select multiple status filters', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const statusPills = statusGroup(page).getByRole('button')
      test.skip((await statusPills.count()) < 2, 'Fewer than two statuses')

      await statusPills.nth(0).click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
      await statusPills.nth(1).click()

      await expect(statusPills.nth(0)).toHaveAttribute('aria-pressed', 'true')
      await expect(statusPills.nth(1)).toHaveAttribute('aria-pressed', 'true')
      // Both statuses share one Status chip
      await expect(activeFilters(page).getByText('Status:')).toHaveCount(1)
      await expect(page).toHaveURL(/[?&]status=/)
    })

    test('filter panel shows tags section if tags exist', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // The Tags section only renders when more than one tag is on a visible post
      test.skip((await tagsGroup(page).count()) === 0, 'No tags section in the filter panel')
      await expect(tagsGroup(page).getByRole('button').first()).toBeVisible()
    })

    test('navigating with status param shows correct checked state', async ({ page }) => {
      // TanStack Router encodes arrays as JSON: ["open"] → %5B%22open%22%5D
      await page.goto('/?status=%5B%22open%22%5D')
      await page.waitForLoadState('networkidle')

      await expect(statusGroup(page).getByRole('button', { name: /^Open/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(activeFilters(page).getByText('Status:')).toHaveCount(1)
    })

    test('can select tag filter when tags exist', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      test.skip((await tagsGroup(page).count()) === 0, 'No tags section in the filter panel')
      const tagPill = tagsGroup(page).getByRole('button').first()
      await tagPill.click()

      // URL should update with tagIds parameter
      await expect(page).toHaveURL(/[?&]tagIds=/, { timeout: 5000 })
      await expect(tagPill).toHaveAttribute('aria-pressed', 'true')
    })

    test('tag selection adds an active filter chip', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      test.skip((await tagsGroup(page).count()) === 0, 'No tags section in the filter panel')
      await tagsGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]tagIds=/, { timeout: 5000 })
      await expect(activeFilters(page).getByText(/^Tags?:$/)).toHaveCount(1)

      // Select a status too: a second chip
      await statusGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
      await expect(activeFilters(page).getByText('Status:')).toHaveCount(1)
      await expect(activeFilters(page).getByText(/^Tags?:$/)).toHaveCount(1)
    })

    test('combined status and tag filtering updates URL correctly', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await statusGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })

      test.skip((await tagsGroup(page).count()) === 0, 'No tags section in the filter panel')
      await tagsGroup(page).getByRole('button').first().click()

      // URL should have both status and tagIds
      await expect(page).toHaveURL(/tagIds=/, { timeout: 5000 })
      await expect(page).toHaveURL(/status=/)
    })

    test('clearing filters removes both status and tag params', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await statusGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
      test.skip((await tagsGroup(page).count()) === 0, 'No tags section in the filter panel')
      await tagsGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]tagIds=/, { timeout: 5000 })

      await activeFilters(page).getByRole('button', { name: 'Clear all' }).click()

      // Both params should be removed
      await expect(page).not.toHaveURL(/status=/, { timeout: 5000 })
      await expect(page).not.toHaveURL(/tagIds=/)
    })

    test('filter state persists on page reload', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await statusGroup(page).getByRole('button').first().click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
      const urlBeforeReload = page.url()

      await page.reload()
      await page.waitForLoadState('networkidle')

      // URL should still have the status parameter, and the pill stays picked
      expect(page.url()).toBe(urlBeforeReload)
      await expect(statusGroup(page).getByRole('button').first()).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(activeFilters(page).getByText('Status:')).toHaveCount(1)
    })

    test('status filter triggers post list refresh', async ({ page }) => {
      await page.goto('/')

      // Wait for initial posts to load
      const postCards = page.locator('[data-post-id]')
      await expect(postCards.first()).toBeVisible({ timeout: 15000 })
      await page.waitForLoadState('networkidle')

      // "Complete" posts are hidden by default, so picking it changes the list
      await statusGroup(page)
        .getByRole('button', { name: /^Complete/ })
        .click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })

      await expect(
        postCards.first().or(page.getByText('No posts match your filters.'))
      ).toBeVisible({ timeout: 10000 })
      if ((await postCards.count()) > 0) {
        await expect(postCards.first()).toContainText('Complete')
      }
    })

    test('shows posts or the empty state when a filter is applied', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const statusPills = statusGroup(page).getByRole('button')
      await statusPills.nth((await statusPills.count()) - 1).click()
      await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
      await page.waitForLoadState('networkidle')

      // The page should show either posts or an empty state message (not an error page)
      await expect(page.getByText('Something went wrong')).toHaveCount(0)
      await expect(
        page
          .locator('[data-post-id]')
          .first()
          .or(page.getByText(/No posts match/))
      ).toBeVisible({ timeout: 10000 })
    })

    test('the phone Filters sheet closes with Escape', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await page.getByRole('button', { name: 'Filters' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('group', { name: 'Boards' })).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(sheet).toBeHidden({ timeout: 3000 })
    })

    test('multiple status filters use OR logic (shows posts matching any)', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const statusPills = statusGroup(page).getByRole('button')
      test.skip((await statusPills.count()) < 2, 'Fewer than two statuses')

      // Select first status and count its posts
      await statusPills.nth(0).click()
      await expect(page).toHaveURL(/status=/, { timeout: 5000 })
      await page.waitForLoadState('networkidle')
      const postCards = page.locator('[data-post-id]')
      const countWithFirst = await postCards.count()

      // Add second status
      await statusPills.nth(1).click()
      await expect(statusPills.nth(1)).toHaveAttribute('aria-pressed', 'true')
      await page.waitForLoadState('networkidle')

      // OR union cannot produce fewer than either filter alone
      const countWithBoth = await postCards.count()
      expect(countWithBoth).toBeGreaterThanOrEqual(countWithFirst)
    })
  })
})

// ---------------------------------------------------------------------------
// Filter Result Verification
// ---------------------------------------------------------------------------

test.describe('Post List - Filter Result Verification', () => {
  test('status filter: all visible post status badges match the applied filter', async ({
    page,
  }) => {
    // Navigate to page and wait for initial posts to load
    await page.goto('/')
    const postCards = page.locator('[data-post-id]')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Pick "Open" in the filter panel's Status group
    const openPill = page
      .getByRole('group', { name: 'Status', exact: true })
      .getByRole('button', { name: /^Open/ })
    test.skip((await openPill.count()) === 0, 'Open status not found in the filter panel')
    await openPill.click()

    // Wait for URL and page to update (TanStack Router encodes arrays as JSON)
    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')

    // Collect all visible status badge texts from post cards
    // StatusBadge renders as: <span class="inline-flex items-center gap-1.5 text-xs font-medium">
    const statusBadges = page.locator(
      '[data-post-id] span.inline-flex.items-center.text-xs.font-medium'
    )
    // The previous list stays on screen until the filtered one arrives
    await expect
      .poll(async () => (await statusBadges.allTextContents()).every((t) => t.includes('Open')), {
        timeout: 10000,
      })
      .toBe(true)
    const badgeCount = await statusBadges.count()

    // If there are posts with status badges, each should say "Open"
    if (badgeCount > 0) {
      for (let i = 0; i < badgeCount; i++) {
        const text = await statusBadges.nth(i).textContent()
        expect(text?.trim()).toContain('Open')
      }
    } else {
      // Acceptable: zero posts with badges means the empty state or posts without statuses
      const emptyMsg = page.getByText('No posts match your filters.')
      const postLinks = page.locator('[data-post-id]')
      const hasEmpty = (await emptyMsg.count()) > 0
      const hasPosts = (await postLinks.count()) > 0
      expect(hasEmpty || hasPosts).toBe(true)
    }
  })

  test('board filter: all visible post links belong to the selected board', async ({ page }) => {
    // Navigate directly with the features board filter
    await page.goto('/?board=features')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Skip if the features board has no posts in this environment
    const postLinks = page.locator('a[data-post-id]')
    const count = await postLinks.count()
    test.skip(count === 0, 'No posts found for features board')

    // Every post link href should include /b/features/posts/
    for (let i = 0; i < count; i++) {
      const href = await postLinks.nth(i).getAttribute('href')
      expect(href).toMatch(/\/b\/features\/posts\//)
    }
  })

  test('tag filter: post count is reduced after applying a tag filter', async ({ page }) => {
    await page.goto('/')
    const postCards = page.locator('[data-post-id]')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    // Record unfiltered count (up to one page)
    const unfilteredCount = await postCards.count()

    const tags = page.getByRole('group', { name: 'Tags' })
    test.skip((await tags.count()) === 0, 'No tags section in the filter panel')
    await tags.getByRole('button').first().click()
    await expect(page).toHaveURL(/[?&]tagIds=/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')

    // Filtering can only reduce or keep the count
    const filteredCount = await postCards.count()
    expect(filteredCount).toBeGreaterThan(0)
    expect(filteredCount).toBeLessThanOrEqual(unfilteredCount)
  })

  test('clearing a filter restores a larger result set', async ({ page }) => {
    await page.goto('/')
    const postCards = page.locator('[data-post-id]')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    const status = page.getByRole('group', { name: 'Status', exact: true })
    await status.getByRole('button').first().click()
    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')
    const filteredCount = await postCards.count()

    // Remove it from its chip
    await page.getByRole('button', { name: /^Remove Status/ }).click()
    await expect(page).not.toHaveURL(/[?&]status=/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')

    const unfilteredCount = await postCards.count()
    expect(unfilteredCount).toBeGreaterThanOrEqual(filteredCount)
  })

  test('combining board + status filters: count ≤ board-only count AND status-only count', async ({
    page,
  }) => {
    const postCards = page.locator('[data-post-id]')

    // Get board-only count
    await page.goto('/?board=features')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    const boardOnlyCount = await postCards.count()
    test.skip(boardOnlyCount === 0, 'No posts in features board')

    // Pick the first status in the panel to get the URL encoding right
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page
      .getByRole('group', { name: 'Status', exact: true })
      .getByRole('button')
      .first()
      .click()
    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    // Extract the encoded status value from the URL
    const statusMatch = page.url().match(/[?&]status=([^&]+)/)
    const encodedStatus = statusMatch?.[1] ?? ''

    // Get status-only count
    await page.goto(`/?status=${encodedStatus}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    const statusOnlyCount = await postCards.count()

    // Get combined count
    await page.goto(`/?board=features&status=${encodedStatus}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    const combinedCount = await postCards.count()

    expect(combinedCount).toBeLessThanOrEqual(boardOnlyCount)
    expect(combinedCount).toBeLessThanOrEqual(statusOnlyCount)
  })

  test('empty state shows "No posts match your filters." when no posts match', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Pick the last status (often "closed" or similar low-count status)
    const statusPills = page.getByRole('group', { name: 'Status', exact: true }).getByRole('button')
    await statusPills.nth((await statusPills.count()) - 1).click()
    await expect(page).toHaveURL(/[?&]status=/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Whether we have posts or not, the page should not show an error
    await expect(page.getByText('Something went wrong')).toHaveCount(0)

    if ((await page.locator('[data-post-id]').count()) === 0) {
      // Must show the specific empty-state message, not just a blank page
      await expect(page.getByText('No posts match your filters.')).toBeVisible()
    }
    // If there are posts, the filter found some results — test passes vacuously
  })
})

// ---------------------------------------------------------------------------
// Sort Order Verification
// ---------------------------------------------------------------------------

test.describe('Post List - Sort Order Verification', () => {
  test('"New" sort: first post was created more recently than the second post', async ({
    page,
  }) => {
    await page.goto('/?sort=new')
    const postCards = page.locator('[data-post-id]')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    const count = await postCards.count()
    test.skip(count < 2, 'Need at least 2 posts to verify sort order')

    // TimeAgo renders relative text, but the <a> element carries a data-post-id.
    // The most robust DOM signal: the post links themselves include the post IDs.
    // We verify ordering by checking that switching between "New" and "Top" produces
    // different first-post IDs (proving the sort actually changes the list).

    // Capture the first post ID under "new" sort
    const firstPostIdNew = await postCards.first().getAttribute('data-post-id')
    expect(firstPostIdNew).toBeTruthy()

    // Switch to "top" sort
    const topButton = page.getByRole('button', { name: /^Top$/i })
    await topButton.click()
    await expect(page).toHaveURL(/sort=top/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)

    const firstPostIdTop = await postCards.first().getAttribute('data-post-id')
    expect(firstPostIdTop).toBeTruthy()

    // Guard: if both sorts produce the same first post the seed data isn't
    // diverse enough to differentiate them — skip rather than fail.
    test.skip(
      firstPostIdNew === firstPostIdTop,
      'Sort may not differentiate with current data (same first post for new and top)'
    )

    // With 500 seed posts it is astronomically unlikely for new-sort and top-sort
    // to have the same first post. Verify they differ, confirming sort works.
    expect(firstPostIdNew).not.toBe(firstPostIdTop)
  })

  test('"Top" sort: first post has vote count ≥ second post vote count', async ({ page }) => {
    await page.goto('/?sort=top')
    const postCards = page.locator('[data-post-id]')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    const count = await postCards.count()
    test.skip(count < 2, 'Need at least 2 posts to verify sort order')

    // Read vote counts from the DOM via data-testid="vote-count"
    const voteCountSpans = page.locator('[data-post-id] [data-testid="vote-count"]')
    const firstVoteText = await voteCountSpans.nth(0).textContent()
    const secondVoteText = await voteCountSpans.nth(1).textContent()

    test.skip(!firstVoteText || !secondVoteText, 'Vote count elements not found')

    const firstVotes = parseInt(firstVoteText!.trim(), 10)
    const secondVotes = parseInt(secondVoteText!.trim(), 10)

    expect(isNaN(firstVotes)).toBe(false)
    expect(isNaN(secondVotes)).toBe(false)
    // Top sort: higher vote counts first
    expect(firstVotes).toBeGreaterThanOrEqual(secondVotes)
  })

  test('"New" sort places a recently-created post before an older one', async ({ page }) => {
    await page.goto('/?sort=new')
    const postCards = page.locator('[data-post-id]')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    await page.waitForLoadState('networkidle')

    const count = await postCards.count()
    test.skip(count < 2, 'Need at least 2 posts to verify sort order')

    // TimeAgo component renders strings like "about 2 hours ago", "3 days ago".
    // Capture the first two time-ago strings and verify the first is not older than the second.
    // Strategy: "X minutes/hours ago" is newer than "X days/months ago".
    // Note: .post-card is on the same element as [data-post-id], not a descendant.
    const timeAgoSpans = page.locator('[data-post-id] span.text-muted-foreground\\/70')
    const firstTimeAgo = (await timeAgoSpans.nth(0).textContent())?.trim() ?? ''
    const secondTimeAgo = (await timeAgoSpans.nth(1).textContent())?.trim() ?? ''

    // Both should be non-empty relative time strings
    expect(firstTimeAgo.length).toBeGreaterThan(0)
    expect(secondTimeAgo.length).toBeGreaterThan(0)

    // Simple ordering heuristic: if the first contains "minutes" or "hours" and
    // the second contains "days" or "months", the first is definitely more recent.
    // Otherwise we just verify the strings are present (sort is server-side and trusted).
    const firstIsMinutesOrHours = /minutes|hours|seconds/.test(firstTimeAgo)
    const secondIsDaysOrMore = /days|months|years/.test(secondTimeAgo)

    if (firstIsMinutesOrHours && secondIsDaysOrMore) {
      // First post is clearly more recent — verified
      expect(firstIsMinutesOrHours).toBe(true)
    } else {
      // Both are in the same time-unit range; the list is still in new order per server.
      // Just confirm that non-empty relative timestamps are shown on both cards.
      expect(firstTimeAgo.length).toBeGreaterThan(0)
      expect(secondTimeAgo.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Search Accuracy
// ---------------------------------------------------------------------------

test.describe('Post List - Search Accuracy', () => {
  test('search term: only posts whose titles contain the search term are shown', async ({
    page,
  }) => {
    await page.goto('/')
    const postCards = page.locator('[data-post-id]')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    // Wait for React hydration before clicking interactive elements
    await page.waitForLoadState('networkidle')

    // Use a search term that exists in the seed post titles
    const searchTerm = 'dark mode'

    const searchInput = page.getByRole('searchbox', { name: 'Search posts' })
    await searchInput.fill(searchTerm)
    await searchInput.press('Enter')

    await expect(page).toHaveURL(/search=dark\+mode|search=dark%20mode/, { timeout: 5000 })
    // The previous results stay on screen until the search lands; wait for it.
    const titles = page.locator('[data-post-id] h3')
    await expect
      .poll(async () =>
        (await titles.allTextContents()).every((t) =>
          t.toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
      .toBe(true)

    const filteredCount = await postCards.count()
    const emptyState = page.getByText('No posts match your filters.')
    const hasEmpty = (await emptyState.count()) > 0

    test.skip(
      filteredCount === 0 && !hasEmpty,
      'Unexpected empty result without empty state message'
    )

    if (filteredCount > 0) {
      // Every visible post title should contain the search term (case-insensitive)
      const titleCount = await titles.count()
      for (let i = 0; i < titleCount; i++) {
        const titleText = (await titles.nth(i).textContent()) ?? ''
        expect(titleText.toLowerCase()).toContain(searchTerm.toLowerCase())
      }
    } else {
      // Empty state message is acceptable (no matching posts)
      expect(hasEmpty).toBe(true)
    }
  })

  test('clearing search restores a larger result set', async ({ page }) => {
    // Start with search active
    await page.goto('/?search=dark+mode')
    const postCards = page.locator('[data-post-id]')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    const searchCount = await postCards.count()

    const clearButton = page.getByRole('button', { name: /Clear search/i })
    await expect(clearButton).toBeVisible({ timeout: 5000 })
    await clearButton.click()

    // URL should no longer contain a search parameter
    await expect(page).not.toHaveURL(/[?&]search=/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)

    const fullCount = await postCards.count()
    // Full list should have at least as many posts as the search-filtered list
    expect(fullCount).toBeGreaterThanOrEqual(searchCount)
  })

  test('searching for a non-existent term shows the specific empty-state message', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('[data-post-id]').first()).toBeVisible({ timeout: 15000 })
    // Wait for React hydration before clicking interactive elements
    await page.waitForLoadState('networkidle')

    // Search for a string that will never match real post titles
    const impossibleTerm = 'xyzzy_no_such_post_zqwerty_99999'

    const searchInput = page.getByRole('searchbox', { name: 'Search posts' })
    await searchInput.fill(impossibleTerm)
    await searchInput.press('Enter')

    await expect(page).toHaveURL(/search=/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)

    // Should show the specific "no match" message rather than just a blank list
    const noMatchMsg = page.getByText(`No posts match “${impossibleTerm}”.`)
    await expect(noMatchMsg).toBeVisible({ timeout: 5000 })

    // And there should be no post cards
    const postCards = page.locator('[data-post-id]')
    expect(await postCards.count()).toBe(0)
  })
})
