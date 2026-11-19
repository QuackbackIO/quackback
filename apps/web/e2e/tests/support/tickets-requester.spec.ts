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
import {
  addWatcherRow,
  clickUntilVisible,
  createTicketTypeRow,
  ticketBells,
} from '../../support/tickets'
import {
  anonWidgetConversation,
  conversationVisitor,
  postTicketEmbed,
  reopenWidgetConversation,
} from '../../support/tickets-more'

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
      await expect
        .poll(() => ticketWatchers(ticketId))
        .toContainEqual(
          expect.objectContaining({
            principal_id: principalUuid(customer.principalId),
            reason: 'requester',
          })
        )
      const backing = await pollFor('backing conversation', () => pairedConversationId(ticketId))
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
    "TKT-79 the requester's thread never shows internal notes from the ticket or its conversation",
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

test.describe('requester intake rules', () => {
  test(
    'TKT-18 an anonymous widget visitor must give an email; the first one is kept',
    { tag: '@core' },
    async ({ page, people, marker }) => {
      test.setTimeout(120_000)
      const text = `Anonymous ask ${marker}`
      const { widget, conversationId } = await anonWidgetConversation(page, text)
      const visitor = await conversationVisitor(conversationId)
      const contactEmail = async () =>
        (
          await supportDb()<{ contact_email: string | null }[]>`
            SELECT contact_email FROM principal WHERE id = ${visitor.visitor_principal_id}`
        )[0].contact_email
      const ticketsFiled = async () =>
        (
          await supportDb()<{ title: string }[]>`
            SELECT title FROM tickets WHERE requester_principal_id = ${visitor.visitor_principal_id}
            ORDER BY created_at`
        ).map((t) => t.title)

      await postTicketFormBlock(conversationId, people.people.admin.principalId)
      await reopenWidgetConversation(page, text)
      // a) No email and none on file: refused, nothing filed.
      await widget.getByLabel('Subject').last().fill(`No email ${marker}`)
      await widget.getByRole('button', { name: 'Create ticket' }).last().click()
      await expect(widget.getByText('An email address is required to file a ticket')).toBeVisible()
      expect(await ticketsFiled()).toEqual([])
      expect(await contactEmail()).toBeNull()

      // b) A plausible email is captured (lower-cased) and the ticket filed.
      const first = `First.${marker}@Customers.Example`
      await widget.getByLabel('Email').last().fill(first)
      await widget.getByLabel('Subject').last().fill(`With email ${marker}`)
      await widget.getByRole('button', { name: 'Create ticket' }).last().click()
      await expect(widget.getByText("Ticket filed. We'll track it from here.")).toBeVisible()
      await expect.poll(contactEmail).toBe(first.toLowerCase())
      expect(await ticketsFiled()).toEqual([`With email ${marker}`])

      // c) A different email on a later ticket never replaces it.
      await postTicketFormBlock(conversationId, people.people.admin.principalId)
      await reopenWidgetConversation(page, text)
      await widget.getByLabel('Email').last().fill(`other.${marker}@customers.example`)
      await widget.getByLabel('Subject').last().fill(`Second ${marker}`)
      await widget.getByRole('button', { name: 'Create ticket' }).last().click()
      await expect(widget.getByText("Ticket filed. We'll track it from here.")).toBeVisible()
      await expect.poll(ticketsFiled).toEqual([`With email ${marker}`, `Second ${marker}`])
      expect(await contactEmail()).toBe(first.toLowerCase())
    }
  )

  test(
    'TKT-19 the thread form refuses a ticket type that is not on offer',
    { tag: '@nightly' },
    async ({ playwright, baseURL, browser, people, marker, customerEmail }) => {
      test.setTimeout(90_000)
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const seeded = seedConversation(`Intake ${marker}`, customerEmail)
      // Types the requester is never offered: a back-office one, a customer
      // one hidden from intake, and an archived customer one.
      const backOffice = await createTicketTypeRow({
        name: `Desk ${marker.slice(-12)}`,
        category: 'back_office',
      })
      // Inserted already off the intake form, so no other test's form ever
      // offers them.
      const offIntakeType = async (name: string, archived: boolean) => {
        const id = randomUUID()
        await supportDb()`
          INSERT INTO ticket_types (id, name, slug, category, fields, is_default, position,
                                    intake_visible, deleted_at)
          VALUES (${id}, ${name}, ${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}, 'customer',
                  '[]'::jsonb, false, 100, false, ${archived ? new Date() : null})`
        return fromUuid('ticket_type', id)
      }
      const hidden = await offIntakeType(`Hidden ${marker.slice(-12)}`, false)
      const archived = await offIntakeType(`Gone ${marker.slice(-12)}`, true)
      const [offered] = await supportDb()<{ id: string }[]>`
        SELECT id FROM ticket_types WHERE category = 'customer' AND is_default AND deleted_at IS NULL`
      const offeredId = fromUuid('ticket_type', offered.id)

      const page = await signedInAs(browser, customer.userId)
      for (const [i, swapTo] of [backOffice, hidden, archived].entries()) {
        await postTicketFormBlock(seeded.conversationId, people.people.admin.principalId)
        await openRequesterThread(page, seeded.conversationId)
        // The form only offers the default type; send another type's id in its place.
        await page.route('**/_serverFn/**', async (route) => {
          const body = route.request().postData()
          if (body?.includes(offeredId)) {
            await route.continue({ postData: body.split(offeredId).join(swapTo) })
          } else {
            await route.continue()
          }
        })
        const title = `Refused ${i} ${marker}`
        await page.getByLabel('Subject').last().fill(title)
        await page.getByRole('button', { name: 'Create ticket' }).last().click()
        await expect(
          page.getByText('That ticket type is not available. Pick one of the offered types.')
        ).toBeVisible()
        await page.unroute('**/_serverFn/**')
        const [{ n }] = await supportDb()<{ n: number }[]>`
          SELECT count(*)::int AS n FROM tickets WHERE title = ${title}`
        expect(n).toBe(0)
      }
      await api.dispose()
    }
  )
})

