import { test, expect } from '@playwright/test'

test.describe('Slack notification routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/integrations/slack')
    await page.waitForLoadState('networkidle')
  })

  test('renders the routing UI when Slack is connected', async ({ page }) => {
    // Skip when Slack isn't connected in this environment — the page shows
    // the connection-setup card instead of the routing UI.
    const setupCard = page.getByText(/connect your slack workspace/i)
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

  test('event columns reflect Slack event list (4 events including Changelog)', async ({
    page,
  }) => {
    // Column headers use `title` attributes derived from EventConfig.label,
    // which is more specific than text matching (event names also appear in
    // the AddChannelDialog event multi-select).
    const feedbackHeader = page.getByTitle('When a user submits new feedback')
    if (!(await feedbackHeader.isVisible())) test.skip()

    await expect(feedbackHeader).toBeVisible()
    await expect(page.getByTitle('When the status of a feedback post is updated')).toBeVisible()
    await expect(page.getByTitle('When someone comments on a feedback post')).toBeVisible()
    // Slack-only event — must be present (mirrors the negative assertion in the Discord spec).
    await expect(page.getByTitle('When a changelog entry is published')).toBeVisible()
  })

  test('channel monitoring section still renders', async ({ page }) => {
    // PR1 left the monitored-channel UI unchanged. Guards against accidental removal.
    await expect(page.getByText(/channel monitoring/i)).toBeVisible()
  })
})
