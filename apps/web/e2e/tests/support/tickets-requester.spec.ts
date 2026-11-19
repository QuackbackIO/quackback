/**
 * Tickets from the requester's side (area TKT): filing a ticket in the
 * thread, replying in the portal and by email, the ticket header card and
 * what the requester must never see.
 */
import { randomUUID } from 'node:crypto'
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { sendInboundEmail, ticketReplyAddress } from '../../support/inbound-email'
import { emailLogFor, waitForMail } from '../../support/mailpit'
import {
  conversationMessages,
  createCustomer,
  openInInbox,
  openRequesterThread,
  pairedConversationId,
  pairedCustomerTicket,
  principalUuid,
  setStatus,
  signedInAs,
  ticketActivity,
  ticketApi,
  ticketWatchers,
  waitForTicket,
} from '../../support/tickets'
import { seedConversation } from '../../utils/db-helpers'

/**
 * Put a ticket form block in a conversation, as a workflow's "send ticket
 * form" step writes it (action.executor.ts). A precondition: filing through
 * the block is the action under test.
 */
async function postTicketFormBlock(conversationId: string, authorPrincipalId: string) {
  await supportDb()`
    INSERT INTO conversation_messages
      (id, conversation_id, principal_id, sender_type, content, is_internal, metadata, created_at)
    VALUES (${randomUUID()}, ${toUuid(conversationId as `conversation_${string}`)},
            ${principalUuid(authorPrincipalId)}, 'agent', 'Tell us about the problem', false,
            ${supportDb().json({
              block: {
                v: 1,
                kind: 'ticketForm',
                runId: randomUUID(),
                nodeId: 'form',
                waiting: false,
              },
            })}, NOW())`
}