test.describe('requester watching', () => {
  test(
    'TKT-55 a requester who stops watching gets no resolved email until they reply',
    { tag: '@nightly' },
    async ({ playwright, baseURL, browser, request, people, marker, customerEmail }) => {
      test.setTimeout(120_000)
      const api = await ticketApi(playwright, baseURL)
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Quiet please ${marker}`
      )
      await addWatcherRow(ticket.id, people.people.agentB.principalId)
      const customerUuid = principalUuid(customer.principalId)
      const page = await signedInAs(browser, customer.userId)
      await openRequesterThread(page, conversationId)
      const stop = page.getByRole('button', { name: 'Stop watching' })
      await expect(stop).toBeVisible()
      await stop.click()
      await expect(page.getByRole('button', { name: 'Watch this ticket' })).toBeVisible()
      await expect
        .poll(async () => (await ticketWatchers(ticket.id)).map((w) => w.principal_id))
        .not.toContain(customerUuid)

      const resolved = `Your ticket ${ticket.reference} was resolved`
      await setStatus(api, ticket.id, 'Resolved')
      // The same event reaches the watching teammate; the requester gets nothing.
      await waitForMail({ to: people.people.agentB.email, subject: resolved })
      await new Promise((r) => setTimeout(r, 1_500))
      expect(
        (await emailLogFor(customerEmail)).filter((r) => (r.subject ?? '') === resolved)
      ).toEqual([])
      expect(
        (await ticketBells(customer.principalId, ticket.id)).filter(
          (b) => b.type === 'ticket_status_changed'
        )
      ).toEqual([])

      // An email reply re-subscribes them (and reopens the ticket).
      const res = await sendInboundEmail(request, {
        from: customerEmail,
        to: ticketReplyAddress(ticket.id),
        subject: `Re: ${ticket.title}`,
        text: `Actually it is back ${marker}`,
      })
      expect(res.status(), await res.text()).toBe(200)
      await expect
        .poll(async () => await ticketWatchers(ticket.id))
        .toContainEqual(
          expect.objectContaining({ principal_id: customerUuid, reason: 'requester' })
        )
      await waitForTicket(ticket.id, 'reopened', (r) => r.status_category === 'open')
      await setStatus(api, ticket.id, 'Resolved')
      await waitForMail({ to: customerEmail, subject: resolved })
      await api.dispose()
    }
  )
})

test.describe('the ticket embed card', () => {
  test(
    'TKT-65 a ticket card shows its stage to the requester and is unavailable to another visitor',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Product bug: generateContentHTML emits a quackbackEmbed placeholder only for post and changelog (lib/shared/content-html.ts:222), so a ticket card (shareTicket) renders nothing in a thread. See QUARANTINE.md.',
      },
    },
    async ({ playwright, baseURL, browser, people, marker, customerEmail }) => {
      test.setTimeout(90_000)
      const api = await ticketApi(playwright, baseURL)
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Embedded ${marker}`
      )
      // The assistant drops a ticket card into the requester's own thread
      // and, for the control, into another visitor's thread.
      const otherEmail = `${marker}-other@customers.example`
      const other = await createCustomer(api, otherEmail)
      const otherThread = seedConversation(`Other ${marker}`, otherEmail)
      await postTicketEmbed(conversationId, people.people.admin.principalId, ticket.id)
      await postTicketEmbed(otherThread.conversationId, people.people.admin.principalId, ticket.id)

      const owner = await signedInAs(browser, customer.userId)
      await openRequesterThread(owner, conversationId)
      const card = owner.locator('[data-quackback-embed]')
      await expect(card.getByText(ticket.reference).first()).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('Received').first()).toBeVisible()
      // Only the stage, never the internal status name.
      await expect(card.getByText('New', { exact: true })).toHaveCount(0)

      const stranger = await signedInAs(browser, other.userId)
      await openRequesterThread(stranger, otherThread.conversationId)
      await expect(stranger.getByText('This ticket is unavailable')).toBeVisible({
        timeout: 15_000,
      })
      await expect(stranger.getByText(ticket.title)).toHaveCount(0)
      await api.dispose()
    }
  )
})

