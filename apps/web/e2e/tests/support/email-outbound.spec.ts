/**
 * Email out: what a customer receives when a teammate answers, closes, starts a
 * conversation or works a ticket, and what they never receive (journeys
 * CUS-O-01..20, 30..35).
 *
 * Oracles: Mailpit (subject, body, From, Reply-To and threading headers) and
 * the app's email_log. Absence is asserted only after a later mail to the same
 * person has arrived, so a slow pipeline cannot pass for a silent one.
 */
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import {
  conversationReplyAddress,
  supportInboxAddress,
  ticketReplyAddress,
} from '../../support/inbound-email'
import { getMailHeaders, linksIn } from '../../support/mailpit'
import { runSweep } from '../../support/sweeps'
import { clearSigninRateLimit, enableMagicLinkMethod } from '../../utils/db-helpers'
import {
  addParticipant,
  agentNote,
  agentReply,
  apiAs,
  assignConversation,
  conversationTypeId,
  createCustomerTicket,
  deliver,
  emailLogForConversation,
  enableAutoAck,
  enableSupportTickets,
  header,
  holdVisitorStream,
  latestConversationOf,
  mailText,
  mailsMatching,
  openWidgetAs,
  personalKeyFor,
  principalForUserEmail,
  retireWorkflow,
  seedAnonymousVisitor,
  seedConversation,
  seedCustomer,
  seedLiveWorkflow,
  sendColdMail,
  conversationForMessage,
  setConversationStatus,
  setTicketStatus,
  ticketNote,
  ticketReply,
  ticketStatusId,
  uuidOf,
  waitForConversation,
  waitForMailMatching,
  waitForVisitorPresence,
} from '../../support/email-journeys'
import { conversationIdFromInboundAddress } from '../../../src/lib/server/domains/conversation/conversation.email-channel'

const WORKSPACE = 'Acme Corp'
const ADMIN_NAME = 'Ada Admin'
const FROM_ADDRESS = 'support@acme.test'

type Request = import('@playwright/test').APIRequestContext

/** The admin's REST client (a personal key: replies are signed by Ada Admin). */
function adminApi(
  playwright: import('@playwright/test').Playwright,
  baseURL: string,
  people: { people: { admin: { email: string } } }
) {
  return apiAs(playwright, baseURL, personalKeyFor(people.people.admin.email))
}

/** A cold email from `from` (DMARC pass) and the email conversation it opened. */
async function coldThread(
  request: Request,
  from: string,
  marker: string,
  subject = `Help with ${marker}`,
  headers: Record<string, string> = {}
) {
  const sent = await sendColdMail(request, {
    from,
    subject,
    text: `Hello, I need help with ${marker}.`,
    headers,
  })
  expect(sent.http).toBe(200)
  const row = await conversationForMessage(sent.messageId)
  return { messageId: sent.messageId, row, id: conversationTypeId(row.id) }
}

/** Messages tab button (an unread count may prefix the label). */
function messagesTab(widget: import('@playwright/test').FrameLocator) {
  return widget.getByRole('button', { name: /^(?:\d+ unread )?Messages$/ })
}

