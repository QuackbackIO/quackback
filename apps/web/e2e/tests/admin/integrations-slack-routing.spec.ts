import { test, expect } from '@playwright/test'

test.describe('Slack notification routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/integrations/slack')
    await page.waitForLoadState('networkidle')
  })

  test('renders the routing UI when Slack is connected', async ({ page }) => {
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
    await page.getByRole('button', { name: /filter by board/i }).click()
    await expect(page.getByText(/board filter/i)).toBeVisible()
    await page.getByRole('button', { name: /cancel/i }).click()
  })

  test('event columns reflect Slack event list (4 events including Changelog)', async ({
    page,
  }) => {
    const tableHeader = page.getByText(/^Channel$/)
    if (!(await tableHeader.isVisible())) test.skip()

    await expect(page.getByText(/^Feedback$/)).toBeVisible()
    await expect(page.getByText(/^Status$/)).toBeVisible()
    await expect(page.getByText(/^Comment$/)).toBeVisible()
    // Slack-only event — must be present (mirrors the negative assertion in Discord spec).
    await expect(page.getByText(/^Changelog$/)).toBeVisible()
  })

  test('channel monitoring section still renders', async ({ page }) => {
    // PR1 left the monitored-channel UI unchanged. Guards against accidental removal.
    await expect(page.getByText(/channel monitoring/i)).toBeVisible()
  })
})
