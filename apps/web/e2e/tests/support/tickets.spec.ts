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
  clickUntilVisible,
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
import type { Page } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { seedConversation } from '../../utils/db-helpers'
import { sink } from '../../support/webhook-sink-client'

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

test.describe('tickets: settings', () => {
  /** The type options the Create ticket dialog offers on a conversation. */
  async function createPickerOptions(page: Page, conversationId: string): Promise<string[]> {
    await page.goto(`/admin/inbox?i=${conversationId}`)
    const dialog = page.getByRole('dialog')
    await clickUntilVisible(page.getByRole('button', { name: 'Create ticket' }).first(), dialog)
    await dialog.getByRole('combobox').first().click()
    const options = await page.getByRole('option').allInnerTexts()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    return options
  }

  test(
    'TKT-20 an admin creates, edits, archives and restores a ticket type',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      test.setTimeout(90_000)
      const name = `Kind ${marker}`
      const renamed = `${name} v2`
      const conversation = seedConversation(`Type picker ${marker}`)
      const admin = await asPerson('admin')
      await admin.goto('/admin/settings/ticket-types')

      const editor = admin.getByRole('dialog')
      await clickUntilVisible(admin.getByRole('button', { name: 'New type' }), editor)
      await editor.getByLabel('Name').fill(name)
      await editor.getByRole('button', { name: 'Create type' }).click()
      await expect(admin.getByText(`Created "${name}"`)).toBeVisible()

      await admin.getByRole('button', { name: `Actions for ${name}` }).click()
      await admin.getByRole('menuitem', { name: 'Edit' }).click()
      await editor.getByLabel('Name').fill(renamed)
      await editor.getByRole('button', { name: 'Save changes' }).click()
      await expect(admin.getByText(`Saved "${renamed}"`)).toBeVisible()
      expect((await createPickerOptions(admin, conversation.conversationId)).join('\n')).toContain(
        renamed
      )

      await admin.goto('/admin/settings/ticket-types')
      await admin.getByRole('button', { name: `Actions for ${renamed}` }).click()
      await admin.getByRole('menuitem', { name: 'Archive' }).click()
      await admin.getByRole('button', { name: 'Archive type' }).click()
      await expect(admin.getByText(`Archived "${renamed}"`)).toBeVisible()
      expect(
        (await createPickerOptions(admin, conversation.conversationId)).join('\n')
      ).not.toContain(renamed)

      await admin.goto('/admin/settings/ticket-types')
      await admin.getByRole('button', { name: `Actions for ${renamed}` }).click()
      await admin.getByRole('menuitem', { name: 'Restore' }).click()
      await expect(admin.getByText(`Restored "${renamed}"`)).toBeVisible()
      expect((await createPickerOptions(admin, conversation.conversationId)).join('\n')).toContain(
        renamed
      )
    }
  )
})