test.describe('requester files a ticket', () => {
  test(
    'TKT-17 a verified customer files a ticket from the thread form, gets a received email, and the team sees it',
    { tag: '@core' },
    async ({ playwright, baseURL, browser, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const seeded = seedConversation(`Form ${marker}`, customerEmail)
      await postTicketFormBlock(seeded.conversationId, people.people.admin.principalId)

      const page = await signedInAs(browser, customer.userId)
      await openRequesterThread(page, seeded.conversationId)
      const title = `Cannot export ${marker}`
      await page.getByLabel('Subject').fill(title)
      await page.getByLabel('Details').fill(`It fails every time ${marker}`)
      await page.getByRole('button', { name: 'Create ticket' }).click()
      await expect(page.getByText("Ticket filed. We'll track it from here.")).toBeVisible()

      const row = await pollFor('filed ticket', async () => {
        const [t] = await supportDb()<
          { id: string; requester_principal_id: string; assignee_principal_id: string | null }[]
        >`SELECT id, requester_principal_id, assignee_principal_id FROM tickets WHERE title = ${title}`
        return t ?? null
      })
      const ticketId = fromUuid('ticket', row.id)
      expect(row.requester_principal_id).toBe(principalUuid(customer.principalId))
      expect(row.assignee_principal_id, 'a requester-filed ticket is born unassigned').toBeNull()
      expect(await ticketWatchers(ticketId)).toContainEqual(
        expect.objectContaining({
          principal_id: principalUuid(customer.principalId),
          reason: 'requester',
        })
      )
      const backing = await pairedConversationId(ticketId)
      expect(backing).not.toBeNull()
      expect(
        (await conversationMessages(backing!)).find((m) =>
          m.content.includes('It fails every time')
        )
      ).toMatchObject({ sender_type: 'visitor' })

      const [{ number }] = await supportDb()<{ number: number }[]>`
        SELECT number FROM tickets WHERE id = ${row.id}`
      await waitForMail({
        to: customerEmail,
        subject: `We received your ticket #${number}: ${title}`,
      })

      const admin = await asPerson('admin')
      await admin.goto('/admin/inbox?view=tickets_customer')
      await expect(admin.getByText(title).first()).toBeVisible({ timeout: 15_000 })
    }
  )
})

test.describe('requester replies', () => {
  test(
    'TKT-28 a requester reply from the portal reopens a resolved ticket',
    { tag: '@core' },
    async ({ playwright, baseURL, browser, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Reopen by reply ${marker}`
      )
      await setStatus(api, ticket.id, 'Resolved')

      const page = await signedInAs(browser, customer.userId)
      await openRequesterThread(page, conversationId)
      const box = page.locator('[contenteditable="true"]').last()
      await box.click()
      await box.fill(`Still happening ${marker}`)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(page.getByText(`Still happening ${marker}`)).toBeVisible()

      const row = await waitForTicket(ticket.id, 'reopened', (r) => r.status_category === 'open')
      expect(row.status_name).toBe('New')
      expect(row.resolved_at).toBeNull()
      expect(row.reopened_count).toBe(1)
      const reopened = (await ticketActivity(ticket.id)).find((a) => a.type === 'ticket.reopened')
      expect(reopened?.metadata).toMatchObject({ trigger: 'requester_reply', toName: 'New' })
      expect(reopened?.actor).toBe(principalUuid(customer.principalId))
    }
  )

  test(
    'TKT-58 a requester email reply lands in the ticket thread once, with no reply email back',
    { tag: '@core' },
    async ({ playwright, baseURL, request, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Email reply ${marker}`
      )
      const text = `Answer by email ${marker}`
      const mail = {
        from: customerEmail,
        to: ticketReplyAddress(ticket.id),
        subject: `Re: ${ticket.title}`,
        text,
        messageId: `<${marker}@customers.example>`,
      }
      const first = await sendInboundEmail(request, mail)
      expect(first.status(), await first.text()).toBe(200)
      const replies = async () =>
        (await conversationMessages(conversationId)).filter((m) => m.content.includes(text))
      await expect.poll(async () => (await replies()).length).toBe(1)
      expect((await replies())[0]).toMatchObject({ sender_type: 'visitor', is_internal: false })
      expect((await replies())[0].metadata).toMatchObject({ source: 'email' })

      // A redelivery of the same message adds nothing.
      const again = await sendInboundEmail(request, mail)
      expect(again.status()).toBe(200)
      await new Promise((r) => setTimeout(r, 2_000))
      expect(await replies()).toHaveLength(1)

      // The requester gets no reply email for their own message.
      const sentAfter = (await emailLogFor(customerEmail)).filter(
        (r) => r.direction === 'outbound' && (r.subject ?? '').startsWith('New reply on')
      )
      expect(sentAfter).toEqual([])
    }
  )
})

test.describe('what the requester sees', () => {
  test(
    'TKT-66 the ticket header card shows the current stage and follows a stage change live',
    { tag: '@core' },
    async ({ playwright, baseURL, browser, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Header card ${marker}`
      )
      const page = await signedInAs(browser, customer.userId)
      await openRequesterThread(page, conversationId)
      await expect(page.getByText(ticket.title).first()).toBeVisible()
      const progress = page.getByRole('list', { name: 'Ticket progress' })
      const currentStage = progress.locator('li[aria-current="step"]')
      await expect(currentStage).toHaveText('Received')

      // A teammate moves the ticket on: the card follows without a reload.
      await setStatus(api, ticket.id, 'Investigating')
      await expect(page.getByText('Status updated to In progress')).toBeVisible({ timeout: 15_000 })
      await expect(currentStage).toHaveText('In progress')
    }
  )

  test(
    "TKT-79 the requester's thread never shows internal notes or team-only notices",
    { tag: '@core' },
    async ({ playwright, baseURL, browser, asPerson, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const opening = `Shown to the customer ${marker}`
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Hidden notices ${marker}`,
        opening
      )
      const ticketNote = `Ticket note ${marker}`
      const conversationNote = `Conversation note ${marker}`
      expect(
        (
          await api.post(`/api/v1/tickets/${ticket.id}/note`, { data: { content: ticketNote } })
        ).ok()
      ).toBe(true)
      expect(
        (
          await api.post(`/api/v1/conversations/${conversationId}/note`, {
            data: { content: conversationNote },
          })
        ).ok()
      ).toBe(true)

      const page = await signedInAs(browser, customer.userId)
      await openRequesterThread(page, conversationId)
      await expect(page.getByText(opening)).toBeVisible()
      await expect(page.getByText(ticketNote)).toHaveCount(0)
      await expect(page.getByText(conversationNote)).toHaveCount(0)
      // Control: the team sees both notes in the ticket thread.
      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await expect(admin.getByText(ticketNote).first()).toBeVisible()
      await expect(admin.getByText(conversationNote).first()).toBeVisible()
    }
  )
})
