import { test, expect, type Page } from '@playwright/test'

/**
 * PRO-1664: the feed keeps at most 8 pages (160 posts) in memory, dropping the
 * oldest page as it appends a new one. Deriving the next page number from the
 * number of pages held therefore stuck at page 9 once the cap was reached, and
 * infinite scroll served the same 20 posts forever.
 *
 * The seed has ~400 active posts (20+ pages), so this walks the whole feed:
 * every page must bring posts never seen before, and the scroll must end.
 */

const PAGE_SIZE = 20
const MAX_PAGES_HELD = 8

async function visiblePostIds(page: Page): Promise<string[]> {
  return page
    .locator('[data-post-id]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-post-id') ?? ''))
}

test.describe('Post List - Infinite Scroll', () => {
  test('"New" sort scrolls through every post once and reaches the end', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?sort=new')
    const cards = page.locator('[data-post-id]')
    const sentinel = page.getByTestId('post-list-sentinel')
    await expect(cards.first()).toBeVisible({ timeout: 15000 })
    // The router restores scroll position on hydration; scrolling before the
    // app is interactive gets undone, so let the initial load settle first.
    await page.waitForLoadState('networkidle')

    const seen = new Set<string>()
    let visible = await visiblePostIds(page)
    visible.forEach((id) => seen.add(id))
    const firstPageIds = [...visible]
    expect(firstPageIds.length).toBe(PAGE_SIZE)

    // Each loop turn loads one page. The cap on iterations is generous (the
    // seed is ~22 pages); the bug would spin here forever, failing the
    // duplicate check on the first repeated page instead.
    for (let pagesLoaded = 1; pagesLoaded < 60; pagesLoaded++) {
      if ((await sentinel.count()) === 0) break
      const lastBefore = visible.at(-1)

      // Keep the sentinel in view while waiting: the observer fires when it
      // intersects, and nothing else in the test should move the viewport.
      await expect
        .poll(
          async () => {
            if ((await sentinel.count()) === 0) return 'done'
            const ids = await visiblePostIds(page)
            if (ids.at(-1) !== lastBefore) return 'advanced'
            await sentinel.scrollIntoViewIfNeeded()
            return 'waiting'
          },
          { timeout: 15000 }
        )
        .not.toBe('waiting')

      visible = await visiblePostIds(page)
      const fresh = visible.filter((id) => !seen.has(id))
      const repeated = visible.filter((id) => seen.has(id) && !firstPageIds.includes(id))

      // The DOM window slides: once 8 pages are held, appending page N drops
      // page N-8. So the window never exceeds 8 pages, and what it shows is
      // always the newest pages, never a page served twice.
      expect(visible.length, `window size after page ${pagesLoaded + 1}`).toBeLessThanOrEqual(
        MAX_PAGES_HELD * PAGE_SIZE
      )
      expect(new Set(visible).size, 'no post rendered twice').toBe(visible.length)
      if ((await sentinel.count()) > 0 || fresh.length > 0) {
        expect(
          fresh.length,
          `page ${pagesLoaded + 1} must bring new posts, got only repeats of ${repeated.slice(0, 3).join(', ')}`
        ).toBeGreaterThan(0)
      }
      fresh.forEach((id) => seen.add(id))
    }

    // The scroll ends (no sentinel) and we walked well past the 8-page cap.
    await expect(sentinel).toHaveCount(0)
    expect(seen.size).toBeGreaterThan(MAX_PAGES_HELD * PAGE_SIZE)
  })
})
