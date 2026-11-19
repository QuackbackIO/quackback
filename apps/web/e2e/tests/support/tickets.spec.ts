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
  addWatcherRow,
  conversationMessages,
  detailPanel,
  openRequesterThread,
  pairedCustomerTicket,
  principalUuid,
  ticketActivity,
  ticketBells,
  ticketOwnMessages,
  switchComposerToNote,
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

test.describe('tickets: status', () => {
  // The ticket view with its detail panel inline (the panel is xl-only).
  test.use({ viewport: { width: 1920, height: 1080 } })

  test(
    'TKT-23 a stage crossing posts the notice to the requester, logs activity and bells watchers but not the actor',
    { tag: '@core' },
    async ({ playwright, baseURL, browser, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Stage cross ${marker}`
      )
      await addWatcherRow(ticket.id, people.people.agentB.principalId)

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await admin.getByRole('button', { name: 'New', exact: true }).first().click()
      await admin.getByRole('menuitem', { name: 'Investigating In progress' }).click()
      await expect(
        admin.getByRole('button', { name: 'Investigating', exact: true }).first()
      ).toBeVisible()

      const requester = await signedInAs(browser, customer.userId)
      await openRequesterThread(requester, conversationId)
      await expect(requester.getByText('Status updated to In progress')).toBeVisible()

      await expect
        .poll(async () => (await ticketActivity(ticket.id)).map((a) => a.type))
        .toContain('status.changed')
      const change = (await ticketActivity(ticket.id)).find((a) => a.type === 'status.changed')!
      expect(change.metadata).toMatchObject({ fromName: 'New', toName: 'Investigating' })
      expect(change.actor).toBe(principalUuid(people.people.admin.principalId))

      await expect
        .poll(async () =>
          (await ticketBells(people.people.agentB.principalId, ticket.id)).map((b) => b.type)
        )
        .toContain('ticket_status_changed')
      await expect
        .poll(async () => (await ticketBells(customer.principalId, ticket.id)).map((b) => b.type))
        .toContain('ticket_status_changed')
      expect(
        (await ticketBells(people.people.admin.principalId, ticket.id)).map((b) => b.type)
      ).not.toContain('ticket_status_changed')
    }
  )

  test(
    'TKT-25 Resolve closes a customer ticket and emails the requester and watching teammates',
    { tag: '@core' },
    async ({ playwright, baseURL, browser, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Resolve me ${marker}`
      )
      await addWatcherRow(ticket.id, people.people.agentB.principalId)

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await admin.getByRole('button', { name: 'Resolve', exact: true }).click()
      await expect(admin.getByText('Ticket resolved')).toBeVisible()

      const row = await waitForTicket(ticket.id, 'resolved', (r) => !!r.resolved_at)
      expect(row.status_name).toBe('Resolved')
      expect(row.status_category).toBe('closed')

      const subject = `Your ticket ${ticket.reference} was resolved`
      await waitForMail({ to: customerEmail, subject })
      await waitForMail({ to: people.people.agentB.email, subject })

      const requester = await signedInAs(browser, customer.userId)
      await openRequesterThread(requester, conversationId)
      await expect(requester.getByText('Status updated to Resolved')).toBeVisible()
    }
  )

  test(
    'TKT-27 a teammate reopens a closed ticket',
    { tag: '@core' },
    async ({ playwright, baseURL, asPerson, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Reopen ${marker}`)
      await setStatus(api, ticket.id, 'Resolved')
      expect((await ticketRow(ticket.id))!.resolved_at).not.toBeNull()

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await admin.getByRole('button', { name: 'Resolved', exact: true }).first().click()
      await admin.getByRole('menuitem', { name: 'New Received' }).click()

      const row = await waitForTicket(ticket.id, 'reopened', (r) => r.status_name === 'New')
      expect(row.status_category).toBe('open')
      expect(row.resolved_at).toBeNull()
      expect(row.reopened_count).toBe(1)
      const moves = (await ticketActivity(ticket.id)).filter((a) => a.type === 'status.changed')
      expect(moves.at(-1)?.metadata).toMatchObject({ fromName: 'Resolved', toName: 'New' })
    }
  )

  test(
    'TKT-30 an agent message on the paired conversation does not reopen; the requester reply does',
    { tag: '@core' },
    async ({ playwright, baseURL, request, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Awaiting ${marker}`
      )
      await setStatus(api, ticket.id, 'Waiting on customer')

      const reply = await api.post(`/api/v1/conversations/${conversationId}/reply`, {
        data: { content: `Agent nudge ${marker}` },
      })
      expect(reply.ok(), await reply.text()).toBe(true)
      await expect
        .poll(async () =>
          (await conversationMessages(conversationId)).some((m) =>
            m.content.includes(`Agent nudge ${marker}`)
          )
        )
        .toBe(true)
      // The reopen reaction is queued: give it time, then check nothing moved.
      await new Promise((r) => setTimeout(r, 3_000))
      expect((await ticketRow(ticket.id))!.status_name).toBe('Waiting on customer')

      // Control: the requester's own reply does reopen it.
      const inbound = await sendInboundEmail(request, {
        from: customerEmail,
        to: ticketReplyAddress(ticket.id),
        subject: `Re: ${ticket.title}`,
        text: `Here is the info ${marker}`,
      })
      expect(inbound.status(), await inbound.text()).toBe(200)
      const row = await waitForTicket(ticket.id, 'reopen', (r) => r.status_category === 'open')
      expect(row.status_name).toBe('New')
    }
  )
})

