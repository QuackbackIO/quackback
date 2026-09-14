import { expect, test } from '@playwright/test'

test.describe('Home Getting Started card', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 10_000 })
  })

  test('old Getting Started bookmarks land on Overview', async ({ page }) => {
    await page.goto('/admin/getting-started')
    await expect(page).toHaveURL(/\/admin\/?$/, { timeout: 10_000 })
    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 10_000 })
  })

  test('shows Getting started with accessible progress when essentials remain', async ({
    page,
  }) => {
    const heading = page.getByRole('heading', { name: 'Getting started' })
    if ((await heading.count()) === 0) {
      test.skip(true, 'The seeded workspace has already resolved its essentials')
      return
    }

    await expect(heading).toBeVisible()
    const progress = page.getByRole('progressbar', { name: 'Setup progress' })
    await expect(progress).toBeVisible()
    await expect(progress).toHaveAttribute('aria-valuemin', '0')
    await expect(progress).toHaveAttribute('aria-valuenow', /\d+/)
    await expect(progress).toHaveAttribute('aria-valuemax', '100')
    await expect(page.getByText(/% completed/)).toBeVisible()
  })

  test('Start on the current step opens a real action', async ({ page }) => {
    const heading = page.getByRole('heading', { name: 'Getting started' })
    if ((await heading.count()) === 0) {
      test.skip(true, 'The seeded workspace has already resolved its essentials')
      return
    }

    const start = page
      .getByRole('button', { name: 'Start' })
      .or(page.getByRole('link', { name: 'Start' }))
    const copy = page.getByRole('button', { name: /Copy/i })
    await expect(start.or(copy).first()).toBeVisible()
  })

  test('the org logo returns to Overview from Feedback', async ({ page }) => {
    await page.goto('/admin/feedback')
    await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 10_000 })
    await page.locator('aside a[href="/admin"]').first().click()
    await expect(page).toHaveURL(/\/admin\/?$/)
    await expect(page.locator('a[href="/admin/getting-started"]')).toHaveCount(0)
  })

  test('renders without an error boundary', async ({ page }) => {
    await expect(page.getByText(/something went wrong|failed to load/i)).not.toBeVisible()
  })

  test('tiles use module names and Actions opens a create dialog', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Feedback & Roadmaps' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Changelog' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible()

    await page.getByRole('button', { name: 'Actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'New post' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'New changelog' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'New changelog' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
