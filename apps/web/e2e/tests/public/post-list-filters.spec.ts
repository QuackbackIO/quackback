import { test, expect } from '@playwright/test'

test.describe('Public Post List — chip filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('shows no status chip at the default scope', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'Active filters' })).toHaveCount(0)
  })

  test('More filters → 10+ votes filters posts and adds a chip', async ({ page }) => {
    await page.getByRole('button', { name: /^more filters$/i }).click()
    await page.getByRole('button', { name: '10+', exact: true }).click()

    await expect(page).toHaveURL(/[?&]minVotes=10/, { timeout: 5000 })
    await expect(page.getByText(/min votes:/i)).toBeVisible()
  })

  test('a chip opens its pills to change the filter in place', async ({ page }) => {
    await page.goto(`/?status=${encodeURIComponent(JSON.stringify(['open']))}`)
    await page.waitForLoadState('networkidle')
    const chips = page.getByRole('region', { name: 'Active filters' })
    await chips.getByRole('button', { name: /^Status:/ }).click()
    const editor = page.getByRole('dialog', { name: 'Status' })
    await editor.getByRole('button', { name: /^Planned/ }).click()

    await expect(page).toHaveURL(/planned/, { timeout: 5000 })
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('button', { name: /^Planned/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  test('while the feed loads, the compose card, sorting and search are already there', async ({
    page,
  }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    // Hold back only the feed's data (fetchPortalData), not the route.
    await page.route(/_serverFn\/.*ZmV0Y2hQb3J0YWxEYXRh/, async (route) => {
      await held
      await route.continue()
    })
    await page.getByRole('link', { name: 'Feedback' }).first().click()

    await expect(page.getByTestId('portal-feed-skeleton')).toBeVisible()
    await expect(page.getByPlaceholder("What's on your mind?")).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search posts' })).toBeVisible()
    await page.getByRole('button', { name: 'Top', exact: true }).click()
    await expect(page).toHaveURL(/[?&]sort=top/)
    await expect(page.getByRole('button', { name: 'All boards' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    release()
    await expect(page.locator('[data-post-id]').first()).toBeVisible()
    await expect(page.getByTestId('portal-feed-skeleton')).toHaveCount(0)
  })

  test('what is typed while the feed loads carries into the loaded feed', async ({ page }) => {
    await page.goto('/changelog')
    await page.waitForLoadState('networkidle')
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(/_serverFn\/.*ZmV0Y2hQb3J0YWxEYXRh/, async (route) => {
      await held
      await route.continue()
    })
    await page.getByRole('link', { name: 'Feedback' }).first().click()
    await expect(page.getByTestId('portal-feed-skeleton')).toBeVisible()

    await page.getByRole('searchbox', { name: 'Search posts' }).fill('zap')
    await page.getByPlaceholder("What's on your mind?").fill('Dark mode')
    // The feed arrives before the search's pause runs out.
    release()

    await expect(page).toHaveURL(/[?&]search=zap/, { timeout: 5000 })
    await expect(page.getByRole('searchbox', { name: 'Search posts' })).toHaveValue('zap')
    await expect(page.getByPlaceholder("What's on your mind?")).toHaveValue('Dark mode')
  })

  test('Clear all wipes filters', async ({ page }) => {
    await page.getByRole('button', { name: /^more filters$/i }).click()
    await page.getByRole('button', { name: '10+', exact: true }).click()
    await expect(page).toHaveURL(/[?&]minVotes=10/, { timeout: 5000 })
    await page.getByRole('button', { name: '7 days', exact: true }).click()
    await expect(page).toHaveURL(/[?&]dateFrom=/, { timeout: 5000 })

    await page.getByRole('button', { name: /clear all/i }).click()

    await expect(page).not.toHaveURL(/minVotes/)
    await expect(page).not.toHaveURL(/dateFrom/)
    await expect(page.getByRole('region', { name: 'Active filters' })).toHaveCount(0)
  })

  test('search finds a complete post that the default view hides', async ({ page }) => {
    // The route reads status as a JSON array, the way the app writes it.
    await page.goto(`/?status=${encodeURIComponent(JSON.stringify(['complete']))}`)
    const firstTitle = page.locator('[data-post-id] h3').first()
    await expect(firstTitle).toBeVisible()
    const title = (await firstTitle.innerText()).trim()

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('searchbox', { name: 'Search posts' }).fill(title)

    await expect(page).toHaveURL(/[?&]search=/, { timeout: 5000 })
    await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible()
    // Search looks past the default scope without any status picked.
    await expect(
      page
        .getByRole('group', { name: 'Status', exact: true })
        .getByRole('button', { name: /^Complete/ })
    ).toHaveAttribute('aria-pressed', 'false')
  })
})
