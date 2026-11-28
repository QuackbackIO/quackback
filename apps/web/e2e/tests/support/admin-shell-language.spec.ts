/**
 * The admin shell in the teammate's language (area ADM-SHELL): the rail,
 * the notifications page and the notification settings read in a German or
 * Arabic teammate's language, with the page's lang and dir set to match. A
 * page whose area is not translated yet keeps lang="en" while its rail is
 * translated. An English teammate sees no change.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each page there, and to
 * run ADM-SHELL-4, which captures the shared parts other pages show (Home,
 * the settings nav, a dialog with the editor's slash menu, the date picker).
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'

function catalogue(locale: string): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, '../../../src/locales', `${locale}.json`), 'utf8'))
}

async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_GALLERY_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true })
}

async function teammatePage(
  browser: Browser,
  newTeammate: (opts: { roleKey: string }) => Promise<{ userId: string; storageState: string }>,
  language: string | null
) {
  const mate = await newTeammate({ roleKey: 'admin' })
  await supportDb()`UPDATE "user" SET preferred_language = ${language}
    WHERE id = ${toUuid(mate.userId as `user_${string}`)}`
  const context = await browser.newContext({
    storageState: mate.storageState,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  })
  return { context, page: await context.newPage() }
}

/** The page never scrolls sideways (long German words, a mirrored layout). */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('the admin shell reads in the teammate language', () => {
  test(
    'ADM-SHELL-1 a German teammate: notifications and notification settings are German, lang="de"',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const de = catalogue('de')
      const { context, page } = await teammatePage(browser, newTeammate, 'de')
      try {
        await page.goto('/admin/notifications')
        await expect(
          page.getByRole('heading', { name: de['admin.shell.notifications.title'] })
        ).toBeVisible({ timeout: 20_000 })
        await expect(
          page.getByRole('button', { name: de['admin.shell.notifications.markAllRead'] })
        ).toBeVisible()
        await expect(
          page.getByRole('tab', { name: de['admin.shell.notifications.tabAll'] })
        ).toBeVisible()
        await expect(
          page.locator('[data-admin-rail]').getByText(de['admin.nav.home'])
        ).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', 'de')
        await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
        await expectNoSidewaysScroll(page)
        await snap(page, 'shell-de-notifications')

        await page.goto('/admin/settings/notifications')
        await expect(
          page.getByText(de['portal.settings.notifications.channel.email']).first()
        ).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('html')).toHaveAttribute('lang', 'de')
        await expectNoSidewaysScroll(page)
        await snap(page, 'shell-de-notification-settings')

        await page.goto('/admin/search?q=billing')
        await expect(page.locator('html')).toHaveAttribute('lang', 'de')
        await expectNoSidewaysScroll(page)
        await snap(page, 'shell-de-search')

        // The feedback area is not translated yet: lang stays English, the rail is German.
        await page.goto('/admin/feedback')
        await expect(page.locator('[data-admin-rail]').getByText(de['admin.nav.home'])).toBeVisible(
          {
            timeout: 20_000,
          }
        )
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      } finally {
        await context.close()
      }
    }
  )

  test(
    'ADM-SHELL-2 an Arabic teammate: notifications read Arabic right to left, the rail on the right',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const ar = catalogue('ar')
      const { context, page } = await teammatePage(browser, newTeammate, 'ar')
      try {
        await page.goto('/admin/notifications')
        await expect(
          page.getByRole('heading', { name: ar['admin.shell.notifications.title'] })
        ).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        const rail = await page.locator('[data-admin-rail]').first().boundingBox()
        expect(rail!.x + rail!.width).toBeGreaterThan(page.viewportSize()!.width / 2)
        await expectNoSidewaysScroll(page)
        await snap(page, 'shell-ar-notifications')

        await page.goto('/admin/settings/notifications')
        await expect(
          page.getByText(ar['portal.settings.notifications.channel.email']).first()
        ).toBeVisible({ timeout: 20_000 })
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
        await expectNoSidewaysScroll(page)
        await snap(page, 'shell-ar-notification-settings')
      } finally {
        await context.close()
      }
    }
  )

  test(
    'ADM-SHELL-3 an English teammate with an English browser sees the notifications page as before',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const { context, page } = await teammatePage(browser, newTeammate, null)
      try {
        await page.goto('/admin/notifications')
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({
          timeout: 20_000,
        })
        await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', 'en')
      } finally {
        await context.close()
      }
    }
  )

  test(
    'ADM-SHELL-4 gallery: the shared parts on other pages, German and Arabic',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      test.skip(!process.env.E2E_GALLERY_DIR, 'captures screenshots only')
      test.setTimeout(120_000)
      for (const language of ['de', 'ar'] as const) {
        const words = catalogue(language)
        const { context, page } = await teammatePage(browser, newTeammate, language)
        try {
          await page.goto('/admin')
          await expect(
            page.locator('[data-admin-rail]').getByText(words['admin.nav.home'])
          ).toBeVisible({ timeout: 20_000 })
          await expectNoSidewaysScroll(page)
          await snap(page, `shell-${language}-home`)

          await page.goto('/admin/settings/general')
          await expect(
            page.getByText(words['admin.shell.settingsNav.general']).first()
          ).toBeVisible({ timeout: 20_000 })
          await expectNoSidewaysScroll(page)
          await snap(page, `shell-${language}-settings-nav`)

          await page.goto('/admin/changelog')
          await page.getByRole('button', { name: words['admin.changelog.list.newEntry'] }).click()
          const dialog = page.getByRole('dialog')
          const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
          await expect(editor).toBeVisible({ timeout: 20_000 })
          await editor.click()
          await page.keyboard.type('/')
          await expect(page.getByText(words['ui.editor.heading1']).first()).toBeVisible()
          await snap(page, `shell-${language}-editor-slash`)
          await page.keyboard.press('Backspace')

          // The changelog dialog is the feedback area's, which may still be English.
          const either = (key: string, english: string) =>
            new RegExp(`^(${english}|${words[key]})$`)
          await dialog.getByText(either('admin.changelog.status.draft', 'Draft')).click()
          await page
            .getByText(either('admin.changelog.status.scheduled', 'Scheduled'))
            .last()
            .click()
          // The picker's trigger reads the scheduled date, which holds the year.
          await dialog
            .getByRole('button', { name: /20\d\d/ })
            .first()
            .click()
          await expect(page.getByRole('grid').first()).toBeVisible()
          // Let the popover finish fading in before the capture.
          await page.waitForTimeout(400)
          await snap(page, `shell-${language}-date-picker`)
        } finally {
          await context.close()
        }
      }
    }
  )
})
