/**
 * Creating tickets (area TKT): from the inbox, from a conversation, through
 * the REST API, and the refusals and field rules on the way in.
 */
import type { Page } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { FAKE_AI_FAIL, fakeAi } from '../../support/fake-ai-client'
import { emailLogFor, waitForMail } from '../../support/mailpit'
import {
  clickUntilVisible,
  conversationMessages,
  createCustomer,
  createTicket,
  createTicketTypeRow,
  ticketActivity,
  openInInbox,
  openRequesterThread,
  pairedConversationId,
  principalUuid,
  signedInAs,
  ticketApi,
  ticketOwnMessages,
  ticketRow,
  ticketWatchers,
} from '../../support/tickets'
import { seedConversation } from '../../utils/db-helpers'

test.use({ viewport: { width: 1920, height: 1080 } })

/** Open the Create ticket dialog on a conversation, pick a type, set the title and submit. */
async function createFromConversation(
  page: Page,
  conversationId: string,
  opts: { typeName?: string; title: string; firstMessage: string }
): Promise<void> {
  await openInInbox(page, conversationId, opts.firstMessage)
  const dialog = page.getByRole('dialog')
  await clickUntilVisible(page.getByRole('button', { name: 'Create ticket' }).first(), dialog)
  await expect(dialog.getByRole('heading', { name: 'Create ticket' })).toBeVisible()
  if (opts.typeName) {
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: new RegExp(`^${opts.typeName}\\b`) }).click()
  }
  await dialog.getByPlaceholder('Summarize the request…').fill(opts.title)
  await dialog.getByRole('button', { name: 'Create ticket' }).click()
}

/** The ticket linked to a conversation by `ticketType`, with its reference. */
async function linkedTicket(conversationId: string, ticketType: 'customer' | 'back_office') {
  const [row] = await supportDb()<{ id: string; number: number; title: string }[]>`
    SELECT t.id, t.number, t.title FROM ticket_conversations tc JOIN tickets t ON t.id = tc.ticket_id
    WHERE tc.conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
      AND tc.ticket_type = ${ticketType}`
  return row ?? null
}

function waitLinked(conversationId: string, ticketType: 'customer' | 'back_office') {
  return pollFor(`${ticketType} ticket linked to ${conversationId}`, () =>
    linkedTicket(conversationId, ticketType)
  )
}