test.describe('agent replies by email', () => {
  test(
    'CUS-O-01 an offline widget customer gets the agent reply by email',
    { tag: '@smoke' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      // The customer writes in the widget, then leaves.
      const context = await browser.newContext()
      const page = await context.newPage()
      const widget = await openWidgetAs(page, {
        id: marker,
        email: customerEmail,
        name: 'Wanda Widget',
      })
      await messagesTab(widget).click()
      await widget.getByRole('button', { name: /Ask a question/ }).click()
      const composer = widget.locator('.ProseMirror[contenteditable="true"]')
      await composer.click()
      await composer.fill(`Where is my parcel ${marker}?`)
      await widget.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(widget.getByText(`Where is my parcel ${marker}?`)).toBeVisible({
        timeout: 15_000,
      })
      const principalUuid = await principalForUserEmail(customerEmail)
      const row = await latestConversationOf(principalUuid)
      expect(row.channel).toBe('messenger')
      // The thread's live stream registers first; only then does leaving mean offline.
      await waitForVisitorPresence(principalUuid, true)
      await context.close()
      await waitForVisitorPresence(principalUuid, false)

      // The teammate answers.
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const reply = `Your parcel ships tomorrow ${marker}`
      await agentReply(api, conversationTypeId(row.id), reply)
      await api.dispose()

      const mail = await waitForMailMatching({ to: customerEmail, body: reply })
      expect(mail.Subject).toBe(row.subject ? `Re: ${row.subject}` : `New reply from ${WORKSPACE}`)
      expect(mail.From).toEqual({ Name: `${ADMIN_NAME} from ${WORKSPACE}`, Address: FROM_ADDRESS })
      const text = mailText(mail)
      expect(text).toContain(`${ADMIN_NAME} replied to your conversation with ${WORKSPACE}.`)
      expect(text).toContain(
        'You received this email because you have an open conversation with this team.'
      )
      const cta = linksIn(mail).find((href) => href.includes(conversationTypeId(row.id)))
      expect(cta).toBe(`${supportEnv().baseUrl}/support/${conversationTypeId(row.id)}`)
      const headers = await getMailHeaders(mail.ID)
      expect(header(headers, 'Reply-To')).toBe(conversationReplyAddress(conversationTypeId(row.id)))

      const log = await pollFor('the email_log row', async () => {
        const rows = await emailLogForConversation(row.id)
        return rows.find((r) => r.email_type === 'ConversationMessageEmail') ?? null
      })
      expect(log).toMatchObject({ direction: 'outbound', status: 'sent', address: customerEmail })
    }
  )

  test(
    'CUS-O-02 a customer with the widget open sees the reply live and gets no email',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      const widget = await openWidgetAs(page, {
        id: marker,
        email: customerEmail,
        name: 'Olive Online',
      })
      await messagesTab(widget).click()
      await widget.getByRole('button', { name: /Ask a question/ }).click()
      const composer = widget.locator('.ProseMirror[contenteditable="true"]')
      await composer.click()
      await composer.fill(`Are you there ${marker}?`)
      await widget.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(widget.getByText(`Are you there ${marker}?`)).toBeVisible({ timeout: 15_000 })
      const principalUuid = await principalForUserEmail(customerEmail)
      const row = await latestConversationOf(principalUuid)
      await waitForVisitorPresence(principalUuid, true)

      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const live = `Yes, live answer ${marker}`
      await agentReply(api, conversationTypeId(row.id), live)
      await expect(widget.getByText(live)).toBeVisible({ timeout: 15_000 })

      // Gone: the next reply is emailed, and the live one never was.
      await context.close()
      await waitForVisitorPresence(principalUuid, false)
      const later = `Emailed follow-up ${marker}`
      await agentReply(api, conversationTypeId(row.id), later)
      await api.dispose()
      await waitForMailMatching({ to: customerEmail, body: later })
      expect(await mailsMatching({ to: customerEmail, body: live })).toEqual([])
      const customerRows = async () =>
        (await emailLogForConversation(row.id)).filter(
          (r) => r.email_type === 'ConversationMessageEmail' && r.address === customerEmail
        )
      // The log row lands after the SMTP send returns.
      await pollFor('the emailed reply in email_log', async () =>
        (await customerRows()).length > 0 ? true : null
      )
      expect(await customerRows()).toHaveLength(1)
    }
  )

  test(
    'CUS-O-03 an email-channel customer gets the reply even while online',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail, 'Erin Email')
      const thread = await coldThread(request, customerEmail, marker, `Billing ${marker}`)
      expect(thread.row.visitor_principal_id).toBe(customer.principalUuid)
      const stream = await holdVisitorStream(customer.principalId, thread.id)
      try {
        await waitForVisitorPresence(customer.principalUuid, true)
        const api = await adminApi(playwright, baseURL!, people)
        const reply = `Here is your invoice ${marker}`
        await agentReply(api, thread.id, reply)
        await api.dispose()

        const mail = await waitForMailMatching({ to: customerEmail, body: reply })
        expect(mail.Subject).toBe(`Re: Billing ${marker}`)
        const text = mailText(mail)
        expect(text).toContain(ADMIN_NAME)
        expect(text).toContain(WORKSPACE)
        expect(text).toContain('Reply to this email to continue the conversation')
        expect(text).toContain('View it online')
        // The previous customer message is quoted under an "On <date>, <name> wrote:" line.
        expect(text).toMatch(/On [A-Z][a-z]{2} \d{1,2} ?, Erin Email wrote:/)
        expect(text).toContain(`Hello, I need help with ${marker}.`)
        // Human correspondence: no notification card wording.
        expect(text).not.toContain('replied to your conversation with')
        const log = await pollFor('reply log row', async () =>
          (await emailLogForConversation(thread.row.id)).find(
            (r) => r.email_type === 'ConversationReplyEmail'
          )
        )
        expect(log.status).toBe('sent')
      } finally {
        stream.release()
      }
    }
  )

  test(
    'CUS-O-04 an anonymous visitor with no email gets nothing',
    { tag: '@core' },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      const visitor = await seedAnonymousVisitor(null)
      const thread = await seedConversation({ visitorPrincipalUuid: visitor, subject: null })
      const api = await adminApi(playwright, baseURL!, people)
      const unreachable = `Nobody can read this ${marker}`
      await agentReply(api, thread.id, unreachable)
      // The same visitor then leaves an address: the next reply is mailed, and
      // it is the only mail this conversation ever produced.
      await supportDb()`UPDATE conversations SET visitor_email = ${customerEmail} WHERE id = ${thread.uuid}`
      const reachable = `Now you can read this ${marker}`
      await agentReply(api, thread.id, reachable)
      await api.dispose()
      await waitForMailMatching({ to: customerEmail, body: reachable })
      // The log row is written after the SMTP send returns.
      const rows = await pollFor('the email_log row', async () => {
        const found = await emailLogForConversation(thread.uuid)
        return found.length > 0 ? found : null
      })
      expect(rows.map((r) => r.address)).toEqual([customerEmail])
      expect(await mailsMatching({ to: customerEmail, body: unreachable })).toEqual([])
    }
  )

  test(
    'CUS-O-05 an anonymous visitor who left a pre-chat email gets the reply there',
    { tag: '@core' },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      const visitor = await seedAnonymousVisitor(null)
      const thread = await seedConversation({
        visitorPrincipalUuid: visitor,
        subject: null,
        visitorEmail: customerEmail,
      })
      const api = await adminApi(playwright, baseURL!, people)
      const reply = `Thanks for leaving your email ${marker}`
      await agentReply(api, thread.id, reply)
      await api.dispose()
      const mail = await waitForMailMatching({ to: customerEmail, body: reply })
      expect(mail.Subject).toBe(`New reply from ${WORKSPACE}`)
      expect(mailText(mail)).toContain(
        `${ADMIN_NAME} replied to your conversation with ${WORKSPACE}.`
      )
      // The address now leads back to this visitor.
      const identity = await pollFor('the email identity', async () => {
        const [row] = await supportDb()<{ principal_id: string }[]>`
          SELECT principal_id FROM channel_identities
          WHERE channel = 'email' AND lower(external_id) = lower(${customerEmail})`
        return row ?? null
      })
      expect(identity.principal_id).toBe(visitor)
    }
  )

  test(
    'CUS-O-06 the reply is from "<agent> from <workspace>"; automated mail is from the workspace',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const api = await adminApi(playwright, baseURL!, people)
      const reply = `Signed by a person ${marker}`
      await agentReply(api, thread.id, reply)
      const mail = await waitForMailMatching({ to: customerEmail, body: reply })
      // An email thread answers from the address the customer wrote to.
      expect(mail.From).toEqual({
        Name: `${ADMIN_NAME} from ${WORKSPACE}`,
        Address: supportInboxAddress(),
      })

      await setConversationStatus(api, thread.id, 'closed')
      await api.dispose()
      const closed = await waitForMailMatching({
        to: customerEmail,
        body: 'marked this conversation as resolved',
      })
      expect(closed.From).toEqual({ Name: WORKSPACE, Address: supportInboxAddress() })
    }
  )

  test(
    'CUS-O-07 reply, close and auto-ack mails carry the same signed Reply-To for the conversation',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      await enableAutoAck()
      const subject = `Reply-To ${marker}`
      const thread = await coldThread(request, customerEmail, marker, subject)
      const api = await adminApi(playwright, baseURL!, people)
      await agentReply(api, thread.id, `Reply ${marker}`)
      await setConversationStatus(api, thread.id, 'closed')
      await api.dispose()

      const ack = await waitForMailMatching({ to: customerEmail, body: 'We received your email' })
      const reply = await waitForMailMatching({ to: customerEmail, body: `Reply ${marker}` })
      const close = await waitForMailMatching({
        to: customerEmail,
        body: 'marked this conversation as resolved',
      })
      const expected = conversationReplyAddress(thread.id)
      expect(expected).toMatch(/^reply\+c[a-z0-9]{26}\.[A-Za-z0-9_-]{22}@inbound\.test$/)
      for (const mail of [ack, reply, close]) {
        const replyTo = header(await getMailHeaders(mail.ID), 'Reply-To')
        expect(replyTo, mail.Subject).toBe(expected)
        expect(conversationIdFromInboundAddress(replyTo!, supportEnv().app)).toBe(thread.id)
      }
    }
  )

  test(
    'CUS-O-08 each send mints our Message-ID; In-Reply-To and References follow the latest inbound',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const api = await adminApi(playwright, baseURL!, people)
      await agentReply(api, thread.id, `First answer ${marker}`)
      const first = await waitForMailMatching({ to: customerEmail, body: `First answer ${marker}` })
      await agentReply(api, thread.id, `Second answer ${marker}`)
      const second = await waitForMailMatching({
        to: customerEmail,
        body: `Second answer ${marker}`,
      })
      const h1 = await getMailHeaders(first.ID)
      const h2 = await getMailHeaders(second.ID)
      const id1 = header(h1, 'Message-ID')!
      const id2 = header(h2, 'Message-ID')!
      const minted = /^<c\.[a-z0-9]+\.[A-Za-z0-9_-]+@acme\.test>$/
      expect(id1).toMatch(minted)
      expect(id2).toMatch(minted)
      expect(id2).not.toBe(id1)
      expect(header(h1, 'In-Reply-To')).toBe(thread.messageId)
      expect(header(h2, 'In-Reply-To')).toBe(thread.messageId)
      // Compared without case: the stored chain is normalised (see the
      // quarantined case-preservation test below).
      const refs2 = header(h2, 'References')!.toLowerCase().split(/\s+/)
      expect(refs2[0]).toBe(thread.messageId.toLowerCase())
      expect(refs2).toContain(id1.toLowerCase())

      // The customer answers; the next reply points at their new message.
      const inbound = await deliver(request, {
        from: customerEmail,
        to: conversationReplyAddress(thread.id),
        subject: `Re: ${first.Subject}`,
        text: `Customer again ${marker}`,
        inReplyTo: id2,
      })
      expect(inbound.status).toBe('ingested')
      await agentReply(api, thread.id, `Third answer ${marker}`)
      await api.dispose()
      const third = await waitForMailMatching({ to: customerEmail, body: `Third answer ${marker}` })
      const h3 = await getMailHeaders(third.ID)
      expect(header(h3, 'In-Reply-To')).toBe(inbound.messageId)
      const refs3 = header(h3, 'References')!.toLowerCase()
      for (const id of [thread.messageId, id1, id2, inbound.messageId]) {
        expect(refs3).toContain(id.toLowerCase())
      }
    }
  )

  test(
    'CUS-O-08 References repeats our earlier Message-IDs exactly as they were sent',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description: 'Suspected bug: outbound Message-IDs are stored and replayed lower-cased',
      },
    },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      // Found while writing CUS-O-08: outbound ids are stored lower-cased
      // (conversation.email-store.ts normalizeMessageId) and replayed from
      // there, so References carries a spelling we never sent (QUARANTINE.md).
      const thread = await coldThread(request, customerEmail, marker)
      const api = await adminApi(playwright, baseURL!, people)
      await agentReply(api, thread.id, `One ${marker}`)
      const first = await waitForMailMatching({ to: customerEmail, body: `One ${marker}` })
      await agentReply(api, thread.id, `Two ${marker}`)
      await api.dispose()
      const second = await waitForMailMatching({ to: customerEmail, body: `Two ${marker}` })
      const id1 = header(await getMailHeaders(first.ID), 'Message-ID')!
      const refs = header(await getMailHeaders(second.ID), 'References')!.split(/\s+/)
      expect(refs).toContain(id1)
    }
  )

  test(
    'CUS-O-09 images and PDFs travel as MIME parts; zip and svg go as links',
    { tag: '@nightly' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const api = await adminApi(playwright, baseURL!, people)
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
      const files: Array<[string, string, Buffer]> = [
        ['photo.png', 'image/png', png],
        ['invoice.pdf', 'application/pdf', Buffer.from(`%PDF-1.4\n% ${marker}\n%%EOF\n`)],
        ['bundle.zip', 'application/zip', Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18))],
        [
          'logo.svg',
          'image/svg+xml',
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'),
        ],
      ]
      const attachments = []
      for (const [name, type, bytes] of files) {
        const res = await api.post(`/api/v1/files?name=${encodeURIComponent(name)}`, {
          data: bytes,
          headers: { 'content-type': type },
        })
        expect(res.status(), await res.text()).toBeLessThan(300)
        const { data } = (await res.json()) as { data: { fileId: string } }
        attachments.push({ fileId: data.fileId })
      }
      const reply = `Files attached ${marker}`
      const res = await api.post(`/api/v1/conversations/${thread.id}/reply`, {
        data: { content: reply, attachments },
      })
      expect(res.status(), await res.text()).toBe(201)
      await api.dispose()

      const mail = await waitForMailMatching({ to: customerEmail, body: reply })
      const parts = mail.Attachments.map((a) => a.FileName).sort()
      expect(parts).toEqual(['invoice.pdf', 'photo.png'])
      const text = mailText(mail)
      expect(text).toContain('Attachments')
      expect(text).toContain('bundle.zip')
      expect(text).toContain('logo.svg')
    }
  )

  test(
    'CUS-O-10 internal notes and assignment notices never reach the customer',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      const identity = { id: marker, email: customerEmail, name: 'Nora Notes' }
      let context = await browser.newContext()
      let widget = await openWidgetAs(await context.newPage(), identity)
      await messagesTab(widget).click()
      await widget.getByRole('button', { name: /Ask a question/ }).click()
      const composer = widget.locator('.ProseMirror[contenteditable="true"]')
      await composer.click()
      await composer.fill(`Private question ${marker}`)
      await widget.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(widget.getByText(`Private question ${marker}`)).toBeVisible({ timeout: 15_000 })
      const principalUuid = await principalForUserEmail(customerEmail)
      const row = await latestConversationOf(principalUuid)
      const id = conversationTypeId(row.id)
      // The thread's live stream registers first; only then does leaving mean offline.
      await waitForVisitorPresence(principalUuid, true)
      await context.close()
      await waitForVisitorPresence(principalUuid, false)

      const api = await adminApi(playwright, baseURL!, people)
      const note = `Internal only ${marker}`
      await agentNote(api, id, note)
      await assignConversation(api, id, { assigneePrincipalId: people.people.agentB.principalId })
      await assignConversation(api, id, { assigneePrincipalId: people.people.admin.principalId })
      const reply = `Visible answer ${marker}`
      await agentReply(api, id, reply)
      await api.dispose()

      await waitForMailMatching({ to: customerEmail, body: reply })
      const mails = await mailsMatching({ to: customerEmail })
      for (const mail of mails) {
        expect(mail.HTML).not.toContain(note)
        expect(mailText(mail)).not.toContain('assigned')
      }

      // The widget thread shows the answer, never the note or the notices.
      context = await browser.newContext()
      widget = await openWidgetAs(await context.newPage(), identity)
      await messagesTab(widget).click()
      await widget.getByText(reply).first().click()
      await expect(widget.getByText(reply).first()).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText(note)).toHaveCount(0)
      await expect(widget.getByText(/Conversation assigned to/)).toHaveCount(0)
      await context.close()
    }
  )

  test(
    'CUS-O-11 a teammate-started conversation always emails the customer',
    { tag: '@core' },
    async ({ asPerson, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail, `Olga Outbound ${marker}`)
      const admin = await asPerson('admin')
      await admin.goto('/admin/inbox')
      const dialog = admin.getByRole('dialog')
      // The button answers once the page has hydrated.
      await expect(async () => {
        await admin.getByRole('button', { name: 'New conversation' }).click()
        await expect(dialog).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await dialog.getByRole('textbox').first().fill(customerEmail)
      await dialog.getByText(customer.name).first().click()
      const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
      await editor.click()
      await editor.fill(`Checking in about your order ${marker}`)
      await dialog.getByRole('button', { name: 'Send message' }).click()
      await expect(admin.getByText('Message sent')).toBeVisible()

      const mail = await waitForMailMatching({
        to: customerEmail,
        body: `Checking in about your order ${marker}`,
      })
      // The opening message is the new thread's subject.
      expect(mail.Subject).toBe(`Re: Checking in about your order ${marker}`)
      const text = mailText(mail)
      expect(text).toContain(`${ADMIN_NAME} from ${WORKSPACE} sent you a message.`)
      expect(text).toContain(`You received this email because ${WORKSPACE} sent you a message.`)
      const row = await latestConversationOf(customer.principalUuid)
      expect(row.channel).toBe('messenger')
    }
  )

  test(
    'CUS-O-12 every participant of a group thread gets the reply',
    { tag: '@nightly' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const guests = [`guest1-${customerEmail}`, `guest2-${customerEmail}`]
      for (const guest of guests) {
        await addParticipant(thread.row.id, await seedAnonymousVisitor(guest))
      }
      const api = await adminApi(playwright, baseURL!, people)
      const reply = `For all of you ${marker}`
      await agentReply(api, thread.id, reply)
      await api.dispose()
      const primary = await waitForMailMatching({ to: customerEmail, body: reply })
      const expectedReplyTo = header(await getMailHeaders(primary.ID), 'Reply-To')
      for (const guest of guests) {
        const mail = await waitForMailMatching({ to: guest, body: reply })
        expect(mail.Subject).toBe(primary.Subject)
        expect(header(await getMailHeaders(mail.ID), 'Reply-To')).toBe(expectedReplyTo)
        expect(await mailsMatching({ to: guest, body: reply })).toHaveLength(1)
      }
      expect(await mailsMatching({ to: customerEmail, body: reply })).toHaveLength(1)
    }
  )
})

