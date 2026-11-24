/**
 * Support inbox: the virtualized thread lays its rows out without overlap.
 *
 * The thread positions each row at the sum of the heights above it. A row that
 * is never measured keeps the 72px estimate, and every row below it is drawn
 * over its bubble. The "Jump to latest" pill scrolls smoothly, and a smooth
 * scroll only measures rows near its target, so the rows it mounts a little
 * further up stayed at the estimate until something resized them.
 */
import type { Page } from '@playwright/test'
import { test, expect, openConversation, threadMessages } from '../../support/inbox'

test.use({ viewport: { width: 1920, height: 1080 } })

/** Rows whose drawn offset differs from the end of the row above them. */
async function misplacedRows(page: Page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('[data-index]')]
      .filter((el) => el.style.transform.startsWith('translateY('))
      .map((el) => ({
        index: Number(el.dataset.index),
        start: Number(/translateY\(([\d.]+)px\)/.exec(el.style.transform)?.[1] ?? NaN),
        height: el.getBoundingClientRect().height,
      }))
      .sort((a, b) => a.index - b.index)
    const misplaced: string[] = []
    for (let i = 0; i + 1 < rows.length; i++) {
      const [row, next] = [rows[i], rows[i + 1]]
      if (next.index !== row.index + 1) continue
      if (Math.abs(row.start + row.height - next.start) > 1) {
        misplaced.push(
          `row ${next.index} at ${next.start}, row ${row.index} ends at ${row.start + row.height}`
        )
      }
    }
    return { mounted: rows.length, misplaced }
  })
}

test.describe('inbox thread layout', () => {
  test(
    'INB-97 rows mounted by "Jump to latest" are measured, so no bubble overlaps another',
    { tag: '@core' },
    async ({ teammate, seed, marker }) => {
      test.setTimeout(60_000)
      const { page } = await teammate()
      // Long messages, so a real row is far taller than the 72px estimate.
      const filler =
        'This message is long enough to wrap over several lines in the thread, so its row is much taller than the estimate the list starts from. '
      const messages = Array.from(
        { length: 30 },
        (_, i) =>
          `${marker} message ${String(i + 1).padStart(2, '0')}. ${filler.repeat(1 + (i % 3))}`
      )
      const convo = await seed({ messages })

      // Open on the oldest message, so the rows near the end are not mounted
      // (or measured) before the pill scrolls to them.
      await openConversation(page, convo.id, `${marker} message 01.`, { m: convo.messageIds[0] })
      const jump = page.getByRole('button', { name: /Jump to latest/ })
      await expect(jump).toBeVisible({ timeout: 15_000 })
      await jump.click()

      const last = threadMessages(page, `${marker} message 30.`)
      await expect(last).toBeInViewport({ timeout: 15_000 })
      await expect(jump).toBeHidden({ timeout: 15_000 })

      await expect(async () => {
        const layout = await misplacedRows(page)
        expect(layout.mounted).toBeGreaterThan(5)
        expect(layout.misplaced).toEqual([])
      }).toPass({ timeout: 5_000 })
      // Still pinned to the newest message after the re-measure.
      await expect(last).toBeInViewport()
    }
  )
})
