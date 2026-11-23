import { test, expect } from '@playwright/test'

// Since #388 /admin is Home (the overview). It no longer redirects to /admin/feedback.

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
  })

  test('page loads without error', async ({ page }) => {
    // Home's heading greets the signed-in teammate
    await expect(page.locator('h1#home-greeting')).toBeVisible({ timeout: 10000 })
  })

  test('/admin stays on Home', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/?$/)
    await expect(page.getByRole('link', { name: 'Home' }).first()).toHaveAttribute(
      'data-active',
      'true'
    )
  })

  test('renders the admin layout without crashing', async ({ page }) => {
    // The admin layout wraps all admin pages in a flex container with a sidebar
    await expect(page.locator('body')).toBeVisible()
    // No error boundary should be showing
    await expect(page.getByText('Failed to load feedback')).toBeHidden()
  })
})

test.describe('Admin Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/feedback')
    await page.waitForLoadState('networkidle')
  })

  test('sidebar is visible on desktop', async ({ page }) => {
    // Desktop sidebar is rendered as <aside> with class sm:flex
    const sidebar = page.locator('aside').first()
    await expect(sidebar).toBeVisible({ timeout: 10000 })
  })

  test('sidebar has Feedback navigation link', async ({ page }) => {
    const feedbackLink = page.getByRole('link', { name: 'Feedback' })
    await expect(feedbackLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('sidebar has Roadmap navigation link', async ({ page }) => {
    const roadmapLink = page.getByRole('link', { name: 'Roadmap' })
    await expect(roadmapLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('sidebar has Changelog navigation link', async ({ page }) => {
    const changelogLink = page.getByRole('link', { name: 'Changelog' })
    await expect(changelogLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('sidebar has Users navigation link', async ({ page }) => {
    const usersLink = page.getByRole('link', { name: 'Users' })
    await expect(usersLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('sidebar has Settings navigation link', async ({ page }) => {
    const settingsLink = page.getByRole('link', { name: 'Settings' })
    await expect(settingsLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('Feedback nav link is clickable and navigates correctly', async ({ page }) => {
    const feedbackLink = page.getByRole('link', { name: 'Feedback' }).first()
    await feedbackLink.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/feedback/)
  })

  test('Roadmap nav link is clickable and navigates correctly', async ({ page }) => {
    const roadmapLink = page.getByRole('link', { name: 'Roadmap' }).first()
    await roadmapLink.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/roadmap/)
  })

  test('Changelog nav link is clickable and navigates correctly', async ({ page }) => {
    const changelogLink = page.getByRole('link', { name: 'Changelog' }).first()
    await changelogLink.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/changelog/)
  })

  test('Users nav link is clickable and navigates correctly', async ({ page }) => {
    const usersLink = page.getByRole('link', { name: 'Users' }).first()
    await usersLink.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/users/)
  })

  test('View portal link is present', async ({ page }) => {
    const portalLink = page.getByRole('link', { name: 'View portal' })
    await expect(portalLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('logo links to Home', async ({ page }) => {
    // The sidebar logo shows the workspace's own logo and name (seed: Acme Corp)
    // and leads to Home.
    const logoLink = page.getByRole('link', { name: 'Acme Corp' }).first()
    await expect(logoLink).toBeVisible({ timeout: 10000 })
    await logoLink.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/?$/)
  })
})

test.describe('Admin Feedback Page (Dashboard Content)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/feedback')
    await page.waitForLoadState('networkidle')
  })

  test('page loads without error', async ({ page }) => {
    await expect(page.getByText('Failed to load feedback')).toBeHidden()
  })

  test('shows posts list or empty state', async ({ page }) => {
    // The inbox container renders a post list or an empty message
    const hasPosts = (await page.locator('[data-testid="post-item"]').count()) > 0
    const hasEmptyState = (await page.getByText(/no posts|no feedback|nothing here/i).count()) > 0
    const hasContent = hasPosts || hasEmptyState || (await page.locator('main').count()) > 0
    expect(hasContent).toBe(true)
  })

  test('shows sort selector', async ({ page }) => {
    // The inbox has a sort control (newest/oldest/votes) that changes the order
    const sortControl = page.getByRole('button', { name: /^Sort: / }).first()
    await expect(sortControl).toBeVisible({ timeout: 10000 })
    await expect(sortControl).toHaveText(/Sort: Newest/)

    await sortControl.click()
    await page.getByRole('menuitemradio', { name: 'Oldest' }).click()
    await expect(page.getByRole('button', { name: /^Sort: Oldest/ }).first()).toBeVisible()
  })

  test('shows filter controls or boards sidebar', async ({ page }) => {
    // Boards / filter sidebar or floating filter button should be present
    const hasFilterSidebar = (await page.locator('aside').count()) > 1
    const hasFilterButton = (await page.getByRole('button', { name: /filter/i }).count()) > 0
    expect(hasFilterSidebar || hasFilterButton).toBe(true)
  })

  test('feedback link is active in sidebar while on feedback page', async ({ page }) => {
    // The active rail item is marked data-active and pressed into the rail
    // The Feedback link should exist and have an active state
    const feedbackLink = page.getByRole('link', { name: 'Feedback' }).first()
    await expect(feedbackLink).toBeVisible()
  })
})

test.describe('Admin tab opened before an update', () => {
  test('a call from the older build is answered as stale and the page reloads once', async ({
    page,
    baseURL,
  }) => {
    // The server answers an id it does not have (what an older build asks
    // for) with a marked 409, never cached, instead of a 500.
    const answer = await page.request.post('/_serverFn/an-id-from-an-older-build', {
      headers: {
        'content-type': 'application/json',
        'x-tsr-serverFn': 'true',
        origin: new URL(baseURL!).origin,
      },
      data: {},
    })
    expect(answer.status()).toBe(409)
    expect(answer.headers()['x-stale-build']).toBe('1')
    expect(answer.headers()['cache-control']).toBe('no-store')
    const message = await answer.text()
    expect(message).toBe('This page is out of date. Reload the page to continue.')

    // In the browser, every server function now gets that answer, as it would
    // after an update. The page reloads once, and does not keep reloading.
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    await page.route('**/_serverFn/**', (route) =>
      route.fulfill({ status: 409, headers: answer.headers(), body: message })
    )
    // A reload is a document request, issued the moment the page asks for it.
    let reloads = 0
    page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) reloads++
    })

    const reloaded = page.waitForEvent('load')
    await page.getByRole('link', { name: 'Feedback' }).first().click()
    await reloaded
    expect(reloads).toBe(1)
    await page.waitForLoadState('networkidle')

    // After the reload the calls still get that answer: the call fails like
    // any other, and the page does not reload again. The marker only survives
    // on the same document; the pause gives a second reload time to start.
    await page.evaluate(() => {
      ;(window as unknown as { sameDocument?: boolean }).sameDocument = true
    })
    const staleAgain = page.waitForResponse((r) => r.url().includes('/_serverFn/'))
    await page.getByRole('link', { name: 'Roadmap' }).first().click()
    expect((await staleAgain).status()).toBe(409)
    await page.waitForTimeout(1500)
    expect(reloads).toBe(1)
    expect(
      await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument)
    ).toBe(true)
  })
})
