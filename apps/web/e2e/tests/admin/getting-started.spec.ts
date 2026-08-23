import { expect, test } from '@playwright/test'

// Admin project uses stored auth state (e2e/.auth/admin.json) — no manual login needed.

test.describe('Launch plan (Getting Started)', () => {
  // Goal change and skip write the singleton seeded workspace. Parallel
  // workers would see Help Center or a skipped essential mid-file.
  test.describe.configure({ mode: 'serial' })

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

  test('emphasizes the current setup step with its action', async ({ page }) => {
    const upNext = page.getByText('Up next')
    if ((await upNext.count()) === 0) {
      test.skip(true, 'The seeded workspace has no available setup steps')
      return
    }

    await expect(upNext).toBeVisible()
    const essentials = page
      .getByRole('heading', { name: 'Set up the essentials' })
      .locator('xpath=ancestor::section[1]')
    await expect(
      essentials
        .getByRole('link')
        .or(essentials.getByRole('button', { name: /Write|Create|Connect|Copy|Turn on/i }))
        .first()
    ).toBeVisible()
  })

  test('skip moves a step into Skipped steps and Add back restores the count', async ({ page }) => {
    const progress = page.getByRole('progressbar', { name: 'Setup progress' })
    if ((await progress.count()) === 0) {
      test.skip(true, 'All essentials are already skipped')
      return
    }

    const skip = page.getByRole('button', { name: 'Skip' }).first()
    if ((await skip.count()) === 0) {
      test.skip(true, 'No skippable setup step is on the page')
      return
    }

    const maxBefore = await progress.getAttribute('aria-valuemax')
    await skip.click()
    await expect(page.getByRole('heading', { name: 'Skipped steps' })).toBeVisible()
    await page.getByRole('heading', { name: 'Skipped steps' }).click()
    await page.getByRole('button', { name: 'Add back' }).click()
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
      'aria-valuemax',
      maxBefore ?? ''
    )
  })

  test('changing the goal to Help Center turns the product on', async ({ page }) => {
    const changeGoal = page.getByRole('button', { name: 'Change goal' })
    if ((await changeGoal.count()) === 0 || (await changeGoal.isDisabled())) {
      test.skip(true, 'This workspace does not let the admin change the goal')
      return
    }

    const seededGoal = 'Product feedback'
    const goalHeading = page.locator('#activation-goal + h2')

    async function selectGoal(label: string): Promise<void> {
      const current = (await goalHeading.textContent())?.trim()
      if (current === label) return
      await page.getByRole('button', { name: 'Change goal' }).click()
      await page.getByRole('radio', { name: label }).click()
      await page.getByRole('button', { name: 'Use this goal' }).click()
      await expect(goalHeading).toHaveText(label)
    }

    try {
      await selectGoal('Help Center')
      await expect(page.getByRole('link', { name: 'Help Center' }).first()).toBeVisible()
      await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
        'aria-valuemax',
        /[1-9]\d*/
      )
    } finally {
      await page.goto('/admin/getting-started')
      await page.waitForLoadState('networkidle')
      const restore = page.getByRole('button', { name: 'Change goal' })
      if ((await restore.count()) > 0 && (await restore.isEnabled())) {
        await selectGoal(seededGoal)
      }
    }
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