test.describe('close emails', () => {
  test(
    'CUS-O-13 closing an email conversation sends the resolved email; messenger and reopen send none',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const subject = `Close me ${marker}`
      const thread = await coldThread(request, customerEmail, marker, subject)
      const api = await adminApi(playwright, baseURL!, people)
      await setConversationStatus(api, thread.id, 'closed')
      const mail = await waitForMailMatching({
        to: customerEmail,
        body: 'marked this conversation as resolved',
      })
      expect(mail.Subject).toBe(`Re: ${subject}`)
      const text = mailText(mail)
      expect(text).toContain(`${WORKSPACE} marked this conversation as resolved.`)
      expect(text).toContain('How did we do?')
      expect(text).toContain(
        'Not sorted? Just reply to this email and the conversation will reopen.'
      )
      expect(text).toContain('View it online')
      const ratingLinks = linksIn(mail).filter((href) => href.includes('/csat?token='))
      expect(ratingLinks.map((href) => new URL(href).searchParams.get('rating'))).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
      ])
      expect(new Set(ratingLinks.map((h) => new URL(h).searchParams.get('token'))).size).toBe(1)
      const log = await pollFor('close log row', async () =>
        (await emailLogForConversation(thread.row.id)).find(
          (r) => r.email_type === 'ConversationClosedEmail'
        )
      )
      expect(log.status).toBe('sent')

      // Reopen sends nothing; a later reply arrives and there is still one close mail.
      await setConversationStatus(api, thread.id, 'open')
      await agentReply(api, thread.id, `After reopen ${marker}`)
      await waitForMailMatching({ to: customerEmail, body: `After reopen ${marker}` })
      expect(
        await mailsMatching({ to: customerEmail, body: 'marked this conversation as resolved' })
      ).toHaveLength(1)

      // A messenger conversation gets no close email.
      const messengerEmail = `m-${customerEmail}`
      const customer = await seedCustomer(messengerEmail)
      const messenger = await seedConversation({
        visitorPrincipalUuid: customer.principalUuid,
        subject: `Messenger ${marker}`,
      })
      await setConversationStatus(api, messenger.id, 'closed')
      await setConversationStatus(api, messenger.id, 'open')
      await agentReply(api, messenger.id, `Messenger reply ${marker}`)
      await api.dispose()
      await waitForMailMatching({ to: messengerEmail, body: `Messenger reply ${marker}` })
      expect(
        await mailsMatching({ to: messengerEmail, body: 'marked this conversation as resolved' })
      ).toEqual([])
    }
  )

  test(
    'CUS-O-14 an inactivity workflow close sends the auto-closed wording',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      test.setTimeout(90_000)
      const customer = await seedCustomer(customerEmail)
      const thread = await coldThread(request, customerEmail, marker)
      expect(thread.row.visitor_principal_id).toBe(customer.principalUuid)
      const api = await adminApi(playwright, baseURL!, people)
      await agentReply(api, thread.id, `Did that help ${marker}?`)
      await api.dispose()
      await waitForMailMatching({ to: customerEmail, body: `Did that help ${marker}?` })
      const workflowId = await seedLiveWorkflow({
        name: `Auto-close ${marker}`,
        triggerType: 'conversation.customer_unresponsive',
        triggerSettings: { inactivityMinutes: 60 },
        personEmail: customerEmail,
        then: [{ type: 'action', action: { type: 'close', lifecycle: 'auto_closed' } }],
      })
      try {
        // The customer went quiet over an hour ago (only this conversation is
        // moved), then one sweep at the wall clock. The app caches "is any
        // workflow live" for 30 s and a row written straight to the table
        // does not clear it, so each pass re-dates the silence (a new timer
        // event) until the dispatcher sees the workflow.
        await expect(async () => {
          await supportDb()`
            UPDATE conversations
            SET last_message_at = now() - interval '61 minutes' - random() * interval '5 minutes',
                waiting_since = NULL
            WHERE id = ${thread.row.id} AND status <> 'closed'`
          await runSweep(request, 'workflow-sweep')
          await waitForConversation(
            thread.row.id,
            'auto-close',
            (r) => r.status === 'closed',
            4_000
          )
        }).toPass({ timeout: 50_000, intervals: [1_000] })
        const mail = await waitForMailMatching({
          to: customerEmail,
          body: "we haven't heard back from you",
        })
        const text = mailText(mail)
        expect(text).toContain(
          "This conversation was closed because we haven't heard back from you."
        )
        expect(text).toContain(
          'Need anything else? Just reply to this email and the conversation will reopen.'
        )
        expect(text).not.toContain('marked this conversation as resolved')
      } finally {
        await retireWorkflow(workflowId)
      }
    }
  )

  test(
    'CUS-O-15 no close email for a spam filing or for closing an already-closed conversation',
    { tag: '@nightly' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      await enableAutoAck()
      // Filed to Spam by the sender-auth signal: a close, but a spam one.
      const spam = await coldThread(request, customerEmail, marker, `Spammy ${marker}`, {
        'authentication-results': 'mx.inbound.test; dmarc=fail (p=quarantine) header.from=x',
      })
      await waitForConversation(spam.row.id, 'spam filing', (r) => r.end_reason === 'spam')
      const api = await adminApi(playwright, baseURL!, people)
      // Closing it again is no transition either.
      await setConversationStatus(api, spam.id, 'closed')
      // A later mail to the same person arrives; no close email ever did.
      await agentReply(api, spam.id, `Reply on the spam thread ${marker}`)
      await waitForMailMatching({ to: customerEmail, body: `Reply on the spam thread ${marker}` })
      expect(
        await mailsMatching({ to: customerEmail, body: 'marked this conversation as resolved' })
      ).toEqual([])

      // A real close sends one; closing the closed thread again sends no second.
      const other = `o-${customerEmail}`
      const thread = await coldThread(request, other, `${marker}-o`)
      await setConversationStatus(api, thread.id, 'closed')
      await waitForMailMatching({ to: other, body: 'marked this conversation as resolved' })
      await setConversationStatus(api, thread.id, 'closed')
      await agentReply(api, thread.id, `After the second close ${marker}`)
      await api.dispose()
      await waitForMailMatching({ to: other, body: `After the second close ${marker}` })
      expect(
        await mailsMatching({ to: other, body: 'marked this conversation as resolved' })
      ).toHaveLength(1)
    }
  )
})

