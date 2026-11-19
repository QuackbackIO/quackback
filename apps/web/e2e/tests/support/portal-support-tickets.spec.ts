/**
 * The customer's own tickets (area CUS-P): the ticket form block in a
 * thread, its validation and email tiers, the widget Tickets tab and its
 * stage badge, and rating a resolved ticket's conversation.
 */
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import {
  adminRequest,
  agentApi,
  conversationRow,
  createTicket,
  enableTicketSurfaces,
  mintCustomer,
  mintSessionToken,
  mintVisitor,
  moveTicket,
  openWidget,
  portalContext,
  portalFn,
  seedBlockMessage,
  signSsoToken,
  ticketStatusId,
  visitorSend,
  widgetSecret,
  widgetTab,
  callServerFn,
  FN_FILES,
} from '../../support/widget-portal'

test.beforeAll(async () => {
  await enableTicketSurfaces()
})

/** An identified widget visitor (fresh customer) and the widget iframe. */
async function identifiedWidget(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  email: string,
  marker: string
) {
  const secret = await widgetSecret(request)
  const widget = await openWidget(page, {
    ssoToken: signSsoToken({ id: `tk-${marker}`, email, name: 'Tom Tickets' }, secret),
  })
  const [principal] =
    await supportDb()`SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
    WHERE u.email = ${email}`
  return { widget, principalId: fromUuid('principal', principal.id as string) }
}

