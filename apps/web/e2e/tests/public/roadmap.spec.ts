import { test, expect } from '@playwright/test'

test.describe('Public Roadmap', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap')
    await page.waitForLoadState('networkidle')
  })

  test('page loads at /roadmap', async ({ page }) => {
    await expect(page).toHaveURL(/\/roadmap/)
  })

  test('page has correct title meta tag', async ({ page }) => {
    const title = await page.title()
    expect(title).toMatch(/roadmap/i)
  })

  test('page shows "Roadmap" heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /roadmap/i, level: 1 })).toBeVisible()
  })

  test('page shows description text', async ({ page }) => {
    await expect(
      page.getByText(/see what we('re| are) working on|what's coming next/i)
    ).toBeVisible()
  })

  test('shows roadmap columns or empty state', async ({ page }) => {
    // Either columns (Card elements with column headers) or the empty state
    const columns = page.locator('.roadmap-card').or(page.locator('[class*="CardTitle"]'))
    const emptyState = page.getByText(/no roadmaps available/i)

    const columnCount = await columns.count()
    const emptyCount = await emptyState.count()

    expect(columnCount + emptyCount).toBeGreaterThan(0)
  })

  test('empty state is shown when no roadmaps exist', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    const columns = page.locator('[data-radix-scroll-area-viewport]')

    if ((await emptyState.count()) > 0) {
      await expect(emptyState).toBeVisible()
      await expect(page.getByText(/check back later/i)).toBeVisible()
    } else {
      // Roadmap data exists — scroll area with columns should be visible
      await expect(columns.first()).toBeVisible()
    }
  })

  test('column headers are visible when roadmap data exists', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    if ((await emptyState.count()) > 0) {
      test.skip()
      return
    }

    // RoadmapColumn renders a CardTitle for each status shown on the roadmap
    // shadcn Card uses data-slot attributes, not CSS class names
    const columnCards = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]'),
    })

    await expect(columnCards.first()).toBeVisible({ timeout: 10000 })
  })

  test('status columns have badge showing post count', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    if ((await emptyState.count()) > 0) {
      test.skip()
      return
    }

    // Each column has a Badge next to the title showing a numeric count
    // shadcn Card uses data-slot attributes; Badge uses data-slot="badge"
    const columnBadges = page.locator('[data-slot="card-header"] [data-slot="badge"]')
    await expect(columnBadges.first()).toBeVisible({ timeout: 10000 })
    const badgeText = await columnBadges.first().textContent()
    expect(badgeText).toMatch(/^\d+$/)
  })

  test('columns show "No items yet" when a status has no posts', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    if ((await emptyState.count()) > 0) {
      test.skip()
      return
    }

    // Empty columns render a "No items yet" message inside the scroll area
    const noItemsMsg = page.getByText(/no items yet/i)
    if ((await noItemsMsg.count()) > 0) {
      await expect(noItemsMsg.first()).toBeVisible()
    }
  })

  test('roadmap posts are displayed as cards when data exists', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    if ((await emptyState.count()) > 0) {
      test.skip()
      return
    }

    // RoadmapCard renders with class "roadmap-card" and links to /b/{slug}/posts/{id}
    const roadmapCards = page.locator('.roadmap-card')
    if ((await roadmapCards.count()) > 0) {
      await expect(roadmapCards.first()).toBeVisible()
    }
  })

  test('roadmap post cards show a title', async ({ page }) => {
    const roadmapCards = page.locator('.roadmap-card')
    if ((await roadmapCards.count()) === 0) {
      test.skip()
      return
    }

    // Title text is inside .roadmap-card__content as a <p>
    const firstCardContent = roadmapCards.first().locator('.roadmap-card__content p')
    await expect(firstCardContent).toBeVisible()
    const titleText = await firstCardContent.textContent()
    expect(titleText?.trim().length).toBeGreaterThan(0)
  })

  test('roadmap post cards show a vote count', async ({ page }) => {
    const roadmapCards = page.locator('.roadmap-card')
    if ((await roadmapCards.count()) === 0) {
      test.skip()
      return
    }

    // Vote count is inside .roadmap-card__vote as a <span>
    const voteCount = roadmapCards.first().locator('.roadmap-card__vote span')
    await expect(voteCount).toBeVisible()
    const countText = await voteCount.textContent()
    expect(countText).toMatch(/^\d+$/)
  })

  test('roadmap post cards show a board badge', async ({ page }) => {
    const roadmapCards = page.locator('.roadmap-card')
    if ((await roadmapCards.count()) === 0) {
      test.skip()
      return
    }

    // Each card shows a Badge with the board name; shadcn Badge uses data-slot="badge"
    const boardBadge = roadmapCards.first().locator('[data-slot="badge"]')
    await expect(boardBadge).toBeVisible()
  })

  test('clicking a roadmap post navigates to its detail page', async ({ page }) => {
    const roadmapCards = page.locator('.roadmap-card')
    if ((await roadmapCards.count()) === 0) {
      test.skip()
      return
    }

    const firstCard = roadmapCards.first()
    const href = await firstCard.getAttribute('href')

    await Promise.all([
      page.waitForURL(/\/posts\//, { timeout: 10000 }),
      firstCard.click(),
    ])

    if (href) {
      await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    } else {
      await expect(page).toHaveURL(/\/posts\//)
    }
  })

  test('roadmap tabs are shown when multiple roadmaps exist', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    if ((await emptyState.count()) > 0) {
      test.skip()
      return
    }

    // Tabs are rendered only when availableRoadmaps.length > 1
    const tabs = page.locator('[role="tablist"]')
    if ((await tabs.count()) > 0) {
      await expect(tabs.first()).toBeVisible()
      const tabTriggers = tabs.first().locator('[role="tab"]')
      await expect(tabTriggers.first()).toBeVisible()
    }
  })

  test('switching roadmap tabs updates the board', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    if ((await emptyState.count()) > 0) {
      test.skip()
      return
    }

    const tabList = page.locator('[role="tablist"]')
    if ((await tabList.count()) === 0) {
      test.skip()
      return
    }

    const tabs = tabList.first().locator('[role="tab"]')
    const tabCount = await tabs.count()
    if (tabCount < 2) {
      test.skip()
      return
    }

    // Click the second tab
    await tabs.nth(1).click()
    await page.waitForLoadState('networkidle')

    // The second tab should now be selected
    await expect(tabs.nth(1)).toHaveAttribute('data-state', 'active')
    await expect(tabs.nth(0)).not.toHaveAttribute('data-state', 'active')
  })

  test('URL search param ?roadmap= selects the corresponding roadmap', async ({ page }) => {
    // Navigate fresh without beforeEach interference
    await page.goto('/roadmap')
    await page.waitForLoadState('networkidle')

    const tabList = page.locator('[role="tablist"]')
    if ((await tabList.count()) === 0) {
      test.skip()
      return
    }

    // Get the value of the first tab to use as the roadmap param
    const firstTab = tabList.first().locator('[role="tab"]').first()
    const roadmapId = await firstTab.getAttribute('data-value')

    if (!roadmapId) {
      test.skip()
      return
    }

    await page.goto(`/roadmap?roadmap=${roadmapId}`)
    await page.waitForLoadState('networkidle')

    await expect(firstTab).toHaveAttribute('data-state', 'active')
  })

  test('filter bar is rendered on the roadmap page', async ({ page }) => {
    const emptyState = page.getByText(/no roadmaps available/i)
    if ((await emptyState.count()) > 0) {
      test.skip()
      return
    }

    // RoadmapFiltersBar renders a Search button + sort buttons + "Add filter" button.
    // There is no form or [class*="filters"] element visible — the form is inside a popover.
    // Check for the "Add filter" button which is always rendered.
    const addFilterButton = page.getByRole('button', { name: 'Add filter' })
    await expect(addFilterButton).toBeVisible({ timeout: 5000 })
    // Page should not show an error state
    await expect(page.locator('body')).not.toContainText(/something went wrong/i)
  })
})
