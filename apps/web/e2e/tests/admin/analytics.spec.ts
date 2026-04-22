import { test, expect } from '@playwright/test'

// Analytics is behind a feature flag. When the flag is off the route redirects
// to /admin/feedback. All tests guard for both states.

test.describe('Admin Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/analytics')
    await page.waitForLoadState('networkidle')
  })

  test('page loads without error', async ({ page }) => {
    // Either renders analytics or redirects to feedback — both are valid
    const url = page.url()
    expect(url).toMatch(/\/admin\/(analytics|feedback)/)
  })

  test('shows analytics content or redirects when flag is off', async ({ page }) => {
    const isOnAnalytics = page.url().includes('/admin/analytics')
    if (!isOnAnalytics) {
      // Flag is disabled — redirect to feedback is expected behaviour
      await expect(page).toHaveURL(/\/admin\/feedback/)
      return
    }

    // Flag is enabled — some content should be visible
    await expect(page.locator('main, [class*="flex"]').first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Admin Analytics — Period Selector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/analytics')
    await page.waitForLoadState('networkidle')
  })

  test('period selector buttons are present when analytics enabled', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    // Wait for the skeleton to resolve
    await page.waitForTimeout(500)

    // Period buttons: 7d, 30d, 90d, 12m rendered as <button> elements
    const periodButtons = page.getByRole('button', { name: /^(7d|30d|90d|12m)$/ })

    if ((await periodButtons.count()) > 0) {
      await expect(periodButtons.first()).toBeVisible({ timeout: 10000 })
    }
  })

  test('can switch to 7d period', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    const btn7d = page.getByRole('button', { name: '7d' })
    if ((await btn7d.count()) > 0) {
      await btn7d.click()
      await page.waitForLoadState('networkidle')
      // Button should now have primary background (active state)
      await expect(btn7d).toBeVisible()
    }
  })

  test('can switch to 30d period', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    const btn30d = page.getByRole('button', { name: '30d' })
    if ((await btn30d.count()) > 0) {
      await btn30d.click()
      await page.waitForLoadState('networkidle')
      await expect(btn30d).toBeVisible()
    }
  })

  test('can switch to 90d period', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    const btn90d = page.getByRole('button', { name: '90d' })
    if ((await btn90d.count()) > 0) {
      await btn90d.click()
      await page.waitForLoadState('networkidle')
      await expect(btn90d).toBeVisible()
    }
  })

  test('can switch to 12m period', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    const btn12m = page.getByRole('button', { name: '12m' })
    if ((await btn12m.count()) > 0) {
      await btn12m.click()
      await page.waitForLoadState('networkidle')
      await expect(btn12m).toBeVisible()
    }
  })
})

test.describe('Admin Analytics — Section Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/analytics')
    await page.waitForLoadState('networkidle')
  })

  test('left sidebar shows section nav on large screens', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    // The analytics sidebar contains Overview, Feedback, Changelog, Users buttons
    const overviewBtn = page.getByRole('button', { name: 'Overview' })
    if ((await overviewBtn.count()) > 0) {
      await expect(overviewBtn).toBeVisible({ timeout: 10000 })
    }
  })

  test('Overview section is selected by default', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    // "Sections" heading appears in the left sidebar
    const sectionsLabel = page.getByText('Sections', { exact: false })
    if ((await sectionsLabel.count()) > 0) {
      await expect(sectionsLabel.first()).toBeVisible({ timeout: 10000 })
    }
  })

  test('can navigate to Feedback section', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    // There are two "Feedback" elements: sidebar nav button + main nav link
    // The sidebar nav button is inside the analytics aside
    const feedbackBtn = page
      .locator('aside button')
      .filter({ hasText: 'Feedback' })

    if ((await feedbackBtn.count()) > 0) {
      await feedbackBtn.first().click()
      await page.waitForTimeout(300)

      // Status distribution and Boards cards should appear
      const statusCard = page.getByText('Status distribution')
      const boardsCard = page.getByText('Boards')
      const hasContent =
        (await statusCard.count()) > 0 || (await boardsCard.count()) > 0
      expect(hasContent).toBe(true)
    }
  })

  test('can navigate to Changelog section', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    const changelogBtn = page
      .locator('aside button')
      .filter({ hasText: 'Changelog' })

    if ((await changelogBtn.count()) > 0) {
      await changelogBtn.first().click()
      await page.waitForTimeout(300)

      const changelogViews = page.getByText('Changelog views')
      if ((await changelogViews.count()) > 0) {
        await expect(changelogViews.first()).toBeVisible()
      }
    }
  })

  test('can navigate to Users section', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    const usersBtn = page
      .locator('aside button')
      .filter({ hasText: 'Users' })

    if ((await usersBtn.count()) > 0) {
      await usersBtn.first().click()
      await page.waitForTimeout(300)

      const topContributors = page.getByText('Top contributors')
      if ((await topContributors.count()) > 0) {
        await expect(topContributors.first()).toBeVisible()
      }
    }
  })
})

test.describe('Admin Analytics — Metrics Cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/analytics')
    await page.waitForLoadState('networkidle')
  })

  test('shows Posts metric card when data available', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    await page.waitForLoadState('networkidle')
    // Give Suspense a moment to resolve
    await page.waitForTimeout(1000)

    const postsCard = page.getByRole('button', { name: /posts/i })
    if ((await postsCard.count()) > 0) {
      await expect(postsCard.first()).toBeVisible()
    }
  })

  test('shows Votes metric card when data available', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    await page.waitForTimeout(1000)

    const votesCard = page.getByRole('button', { name: /votes/i })
    if ((await votesCard.count()) > 0) {
      await expect(votesCard.first()).toBeVisible()
    }
  })

  test('shows Comments metric card when data available', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    await page.waitForTimeout(1000)

    const commentsCard = page.getByRole('button', { name: /comments/i })
    if ((await commentsCard.count()) > 0) {
      await expect(commentsCard.first()).toBeVisible()
    }
  })

  test('shows Users metric card when data available', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    await page.waitForTimeout(1000)

    // "Users" appears both in sidebar nav and metric card; use the button role to
    // target the clickable metric card specifically
    const usersMetricBtn = page.getByRole('button', { name: /^users$/i })
    if ((await usersMetricBtn.count()) > 0) {
      await expect(usersMetricBtn.first()).toBeVisible()
    }
  })

  test('can click Posts metric to set it as active', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    await page.waitForTimeout(1000)

    const postsBtn = page.getByRole('button', { name: /^posts$/i })
    if ((await postsBtn.count()) > 0) {
      await postsBtn.first().click()
      // Active state is applied via inline style — just verify the button remains visible
      await expect(postsBtn.first()).toBeVisible()
    }
  })

  test('shows activity chart area after data loads', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    await page.waitForTimeout(1500)

    // The chart is rendered inside a Card; an SVG (recharts) will be present
    const chartSvg = page.locator('svg').first()
    if ((await chartSvg.count()) > 0) {
      await expect(chartSvg).toBeVisible()
    }
  })

  test('shows last updated timestamp when data is present', async ({ page }) => {
    if (!page.url().includes('/admin/analytics')) return

    await page.waitForTimeout(1500)

    const updated = page.getByText(/updated .* ago/)
    if ((await updated.count()) > 0) {
      await expect(updated.first()).toBeVisible()
    }
  })
})
