import { test, expect } from '@playwright/test'

test.describe('Post detail page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    const postCards = page.locator('a[href*="/posts/"]:has(h3)')
    await expect(postCards.first()).toBeVisible({ timeout: 15000 })
    await postCards.first().click()
    await expect(page.getByTestId('post-detail')).toBeVisible({ timeout: 10000 })
  })

  test('content is constrained within a max-width container', async ({ page }) => {
    const viewport = page.viewportSize()!
    const box = await page.getByTestId('post-detail').boundingBox()
    expect(box).not.toBeNull()
    // Container must not bleed to the viewport edges
    expect(box!.x).toBeGreaterThan(0)
    expect(box!.x + box!.width).toBeLessThan(viewport.width)
  })
})
