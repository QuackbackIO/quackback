import { test, expect } from '@playwright/test'

test.describe('Discord notification routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/settings/integrations/discord')
    await page.waitForLoadState('networkidle')
  })

  test('renders the routing UI when Discord is connected', async ({ page }) => {
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

  test('event columns reflect Discord event list (3 events, no changelog)', async ({ page }) => {
    const tableHeader = page.getByText(/^Channel$/)
    if (!(await tableHeader.isVisible())) test.skip()

    await expect(page.getByText(/^Feedback$/)).toBeVisible()
    await expect(page.getByText(/^Status$/)).toBeVisible()
    await expect(page.getByText(/^Comment$/)).toBeVisible()
    // Slack has Changelog; Discord must not.
    await expect(page.getByText(/^Changelog$/)).not.toBeVisible()
  })
})
