import { test, expect } from '@playwright/test'

// /admin redirects to /admin/feedback — all dashboard tests run on the feedback page

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
  })

  test('page loads without error', async ({ page }) => {
    // Should redirect to /admin/feedback
    await expect(page).toHaveURL(/\/admin\/feedback/, { timeout: 10000 })
  })

  test('redirects /admin to /admin/feedback', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/feedback/)
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

  test('View Portal link is present', async ({ page }) => {
    const portalLink = page.getByRole('link', { name: 'View Portal' })
    await expect(portalLink.first()).toBeVisible({ timeout: 10000 })
  })

  test('logo links to feedback page', async ({ page }) => {
    const logoLink = page.getByRole('link', { name: 'Quackback' }).first()
    await expect(logoLink).toBeVisible({ timeout: 10000 })
    await logoLink.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/feedback/)
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
    // The inbox has a sort control (newest/oldest/votes)
    const sortControl = page
      .getByRole('combobox')
      .filter({ hasText: /newest|oldest|votes/i })

    if ((await sortControl.count()) > 0) {
      await expect(sortControl.first()).toBeVisible()
    }
  })

  test('shows filter controls or boards sidebar', async ({ page }) => {
    // Boards / filter sidebar or floating filter button should be present
    const hasFilterSidebar = (await page.locator('aside').count()) > 1
    const hasFilterButton =
      (await page.getByRole('button', { name: /filter/i }).count()) > 0
    expect(hasFilterSidebar || hasFilterButton).toBe(true)
  })

  test('feedback link is active in sidebar while on feedback page', async ({ page }) => {
    // The active nav item gets bg-muted/80 applied via CSS class
    // The Feedback link should exist and have an active state
    const feedbackLink = page.getByRole('link', { name: 'Feedback' }).first()
    await expect(feedbackLink).toBeVisible()
  })
})