test.describe('tickets: more status, assignment and priority', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test(
    'TKT-24 a move within the same stage logs activity but posts no notice and no bell',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, people, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Same stage ${marker}`
      )
      await addWatcherRow(ticket.id, people.people.agentB.principalId)
      await setStatus(api, ticket.id, 'Investigating')
      const notices = async () =>
        (await conversationMessages(conversationId)).filter((m) =>
          m.content.startsWith('Status updated')
        ).length
      const bells = async () =>
        (await ticketBells(people.people.agentB.principalId, ticket.id)).filter(
          (b) => b.type === 'ticket_status_changed'
        ).length
      await expect.poll(bells).toBe(1)
      expect(await notices()).toBe(1)

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await admin.getByRole('button', { name: 'Investigating', exact: true }).first().click()
      await admin.getByRole('menuitem', { name: 'Escalated In progress' }).click()
      await expect
        .poll(async () =>
          (await ticketActivity(ticket.id))
            .filter((a) => a.type === 'status.changed')
            .map((a) => a.metadata.toName)
        )
        .toEqual(['Investigating', 'Escalated'])
      await new Promise((r) => setTimeout(r, 2_000))
      expect(await notices()).toBe(1)
      expect(await bells()).toBe(1)
    }
  )

  test(
    'TKT-26 closing with a hidden-stage status says "closed", never the internal name',
    { tag: '@nightly' },
    async ({ playwright, baseURL, browser, asPerson, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { customer, ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Wont do ${marker}`
      )
      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await admin.getByRole('button', { name: 'New', exact: true }).first().click()
      await admin.getByRole('menuitem', { name: "Won't do" }).click()

      const row = await waitForTicket(ticket.id, 'closed', (r) => r.status_category === 'closed')
      expect(row.status_name).toBe("Won't do")
      const mail = await waitForMail({
        to: customerEmail,
        subject: `Your ticket ${ticket.reference} was closed`,
      })
      expect(mail.Text).not.toContain("Won't do")

      const requester = await signedInAs(browser, customer.userId)
      await openRequesterThread(requester, conversationId)
      await expect(requester.getByText('Ticket closed')).toBeVisible()
      await expect(requester.getByText("Won't do")).toHaveCount(0)
    }
  )

  test(
    'TKT-31 ticket and conversation status stay independent',
    { tag: '@nightly' },
    async ({ playwright, baseURL, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Independent ${marker}`
      )
      const conversationStatus = async () => {
        const res = await api.get(`/api/v1/conversations/${conversationId}`)
        return ((await res.json()) as { data: { status: string } }).data.status
      }
      await setStatus(api, ticket.id, 'Resolved')
      expect(await conversationStatus()).toBe('open')

      await setStatus(api, ticket.id, 'Investigating')
      const closed = await api.post(`/api/v1/conversations/${conversationId}/status`, {
        data: { status: 'closed' },
      })
      expect(closed.ok(), await closed.text()).toBe(true)
      expect(await conversationStatus()).toBe('closed')
      await new Promise((r) => setTimeout(r, 2_000))
      expect((await ticketRow(ticket.id))!.status_name).toBe('Investigating')
    }
  )

  test(
    'TKT-34 assigning a team bells and emails its members, not the actor',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Team ${marker}`)
      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      const panel = detailPanel(admin)
      await panel.getByRole('button', { name: /Ada Admin/ }).click()
      await admin.getByRole('menuitem', { name: 'E2E Billing' }).click()

      const billing = toUuid(people.teams.billing as `team_${string}`)
      await waitForTicket(ticket.id, 'team', (r) => r.assignee_team_id === billing)
      await expect
        .poll(async () =>
          (await ticketActivity(ticket.id))
            .filter((a) => a.type === 'ticket.assigned')
            .map((a) => a.metadata.toTeamName)
        )
        .toContain('E2E Billing')
      // Billing members who can see tickets get a bell; the contributor (no
      // ticket permission) and the acting admin (also in Billing) do not.
      await expect
        .poll(async () =>
          (await ticketBells(people.people.scoped.principalId, ticket.id)).map((b) => b.type)
        )
        .toContain('ticket_assigned')
      expect(
        (await ticketBells(people.people.contributor.principalId, ticket.id)).map((b) => b.type)
      ).not.toContain('ticket_assigned')
      await waitForMail({
        to: people.people.scoped.email,
        subject: `Ticket ${ticket.reference} assigned to your team`,
      })
      expect(
        (await ticketBells(people.people.admin.principalId, ticket.id)).map((b) => b.type)
      ).not.toContain('ticket_assigned')
    }
  )

  test(
    'TKT-35 unassign and clear team set null; a repeat assignment records nothing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Unassign ${marker}`)
      const assign = (data: Record<string, string | null>) =>
        api.post(`/api/v1/tickets/${ticket.id}/assign`, { data })
      const assigned = async () =>
        (await ticketActivity(ticket.id)).filter((a) => a.type === 'ticket.assigned').length

      expect((await assign({ assigneeTeamId: people.teams.support })).ok()).toBe(true)
      await expect.poll(assigned).toBe(1)
      // The same values again: no activity.
      const same = await assign({
        assigneePrincipalId: people.people.admin.principalId,
        assigneeTeamId: people.teams.support,
      })
      expect(same.ok()).toBe(true)
      await new Promise((r) => setTimeout(r, 1_000))
      expect(await assigned()).toBe(1)

      expect((await assign({ assigneePrincipalId: null, assigneeTeamId: null })).ok()).toBe(true)
      await waitForTicket(
        ticket.id,
        'cleared',
        (r) => r.assignee_principal_id === null && r.assignee_team_id === null
      )
      await expect.poll(assigned).toBe(2)

      // A customer is not a teammate.
      const bad = await assign({ assigneePrincipalId: people.people.customer.principalId })
      expect(bad.status()).toBe(400)
      expect(await bad.text()).toContain('Can only assign to a team member')
    }
  )

  test(
    'TKT-36 setting priority shows on the ticket and logs the change',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Priority ${marker}`)
      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      const panel = detailPanel(admin)
      await panel.getByRole('button', { name: 'Priority' }).click()
      await admin.getByRole('menuitem', { name: /High/ }).click()
      await expect(panel.getByRole('button', { name: 'High' })).toBeVisible()
      await waitForTicket(ticket.id, 'priority', (r) => r.priority === 'high')
      await expect
        .poll(async () =>
          (await ticketActivity(ticket.id))
            .filter((a) => a.type === 'priority.changed')
            .map((a) => a.metadata)
        )
        .toEqual([expect.objectContaining({ from: 'none', to: 'high' })])
    }
  )

  test(
    'TKT-69 the activity timeline lists status and assignment changes, newest first',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, people, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Timeline ${marker}`)
      await setStatus(api, ticket.id, 'Investigating')
      const assign = await api.post(`/api/v1/tickets/${ticket.id}/assign`, {
        data: { assigneePrincipalId: people.people.agentB.principalId },
      })
      expect(assign.ok()).toBe(true)

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      const panel = detailPanel(admin)
      await panel.getByRole('button', { name: 'Activity' }).click()
      const timeline = admin.getByText(/created this ticket|changed status|assigned Ben Agent/)
      await expect(timeline).toHaveCount(3)
      await expect(timeline.nth(0)).toContainText('assigned Ben Agent')
      await expect(timeline.nth(1)).toContainText('changed status')
      await expect(timeline.nth(2)).toContainText('created this ticket')
    }
  )
})

