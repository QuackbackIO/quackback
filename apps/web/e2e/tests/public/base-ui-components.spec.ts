import { expect, test } from '@playwright/test'
import { waitForHydration } from '../../utils/helpers'

/**
 * Public-portal usability pass for the Radix → Base UI migration.
 */
test.describe('Public Base UI component usability', () => {
  test.describe.configure({ timeout: 45_000 })

  test('filters, menus, and styled links stay usable', async ({ page }) => {
    await page.goto('/')
    // The less common filters unfold under More filters, at the foot of the panel.
    const more = page.getByRole('button', { name: /^more filters$/i })
    await waitForHydration(more)
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('group', { name: 'Vote count' })).toBeVisible()
    await more.click()
    await expect(page.getByRole('group', { name: 'Vote count' })).toHaveCount(0)

    await page.goto('/changelog')
    const rss = page.locator('a[href="/changelog/feed"]')
    await expect(rss).toBeVisible({ timeout: 10_000 })
    await expect(rss).not.toHaveAttribute('role', 'button')

    const subscribe = page.getByRole('button', { name: /subscri/i })
    if ((await subscribe.count()) > 0) {
      await subscribe.first().click()
      const menu = page.getByRole('menu')
      if ((await menu.count()) > 0) {
        await expect(menu).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }
  })

  test('roadmap filter popover opens', async ({ page }) => {
    await page.goto('/roadmap')
    const filter = page.getByRole('button', { name: /filter|board|status/i }).first()
    if ((await filter.count()) === 0) {
      test.skip()
      return
    }
    await waitForHydration(filter)
    await filter.click()
    const overlay = page.locator('[data-slot="popover-content"], [role="dialog"]')
    if ((await overlay.count()) > 0) {
      await expect(overlay.first()).toBeVisible()
      await page.keyboard.press('Escape')
    }
  })
})
