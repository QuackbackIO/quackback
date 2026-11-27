/**
 * Emails in the reader's language (area CUS-LANG-E): a customer who chose
 * German gets a teammate's reply by email with every product word in German,
 * while the reply itself stays as the teammate wrote it; a customer with no
 * choice gets the language their browser was last detected in.
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  apiAs as fnApiAs,
  fnOk,
  retireTeammate,
  seedPerson,
  startEmailConversation,
  waitForMailWhere,
} from '../../support/sla-csat'
import type { Browser, FrameLocator } from '@playwright/test'
import {
  agentReply,
  apiAs,
  conversationTypeId,
  latestConversationOf,
  mailText,
  openWidgetAs,
  personalKeyFor,
  principalForUserEmail,
  waitForMailMatching,
  waitForVisitorPresence,
} from '../../support/email-journeys'

const WORKSPACE = 'Acme Corp'
const ADMIN_NAME = 'Ada Admin'

/** Set a language on the person behind a conversation's visitor principal. */
async function setLanguage(
  visitorPrincipalId: string,
  column: 'preferred_language' | 'detected_locale',
  value: string
) {
  const rows = await supportDb().unsafe(
    `UPDATE "user" u SET ${column} = $1 FROM principal p
      WHERE p.user_id = u.id AND p.id = $2
      RETURNING u.id`,
    [value, visitorPrincipalId]
  )
  expect(rows.length).toBe(1)
}

/** Messages tab button (an unread count may prefix the label). */
function messagesTab(widget: FrameLocator) {
  return widget.getByRole('button', { name: /^(?:\d+ unread )?Messages$/ })
}

/**
 * An identified customer writes in the widget and leaves; returns their
 * conversation. Offline, a teammate's reply reaches them by email.
 */
async function offlineWidgetCustomer(
  browser: Browser,
  opts: { email: string; marker: string; text: string }
) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const widget = await openWidgetAs(page, { id: opts.marker, email: opts.email, name: 'Wanda' })
  await messagesTab(widget).click()
  await widget.getByRole('button', { name: /Ask a question/ }).click()
  const composer = widget.locator('.ProseMirror[contenteditable="true"]')
  await composer.click()
  await composer.fill(opts.text)
  await widget.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(widget.getByText(opts.text)).toBeVisible({ timeout: 15_000 })
  const principalUuid = await principalForUserEmail(opts.email)
  const row = await latestConversationOf(principalUuid)
  await waitForVisitorPresence(principalUuid, true)
  await context.close()
  await waitForVisitorPresence(principalUuid, false)
  return row
}

test.describe('emails in the reader language', () => {
  test(
    'CUS-LANG-E1 a customer who chose German gets the reply email in German, the reply as written',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      const row = await offlineWidgetCustomer(browser, {
        email: customerEmail,
        marker,
        text: `Where is my parcel ${marker}?`,
      })
      await setLanguage(row.visitor_principal_id, 'preferred_language', 'de')

      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const reply = `Your parcel ships tomorrow ${marker}`
      await agentReply(api, conversationTypeId(row.id), reply)
      await api.dispose()

      const mail = await waitForMailMatching({ to: customerEmail, body: reply })
      const text = mailText(mail)
      expect(text).toContain(reply)
      expect(text).toContain(
        `${ADMIN_NAME} hat auf deine Unterhaltung mit ${WORKSPACE} geantwortet.`
      )
      expect(text).toContain('Unterhaltung ansehen')
      expect(text).not.toContain('View conversation')
      expect(mail.HTML).toMatch(/<html[^>]*lang="de"/)
      expect(mail.From.Name).toBe(`${ADMIN_NAME} von ${WORKSPACE}`)
      if (!row.subject) expect(mail.Subject).toBe(`Neue Antwort von ${WORKSPACE}`)
    }
  )

  test(
    'CUS-LANG-E2 a customer with no choice gets the language they were detected in',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      const row = await offlineWidgetCustomer(browser, {
        email: customerEmail,
        marker,
        text: `Question ${marker}?`,
      })
      await setLanguage(row.visitor_principal_id, 'detected_locale', 'fr')

      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const reply = `It is fixed ${marker}`
      await agentReply(api, conversationTypeId(row.id), reply)
      await api.dispose()

      const mail = await waitForMailMatching({ to: customerEmail, body: reply })
      expect(mailText(mail)).toContain(
        `${ADMIN_NAME} a répondu à votre conversation avec ${WORKSPACE}.`
      )
      expect(mail.From.Name).toBe(`${ADMIN_NAME} de ${WORKSPACE}`)
    }
  )

  test(
    'CUS-LANG-E3 a teammate who chose Polish gets a note mention in Polish, the note as written',
    { tag: '@core' },
    async ({ request, playwright, marker }) => {
      const mate = await seedPerson(marker, 'teammate', { tag: 'pl' })
      await supportDb()`UPDATE "user" SET preferred_language = 'pl'
        WHERE id = (SELECT user_id FROM principal WHERE id = ${mate.principalUuid})`
      const admin = await fnApiAs(playwright, 'admin')
      try {
        const conversation = await startEmailConversation(request, marker)
        const note = `Look at this ${marker}`
        await fnOk(admin, 'addConversationNoteFn', {
          conversationId: conversation.id,
          content: note,
          contentJson: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: `${note} ` },
                  { type: 'mention', attrs: { id: mate.principalId, label: mate.name } },
                ],
              },
            ],
          },
        })
        const subject = `${ADMIN_NAME} wspomniał o Tobie w notatce wewnętrznej`
        const mail = await waitForMailWhere(mate.email, 'the Polish note mention', (m) =>
          m.Subject.includes(subject)
        )
        expect(mailText(mail)).toContain(note)
        expect(mailText(mail)).toContain('Notatki wewnętrzne widzi tylko Twój zespół.')
      } finally {
        await admin.dispose()
        await retireTeammate(mate)
      }
    }
  )
})
