/**
 * Admin right to left (area ADM-RTL): with the page set right to left, the
 * admin mirrors. The rail moves to the right, a column header that sat on
 * the left moves to the right with its column, and chevrons that point to
 * the next page turn round. Left to right, the same page reads as before.
 *
 * Admin keeps `dir="ltr"` until an area is translated, so the test sets the
 * direction the way the Arabic pages will.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each result there.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'

async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_GALLERY_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

async function setDirection(page: Page, dir: 'ltr' | 'rtl'): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dir = value
  }, dir)
}

/** Where a box sits across the page: its left and right edges. */
async function edges(page: Page, selector: string): Promise<{ left: number; right: number }> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`${selector} is not on the page`)
  return { left: box.x, right: box.x + box.width }
}

test.describe('admin mirrors right to left', () => {
  test(
    'ADM-RTL-1 an Arabic teammate: the rail, the Name column and the next chevrons mirror; left to right is unchanged',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'admin' })
      await supportDb()`UPDATE "user" SET preferred_language = 'ar'
        WHERE id = ${toUuid(mate.userId as `user_${string}`)}`
      const context = await browser.newContext({
        storageState: mate.storageState,
        viewport: { width: 1440, height: 900 },
      })
      try {
        const page = await context.newPage()
        await page.goto('/admin/settings/members')
        const header = page.getByRole('columnheader', { name: 'Name' })
        await expect(header).toBeVisible({ timeout: 20_000 })
        const width = page.viewportSize()!.width

        // Left to right: the rail on the left, the Name header at its cell's left.
        const rail = await edges(page, '[data-admin-rail]')
        expect(rail.left).toBeLessThan(width / 2)
        const cell = (await header.boundingBox())!
        const textLtr = await header.evaluate((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          return range.getBoundingClientRect().left
        })
        expect(textLtr - cell.x).toBeLessThan(cell.width / 2)

        await setDirection(page, 'rtl')
        await snap(page, 'rtl-members')
        // The rail moves to the right.
        expect((await edges(page, '[data-admin-rail]')).right).toBeGreaterThan(width / 2)
        // The Name header follows its column to the right side of its cell.
        const rtlCell = (await header.boundingBox())!
        const textRtl = await header.evaluate((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          return range.getBoundingClientRect().right
        })
        expect(rtlCell.x + rtlCell.width - textRtl).toBeLessThan(rtlCell.width / 2)

        // A chevron to the next page points the other way.
        await page.goto('/admin/settings/integrations')
        await setDirection(page, 'rtl')
        const chevron = page.locator('svg[class*="rtl:-scale-x-100"]').first()
        await expect(chevron).toBeAttached({ timeout: 20_000 })
        expect(await chevron.evaluate((node) => getComputedStyle(node).scale)).toBe('-1 1')
        await setDirection(page, 'ltr')
        expect(await chevron.evaluate((node) => getComputedStyle(node).scale)).toBe('none')
      } finally {
        await context.close()
      }
    }
  )
})
