import { test, expect } from '@playwright/test'

test.describe('Discord notification routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/integrations/discord')
    await page.waitForLoadState('networkidle')
  })

  test('renders the routing UI when Discord is connected', async ({ page }) => {
    // Skip when Discord isn't connected in this environment — the page shows
    // the connection-setup card instead of the routing UI.
    const setupCard = page.getByText(/connect your discord server/i)
    if (await setupCard.isVisible()) test.skip()

    const hasTable = await page.getByRole('button', { name: /add channel/i }).isVisible()
    const hasEmptyState = await page
      .getByText(/no notification channels configured yet/i)
      .isVisible()
    expect(hasTable || hasEmptyState).toBe(true)
  })

  test('add channel dialog opens and closes', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add (your first )?channel/i }).first()
    if (!(await addBtn.isVisible())) test.skip()

    await addBtn.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByText(/route events to a channel/i)).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('exposes board filter in add dialog', async ({ page }) => {
    const addBtn = page.getByRole('button', { name: /add (your first )?channel/i }).first()
    if (!(await addBtn.isVisible())) test.skip()

    await addBtn.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    // Board filter is a combobox showing "All boards" by default.
    await expect(page.getByText(/board filter/i)).toBeVisible()
    await expect(page.getByRole('combobox').filter({ hasText: /all boards/i })).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
  })

  test('event columns reflect Discord event list (3 events, no changelog)', async ({ page }) => {
    // Column headers carry `title` attributes equal to EventConfig.description,
    // which is more specific than text matching (event names also appear in
    // the AddChannelDialog event multi-select).
    const newPostHeader = page.getByTitle('When someone submits a new post')
    if (!(await newPostHeader.isVisible())) test.skip()

    await expect(newPostHeader).toBeVisible()
    await expect(page.getByTitle("When a post's status is updated")).toBeVisible()
    await expect(page.getByTitle('When someone comments on a post')).toBeVisible()
    // Slack has a Changelog column; Discord must not.
    await expect(page.getByTitle('When a changelog entry is published')).not.toBeVisible()
  })
})
