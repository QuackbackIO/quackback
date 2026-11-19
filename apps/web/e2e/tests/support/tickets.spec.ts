/**
 * Tickets from the team's side: status, assignment, priority, replies, notes,
 * watchers, list and search, webhooks and workflow actions (area TKT).
 *
 * Preconditions are made through the REST API (support/tickets.ts); each test
 * makes its own customer and tickets, named by its marker.
 */
import { test, expect } from '../../support/fixtures'
import { ticketReplyAddress, sendInboundEmail } from '../../support/inbound-email'
import { waitForMail } from '../../support/mailpit'
import { supportDb } from '../../support/db'
import {
  conversationMessages,
  createCustomer,
  createTicket,
  getTicket,
  openInInbox,
  pairedConversationId,
  replyToTicket,
  sendFromComposer,
  setStatus,
  signedInAs,
  ticketApi,
  ticketRow,
  waitForTicket,
  ticketWatchers,
} from '../../support/tickets'
import { toUuid } from '@quackback/ids'

test.describe('tickets: replies and first response', () => {
  test(
    'TKT-39 an agent reply on a paired customer ticket reaches the requester live and by email',
    { tag: '@smoke' },
    async ({ playwright, baseURL, browser, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const ticket = await createTicket(api, {
        title: `Printer jam ${marker}`,
        type: 'customer',
        requesterPrincipalId: customer.principalId,
        description: `Opening note ${marker}`,
      })
      const conversationId = await pairedConversationId(ticket.id)
      expect(conversationId, 'a customer ticket with a requester is paired').toBeTruthy()

      // The requester writes first, from their portal thread, and keeps it open.
      const requester = await signedInAs(browser, customer.userId)
      await requester.goto(`/support/${conversationId}`)
      const question = `Customer question ${marker}`
      const box = requester.locator('[contenteditable="true"]').last()
      await expect(box).toBeVisible({ timeout: 15_000 })
      await box.click()
      await box.fill(question)
      await requester.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(requester.getByText(question)).toBeVisible()

      // A teammate replies from the ticket thread in the inbox.
      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await expect(admin.getByText(question).first()).toBeVisible({ timeout: 15_000 })
      const answer = `Agent answer ${marker}`
      await sendFromComposer(admin, answer)
      await expect(admin.getByText(answer).first()).toBeVisible({ timeout: 10_000 })

      // Live in the requester's open thread, no reload.
      await expect(requester.getByText(answer)).toBeVisible({ timeout: 15_000 })

      // By email, as the ticket's reply notice.
      const mail = await waitForMail({
        to: customerEmail,
        subject: `New reply on ${ticket.reference}: ${ticket.title}`,
      })
      expect(mail.Text).toContain(answer)

      // The reply is the ticket's first response; the replier now watches it.
      const row = await waitForTicket(ticket.id, 'first response', (r) => !!r.first_response_at)
      expect(row.first_response_at).not.toBeNull()
      const watchers = await ticketWatchers(ticket.id)
      expect(watchers.map((w) => w.principal_id)).toContain(
        toUuid(people.people.admin.principalId as `principal_${string}`)
      )
    }
  )

  test(
    'TKT-41 first response is the first human public reply after the customer writes',
    { tag: '@smoke' },
    async ({ playwright, baseURL, request, marker, customerEmail }) => {
      const personal = await ticketApi(playwright, baseURL, 'admin', 'personal')
      const workspace = await ticketApi(playwright, baseURL, 'admin', 'workspace')
      const customer = await createCustomer(personal, customerEmail)
      const ticket = await createTicket(personal, {
        title: `Login loop ${marker}`,
        type: 'customer',
        requesterPrincipalId: customer.principalId,
        description: `Teammate opening line ${marker}`,
      })
      // Before the customer writes: a teammate reply, status, priority and
      // assignment changes never count.
      await replyToTicket(personal, ticket.id, `Early reply ${marker}`)
      await setStatus(personal, ticket.id, 'Investigating')
      const priority = await personal.post(`/api/v1/tickets/${ticket.id}/priority`, {
        data: { priority: 'high' },
      })
      expect(priority.ok(), await priority.text()).toBe(true)
      expect((await getTicket(personal, ticket.id)).firstResponseAt).toBeNull()

      // The customer replies by email to the ticket's reply address.
      const inbound = await sendInboundEmail(request, {
        from: customerEmail,
        to: ticketReplyAddress(ticket.id),
        subject: `Re: ${ticket.title}`,
        text: `Still broken ${marker}`,
      })
      expect(inbound.status(), await inbound.text()).toBe(200)
      const conversationId = (await pairedConversationId(ticket.id))!
      await expect
        .poll(async () => {
          return (await conversationMessages(conversationId)).some(
            (m) => m.sender_type === 'visitor' && m.content.includes(`Still broken ${marker}`)
          )
        })
        .toBe(true)

      // A workspace key's reply and an internal note do not count.
      await replyToTicket(workspace, ticket.id, `Automated reply ${marker}`)
      const note = await personal.post(`/api/v1/tickets/${ticket.id}/note`, {
        data: { content: `Internal ${marker}` },
      })
      expect(note.ok(), await note.text()).toBe(true)
      expect((await getTicket(personal, ticket.id)).firstResponseAt).toBeNull()

      // A personal key (made after the cutoff) replies as its teammate: counts.
      await replyToTicket(personal, ticket.id, `Human reply ${marker}`)
      await expect
        .poll(async () => (await getTicket(personal, ticket.id)).firstResponseAt)
        .not.toBeNull()
      const stamped = (await ticketRow(ticket.id))!.first_response_at!
      const [human] = await supportDb()<{ created_at: Date }[]>`
        SELECT created_at FROM conversation_messages
        WHERE content LIKE ${`Human reply ${marker}%`}`
      expect(stamped.getTime()).toBe(human.created_at.getTime())
      await personal.dispose()
      await workspace.dispose()
    }
  )
})