test.describe('portal tickets: the ticket form', () => {
  test(
    'CUS-P-30 an identified customer files a ticket from the form block in their portal thread',
    { tag: '@core' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} I need a ticket`
      const { conversation } = await visitorSend(request, token, opening)
      await seedBlockMessage(conversation.id, `${marker} File it here`, { kind: 'ticketForm' })
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(`${marker} File it here`)).toBeVisible({ timeout: 15_000 })

      const create = page.getByRole('button', { name: 'Create ticket' })
      await expect(create).toBeDisabled({ timeout: 15_000 })
      await page.getByLabel(/Subject/).fill(`${marker} lost my invoices`)
      await page.getByLabel(/Details/).fill('All of them, since Tuesday.')
      await create.click()
      await expect(page.getByText("Ticket filed. We'll track it from here.")).toBeVisible({
        timeout: 15_000,
      })
      const [ticket] = await supportDb()`
        SELECT t.type, t.requester_principal_id, t.ticket_type_id, tt.is_default
        FROM tickets t LEFT JOIN ticket_types tt ON tt.id = t.ticket_type_id
        WHERE t.title = ${`${marker} lost my invoices`}`
      expect(ticket).toMatchObject({
        type: 'customer',
        requester_principal_id: customer.principalUuid,
      })
      expect(ticket.is_default).toBe(true)

      // The new pair shows in the customer's list.
      await page.goto('/support')
      await expect(
        page.getByRole('link', { name: new RegExp(`${marker} lost my invoices`) })
      ).toBeVisible({ timeout: 15_000 })
      await context.close()
    }
  )

  test(
    'CUS-P-31 the ticket form refuses an empty subject, bad field values and a forged type',
    { tag: '@core' },
    async ({ browser, customerEmail, marker }) => {
      // A type of this test's own with one field of each kind, removed again after.
      const typeUuid = toUuid(generateId('ticket_type'))
      const fields = [
        {
          key: 'seats',
          label: 'Seats',
          type: 'number',
          required: true,
          visibleToCustomer: true,
          order: 0,
        },
        {
          key: 'plan',
          label: 'Plan',
          type: 'select',
          required: false,
          visibleToCustomer: true,
          order: 1,
          options: ['Free', 'Pro'],
        },
        {
          key: 'since',
          label: 'Since',
          type: 'date',
          required: false,
          visibleToCustomer: true,
          order: 2,
        },
        {
          key: 'agree',
          label: 'Agree',
          type: 'checkbox',
          required: true,
          visibleToCustomer: true,
          order: 3,
        },
      ]
      await supportDb()`INSERT INTO ticket_types (id, name, slug, category, fields, is_default, position, intake_visible)
        VALUES (${typeUuid}, ${`${marker} type`}, ${marker}, 'customer', ${supportDb().json(fields)}, false, 99, true)`
      const customer = await mintCustomer({ email: customerEmail })
      const context = await portalContext(browser, customer)
      const file = (data: Record<string, unknown>) =>
        portalFn(context.request, 'createMyTicketFn', data)
      try {
        expect((await file({ title: '' })).error).toBeDefined()
        expect((await file({ title: 'x', description: 'y'.repeat(4001) })).error).toBeDefined()

        const ticketTypeId = fromUuid('ticket_type', typeUuid)
        const bad = await file({
          title: `${marker} bad`,
          ticketTypeId,
          fieldValues: { seats: 'many', plan: 'Enterprise', since: '2026-02-31', agree: false },
        })
        expect(bad.error).toMatchObject({ code: 'INVALID_TICKET_FIELDS' })
        for (const msg of [
          'Seats must be a number',
          'Plan is not a valid option',
          'Since must be a valid date',
          'Agree is required',
        ]) {
          expect(bad.error?.message).toContain(msg)
        }
        const missing = await file({ title: `${marker} missing`, ticketTypeId, fieldValues: {} })
        expect(missing.error?.message).toContain('Seats is required')

        const forged = await file({
          title: `${marker} forged`,
          ticketTypeId: fromUuid('ticket_type', toUuid(generateId('ticket_type'))),
        })
        expect(forged.error).toMatchObject({
          code: 'INVALID_TICKET_TYPE',
          message: 'That ticket type is not available. Pick one of the offered types.',
        })
        const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM tickets
          WHERE requester_principal_id = ${customer.principalUuid}`
        expect(n).toBe(0)
      } finally {
        await supportDb()`UPDATE ticket_types SET deleted_at = NOW() WHERE id = ${typeUuid}`
        await context.close()
      }
    }
  )

  test(
    'CUS-P-33 an anonymous visitor must give a plausible email to file, and the first one sticks',
    { tag: '@core' },
    async ({ request, marker }) => {
      const visitor = await mintVisitor()
      const fileTicket = (data: Record<string, unknown>) =>
        callServerFn(request, FN_FILES.widgetTickets, 'widgetCreateMyTicketFn', {
          bearer: visitor.token,
          data: { title: `${marker} anon ticket`, ...data },
        })
      expect((await fileTicket({})).error).toMatchObject({ code: 'EMAIL_REQUIRED' })
      expect((await fileTicket({ email: 'bad@' })).error).toMatchObject({ code: 'EMAIL_REQUIRED' })
      const ok = await fileTicket({ email: `${marker}@Customers.Example` })
      expect(ok.error).toBeUndefined()
      const contact = async () =>
        (
          await supportDb()`SELECT contact_email FROM principal WHERE id = ${visitor.principalUuid}`
        )[0].contact_email as string
      expect(await contact()).toBe(`${marker}@customers.example`)
      const again = await fileTicket({ email: `other-${marker}@x.io` })
      expect(again.error).toBeUndefined()
      expect(await contact()).toBe(`${marker}@customers.example`)
    }
  )

  test(
    'CUS-P-32 when the ticket form cannot load, it says so and offers Try again',
    { tag: '@nightly' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} form fails`
      const { conversation } = await visitorSend(request, token, opening)
      await seedBlockMessage(conversation.id, `${marker} Form here`, { kind: 'ticketForm' })
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      const formFn = (await import('../../support/widget-portal')).serverFnId(
        FN_FILES.tickets,
        'getMyTicketFormFn'
      )
      await page.route(`**/_serverFn/${formFn}**`, (route) =>
        route.fulfill({ status: 500, body: 'down' })
      )
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText("Couldn't load this form.")).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Create ticket' })).toBeDisabled()
      await context.close()
    }
  )
})

test.describe('portal tickets: the widget Tickets tab', () => {
  test(
    'CUS-P-34 the Tickets tab lists the visitor’s tickets newest first with stage chips and references',
    { tag: '@core' },
    async ({ page, request, playwright, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const customer = await mintCustomer({ email: customerEmail, externalId: `tk-${marker}` })
      const older = await createTicket(admin, {
        title: `${marker} older ticket`,
        requesterPrincipalId: customer.principalId,
      })
      const newer = await createTicket(admin, {
        title: `${marker} newer ticket`,
        requesterPrincipalId: customer.principalId,
      })
      await moveTicket(admin, newer.id, 'Investigating')
      const { widget } = await identifiedWidget(page, request, customerEmail, marker)
      await widgetTab(widget, 'Tickets').click()
      const rows = widget.getByRole('button', {
        name: new RegExp(`${marker} (older|newer) ticket`),
      })
      await expect(rows).toHaveCount(2, { timeout: 15_000 })
      await expect(rows.nth(0)).toContainText(`${marker} newer ticket`)
      await expect(rows.nth(0)).toContainText('In progress')
      await expect(rows.nth(0)).toContainText(newer.reference)
      await expect(rows.nth(1)).toContainText(`${marker} older ticket`)
      await expect(rows.nth(1)).toContainText('Received')
      await expect(rows.nth(1)).toContainText(older.reference)
      // An anonymous visitor never gets the tab.
      const anon = await mintVisitor()
      const anonPage = await page.context().newPage()
      const anonWidget = await openWidget(anonPage, { visitorToken: anon.token })
      await expect(widgetTab(anonWidget, 'Messages')).toBeVisible({ timeout: 15_000 })
      await expect(widgetTab(anonWidget, 'Tickets')).toHaveCount(0)
      await admin.dispose()
    }
  )

  test(
    'CUS-P-35 the Tickets badge counts a stage change since the last visit and clears once viewed',
    { tag: '@nightly' },
    async ({ page, request, playwright, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const customer = await mintCustomer({ email: customerEmail, externalId: `tk-${marker}` })
      const ticket = await createTicket(admin, {
        title: `${marker} badge ticket`,
        requesterPrincipalId: customer.principalId,
      })
      let { widget } = await identifiedWidget(page, request, customerEmail, marker)
      // First load: a silent baseline, no badge.
      await expect(widget.getByRole('button', { name: /^Tickets$/ })).toBeVisible({
        timeout: 15_000,
      })
      await moveTicket(admin, ticket.id, 'Investigating')
      await page.reload()
      ;({ widget } = await identifiedWidget(page, request, customerEmail, marker))
      await expect(widget.getByRole('button', { name: '1 unread Tickets' })).toBeVisible({
        timeout: 20_000,
      })
      await widgetTab(widget, 'Tickets').click()
      await expect(widget.getByText('Status changed since your last visit')).toBeVisible()
      await expect(widget.getByRole('button', { name: /unread Tickets/ })).toHaveCount(0, {
        timeout: 15_000,
      })
      await admin.dispose()
    }
  )
})

test.describe('portal tickets: rating a resolved ticket', () => {
  test(
    "CUS-P-36 rating a resolved ticket's conversation records the rating and reopens neither",
    { tag: '@smoke' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} thanks for fixing`
      const { conversation } = await visitorSend(request, token, opening)
      const ticket = await createTicket(admin, {
        title: `${marker} fixed ticket`,
        requesterPrincipalId: customer.principalId,
        conversationId: conversation.id,
      })
      await moveTicket(admin, ticket.id, 'Resolved')
      await agentApi(request).status(conversation.id, 'closed')

      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText('How was your conversation?')).toBeVisible({ timeout: 15_000 })
      await page.getByRole('button', { name: 'Rate 5 of 5' }).click()
      await page.getByRole('textbox', { name: 'Add a comment (optional)' }).fill(`${marker} great`)
      await page.getByRole('button', { name: 'Send feedback' }).click()
      await expect(page.getByText('Thanks for your feedback!')).toBeVisible({ timeout: 10_000 })

      const row = await pollFor('the rating', async () => {
        const r = await conversationRow(conversation.id)
        return r.csat_rating === 5 ? r : null
      })
      // Give the reaction queue its turn, then both stay resolved.
      await pollFor('the csat event to be processed', async () => {
        const [n] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
          WHERE conversation_id = ${row.id} AND is_internal = true`
        return (n.n as number) > 0 ? true : null
      })
      expect((await conversationRow(conversation.id)).status).toBe('closed')
      const [t] = await supportDb()`SELECT status_id FROM tickets
        WHERE id = ${toUuid(ticket.id as `ticket_${string}`)}`
      expect(t.status_id).toBe(
        toUuid((await ticketStatusId('Resolved')) as `ticket_status_${string}`)
      )
      await admin.dispose()
      await context.close()
    }
  )
})
