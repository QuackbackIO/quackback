/**
 * Tracker tickets (area TKT): creating one, linking and unlinking customer
 * tickets, the status cascade and Reply all.
 */
import { fromUuid, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import {
  clickUntilVisible,
  conversationMessages,
  createTicket,
  detailPanel,
  openInInbox,
  pairedCustomerTicket,
  setStatus,
  ticketApi,
  ticketOwnMessages,
  ticketRow,
  waitForTicket,
} from '../../support/tickets'

test.use({ viewport: { width: 1920, height: 1080 } })

const uuid = (ticketId: string) => toUuid(ticketId as `ticket_${string}`)

async function trackedBy(ticketId: string): Promise<string | null> {
  const [row] = await supportDb()<{ tracker_ticket_id: string }[]>`
    SELECT tracker_ticket_id FROM ticket_links WHERE linked_ticket_id = ${uuid(ticketId)}`
  return row ? fromUuid('ticket', row.tracker_ticket_id) : null
}

/** Link a customer ticket to a tracker (precondition; the UI path is TKT-45). */
async function linkRow(trackerId: string, ticketId: string) {
  await supportDb()`
    INSERT INTO ticket_links (tracker_ticket_id, linked_ticket_id, relation)
    VALUES (${uuid(trackerId)}, ${uuid(ticketId)}, 'tracks')`
}

test.describe('trackers', () => {
  test(
    'TKT-02 a new tracker shows under Trackers with no linked tickets and no first response',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const admin = await asPerson('admin')
      await admin.goto('/admin')
      const dialog = admin.getByRole('dialog')
      const item = admin.getByRole('menuitem', { name: 'New ticket' })
      await clickUntilVisible(admin.getByRole('button', { name: 'Actions', exact: true }), item)
      await clickUntilVisible(item, dialog)
      await dialog.getByRole('combobox').first().click()
      await admin.getByRole('option', { name: /^Tracker\b/ }).click()
      const title = `Outage tracker ${marker}`
      await dialog.getByPlaceholder('Summarize the request…').fill(title)
      await dialog.getByRole('button', { name: 'Create ticket' }).click()
      await expect(admin.getByText('Ticket created')).toBeVisible()

      const row = await pollFor('tracker row', async () => {
        const [t] = await supportDb()<
          { id: string }[]
        >`SELECT id FROM tickets WHERE title = ${title}`
        return t ?? null
      })
      const trackerId = fromUuid('ticket', row.id)
      expect(await ticketRow(trackerId)).toMatchObject({ type: 'tracker', first_response_at: null })

      await admin.goto('/admin/inbox?view=tickets_tracker')
      await expect(admin.getByText(title).first()).toBeVisible({ timeout: 15_000 })
      await openInInbox(admin, trackerId, title)
      const panel = detailPanel(admin)
      await expect(panel.getByText('No linked tickets')).toBeVisible()
      await expect(panel.getByRole('button', { name: 'Attach' })).toBeVisible()
    }
  )

  test(
    'TKT-45 linking a customer ticket to a tracker lists it on both sides',
    { tag: '@core' },
    async ({ playwright, baseURL, asPerson, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const tracker = await createTicket(api, { title: `Tracker ${marker}`, type: 'tracker' })
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Tracked ${marker}`)

      const admin = await asPerson('admin')
      await openInInbox(admin, ticket.id, ticket.title)
      const panel = detailPanel(admin)
      const option = admin.getByRole('menuitem').filter({ hasText: tracker.title })
      await clickUntilVisible(panel.getByRole('button', { name: 'Link to tracker' }), option)
      await option.click()
      await expect(panel.getByRole('button', { name: 'Unlink from tracker' })).toBeVisible()
      await expect.poll(() => trackedBy(ticket.id)).toBe(tracker.id)
      await expect
        .poll(async () =>
          (await ticketOwnMessages(ticket.id)).find((m) =>
            m.content.includes(`Linked to tracker ${tracker.reference}`)
          )
        )
        .toMatchObject({ is_internal: true })

      await openInInbox(admin, tracker.id, tracker.title)
      await expect(
        detailPanel(admin).getByRole('button', { name: `Unlink ${ticket.reference}` })
      ).toBeVisible()
    }
  )

  test(
    'TKT-46 unlinking removes the ticket from the tracker',
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const tracker = await createTicket(api, { title: `Tracker ${marker}`, type: 'tracker' })
      const { ticket } = await pairedCustomerTicket(api, customerEmail, `Untrack ${marker}`)
      await linkRow(tracker.id, ticket.id)

      const admin = await asPerson('admin')
      await openInInbox(admin, tracker.id, tracker.title)
      const panel = detailPanel(admin)
      await panel.getByRole('button', { name: `Unlink ${ticket.reference}` }).click()
      await expect(panel.getByText('No linked tickets')).toBeVisible()
      await expect.poll(() => trackedBy(ticket.id)).toBeNull()
    }
  )

  test(
    'TKT-47 resolving a tracker resolves its open linked tickets and leaves closed ones alone',
    { tag: '@core' },
    async ({ playwright, baseURL, marker, customerEmail }) => {
      const api = await ticketApi(playwright, baseURL)
      const tracker = await createTicket(api, { title: `Cascade ${marker}`, type: 'tracker' })
      const linked = []
      for (const n of [1, 2, 3]) {
        const { ticket } = await pairedCustomerTicket(
          api,
          customerEmail.replace('@', `-${n}@`),
          `Cascade ${n} ${marker}`
        )
        await linkRow(tracker.id, ticket.id)
        linked.push(ticket)
      }
      await setStatus(api, linked[2].id, "Won't do")

      // Same-category move: no cascade.
      await setStatus(api, tracker.id, 'Investigating')
      await new Promise((r) => setTimeout(r, 1_500))
      expect((await ticketRow(linked[0].id))!.status_name).toBe('New')

      await setStatus(api, tracker.id, 'Resolved')
      for (const ticket of linked.slice(0, 2)) {
        const row = await waitForTicket(ticket.id, 'cascaded', (r) => r.status_name === 'Resolved')
        expect(row.resolved_at).not.toBeNull()
      }
      expect((await ticketRow(linked[2].id))!.status_name).toBe("Won't do")
    }
  )

  test(
    "TKT-48 Reply all on a tracker reaches every linked ticket's requester",
    { tag: '@nightly' },
    async ({ playwright, baseURL, asPerson, marker, customerEmail }) => {
      test.setTimeout(60_000)
      const api = await ticketApi(playwright, baseURL)
      const tracker = await createTicket(api, { title: `Reply all ${marker}`, type: 'tracker' })
      const pairs = []
      for (const n of [1, 2]) {
        const pair = await pairedCustomerTicket(
          api,
          customerEmail.replace('@', `-${n}@`),
          `Reply all ${n} ${marker}`
        )
        await linkRow(tracker.id, pair.ticket.id)
        pairs.push(pair)
      }

      const admin = await asPerson('admin')
      await openInInbox(admin, tracker.id, tracker.title)
      await admin.getByRole('button', { name: 'Note', exact: true }).click()
      await admin.getByRole('menuitemradio', { name: 'Reply all' }).click()
      const text = `Fix is rolling out ${marker}`
      const composer = admin.locator('.ProseMirror[contenteditable="true"]').first()
      await composer.click()
      await composer.fill(text)
      await admin.getByRole('button', { name: 'Send reply' }).click()

      await expect
        .poll(async () => (await ticketOwnMessages(tracker.id)).map((m) => m.content))
        .toContain(text)
      for (const { conversationId } of pairs) {
        await expect
          .poll(async () =>
            (await conversationMessages(conversationId)).find((m) => m.content.includes(text))
          )
          .toMatchObject({ sender_type: 'agent', is_internal: false })
      }
    }
  )
})
