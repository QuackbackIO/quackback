/**
 * The portal's own UI on a phone (375px): no text under 12px, and every
 * control a pointer can hit at least 24 by 24px (WCAG 2.5.8), on Home, the
 * roadmap, Feedback, the changelog, the header's menu where it scrolls, and the sign-in dialog.
 * Colour contrast across designs is design-contrast.spec.ts.
 */
import { expect, test } from '@playwright/test'
import { audit, describeFailures } from '../../utils/a11y-audit'

test.use({ viewport: { width: 375, height: 812 } })

const floors = { contrast: false, type: true, targets: true } as const

test.describe('portal type and target floors at 375px', () => {
  for (const path of ['/', '/roadmap', '/feedback', '/changelog']) {
    test(`${path} keeps 12px type and 24px targets`, async ({ page }) => {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(describeFailures(await audit(page, floors))).toEqual([])
    })
  }

  test('the header menu keeps 24px targets where it scrolls', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const menu = page.locator('.portal-header')
    await expect(menu).toBeVisible()
    expect(describeFailures(await audit(page, { ...floors, within: '.portal-header' }))).toEqual([])
  })

  test('the sign-in dialog keeps 12px type and 24px targets', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page
      .getByRole('button', { name: /log in/i })
      .first()
      .click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    expect(describeFailures(await audit(page, { ...floors, within: '[role=dialog]' }))).toEqual([])
  })
})