test.describe('tickets: assignment, notes and the linked ticket', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test(
    'TKT-33 assigning a teammate makes them a watcher and sends them a bell and an email',
    { tag: '@core' },
    async ({ playwright, baseURL, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Assign ${marker}`)

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      const panel = detailPanel(admin)
      await panel.getByRole('button', { name: /Ada Admin/ }).click()
      await admin.getByRole('menuitem', { name: /Ben Agent/ }).click()
      await expect(panel.getByRole('button', { name: /Ben Agent/ })).toBeVisible()

      const agentB = principalUuid(people.people.agentB.principalId)
      await waitForTicket(ticket.id, 'assignee', (r) => r.assignee_principal_id === agentB)
      expect(await ticketWatchers(ticket.id)).toContainEqual(
        expect.objectContaining({ principal_id: agentB, reason: 'assignee' })
      )
      await expect
        .poll(async () => (await ticketActivity(ticket.id)).map((a) => a.type))
        .toContain('ticket.assigned')
      await expect
        .poll(async () =>
          (await ticketBells(people.people.agentB.principalId, ticket.id)).map((b) => b.type)
        )
        .toContain('ticket_assigned')
      await waitForMail({
        to: people.people.agentB.email,
        subject: `Ticket ${ticket.reference} assigned to you`,
      })
    }
  )

  test(
    'TKT-43 an internal note shows to teammates and never to the requester',
    { tag: '@core' },
    async ({ playwright, baseURL, browser, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const opening = `Visible opening ${marker}`
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Note ${marker}`,
        opening
      )
      await addWatcherRow(ticket.id, people.people.agentB.principalId)

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      const note = `Team only ${marker}`
      await switchComposerToNote(admin)
      await sendFromComposer(admin, note, 'Add note')
      await expect(admin.getByText(note).first()).toBeVisible()

      await expect
        .poll(async () =>
          (await ticketOwnMessages(ticket.id)).find((m) => m.content.includes(note))
        )
        .toMatchObject({ is_internal: true, sender_type: 'agent' })
      await expect
        .poll(async () =>
          (await ticketBells(people.people.agentB.principalId, ticket.id)).map((b) => b.type)
        )
        .toContain('ticket_note_added')
      expect((await ticketBells(customer.principalId, ticket.id)).map((b) => b.type)).not.toContain(
        'ticket_note_added'
      )

      const requester = await signedInAs(browser, customer.userId)
      await openRequesterThread(requester, conversationId)
      await expect(requester.getByText(opening)).toBeVisible()
      await expect(requester.getByText(note)).toHaveCount(0)
    }
  )

  test(
    'TKT-64 the conversation panel shows the linked ticket, or says it cannot be opened',
    { tag: '@core' },
    async ({ playwright, baseURL, asPerson, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Pill ${marker}`
      )

      const admin = await asPerson('admin')
      await openInInbox(admin, conversationId, `Opening note for ${ticket.title}`)
      const panel = detailPanel(admin)
      await expect(panel.getByText('Linked ticket', { exact: true })).toBeVisible()
      // A first click can land before the panel hydrates: retry until it opens.
      await expect(async () => {
        await panel.getByRole('button', { name: ticket.reference, exact: true }).click()
        await expect(admin).toHaveURL(new RegExp(`i=${ticket.id}`), { timeout: 2_000 })
      }).toPass({ timeout: 15_000 })

      // The scoped teammate can open the unassigned conversation but not the
      // ticket, which is assigned to the admin and to no Billing team.
      const scoped = await asPerson('scoped')
      await openInInbox(scoped, conversationId, `Opening note for ${ticket.title}`)
      const scopedPanel = detailPanel(scoped)
      await expect(scopedPanel.getByText("Linked ticket you can't open")).toBeVisible()
      await expect(scopedPanel.getByRole('button', { name: ticket.reference })).toHaveCount(0)
    }
  )
})