test.describe('ticket forms are accessible', () => {
  test(
    'TKT-73 form fields are found by their labels; required ones say so and the asterisk is hidden',
    { tag: '@nightly' },
    async ({ playwright, baseURL, browser, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(90_000)
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const seeded = seedConversation(`Labels ${marker}`, customerEmail)
      await postTicketFormBlock(seeded.conversationId, people.people.admin.principalId)

      // The chat form block.
      const page = await signedInAs(browser, customer.userId)
      await openRequesterThread(page, seeded.conversationId)
      const subject = page.getByLabel('Subject')
      await expect(subject).toHaveAttribute('aria-required', 'true')
      await expect(page.getByRole('textbox', { name: 'Subject' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Details' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
      await page.locator('label', { hasText: 'Details' }).click()
      await expect(page.getByLabel('Details')).toBeFocused()
      await page.locator('label', { hasText: 'Subject' }).click()
      await expect(subject).toBeFocused()
      await expect(
        page.locator('label', { hasText: 'Subject' }).locator('[aria-hidden]')
      ).toHaveText('*')

      // The team's dialog, with a type of our own carrying custom fields.
      const typeName = `Labelled ${marker.slice(-12)}`
      await createTicketTypeRow({
        name: typeName,
        category: 'back_office',
        fields: [
          {
            key: 'order_ref',
            label: 'Order reference',
            type: 'text',
            required: true,
            visibleToCustomer: true,
          },
          {
            key: 'notes_x',
            label: 'Internal notes',
            type: 'long_text',
            required: false,
            visibleToCustomer: false,
          },
        ],
      })
      const admin = await asPerson('admin')
      await admin.goto('/admin')
      const dialog = admin.getByRole('dialog')
      const item = admin.getByRole('menuitem', { name: 'New ticket' })
      await clickUntilVisible(admin.getByRole('button', { name: 'Actions', exact: true }), item)
      await clickUntilVisible(item, dialog)
      await dialog.getByRole('combobox').first().click()
      await admin.getByRole('option', { name: new RegExp(`^${typeName}\\b`) }).click()
      const order = dialog.getByLabel('Order reference')
      await expect(order).toHaveAttribute('aria-required', 'true')
      await expect(dialog.getByLabel('Internal notes')).not.toHaveAttribute('aria-required', 'true')
      await dialog.locator('label', { hasText: 'Order reference' }).click()
      await expect(order).toBeFocused()
      await expect(
        dialog.locator('label', { hasText: 'Order reference' }).locator('[aria-hidden]')
      ).toHaveText('*')
      await api.dispose()
    }
  )
})