test.describe('create a ticket from a conversation', () => {
  test(
    'INB-81 a customer ticket posts a public notice and a header card; a back-office one an internal note',
    { tag: '@core' },
    async ({ playwright, baseURL, browser, asPerson, marker, customerEmail }) => {
      test.setTimeout(90_000)
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const seeded = seedConversation(`Convert ${marker}`, customerEmail)
      const admin = await asPerson('admin')

      await createFromConversation(admin, seeded.conversationId, {
        typeName: 'Back-office',
        title: `Internal follow-up ${marker}`,
        firstMessage: seeded.messages[0],
      })
      await expect(admin.getByText('Ticket created')).toBeVisible()
      const internal = await waitLinked(seeded.conversationId, 'back_office')
      const internalNotice = `Internal ticket #${internal.number} opened from this conversation`
      await expect
        .poll(async () =>
          (await conversationMessages(seeded.conversationId)).find((m) =>
            m.content.includes(internalNotice)
          )
        )
        .toMatchObject({ is_internal: true })

      const title = `Customer follow-up ${marker}`
      await createFromConversation(admin, seeded.conversationId, {
        title,
        firstMessage: seeded.messages[0],
      })
      await expect(admin.getByText('Ticket created').first()).toBeVisible()
      const paired = await waitLinked(seeded.conversationId, 'customer')
      const publicNotice = `Ticket #${paired.number} created from this conversation`
      await expect
        .poll(async () =>
          (await conversationMessages(seeded.conversationId)).find((m) =>
            m.content.includes(publicNotice)
          )
        )
        .toMatchObject({ is_internal: false })

      // The visitor sees the public notice and the ticket header card, never the internal one.
      const visitor = await signedInAs(browser, customer.userId)
      await openRequesterThread(visitor, seeded.conversationId)
      await expect(visitor.getByText(title)).toBeVisible()
      await expect(visitor.getByRole('list', { name: 'Ticket progress' })).toBeVisible()
      await expect(visitor.getByText(publicNotice)).toBeVisible()
      await expect(visitor.getByText(internalNotice)).toHaveCount(0)
    }
  )

  test(
    'TKT-05 a customer ticket from a conversation pairs with it and inherits its assignee',
    { tag: '@core' },
    async ({ playwright, baseURL, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const seeded = seedConversation(`Pair ${marker}`, customerEmail)
      const assigned = await api.post(`/api/v1/conversations/${seeded.conversationId}/assign`, {
        data: { assigneePrincipalId: people.people.agentB.principalId },
      })
      expect(assigned.ok(), await assigned.text()).toBe(true)

      const admin = await asPerson('admin')
      await createFromConversation(admin, seeded.conversationId, {
        title: `Paired ${marker}`,
        firstMessage: seeded.messages[0],
      })
      await expect(admin.getByText('Ticket created')).toBeVisible()
      const paired = await waitLinked(seeded.conversationId, 'customer')
      const ticketId = fromUuid('ticket', paired.id)
      const row = (await ticketRow(ticketId))!
      expect(row.type).toBe('customer')
      expect(row.assignee_principal_id).toBe(principalUuid(people.people.agentB.principalId))
      // The ticket's requester is the conversation's visitor, and no second
      // (backing) conversation was minted.
      const [ticket] = await supportDb()<{ requester_principal_id: string }[]>`
        SELECT requester_principal_id FROM tickets WHERE id = ${paired.id}`
      expect(ticket.requester_principal_id).toBe(principalUuid(customer.principalId))
      expect(await pairedConversationId(ticketId)).toBe(seeded.conversationId)
    }
  )

  test(
    'TKT-06 a back-office ticket from a conversation records provenance and no first response',
    { tag: '@nightly' },
    async ({ asPerson, marker }) => {
      test.setTimeout(60_000)
      const seeded = seedConversation(`Provenance ${marker}`)
      const admin = await asPerson('admin')
      await createFromConversation(admin, seeded.conversationId, {
        typeName: 'Back-office',
        title: `Provenance ${marker}`,
        firstMessage: seeded.messages[0],
      })
      await expect(admin.getByText('Ticket created')).toBeVisible()
      const ticket = await waitLinked(seeded.conversationId, 'back_office')
      const row = (await ticketRow(fromUuid('ticket', ticket.id)))!
      expect(row.type).toBe('back_office')
      expect(row.first_response_at).toBeNull()
      expect(await linkedTicket(seeded.conversationId, 'customer')).toBeNull()
    }
  )

  test(
    'TKT-07 a second customer ticket for a paired conversation is refused and not created',
    { tag: '@core' },
    async ({ playwright, baseURL, asPerson, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      await createCustomer(api, customerEmail)
      const seeded = seedConversation(`Twice ${marker}`, customerEmail)

      // Two teammates open Create ticket on the same conversation; once it is
      // paired the button is gone, so the race is the only way to a second.
      const admin = await asPerson('admin')
      await openInInbox(admin, seeded.conversationId, seeded.messages[0])
      const dialog = admin.getByRole('dialog')
      await clickUntilVisible(admin.getByRole('button', { name: 'Create ticket' }).first(), dialog)
      const second = `Second ${marker}`
      await dialog.getByPlaceholder('Summarize the request…').fill(second)

      const agentB = await asPerson('agentB')
      await createFromConversation(agentB, seeded.conversationId, {
        title: `First ${marker}`,
        firstMessage: seeded.messages[0],
      })
      await waitLinked(seeded.conversationId, 'customer')

      await dialog.getByRole('button', { name: 'Create ticket' }).click()
      await expect(admin.getByText('This conversation already has a linked ticket')).toBeVisible()
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM tickets WHERE title = ${second} AND deleted_at IS NULL`
      expect(n, 'the refused ticket is never created').toBe(0)
    }
  )
})

test.describe('create a ticket through the API', () => {
  test(
    'TKT-03 a customer ticket for a requester gets a backing conversation, watchers and a received email',
    { tag: '@smoke' },
    async ({ playwright, baseURL, people, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const opening = `Opening details ${marker}`
      const ticket = await createTicket(api, {
        title: `Broken export ${marker}`,
        requesterPrincipalId: customer.principalId,
        description: opening,
      })
      expect(ticket.type).toBe('customer')
      expect(ticket.firstResponseAt).toBeNull()

      const conversationId = await pairedConversationId(ticket.id)
      expect(conversationId, 'a backing conversation is paired').not.toBeNull()
      const [conversation] = await supportDb()<
        { channel: string; source: string; status: string; visitor_principal_id: string }[]
      >`
        SELECT channel, source, status, visitor_principal_id FROM conversations
        WHERE id = ${toUuid(conversationId as `conversation_${string}`)}`
      expect(conversation).toEqual({
        channel: 'messenger',
        source: 'ticket_form',
        status: 'open',
        visitor_principal_id: principalUuid(customer.principalId),
      })
      // The opening message lands on the conversation, written by the team.
      const messages = await conversationMessages(conversationId!)
      expect(messages.find((m) => m.content.includes(opening))).toMatchObject({
        sender_type: 'agent',
        is_internal: false,
      })
      expect(await ticketOwnMessages(ticket.id)).toEqual([])

      const watchers = await ticketWatchers(ticket.id)
      expect(watchers).toContainEqual(
        expect.objectContaining({
          principal_id: principalUuid(customer.principalId),
          reason: 'requester',
        })
      )
      expect(watchers).toContainEqual(
        expect.objectContaining({
          principal_id: principalUuid(people.people.admin.principalId),
          reason: 'assignee',
        })
      )

      await waitForMail({
        to: customerEmail,
        subject: `We received your ticket ${ticket.reference}: ${ticket.title}`,
      })
    }
  )

  test(
    'TKT-03 the requester gets one email on create, not also a reply email echoing the opening note',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'The opening note also goes out as a conversation reply email (ticket-intake.service.ts:347)',
      },
    },
    async ({ playwright, baseURL, marker, customerEmail }) => {
      // Quarantined: the opening message runs the full conversation write
      // pipeline (ticket-intake.service.ts:347), so the requester also gets a
      // ConversationMessageEmail "Re: <opening note>" (see QUARANTINE.md).
      const api = await ticketApi(playwright, baseURL)
      const customer = await createCustomer(api, customerEmail)
      const opening = `One email ${marker}`
      const ticket = await createTicket(api, {
        title: `One mail ${marker}`,
        requesterPrincipalId: customer.principalId,
        description: opening,
      })
      await waitForMail({
        to: customerEmail,
        subject: `We received your ticket ${ticket.reference}: ${ticket.title}`,
      })
      await new Promise((r) => setTimeout(r, 3_000))
      const sent = (await emailLogFor(customerEmail)).filter((r) => r.direction === 'outbound')
      expect(sent.map((r) => r.email_type)).toEqual(['TicketEventEmail'])
    }
  )

  test(
    'TKT-04 a customer ticket without a requester stays standalone',
    { tag: '@nightly' },
    async ({ playwright, baseURL, marker }) => {
      const api = await ticketApi(playwright, baseURL)
      const opening = `No requester ${marker}`
      const ticket = await createTicket(api, {
        title: `Standalone ${marker}`,
        type: 'customer',
        description: opening,
      })
      expect(ticket.type).toBe('customer')
      expect(ticket.requesterPrincipalId).toBeNull()
      expect(await pairedConversationId(ticket.id)).toBeNull()
      expect(await ticketOwnMessages(ticket.id)).toEqual([
        expect.objectContaining({ content: opening, sender_type: 'agent' }),
      ])
    }
  )

  test(
    'TKT-11 a teammate without ticket.create is refused',
    { tag: '@core' },
    async ({ playwright, baseURL, marker }) => {
      const title = `Refused ${marker}`
      for (const person of ['contributor', 'noAccess'] as const) {
        const api = await ticketApi(playwright, baseURL, person)
        const res = await api.post('/api/v1/tickets', { data: { title, type: 'back_office' } })
        expect(res.status(), person).toBe(403)
        await api.dispose()
      }
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM tickets WHERE title = ${title}`
      expect(n).toBe(0)
      // Control: the admin's key may create it.
      const admin = await ticketApi(playwright, baseURL)
      const ok = await admin.post('/api/v1/tickets', { data: { title, type: 'back_office' } })
      expect(ok.status()).toBe(201)
    }
  )
})

test.describe('the New ticket dialog', () => {
  /** Open New ticket from the admin home. */
  async function openNewTicket(page: Page) {
    await page.goto('/admin')
    const dialog = page.getByRole('dialog')
    const item = page.getByRole('menuitem', { name: 'New ticket' })
    await clickUntilVisible(page.getByRole('button', { name: 'Actions', exact: true }), item)
    await clickUntilVisible(item, dialog)
    await expect(dialog.getByRole('heading', { name: 'New ticket' })).toBeVisible()
    return dialog
  }

  async function pickType(page: Page, dialog: ReturnType<Page['getByRole']>, name: string) {
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: new RegExp(`^${name}\\b`) }).click()
  }

  test(
    'TKT-01 a back-office ticket with no requester is created with the default status',
    { tag: '@core' },
    async ({ asPerson, people, marker }) => {
      const admin = await asPerson('admin')
      const dialog = await openNewTicket(admin)
      await expect(
        dialog.getByText('Open a trackable request and set who it is for.')
      ).toBeVisible()
      await expect(dialog.getByText('Requester (optional)')).toBeVisible()
      await pickType(admin, dialog, 'Back-office')
      const title = `Refund ledger fix ${marker}`
      await dialog.getByPlaceholder('Summarize the request…').fill(title)
      await dialog.getByRole('button', { name: 'Create ticket' }).click()
      await expect(admin.getByText('Ticket created')).toBeVisible()

      const [row] = await supportDb()<
        { id: string }[]
      >`SELECT id FROM tickets WHERE title = ${title}`
      const ticketId = fromUuid('ticket', row.id)
      expect(await ticketRow(ticketId)).toMatchObject({
        type: 'back_office',
        status_name: 'New',
        priority: 'none',
        assignee_principal_id: principalUuid(people.people.admin.principalId),
      })
      expect(await pairedConversationId(ticketId)).toBeNull()
      await expect
        .poll(async () => (await ticketActivity(ticketId)).map((a) => a.type))
        .toContain('ticket.created')

      // It is listed under the inbox's Back office view.
      await admin.goto('/admin/inbox?view=tickets_back_office')
      await expect(admin.getByText(title).first()).toBeVisible({ timeout: 15_000 })
    }
  )

  test(
    'TKT-13 a required custom field blocks create until it is filled',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const typeName = `Order issue ${marker.slice(-12)}`
      await createTicketTypeRow({
        name: typeName,
        category: 'back_office',
        fields: [
          {
            key: 'order_id',
            label: 'Order ID',
            type: 'text',
            required: true,
            visibleToCustomer: true,
          },
        ],
      })
      const admin = await asPerson('admin')
      const dialog = await openNewTicket(admin)
      await pickType(admin, dialog, typeName)
      const title = `Missing order ${marker}`
      await dialog.getByPlaceholder('Summarize the request…').fill(title)
      await dialog.getByRole('button', { name: 'Create ticket' }).click()
      await expect(dialog.getByText('Order ID is required')).toBeVisible()
      const count = async () =>
        (
          await supportDb()<
            { n: number }[]
          >`SELECT count(*)::int AS n FROM tickets WHERE title = ${title}`
        )[0].n
      expect(await count()).toBe(0)

      await dialog.getByLabel('Order ID').fill('A-1001')
      await dialog.getByRole('button', { name: 'Create ticket' }).click()
      await expect(admin.getByText('Ticket created')).toBeVisible()
      const [row] = await supportDb()<{ custom_attributes: Record<string, unknown> }[]>`
        SELECT custom_attributes FROM tickets WHERE title = ${title}`
      expect(row.custom_attributes).toMatchObject({ order_id: 'A-1001' })
    }
  )

  test(
    'TKT-14 a teammate fills a customer-hidden field and it is stored',
    { tag: '@nightly' },
    async ({ asPerson, marker }) => {
      const typeName = `Hidden field ${marker.slice(-12)}`
      await createTicketTypeRow({
        name: typeName,
        category: 'back_office',
        fields: [
          {
            key: 'risk',
            label: 'Risk score',
            type: 'text',
            required: false,
            visibleToCustomer: false,
          },
        ],
      })
      const admin = await asPerson('admin')
      const dialog = await openNewTicket(admin)
      await pickType(admin, dialog, typeName)
      const title = `Hidden ${marker}`
      await dialog.getByPlaceholder('Summarize the request…').fill(title)
      await dialog.getByLabel('Risk score').fill('high')
      await dialog.getByRole('button', { name: 'Create ticket' }).click()
      await expect(admin.getByText('Ticket created')).toBeVisible()
      const [row] = await supportDb()<{ custom_attributes: Record<string, unknown> }[]>`
        SELECT custom_attributes FROM tickets WHERE title = ${title}`
      expect(row.custom_attributes).toMatchObject({ risk: 'high' })
    }
  )
})