test.describe('tickets: replies, refusals and watchers', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test(
    'TKT-40 a reply on a back-office ticket stays on the ticket and sets no first response',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, marker }) => {
      const api = await ticketApi(playwright, baseURL)
      const ticket = await createTicket(api, { title: `Ledger ${marker}`, type: 'back_office' })
      // The inbox composer on a back-office ticket offers notes only, so the
      // reply goes through the REST reply route.
      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      await expect(admin.getByRole('button', { name: 'Add note' })).toBeVisible()
      await expect(admin.getByRole('button', { name: 'Send reply' })).toHaveCount(0)
      const text = `Back office reply ${marker}`
      await replyToTicket(api, ticket.id, text)
      await expect(admin.getByText(text).first()).toBeVisible()
      await expect
        .poll(async () => (await ticketOwnMessages(ticket.id)).map((m) => m.content))
        .toContain(text)
      expect(await pairedConversationId(ticket.id)).toBeNull()
      await new Promise((r) => setTimeout(r, 1_000))
      expect((await ticketRow(ticket.id))!.first_response_at).toBeNull()
    }
  )

  test(
    'TKT-42 a role without ticket.reply is refused and empty content is invalid',
    { tag: '@nightly' },
    async ({ playwright, baseURL, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const { ticket, conversationId } = await pairedCustomerTicket(
        api,
        customerEmail,
        `Refuse ${marker}`
      )
      const empty = await api.post(`/api/v1/tickets/${ticket.id}/reply`, { data: { content: '' } })
      expect(empty.status()).toBe(400)

      const noAccess = await ticketApi(playwright, baseURL, 'noAccess')
      const refused = await noAccess.post(`/api/v1/tickets/${ticket.id}/reply`, {
        data: { content: `Not allowed ${marker}` },
      })
      expect(refused.status()).toBe(403)
      expect(
        (await conversationMessages(conversationId)).some((m) => m.content.includes('Not allowed'))
      ).toBe(false)
      await noAccess.dispose()
    }
  )

  test(
    'TKT-53 a teammate watches, mutes and unwatches a ticket',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, people, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Watch ${marker}`)
      const agentB = principalUuid(people.people.agentB.principalId)
      const mine = async () =>
        (await ticketWatchers(ticket.id)).find((w) => w.principal_id === agentB) ?? null

      const page = await asPerson('agentB')
      await openInInbox(page, ticket.id, ticket.title)
      const panel = detailPanel(page)
      await clickUntilVisible(
        panel.getByRole('button', { name: 'Watch', exact: true }),
        page.getByRole('menuitem', { name: 'Watch' })
      )
      await page.getByRole('menuitem', { name: 'Watch' }).click()
      await expect(panel.getByRole('button', { name: 'Watching' })).toBeVisible()
      await expect.poll(mine).toMatchObject({ reason: 'manual', muted_until: null })

      await panel.getByRole('button', { name: 'Watching' }).click()
      await page.getByRole('menuitem', { name: 'Mute for a week' }).click()
      await expect(panel.getByRole('button', { name: 'Muted' })).toBeVisible()
      await expect.poll(async () => (await mine())?.muted_until ?? null).not.toBeNull()

      // Muted: a status change sends no bell.
      await setStatus(api, ticket.id, 'Investigating')
      await new Promise((r) => setTimeout(r, 2_000))
      expect(
        (await ticketBells(people.people.agentB.principalId, ticket.id)).map((b) => b.type)
      ).not.toContain('ticket_status_changed')

      await panel.getByRole('button', { name: 'Muted' }).click()
      await page.getByRole('menuitem', { name: 'Unwatch' }).click()
      await expect(panel.getByRole('button', { name: 'Watch', exact: true })).toBeVisible()
      await expect.poll(mine).toBeNull()
    }
  )

  test(
    'TKT-54 an admin adds and removes a watcher',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, people, marker }) => {
      const api = await ticketApi(playwright, baseURL)
      const ticket = await createTicket(api, { title: `Watchers ${marker}`, type: 'back_office' })
      const agentB = principalUuid(people.people.agentB.principalId)
      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      const panel = detailPanel(admin)
      const popover = admin.getByRole('dialog')
      await clickUntilVisible(panel.getByRole('button', { name: 'Add watcher' }), popover)
      await popover.getByRole('combobox').click()
      await admin.getByRole('option', { name: /Ben Agent/ }).click()
      await expect
        .poll(async () => (await ticketWatchers(ticket.id)).map((w) => w.principal_id))
        .toContain(agentB)

      // The remove button shows on hover of the watcher's row.
      const row = popover
        .locator('div.group')
        .filter({ has: admin.getByText('Ben Agent', { exact: true }) })
      await row.hover()
      await row.getByRole('button', { name: 'Remove watcher' }).click()
      await expect
        .poll(async () => (await ticketWatchers(ticket.id)).map((w) => w.principal_id))
        .not.toContain(agentB)
    }
  )
})

test.describe('tickets: old links and webhooks', () => {
  test(
    'TKT-72 old /admin/tickets links redirect to the inbox',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, marker }) => {
      const api = await ticketApi(playwright, baseURL)
      const ticket = await createTicket(api, { title: `Old link ${marker}`, type: 'back_office' })
      const admin = await asPerson('admin')
      await admin.goto(`/admin/tickets?t=${ticket.id}`)
      await expect(admin).toHaveURL(new RegExp(`/admin/inbox\\?.*i=${ticket.id}`))
      await expect(admin.getByText(ticket.title).first()).toBeVisible()
      await admin.goto('/admin/tickets')
      await expect(admin).toHaveURL(/\/admin\/inbox\?.*view=tickets_customer/)
    }
  )

  test(
    'TKT-70 signed ticket webhooks reach the sink for create, assign, reply, note and status',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const events = [
        'ticket.created',
        'ticket.assigned',
        'ticket.replied',
        'ticket.note_added',
        'ticket.status_changed',
      ]
      const created = await api.post('/api/v1/webhooks', {
        data: { url: sink.url(marker), events },
      })
      expect(created.status(), await created.text()).toBe(201)
      const { data: webhook } = (await created.json()) as { data: { id: string; secret: string } }
      try {
        const { ticket } = await pairedCustomerTicket(api, customerEmail, `Hooks ${marker}`)
        await api.post(`/api/v1/tickets/${ticket.id}/assign`, {
          data: { assigneePrincipalId: people.people.agentB.principalId },
        })
        await replyToTicket(api, ticket.id, `Hook reply ${marker}`)
        await api.post(`/api/v1/tickets/${ticket.id}/note`, {
          data: { content: `Hook note ${marker}` },
        })
        await setStatus(api, ticket.id, 'Resolved')

        const deliveries = await sink.waitForDeliveries(marker, {
          count: events.length,
          where: (d) => d.body.includes(ticket.id),
        })
        const byEvent = new Map(
          deliveries.map((d) => [d.headers['x-quackback-event'], d.body] as const)
        )
        expect([...byEvent.keys()].sort()).toEqual([...events].sort())
        for (const d of deliveries) {
          const expected = createHmac('sha256', webhook.secret)
            .update(`${d.headers['x-quackback-timestamp']}.${d.body}`)
            .digest('hex')
          expect(d.headers['x-quackback-signature']).toBe(`sha256=${expected}`)
        }
        expect(byEvent.get('ticket.replied')).toContain(`Hook reply ${marker}`)
        expect(byEvent.get('ticket.replied')).toContain('"senderType":"agent"')
        expect(byEvent.get('ticket.note_added')).toContain(`Hook note ${marker}`)
        expect(byEvent.get('ticket.status_changed')).toContain('closed')
      } finally {
        await api.delete(`/api/v1/webhooks/${webhook.id}`)
      }
    }
  )
})