test.describe('ticket emails to the requester', () => {
  // Ticket mail goes out only with support tickets on (it stays on).
  test.beforeEach(() => enableSupportTickets())

  test(
    'CUS-O-16 creating a customer ticket sends one "We received your ticket" email',
    { tag: '@core' },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail)
      const api = await adminApi(playwright, baseURL!, people)
      const title = `Printer broken ${marker}`
      const ticket = await createCustomerTicket(api, customer.principalId, title)
      const label = `#${ticket.number}`
      const mail = await waitForMailMatching({
        to: customerEmail,
        subject: `We received your ticket ${label}: ${title}`,
      })
      const text = mailText(mail)
      expect(text).toContain("We've got your ticket")
      expect(text).toContain(
        `Your ticket ${label} "${title}" is with the ${WORKSPACE} team. We'll email you as soon as there's a reply.`
      )
      expect(text).toContain(
        `You're receiving this because you opened ticket ${label} at ${WORKSPACE}.`
      )
      const [pair] = await supportDb()<{ conversation_id: string }[]>`
        SELECT conversation_id FROM ticket_conversations WHERE ticket_id = ${uuidOf(ticket.id)}`
      const cta = linksIn(mail).find((h) => h.includes('/support/'))
      expect(cta).toBe(
        `${supportEnv().baseUrl}/support/${conversationTypeId(pair.conversation_id)}`
      )
      expect(linksIn(mail)).toContain(`${supportEnv().baseUrl}/settings/preferences`)
      const headers = await getMailHeaders(mail.ID)
      expect(header(headers, 'Reply-To')).toBe(ticketReplyAddress(ticket.id))
      expect(header(headers, 'Message-ID')).toMatch(/^<ticket-[a-z0-9]+@acme\.test>$/)
      expect(header(headers, 'In-Reply-To')).toBeUndefined()

      // A later ticket mail arrives; still one confirmation and no conversation-started mail.
      await ticketReply(api, ticket.id, `We are on it ${marker}`)
      await api.dispose()
      await waitForMailMatching({ to: customerEmail, subject: `New reply on ${label}` })
      expect(
        await mailsMatching({ to: customerEmail, subject: 'We received your ticket' })
      ).toHaveLength(1)
      expect(await mailsMatching({ to: customerEmail, body: 'sent you a message' })).toEqual([])
    }
  )

  test(
    'CUS-O-16 a teammate-filed ticket sends the requester the confirmation and no conversation email',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Suspected bug: the opening message of a teammate-filed ticket is also emailed as a conversation reply',
      },
    },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      await enableSupportTickets()
      const customer = await seedCustomer(customerEmail)
      const api = await adminApi(playwright, baseURL!, people)
      const title = `Filed for you ${marker}`
      const ticket = await createCustomerTicket(api, customer.principalId, title)
      await waitForMailMatching({
        to: customerEmail,
        subject: `We received your ticket #${ticket.number}`,
      })
      // A later ticket mail to the same person arrives first.
      await setTicketStatus(api, ticket.id, await ticketStatusId('Resolved'))
      await api.dispose()
      await waitForMailMatching({
        to: customerEmail,
        subject: `Your ticket #${ticket.number} was resolved`,
      })
      const extra = await mailsMatching({ to: customerEmail, body: 'replied to your conversation' })
      expect(extra.map((m) => m.Subject)).toEqual([])
    }
  )

  test(
    'CUS-O-17 an agent reply on a ticket emails the requester; a note sends nothing',
    { tag: '@core' },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail)
      const api = await adminApi(playwright, baseURL!, people)
      const title = `Login fails ${marker}`
      const ticket = await createCustomerTicket(api, customer.principalId, title)
      const label = `#${ticket.number}`
      await ticketNote(api, ticket.id, `Team-only note ${marker}`)
      const reply = `Please clear your cookies ${marker}`
      await ticketReply(api, ticket.id, reply)
      await api.dispose()

      const mail = await waitForMailMatching({
        to: customerEmail,
        subject: `New reply on ${label}: ${title}`,
      })
      const text = mailText(mail)
      expect(text).toContain(`${ADMIN_NAME} replied to ${label} "${title}":`)
      expect(text).toContain(reply)
      expect(text).toContain('View your ticket')
      const headers = await getMailHeaders(mail.ID)
      const root = `<ticket-${ticket.id.replace(/^ticket_/, '')}@acme.test>`
      expect(header(headers, 'In-Reply-To')).toBe(root)
      expect(header(headers, 'Message-ID')).toMatch(
        /^<ticket-[a-z0-9]+\.[A-Za-z0-9_-]+@acme\.test>$/
      )
      for (const m of await mailsMatching({ to: customerEmail })) {
        expect(m.HTML).not.toContain(`Team-only note ${marker}`)
      }
    }
  )

  test(
    'CUS-O-17 one agent reply on a ticket sends the requester exactly one email',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description: 'Known bug: a ticket reply may also send a conversation reply email',
      },
    },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      // Known bug: a reply on a ticket with a linked conversation may send both
      // a ticket reply email and a conversation reply email (QUARANTINE.md).
      const customer = await seedCustomer(customerEmail)
      const api = await adminApi(playwright, baseURL!, people)
      const ticket = await createCustomerTicket(api, customer.principalId, `Double ${marker}`)
      const first = `First ticket reply ${marker}`
      await ticketReply(api, ticket.id, first)
      await waitForMailMatching({ to: customerEmail, body: first })
      const second = `Second ticket reply ${marker}`
      await ticketReply(api, ticket.id, second)
      await api.dispose()
      await waitForMailMatching({ to: customerEmail, body: second })
      expect(await mailsMatching({ to: customerEmail, body: first })).toHaveLength(1)
    }
  )

  test(
    'CUS-O-18 resolving a ticket emails "was resolved", a stage-less close "was closed", open moves nothing',
    { tag: '@core' },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail)
      const api = await adminApi(playwright, baseURL!, people)
      const title = `Resolve me ${marker}`
      const ticket = await createCustomerTicket(api, customer.principalId, title)
      const label = `#${ticket.number}`
      await setTicketStatus(api, ticket.id, await ticketStatusId('Investigating'))
      await setTicketStatus(api, ticket.id, await ticketStatusId('Resolved'))
      const resolved = await waitForMailMatching({
        to: customerEmail,
        subject: `Your ticket ${label} was resolved`,
      })
      const text = mailText(resolved)
      expect(text).toContain(
        `${label} "${title}" has been marked resolved by the ${WORKSPACE} team.`
      )
      expect(text).toContain(
        "Reply on the ticket thread if this isn't fixed for you; replying reopens it."
      )
      // Customer-facing stage labels, never the internal status name.
      expect(text).toContain('In progress → Resolved')
      expect(text).not.toContain('Investigating')
      // Of the ticket mails, only the confirmation and the resolution: the move
      // to an open status sent nothing.
      const subjects = (await mailsMatching({ to: customerEmail }))
        .map((m) => m.Subject)
        .filter((subject) => subject.includes(label))
        .sort()
      expect(subjects).toEqual(
        [`We received your ticket ${label}: ${title}`, `Your ticket ${label} was resolved`].sort()
      )

      const other = await createCustomerTicket(api, customer.principalId, `Will not do ${marker}`)
      await setTicketStatus(api, other.id, await ticketStatusId("Won't do"))
      await api.dispose()
      const closed = await waitForMailMatching({
        to: customerEmail,
        subject: `Your ticket #${other.number} was closed`,
      })
      const closedText = mailText(closed)
      expect(closedText).toContain(`has been closed by the ${WORKSPACE} team.`)
      expect(closedText).toContain('→ Closed')
      expect(closedText).not.toContain("Won't do")
    }
  )

  test(
    'CUS-O-19 ticket assignment mail goes to the teammate, never the requester',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail)
      const api = await adminApi(playwright, baseURL!, people)
      const title = `Assign me ${marker}`
      const ticket = await createCustomerTicket(api, customer.principalId, title)
      const label = `#${ticket.number}`
      const res = await api.post(`/api/v1/tickets/${ticket.id}/assign`, {
        data: { assigneePrincipalId: people.people.agentB.principalId },
      })
      expect(res.status(), await res.text()).toBeLessThan(300)
      const assigned = await waitForMailMatching({
        to: people.people.agentB.email,
        subject: `Ticket ${label} assigned to you`,
      })
      expect(mailText(assigned)).toContain(`${label} "${title}" was assigned to you.`)
      // The requester's next ticket mail arrives; no assignment mail ever did.
      await setTicketStatus(api, ticket.id, await ticketStatusId('Resolved'))
      await api.dispose()
      await waitForMailMatching({ to: customerEmail, subject: `Your ticket ${label} was resolved` })
      expect(await mailsMatching({ to: customerEmail, subject: 'assigned' })).toEqual([])
    }
  )
})