test.describe('AI field suggestions on create', () => {
  test(
    'TKT-15 Auto-fill fills fields from the model and Undo restores them',
    { tag: '@nightly' },
    async ({ asPerson, marker }) => {
      test.setTimeout(60_000)
      const typeName = `Suggest ${marker.slice(-12)}`
      await createTicketTypeRow({
        name: typeName,
        category: 'back_office',
        fields: [
          {
            key: 'order_id',
            label: 'Order ID',
            type: 'text',
            required: false,
            visibleToCustomer: true,
          },
        ],
      })
      await fakeAi.script({ marker, json: { title: `AI title ${marker}`, order_id: 'B-2002' } })
      const seeded = seedConversation(`Suggest ${marker}`)
      const admin = await asPerson('admin')
      await openInInbox(admin, seeded.conversationId, seeded.messages[0])
      const dialog = admin.getByRole('dialog')
      await clickUntilVisible(admin.getByRole('button', { name: 'Create ticket' }).first(), dialog)
      await dialog.getByRole('combobox').first().click()
      await admin.getByRole('option', { name: new RegExp(`^${typeName}\\b`) }).click()
      const titleBox = dialog.getByPlaceholder('Summarize the request…')
      const before = await titleBox.inputValue()

      await dialog.getByRole('button', { name: '✨ Auto-fill' }).click()
      await expect(titleBox).toHaveValue(`AI title ${marker}`)
      await expect(dialog.getByLabel('Order ID')).toHaveValue('B-2002')
      await expect(dialog.getByText('✨ 2 suggested')).toBeVisible()

      await dialog.getByRole('button', { name: 'Undo suggestions' }).click()
      await expect(titleBox).toHaveValue(before)
      await expect(dialog.getByLabel('Order ID')).toHaveValue('')
      await fakeAi.clear(marker)
    }
  )

  test(
    'TKT-16 when the model fails, Auto-fill says so and create still works',
    { tag: '@nightly' },
    async ({ asPerson, marker }) => {
      test.setTimeout(60_000)
      const seeded = seedConversation(`Suggest fail ${marker} ${FAKE_AI_FAIL}`)
      const admin = await asPerson('admin')
      await openInInbox(admin, seeded.conversationId, seeded.messages[0])
      const dialog = admin.getByRole('dialog')
      await clickUntilVisible(admin.getByRole('button', { name: 'Create ticket' }).first(), dialog)
      await dialog.getByRole('combobox').first().click()
      await admin.getByRole('option', { name: /^Back-office\b/ }).click()
      await dialog.getByRole('button', { name: '✨ Auto-fill' }).click()
      await expect(
        admin.getByText('AI suggestions are unavailable. The form is unchanged.')
      ).toBeVisible({ timeout: 30_000 })

      await dialog.getByPlaceholder('Summarize the request…').fill(`Still works ${marker}`)
      await dialog.getByRole('button', { name: 'Create ticket' }).click()
      await expect(admin.getByText('Ticket created')).toBeVisible()
      await waitLinked(seeded.conversationId, 'back_office')
    }
  )
})
