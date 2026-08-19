import { expect, test } from '@playwright/test'

// Admin project uses stored auth state (e2e/.auth/admin.json) — no manual login needed.

test.describe('Launch plan (Getting Started)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/getting-started')
    await page.waitForLoadState('networkidle')
  })

  test('shows the current goal and readiness sections', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/getting-started/, { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Your launch plan' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Set up the essentials' })).toBeVisible()
    await expect(page.getByText('Current goal')).toBeVisible()
  })

  test('reports progress with accessible semantics', async ({ page }) => {
    const progress = page.getByRole('progressbar', { name: 'Setup progress' })
    await expect(progress).toBeVisible({ timeout: 10_000 })
    await expect(progress).toHaveAttribute('aria-valuemin', '0')
    await expect(progress).toHaveAttribute('aria-valuenow', /\d+/)
    await expect(progress).toHaveAttribute('aria-valuemax', /\d+/)
  })

  test('uses the shared Radix viewport for vertical scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 })

    const viewport = page
      .getByRole('heading', { name: 'Your launch plan' })
      .locator('xpath=ancestor::*[@data-slot="scroll-area-viewport"][1]')
    await expect(viewport).toBeVisible()
    await expect
      .poll(() =>
        viewport.evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }))
      )
      .toMatchObject({ clientHeight: expect.any(Number), scrollHeight: expect.any(Number) })

    const canScroll = await viewport.evaluate(
      (element) => element.scrollHeight > element.clientHeight
    )
    expect(canScroll).toBe(true)

    await viewport.evaluate((element) => {
      element.scrollTop = 160
    })
    await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  })

  test('offers an action for the next available setup step', async ({ page }) => {
    const essentials = page
      .getByRole('heading', { name: 'Set up the essentials' })
      .locator('xpath=ancestor::section[1]')
    const actionableLinks = essentials.locator('ul a')

    if ((await actionableLinks.count()) === 0) {
      test.skip(true, 'The seeded workspace has no available setup steps')
      return
    }

    await expect(actionableLinks.first()).toBeVisible()
  })

  test('is accessible from the admin sidebar through the launch plan link', async ({ page }) => {
    await page.goto('/admin/feedback')
    await page.waitForLoadState('networkidle')

    const link = page.getByRole('link', { name: /launch plan/i }).first()
    if ((await link.count()) === 0) {
      test.skip(true, 'The seeded workspace has already completed its launch plan')
      return
    }

    await expect(link).toBeVisible({ timeout: 10_000 })
    await link.click()
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveURL(/\/admin\/getting-started/)
  })

  test('renders without an error boundary', async ({ page }) => {
    await expect(page.getByText(/something went wrong|failed to load/i)).not.toBeVisible()
  })
})