test.describe('where email links land', () => {
  test.beforeEach(() => enableSupportTickets())

  test(
    'CUS-O-31 a conversation email links to /support/<id>, which asks a signed-out visitor to sign in',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      const customer = await seedCustomer(customerEmail)
      const thread = await seedConversation({
        visitorPrincipalUuid: customer.principalUuid,
        subject: `Portal link ${marker}`,
        channel: 'email',
      })
      const api = await adminApi(playwright, baseURL!, people)
      await agentReply(api, thread.id, `Follow the link ${marker}`)
      await api.dispose()
      const mail = await waitForMailMatching({
        to: customerEmail,
        body: `Follow the link ${marker}`,
      })
      const link = linksIn(mail).find((href) => href.includes('/support/'))
      expect(link).toBe(`${supportEnv().baseUrl}/support/${thread.id}`)
      expect(new URL(link!).search).toBe('')

      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto(link!)
      await expect(page.getByText('Sign in to view your conversations')).toBeVisible()
      await expect(
        page.getByText('Your support conversations are tied to your account.')
      ).toBeVisible()
      // The button works once the page has hydrated: it opens the sign-in dialog.
      await expect(async () => {
        await page.getByRole('main').getByRole('button', { name: 'Log in' }).click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      // The link itself carries no access: nothing of the thread is shown.
      await expect(page.getByText(`Follow the link ${marker}`)).toHaveCount(0)
      await context.close()
    }
  )

  test(
    'CUS-O-32 a customer signs in from a ticket email with the emailed code link and sees the ticket',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      enableMagicLinkMethod()
      clearSigninRateLimit()
      const customer = await seedCustomer(customerEmail, 'Sid Signin')
      const api = await adminApi(playwright, baseURL!, people)
      const title = `Where is my refund ${marker}`
      const ticket = await createCustomerTicket(api, customer.principalId, title)
      await api.dispose()
      const confirmation = await waitForMailMatching({
        to: customerEmail,
        subject: `We received your ticket #${ticket.number}`,
      })
      const ticketLink = linksIn(confirmation).find((href) => href.includes('/support/'))!

      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto(ticketLink)
      await expect(async () => {
        await page.getByRole('main').getByRole('button', { name: 'Log in' }).click()
        await expect(page.getByPlaceholder('you@example.com')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await page.getByPlaceholder('you@example.com').fill(customerEmail)
      await page.getByRole('button', { name: /^Continue/ }).click()
      // Password sign-in is also on: ask for the emailed link instead.
      await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click()
      await page.getByRole('button', { name: 'Continue with email' }).click()

      const signIn = await waitForMailMatching({ to: customerEmail, subject: 'is your code for' })
      expect(signIn.Subject).toMatch(new RegExp(`^\\d{6} is your code for ${WORKSPACE}$`))
      const text = mailText(signIn)
      expect(text).toContain(`Sign in to ${WORKSPACE}`)
      expect(text).toContain('The link and code expire in 10 minutes.')
      expect(header(await getMailHeaders(signIn.ID), 'Reply-To')).toBeUndefined()
      const verify = linksIn(signIn).find((href) => href.includes('/verify-magic-link?token='))!
      expect(new URL(verify).origin).toBe(supportEnv().baseUrl)

      await page.goto(verify)
      await page.waitForURL((url) => !url.pathname.startsWith('/verify-magic-link'))
      // Signed in now: the email's own link opens the ticket thread.
      await page.goto(ticketLink)
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Sign in to view your conversations')).toHaveCount(0)
      await context.close()
    }
  )
})

test.describe('account mail', () => {
  test(
    'CUS-O-33 a portal invite carries the personal message and an Accept invitation link',
    { tag: '@nightly' },
    async ({ asPerson, customerEmail, marker }) => {
      const admin = await asPerson('admin')
      await admin.goto('/admin/users?invites=pending')
      const dialog = admin.getByRole('dialog')
      await expect(async () => {
        await admin.getByRole('button', { name: 'Invite users' }).click()
        await expect(dialog).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await dialog.getByLabel('Email addresses to invite').fill(customerEmail)
      await dialog.getByLabel('Optional personal message').fill(`Come and try the beta ${marker}`)
      await dialog.locator('button[type="submit"]').click()

      const mail = await waitForMailMatching({
        to: customerEmail,
        subject: "You've been invited to",
      })
      expect(mail.Subject).toBe(`You've been invited to ${WORKSPACE}`)
      const text = mailText(mail)
      expect(text).toContain(
        `You've been invited to access the ${WORKSPACE} portal. Click below to accept and sign in.`
      )
      expect(text).toContain(`Come and try the beta ${marker}`)
      expect(text).toContain('Accept invitation')
      expect(text).toContain("If you weren't expecting this invitation, you can ignore this email.")
      const accept = linksIn(mail).find((href) => href.startsWith(supportEnv().baseUrl))
      expect(accept, 'the accept link is on the portal').toBeTruthy()
      await expect
        .poll(async () => {
          const rows = await supportDb()<{ n: number }[]>`
            SELECT count(*)::int AS n FROM audit_log
            WHERE event_type = 'portal.invite.sent'
              AND (coalesce(metadata::text, '') || coalesce(after_value::text, '') ||
                   coalesce(target_id, '')) ILIKE ${`%${customerEmail}%`}`
          return rows[0]?.n ?? 0
        })
        .toBeGreaterThan(0)
    }
  )
})

test.describe('account mail, not yet driven', () => {
  test.fixme(
    'CUS-O-34 the verify-address code email confirms a new address',
    { tag: '@nightly' },
    async () => {
      // Needs a signed-in customer of the test's own (the shared `customer`
      // must not change address) and the profile page's two-code change
      // flow. Left for a follow-up; the sign-in half is CUS-O-32.
    }
  )
})

test.describe('auto-acknowledgement mail', () => {
  test(
    'CUS-O-20 the auto-ack has its wording and headers, a per-sender cap and loop guards',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      await enableAutoAck()
      const subject = `Ack wording ${marker}`
      const first = await coldThread(request, customerEmail, marker, subject)
      const ack = await waitForMailMatching({ to: customerEmail, subject: `Re: ${subject}` })
      expect(mailText(ack)).toContain('We received your email and will get back to you shortly.')
      expect(mailText(ack)).toContain(WORKSPACE)
      expect(ack.From).toEqual({ Name: WORKSPACE, Address: supportInboxAddress() })
      const headers = await getMailHeaders(ack.ID)
      expect(header(headers, 'Auto-Submitted')).toBe('auto-replied')
      expect(header(headers, 'Precedence')).toBe('auto_reply')
      expect(header(headers, 'In-Reply-To')).toBe(first.messageId)
      expect(header(headers, 'References')).toBe(first.messageId)
      expect(header(headers, 'Reply-To')).toBe(conversationReplyAddress(first.id))

      // At most two acks per sender per hour: the third thread gets none.
      await coldThread(request, customerEmail, `${marker}-2`, `Second ${marker}`)
      await waitForMailMatching({ to: customerEmail, subject: `Re: Second ${marker}` })
      const third = await coldThread(request, customerEmail, `${marker}-3`, `Third ${marker}`)
      const api = await adminApi(playwright, baseURL!, people)
      await agentReply(api, third.id, `Answer on third ${marker}`)
      await waitForMailMatching({ to: customerEmail, body: `Answer on third ${marker}` })
      const acks = (await mailsMatching({ to: customerEmail })).filter((m) =>
        m.Text.includes('We received your email')
      )
      expect(acks.map((m) => m.Subject).sort()).toEqual([`Re: ${subject}`, `Re: Second ${marker}`])

      // Guarded mail gets none, then a teammate reply does arrive.
      const guarded: Array<[string, Record<string, string>]> = [
        ['auto-submitted', { 'auto-submitted': 'auto-generated' }],
        ['precedence', { precedence: 'list' }],
        ['list', { 'list-id': '<news.lists.example>' }],
      ]
      for (const [label, headersToSend] of guarded) {
        const sender = `${label}-${customerEmail}`
        const t = await coldThread(
          request,
          sender,
          `${marker}-${label}`,
          `Guard ${label} ${marker}`,
          headersToSend
        )
        await agentReply(api, t.id, `Guarded answer ${label} ${marker}`)
        await waitForMailMatching({ to: sender, body: `Guarded answer ${label} ${marker}` })
        const got = (await mailsMatching({ to: sender })).filter((m) =>
          m.Text.includes('We received your email')
        )
        expect(got, label).toEqual([])
      }
      await api.dispose()
    }
  )
})

test.describe('who the email speaks as', () => {
  test.beforeEach(() => enableSupportTickets())

  test(
    'CUS-O-30 a personal API key reply is signed by its creator, in the email and the ticket mail',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const personal = await adminApi(playwright, baseURL!, people)
      await agentReply(personal, thread.id, `From a person ${marker}`)
      const mail = await waitForMailMatching({ to: customerEmail, body: `From a person ${marker}` })
      expect(mail.From.Name).toBe(`${ADMIN_NAME} from ${WORKSPACE}`)
      expect(mailText(mail)).toContain(ADMIN_NAME)

      // The ticket reply intro names the creator too.
      const customer = await seedCustomer(`t-${customerEmail}`)
      const ticket = await createCustomerTicket(
        personal,
        customer.principalId,
        `Key author ${marker}`
      )
      await ticketReply(personal, ticket.id, `Ticket answer ${marker}`)
      await personal.dispose()
      const ticketMail = await waitForMailMatching({
        to: customer.email,
        subject: `New reply on #${ticket.number}`,
      })
      expect(mailText(ticketMail)).toContain(`${ADMIN_NAME} replied to #${ticket.number}`)
    }
  )

  test(
    'CUS-O-35 a reply on a test-customer thread mails only the owning teammate',
    { tag: '@nightly' },
    async ({ request, playwright, baseURL, people, marker }) => {
      const { testEmailAlias } =
        await import('../../../src/lib/server/domains/conversation/conversation.email-channel')
      const owner = people.people.agentB
      const alias = testEmailAlias(owner.principalId, 'reply', supportEnv().app)!
      const sender = `${marker}@customers.example`
      const sent = await sendColdMail(request, {
        from: sender,
        to: alias,
        subject: `Test thread ${marker}`,
        text: `Testing ${marker}`,
      })
      expect(sent.status).toBe('ingested')
      const row = await conversationForMessage(sent.messageId)
      const api = await adminApi(playwright, baseURL!, people)
      const reply = `Reply on a test thread ${marker}`
      await agentReply(api, conversationTypeId(row.id), reply)
      await api.dispose()
      await waitForMailMatching({ to: owner.email, body: reply })
      expect(await mailsMatching({ to: sender, body: reply })).toEqual([])
      const outbound = async () =>
        (await emailLogForConversation(row.id)).filter((r) => r.direction === 'outbound')
      await pollFor('the reply in email_log', async () =>
        (await outbound()).length > 0 ? true : null
      )
      expect((await outbound()).map((r) => r.address)).toEqual([owner.email])
    }
  )
})
