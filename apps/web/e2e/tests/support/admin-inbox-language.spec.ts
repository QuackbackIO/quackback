/**
 * The inbox in the teammate's language (area ADM-INBOX): the inbox nav, the
 * list, the thread's controls and system notices, a ticket and the details
 * panel read in a German or Arabic teammate's language, and the page carries
 * that language's lang and dir. An English teammate sees no change.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each page there (the
 * thread, a ticket, the details panel, Copilot, the view dialog and the
 * composer's menu).
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from '@playwright/test'
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { seedConversation } from '../../support/inbox'
import { createTicket, ticketApi } from '../../support/tickets'

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
  const sql = supportDb()
  // An unnamed visitor, and a closed-then-reopened thread whose notices carry
  // their structured event.
  await sql`UPDATE principal SET display_name = NULL WHERE id = ${seeded.visitorUuid}`
  await sql`INSERT INTO conversation_messages
      (id, conversation_id, principal_id, sender_type, content, is_internal, metadata, created_at)
    VALUES (${toUuid(generateId('conversation_msg'))}, ${seeded.uuid}, NULL, 'system',
      'Conversation ended', false, ${sql.json({ systemEvent: { kind: 'chat_ended' } })}, NOW())`
  await page.goto(`/admin/inbox?i=${seeded.id}`)
  await expect(page.getByText(`Where is my order ${marker}?`).first()).toBeVisible({
    timeout: 20_000,
  })
  const mentions = words ? words['admin.inbox.inboxNavSidebar.mentions'] : 'Mentions'
  await expect(page.getByText(mentions, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
  return seeded
}

/** English words the area replaced, which must be gone from a translated inbox. */
const REPLACED_ENGLISH = [
  'Assigned to me',
  'Visitor',
  'Conversation ended',
  'Resolve',
  'No notes yet',
]

async function expectNoReplacedEnglish(page: Page, words: string[]): Promise<void> {
  for (const english of words) {
    await expect(page.getByText(english, { exact: true }), english).toHaveCount(0)
  }
}

/** Screenshots of the inbox's other surfaces, for the gallery only. */
async function galleryShots(page: Page, words: Record<string, string>, language: string) {
  const tryClick = async (role: 'button' | 'tab', name: string) => {
    const target = page.getByRole(role, { name, exact: true }).first()
    if (await target.isVisible().catch(() => false)) await target.click().catch(() => undefined)
  }
  // Wide enough for the details panel beside the thread.
  await page.setViewportSize({ width: 1920, height: 1000 })
  await openInbox(page, words)
  await expect(page.locator('[data-message-id]').first()).toBeVisible({ timeout: 15_000 })
  await snap(page, `inbox-${language}-details`)
  await tryClick('tab', words['admin.inbox.inboxDetailPanel.copilot'])
  await page.waitForTimeout(500)
  await snap(page, `inbox-${language}-copilot`)
  await page
    .getByText(words['admin.inbox.labels.composer.reply'], { exact: true })
    .last()
    .click()
    .catch(() => undefined)
  await page.waitForTimeout(300)
  await snap(page, `inbox-${language}-composer-menu`)
  await page.keyboard.press('Escape')
  await tryClick('button', words['admin.inbox.inboxNavSidebar.newView'])
  await page.waitForTimeout(500)
  await snap(page, `inbox-${language}-view-dialog`)
  await page.keyboard.press('Escape')
}

test.describe('the inbox reads in the teammate language', () => {
  for (const language of ['de', 'ar'] as const) {
    test(
      `ADM-INBOX-1 a ${language} teammate: inbox nav, thread, notices, a ticket and details read in that language`,
      { tag: '@core' },
      async ({ browser, newTeammate, playwright, baseURL }) => {
        test.setTimeout(90_000)
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
          // The unnamed visitor and the system notice are worded too.
          await expect(
            page.getByText(words['admin.inbox.systemNotice.ended'], { exact: true })
          ).toBeVisible()
          await expect(
            page.getByText(words['admin.inbox.conversationListColumn.visitor']).first()
          ).toBeVisible()
          await expectNoReplacedEnglish(page, REPLACED_ENGLISH)
          await expect(page.locator('html')).toHaveAttribute('lang', language)
          await expect(page.locator('html')).toHaveAttribute(
            'dir',
            language === 'ar' ? 'rtl' : 'ltr'
          )
          await expectNoSidewaysScroll(page)
          await snap(page, `inbox-${language}-thread`)

          // A back-office ticket: its resolve button and empty thread.
          const api = await ticketApi(playwright, baseURL)
          const ticket = await createTicket(api, {
            title: `Back office ${language} ${Date.now()}`,
            type: 'back_office',
          })
          await api.dispose()
          await page.goto(`/admin/inbox?i=${ticket.id}`)
          await expect(
            page.getByRole('button', {
              name: words['admin.inbox.agentConversationThread.resolve'],
            })
          ).toBeVisible({ timeout: 20_000 })
          await expect(
            page.getByText(words['admin.inbox.agentConversationThread.noNotes'], { exact: true })
          ).toBeVisible()
          await expectNoReplacedEnglish(page, REPLACED_ENGLISH)
          await expectNoSidewaysScroll(page)
          await snap(page, `inbox-${language}-ticket`)

          if (process.env.E2E_GALLERY_DIR) await galleryShots(page, words, language)
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
