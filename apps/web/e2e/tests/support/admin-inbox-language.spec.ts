/**
 * The inbox in the teammate's language (area ADM-INBOX): the inbox nav, the
 * list toolbar, the thread's controls and the details panel read in a German
 * or Arabic teammate's language. The page keeps lang="en" until every string
 * it shows is translated (channel names and the ticket activity timeline are
 * still English). An English teammate sees no change.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each page there.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from '@playwright/test'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { seedConversation } from '../../support/inbox'

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

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function openInbox(page: Page, words: Record<string, string> | null) {
  const marker = `inbox-lang-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const seeded = await seedConversation(marker, {
    messages: [`Where is my order ${marker}?`],
    priority: 'none',
  })
  await page.goto(`/admin/inbox?i=${seeded.id}`)
  await expect(page.getByText(`Where is my order ${marker}?`).first()).toBeVisible({
    timeout: 20_000,
  })
  const mentions = words ? words['admin.inbox.inboxNavSidebar.mentions'] : 'Mentions'
  await expect(page.getByText(mentions, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  return seeded
}

test.describe('the inbox reads in the teammate language', () => {
  for (const language of ['de', 'ar'] as const) {
    test(
      `ADM-INBOX-1 a ${language} teammate: inbox nav, thread controls and details read in that language`,
      { tag: '@core' },
      async ({ browser, newTeammate }) => {
        const words = catalogue(language)
        const { context, page } = await teammatePage(browser, newTeammate, language)
        try {
          await openInbox(page, words)
          await expect(
            page
              .getByText(words['admin.inbox.inboxNavSidebar.assignedToMe'], { exact: true })
              .first()
          ).toBeVisible()
          await expect(
            page
              .getByText(words['admin.inbox.labels.priority.placeholder'], { exact: true })
              .first()
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: words['admin.inbox.inboxNavSidebar.newView'] })
          ).toBeVisible()
          // English words the area replaced are gone from the inbox's own parts.
          await expect(page.getByText('Assigned to me', { exact: true })).toHaveCount(0)
          // The page keeps lang="en" until every string on it is translated.
          await expect(page.locator('html')).toHaveAttribute('lang', 'en')
          await expectNoSidewaysScroll(page)
          await snap(page, `inbox-${language}-thread`)
        } finally {
          await context.close()
        }
      }
    )
  }

  test(
    'ADM-INBOX-2 an English teammate with an English browser sees the inbox as before',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      const { context, page } = await teammatePage(browser, newTeammate, null)
      try {
        await openInbox(page, null)
        await expect(page.getByText('Assigned to me', { exact: true }).first()).toBeVisible()
        await expect(page.getByText('Priority', { exact: true }).first()).toBeVisible()
      } finally {
        await context.close()
      }
    }
  )
})
