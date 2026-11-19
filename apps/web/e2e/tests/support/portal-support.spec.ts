/**
 * The portal Support tab from the customer's side (area CUS-P): the list,
 * a thread, replies, the paired ticket's header card, and what the customer
 * is never shown.
 */
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { linksIn, mailTo, waitForEmailLog, waitForMail } from '../../support/mailpit'
import { clearSigninRateLimit, enableMagicLinkMethod } from '../../utils/db-helpers'
import {
  adminFn,
  callServerFn,
  adminRequest,
  agentApi,
  composer,
  conversationRow,
  conversationWithMessage,
  createTicket,
  messageCount,
  enableTicketSurfaces,
  mintCustomer,
  mintSessionToken,
  moveTicket,
  portalContext,
  portalFn,
  streamStatus,
  threadStreamOpen,
  ticketStatusId as ticketStatus,
  visitorSend,
  visitorType,
} from '../../support/widget-portal'

/** A fresh customer signed in to the portal, with one conversation. */
async function customerWithConversation(
  browser: import('@playwright/test').Browser,
  request: import('@playwright/test').APIRequestContext,
  email: string,
  opening: string
) {
  const customer = await mintCustomer({ email })
  const token = await mintSessionToken(customer.userUuid)
  const { conversation } = await visitorSend(request, token, opening)
  const context = await portalContext(browser, customer)
  const page = await context.newPage()
  return { customer, token, conversation, context, page }
}

test.beforeAll(async () => {
  await enableTicketSurfaces()
})

test.describe('portal support: the core loop', () => {
  test(
    "CUS-P-10 another customer's conversation URL shows only the greeting, and the API answers not found",
    { tag: '@smoke' },
    async ({ browser, request, customerEmail, marker }) => {
      const b = await customerWithConversation(
        browser,
        request,
        `b-${customerEmail}`,
        `${marker} B's private question`
      )
      const a = await mintCustomer({ email: `a-${customerEmail}` })
      const aContext = await portalContext(browser, a)
      const aPage = await aContext.newPage()
      await aPage.goto(`/support/${b.conversation.id}`)
      await expect(aPage.getByText('All conversations')).toBeVisible({ timeout: 15_000 })
      await expect(aPage.getByText('Hi! 👋 How can we help you today?')).toBeVisible({
        timeout: 15_000,
      })
      await expect(aPage.getByText(`${marker} B's private question`)).toHaveCount(0)

      const list = await portalFn(aContext.request, 'listConversationMessagesFn', {
        conversationId: b.conversation.id,
      })
      expect(list.error).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' })
      const ticket = await portalFn(aContext.request, 'getConversationLinkedTicketFn', {
        conversationId: b.conversation.id,
      })
      expect(ticket.error).toBeUndefined()
      expect(ticket.value).toBeNull()
      const minted = await portalFn<{ token: string }>(
        aContext.request,
        'mintConversationStreamTokenFn'
      )
      const stream = await streamStatus(
        `conversationId=${b.conversation.id}&token=${minted.value!.token}`
      )
      expect(stream.status).toBe(404)
      await aContext.close()
      await b.context.close()
    }
  )

  test(
    'CUS-P-16 a portal reply shows in the thread and live in the inbox, and reopens a resolved paired ticket',
    { tag: '@smoke' },
    async ({ browser, request, playwright, asPerson, customerEmail, marker }) => {
      const opening = `${marker} my invoice is wrong`
      const { customer, conversation, page, context } = await customerWithConversation(
        browser,
        request,
        customerEmail,
        opening
      )
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} invoice ticket`,
        requesterPrincipalId: customer.principalId,
        conversationId: conversation.id,
      })
      await moveTicket(admin, ticket.id, 'Resolved')

      const inbox = await asPerson('admin')
      await inbox.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(inbox.getByText(opening).first()).toBeVisible({ timeout: 15_000 })

      const live = threadStreamOpen(page, conversation.id)
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await live
      const reply = `${marker} still wrong`
      await visitorType(page, reply)
      await expect(page.getByText(reply)).toBeVisible({ timeout: 10_000 })
      await expect(inbox.getByText(reply).first()).toBeVisible({ timeout: 10_000 })

      // The reaction job reopens the resolved ticket.
      const resolved = toUuid((await ticketStatus('Resolved')) as `ticket_status_${string}`)
      await pollFor('the ticket to reopen', async () => {
        const [row] = await supportDb()`SELECT status_id FROM tickets
          WHERE id = ${toUuid(ticket.id as `ticket_${string}`)}`
        return row.status_id !== resolved ? row : null
      })
      await admin.dispose()
      await context.close()
    }
  )
})

test.describe('portal support: the list', () => {
  test(
    'CUS-P-01 signed out, /support asks the visitor to sign in and the Log in button opens sign-in',
    { tag: '@core' },
    async ({ page }) => {
      await page.goto('/support')
      await expect(page.getByRole('heading', { name: 'Support' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Your conversations with our team')).toBeVisible()
      await expect(page.getByText('Sign in to view your conversations')).toBeVisible()
      await expect(
        page.getByText('Your support conversations are tied to your account.')
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'New conversation' })).toHaveCount(0)
      await expect(async () => {
        await page.getByRole('button', { name: 'Log in' }).first().click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
    }
  )

  test(
    'CUS-P-04 a signed-in customer with no threads sees the empty state, and New conversation opens one',
    { tag: '@core' },
    async ({ browser, customerEmail }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto('/support')
      await expect(page.getByText('No conversations yet')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText("Start a conversation and we'll get back to you.")).toBeVisible()
      await page.getByRole('link', { name: 'New conversation' }).last().click()
      await expect(page).toHaveURL(/\/support\/new$/)
      await expect(composer(page)).toBeVisible({ timeout: 15_000 })
      await context.close()
    }
  )

  test(
    'CUS-P-05 rows run newest first, prefer the ticket title, and show status, stage and unread',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const api = agentApi(request)
      const closed = await visitorSend(request, token, `${marker} closed one`)
      await api.status(closed.conversation.id, 'closed')
      const snoozed = await visitorSend(request, token, `${marker} snoozed one`)
      await supportDb()`UPDATE conversations SET status = 'snoozed', snoozed_until = NOW() + interval '1 day'
        WHERE id = ${toUuid(snoozed.conversation.id as `conversation_${string}`)}`
      const paired = await visitorSend(request, token, `${marker} paired one`)
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} Ticket title wins`,
        requesterPrincipalId: customer.principalId,
        conversationId: paired.conversation.id,
      })
      await api.status(paired.conversation.id, 'closed')
      const unread = await visitorSend(request, token, `${marker} unread one`)
      await api.reply(unread.conversation.id, `${marker} answer one`)
      await api.reply(unread.conversation.id, `${marker} answer two`)

      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto('/support')
      const rows = page.locator('main li a, li a[href^="/support/"]')
      await expect(page.getByText(`${marker} Ticket title wins`)).toBeVisible({ timeout: 15_000 })
      const titles = (await rows.allTextContents()).filter((t) => t.includes(marker))
      // Newest activity first: the replied thread, then the paired one, the snoozed, the closed.
      expect(
        titles.map((t) => t.match(/(unread|paired|Ticket title|snoozed|closed) /)?.[1])
      ).toEqual(['unread', 'Ticket title', 'snoozed', 'closed'])
      const row = (text: string) => page.getByRole('link', { name: new RegExp(text) })
      await expect(row(`${marker} closed one`)).toContainText('Closed')
      await expect(row(`${marker} snoozed one`)).toContainText('Open')
      // The paired row reads the ticket's stage, not the closed conversation.
      const pairedRow = row(`${marker} Ticket title wins`)
      await expect(pairedRow).toContainText('Received')
      await expect(pairedRow).toContainText(ticket.reference)
      await expect(pairedRow).not.toContainText('Closed')
      await expect(row(`${marker} unread one`).locator('.bg-primary')).toHaveText('2')
      await expect(pairedRow).toHaveAttribute('href', `/support/${paired.conversation.id}`)
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-06 the paired row chip follows the public stage, hides internal statuses, and reads Closed on a generic close',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const { conversation } = await visitorSend(request, token, `${marker} chip`)
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} chip ticket`,
        requesterPrincipalId: customer.principalId,
        conversationId: conversation.id,
      })
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      const row = page.getByRole('link', { name: new RegExp(`${marker} chip ticket`) })
      const show = async () => {
        await page.goto('/support')
        await expect(row).toBeVisible({ timeout: 15_000 })
      }

      await moveTicket(admin, ticket.id, 'Investigating')
      await show()
      await expect(row).toContainText('In progress')
      await expect(row).not.toContainText('Investigating')

      // An open-category status with no public stage: a new one, for this test only.
      const [hidden] = await supportDb()`
        INSERT INTO ticket_statuses (id, name, slug, category, public_stage, position)
        VALUES (gen_random_uuid(), ${`${marker} internal`}, ${marker}, 'open', NULL, 99)
        RETURNING id`
      expect(hidden).toBeTruthy()
      await moveTicket(admin, ticket.id, `${marker} internal`)
      await show()
      await expect(row).not.toContainText('internal')
      await expect(row).not.toContainText(/In progress|Received|Closed/)

      await moveTicket(admin, ticket.id, "Won't do")
      await show()
      await expect(row).toContainText('Closed')
      await expect(row).not.toContainText("Won't do")
      // The status was this test's own: take it out again.
      await supportDb()`DELETE FROM ticket_statuses WHERE id = ${hidden.id}`
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-22 two agent replies show an unread pill of 2 (notes and notices excluded), cleared once read',
    { tag: '@core' },
    async ({ browser, request, people, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} count me`
      const { conversation } = await visitorSend(request, token, opening)
      const api = agentApi(request)
      await api.reply(conversation.id, `${marker} reply one`)
      await api.note(conversation.id, `${marker} a note`)
      await api.assign(conversation.id, people.people.agentB.principalId)
      await api.reply(conversation.id, `${marker} reply two`)

      const context = await portalContext(browser, customer)
      const unread = await portalFn(context.request, 'getMessengerUnreadFn')
      expect(unread.value).toEqual({ conversations: 2, total: 2 })
      const page = await context.newPage()
      await page.goto('/support')
      const row = page.getByRole('link', { name: new RegExp(`${marker} reply two|${opening}`) })
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(row.locator('.bg-primary')).toHaveText('2')

      await row.click()
      await expect(page.getByText(`${marker} reply two`)).toBeVisible({ timeout: 15_000 })
      await pollFor('the thread to be marked read', async () => {
        const r = await portalFn<{ total: number }>(context.request, 'getMessengerUnreadFn')
        return r.value?.total === 0 ? true : null
      })
      await page.goto('/support')
      await expect(row).toBeVisible({ timeout: 15_000 })
      await expect(row.locator('.bg-primary')).toHaveCount(0)
      await context.close()
    }
  )
})

test.describe('portal support: the thread', () => {
  test(
    'CUS-P-07 opening a row shows the back link, the messages and the ticket header card',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} header card`
      const { conversation } = await visitorSend(request, token, opening)
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} card ticket`,
        requesterPrincipalId: customer.principalId,
        conversationId: conversation.id,
      })
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto('/support')
      await page.getByRole('link', { name: new RegExp(`${marker} card ticket`) }).click()
      await expect(page).toHaveURL(new RegExp(`/support/${conversation.id}$`))
      await expect(page.getByRole('link', { name: 'All conversations' })).toHaveAttribute(
        'href',
        '/support'
      )
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(`${marker} card ticket`).first()).toBeVisible()
      await expect(page.getByText(ticket.reference).first()).toBeVisible()
      // The requester watches their own ticket from the start.
      await expect(page.getByRole('button', { name: 'Stop watching' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(page.getByLabel('Ticket progress')).toBeVisible()
      await page.getByRole('button', { name: /Details/ }).click()
      await expect(page.getByText(/Opened/)).toBeVisible()
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-11 sending from a foreign or unknown thread URL starts a new thread of your own',
    { tag: '@core' },
    async ({ browser, request, customerEmail, marker }) => {
      const b = await mintCustomer({ email: `b-${customerEmail}` })
      const bToken = await mintSessionToken(b.userUuid)
      const theirs = await visitorSend(request, bToken, `${marker} B's thread`)
      const a = await mintCustomer({ email: `a-${customerEmail}` })
      const context = await portalContext(browser, a)
      const page = await context.newPage()

      for (const id of [theirs.conversation.id, generateId('conversation')]) {
        await page.goto(`/support/${id}`)
        await expect(composer(page)).toBeVisible({ timeout: 15_000 })
        const text = `${marker} from A via ${id.slice(-6)}`
        await visitorType(page, text)
        await expect(page.getByText(text)).toBeVisible({ timeout: 15_000 })
        await expect(page).not.toHaveURL(new RegExp(id))
        await expect(page).toHaveURL(/\/support\/conversation_/)
        const row = await conversationWithMessage(text)
        expect(row.visitor_principal_id).toBe(a.principalUuid)
      }
      expect(await messageCount(theirs.conversation.id)).toBe(1)
      await context.close()
    }
  )

  test(
    'CUS-P-14 the header bell watches and unwatches the ticket, with aria-pressed and the subscription row',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const { conversation } = await visitorSend(request, token, `${marker} bell`)
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} bell ticket`,
        requesterPrincipalId: customer.principalId,
        conversationId: conversation.id,
      })
      const subscription = async () =>
        (
          await supportDb()`SELECT reason FROM ticket_subscriptions
            WHERE ticket_id = ${toUuid(ticket.id as `ticket_${string}`)}
              AND principal_id = ${customer.principalUuid}`
        )[0]?.reason as string | undefined
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto(`/support/${conversation.id}`)

      const startsWatching = (await subscription()) !== undefined
      const bell = page.getByRole('button', { name: /Watch this ticket|Stop watching/ })
      await expect(bell).toHaveAttribute('aria-pressed', String(startsWatching), {
        timeout: 15_000,
      })
      await bell.click()
      await expect(bell).toHaveAttribute('aria-pressed', String(!startsWatching))
      await pollFor('the subscription to flip', async () =>
        ((await subscription()) !== undefined) === !startsWatching ? true : null
      )
      await bell.click()
      await expect(bell).toHaveAttribute('aria-pressed', String(startsWatching))
      await expect(bell).toHaveAccessibleName(
        startsWatching ? 'Stop watching' : 'Watch this ticket'
      )
      await pollFor('the subscription to flip back', async () =>
        ((await subscription()) !== undefined) === startsWatching ? true : null
      )
      // A manual watch is recorded as such.
      if ((await subscription()) === undefined) {
        await bell.click()
        await pollFor('a manual watch', async () =>
          (await subscription()) === 'manual' ? true : null
        )
      }
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-18 a reply to a closed thread reopens it, and the closed hint and rating prompt go',
    { tag: '@core' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} closed soon`
      const { conversation } = await visitorSend(request, token, opening)
      await agentApi(request).status(conversation.id, 'closed')
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto(`/support/${conversation.id}`)
      const hint = page.getByText('This conversation was closed. Reply to reopen it.')
      await expect(hint).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('How was your conversation?')).toBeVisible()

      const reply = `${marker} reopen please`
      await visitorType(page, reply)
      await expect(page.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(hint).toHaveCount(0, { timeout: 15_000 })
      await expect(page.getByText('How was your conversation?')).toHaveCount(0)
      expect((await conversationRow(conversation.id)).status).toBe('open')
      await context.close()
    }
  )

  test(
    'CUS-P-23 assignment and team notices never reach the portal thread, live or after reload',
    { tag: '@core' },
    async ({ browser, request, playwright, people, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} who has it`
      const { conversation } = await visitorSend(request, token, opening)
      const uuid = toUuid(conversation.id as `conversation_${string}`)
      await supportDb()`
        INSERT INTO conversation_messages (id, conversation_id, sender_type, content, is_internal, metadata, created_at)
        VALUES (gen_random_uuid(), ${uuid}, 'system', ${'Legacy kind notice ' + marker}, false,
                ${supportDb().json({ systemEvent: { kind: 'assigned' } })}, NOW()),
               (gen_random_uuid(), ${uuid}, 'system', 'Conversation assigned to the Billing team', false,
                NULL, NOW())`
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      const live = threadStreamOpen(page, conversation.id)
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await live

      const admin = agentApi(request)
      await admin.assign(conversation.id, people.people.agentB.principalId)
      const teamAdmin = await adminRequest(playwright)
      await callServerFn(
        teamAdmin,
        'src/lib/server/functions/teams.ts',
        'assignConversationTeamFn',
        {
          data: { conversationId: conversation.id, teamId: people.teams.billing },
        }
      )
      await teamAdmin.dispose()
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
        WHERE conversation_id = ${uuid} AND is_internal = true
          AND metadata -> 'systemEvent' ->> 'kind' IN ('assigned', 'team_assigned')`
      expect(n).toBe(2)
      const sentinel = `${marker} after notices`
      await admin.reply(conversation.id, sentinel)
      await expect(page.getByText(sentinel)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/assigned to|Legacy kind notice/)).toHaveCount(0)

      await page.reload()
      await expect(page.getByText(sentinel)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/assigned to|Legacy kind notice/)).toHaveCount(0)
      await context.close()
    }
  )

  test(
    'CUS-P-24 a ticket stage change shows live in the thread and the header chip; a same-stage move posts nothing',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} where is it`
      const { conversation } = await visitorSend(request, token, opening)
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} stage ticket`,
        requesterPrincipalId: customer.principalId,
        conversationId: conversation.id,
      })
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      const live = threadStreamOpen(page, conversation.id)
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await live

      await moveTicket(admin, ticket.id, 'Investigating')
      await expect(page.getByText('Status updated to In progress')).toBeVisible({
        timeout: 15_000,
      })
      await moveTicket(admin, ticket.id, 'Escalated') // same public stage
      await moveTicket(admin, ticket.id, "Won't do") // closed, no public stage
      await expect(page.getByText('Ticket closed')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Status updated to In progress')).toHaveCount(1)
      await expect(page.getByText(/Escalated|Won't do|Investigating/)).toHaveCount(0)
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-26 an agent reply on the paired ticket appears with the public name; a ticket note never does',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} ticket reply`
      const { conversation } = await visitorSend(request, token, opening)
      const admin = await adminRequest(playwright)
      const ticket = await createTicket(admin, {
        title: `${marker} reply ticket`,
        requesterPrincipalId: customer.principalId,
        conversationId: conversation.id,
      })
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      const live = threadStreamOpen(page, conversation.id)
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await live

      const note = `${marker} ticket note`
      await adminFn(admin, 'addTicketNoteFn', { ticketId: ticket.id, content: note })
      const reply = `${marker} ticket answer`
      await adminFn(admin, 'sendTicketMessageFn', { ticketId: ticket.id, content: reply })
      await expect(page.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Ada Admin').first()).toBeVisible()
      await expect(page.getByText(note)).toHaveCount(0)
      await page.reload()
      await expect(page.getByText(reply)).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(note)).toHaveCount(0)
      await admin.dispose()
      await context.close()
    }
  )
})

/** A fresh portal customer with a conversation and a paired ticket (api journeys). */
async function customerWithTicket(
  browser: import('@playwright/test').Browser,
  request: import('@playwright/test').APIRequestContext,
  admin: import('@playwright/test').APIRequestContext,
  email: string,
  marker: string
) {
  const customer = await mintCustomer({ email })
  const token = await mintSessionToken(customer.userUuid)
  const { conversation } = await visitorSend(request, token, `${marker} needs a ticket`)
  const ticket = await createTicket(admin, {
    title: `${marker} the ticket`,
    requesterPrincipalId: customer.principalId,
    conversationId: conversation.id,
  })
  const context = await portalContext(browser, customer)
  return { customer, token, conversation, ticket, context }
}

test.describe('portal support: what the customer receives and is refused', () => {
  test(
    'CUS-P-08 the requester ticket payload has exactly the allowed keys and withholds internal fields',
    { tag: '@core' },
    async ({ browser, request, playwright, people, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const { conversation, ticket, context } = await customerWithTicket(
        browser,
        request,
        admin,
        customerEmail,
        marker
      )
      await adminFn(admin, 'assignTicketFn', {
        ticketId: ticket.id,
        assigneePrincipalId: people.people.admin.principalId,
        assigneeTeamId: people.teams.support,
      })
      await adminFn(admin, 'setTicketPriorityFn', { ticketId: ticket.id, priority: 'high' })
      const read = async () => {
        const res = await portalFn<Record<string, unknown>>(
          context.request,
          'getConversationLinkedTicketFn',
          { conversationId: conversation.id }
        )
        expect(res.error).toBeUndefined()
        return res.value!
      }
      const dto = await read()
      expect(Object.keys(dto).sort()).toEqual(
        [
          'id',
          'number',
          'reference',
          'type',
          'ticketType',
          'title',
          'stage',
          'requester',
          'assignee',
          'company',
          'resolvedAt',
          'createdAt',
          'updatedAt',
          'customAttributes',
          'lastMessagePreview',
        ].sort()
      )
      expect(Object.keys(dto.stage as object).sort()).toEqual(['closed', 'label', 'slot'])
      expect(Object.keys(dto.requester as object).sort()).toEqual([
        'avatarUrl',
        'displayName',
        'principalId',
      ])
      expect(Object.keys(dto.assignee as object).sort()).toEqual(['displayName', 'principalId'])
      expect(dto.customAttributes).toEqual({})
      const raw = JSON.stringify(dto)
      for (const withheld of ['priority', 'sla', 'dueAt', 'firstResponseAt', 'teamId', 'status"']) {
        expect(raw, withheld).not.toContain(withheld)
      }

      // Internal activity does not move updatedAt.
      await adminFn(admin, 'addTicketNoteFn', { ticketId: ticket.id, content: `${marker} note` })
      await adminFn(admin, 'setTicketPriorityFn', { ticketId: ticket.id, priority: 'low' })
      expect((await read()).updatedAt).toBe(dto.updatedAt)
      await admin.dispose()
      await context.close()
    }
  )

  test(
    "CUS-P-12 the requester ticket functions answer not-found for someone else's, tracker and back-office tickets",
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const a = await customerWithTicket(browser, request, admin, `a-${customerEmail}`, marker)
      const b = await customerWithTicket(browser, request, admin, `b-${customerEmail}`, marker)
      const others: string[] = [b.ticket.id]
      for (const type of ['tracker', 'back_office'] as const) {
        const t = await adminFn<{ id: string }>(admin, 'createTicketFn', {
          type,
          title: `${marker} ${type}`,
          requesterPrincipalId: a.customer.principalId,
        })
        others.push(t.id)
      }
      const subs = async () =>
        (
          await supportDb()`SELECT count(*)::int AS n FROM ticket_subscriptions
          WHERE ticket_id IN ${supportDb()(others.map((id) => toUuid(id as `ticket_${string}`)))}`
        )[0].n as number
      const before = await subs()
      for (const id of others) {
        for (const name of ['getMyTicketWatchStatusFn', 'watchMyTicketFn', 'unwatchMyTicketFn']) {
          const res = await portalFn(a.context.request, name, { ticketId: id })
          expect(res.error, `${name} ${id}`).toMatchObject({ code: 'TICKET_NOT_FOUND' })
        }
      }
      expect(await subs()).toBe(before)
      await admin.dispose()
      await a.context.close()
      await b.context.close()
    }
  )

  test(
    'CUS-P-13 a customer cannot open a ticket stream, the inbox stream or the agent ticket reads',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const { ticket, context } = await customerWithTicket(
        browser,
        request,
        admin,
        customerEmail,
        marker
      )
      const minted = await portalFn<{ token: string }>(
        context.request,
        'mintConversationStreamTokenFn'
      )
      const token = minted.value!.token
      expect((await streamStatus(`ticketId=${ticket.id}&token=${token}`)).status).toBe(403)
      expect((await streamStatus(`scope=inbox&token=${token}`)).status).toBe(403)
      for (const name of ['getTicketFn', 'listTicketMessagesFn']) {
        const res = await portalFn(context.request, name, { ticketId: ticket.id })
        expect(res.error, name).toBeDefined()
        expect(res.value, name).toBeUndefined()
      }
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-17 a blocked customer cannot send from the portal, and nothing is written',
    { tag: '@core' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const { conversation } = await visitorSend(request, token, `${marker} before block`)
      await supportDb()`UPDATE principal SET blocked_at = NOW() WHERE id = ${customer.principalUuid}`
      const context = await portalContext(browser, customer)
      const res = await portalFn(context.request, 'sendConversationMessageFn', {
        conversationId: conversation.id,
        content: `${marker} after block`,
      })
      expect(res.error).toMatchObject({
        code: 'BLOCKED',
        statusCode: 403,
        message: 'You are not able to send messages here.',
      })
      expect(await messageCount(conversation.id)).toBe(1)
      await context.close()
    }
  )

  test(
    'CUS-P-21 the portal thread offers the customer no close, resolve or reopen, and the agent status call is refused',
    { tag: '@nightly' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} can I close this`
      const { conversation } = await visitorSend(request, token, opening)
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await expect(
        page.getByRole('button', { name: /^(Close|Resolve|Reopen|Mark as resolved)/ })
      ).toHaveCount(0)
      const res = await portalFn(context.request, 'setConversationStatusFn', {
        conversationId: conversation.id,
        status: 'closed',
      })
      expect(res.error).toBeDefined()
      expect((await conversationRow(conversation.id)).status).toBe('open')
      await context.close()
    }
  )

  test(
    'CUS-P-25 a stage change rings the requester bell, a resolve emails them, and unwatching stops both',
    { tag: '@core' },
    async ({ browser, request, playwright, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const { customer, ticket, context } = await customerWithTicket(
        browser,
        request,
        admin,
        customerEmail,
        marker
      )
      const bells = async () =>
        supportDb()`SELECT title FROM in_app_notifications
          WHERE principal_id = ${customer.principalUuid} AND type = 'ticket_status_changed'`
      await moveTicket(admin, ticket.id, 'Investigating')
      await pollFor('the requester bell', async () => ((await bells()).length >= 1 ? true : null))
      expect((await bells())[0].title).toBe(`${ticket.title} is now In progress`)

      await moveTicket(admin, ticket.id, 'Resolved')
      const mail = await waitForMail({
        to: customerEmail,
        subject: 'was resolved',
        timeoutMs: 20_000,
      })
      expect(mail.Subject).toBe(`Your ticket ${ticket.reference} was resolved`)
      await waitForEmailLog(customerEmail, { email_type: 'TicketEventEmail' })
      // The resolve rings the bell too; let it land before counting.
      await pollFor('the resolved bell', async () => ((await bells()).length >= 2 ? true : null))

      // Unwatched: the next moves reach neither the bell nor the inbox.
      const off = await portalFn(context.request, 'unwatchMyTicketFn', { ticketId: ticket.id })
      expect(off.error).toBeUndefined()
      const bellCount = (await bells()).length
      const mailCount = (await mailTo(customerEmail)).length
      await moveTicket(admin, ticket.id, 'Investigating')
      await moveTicket(admin, ticket.id, 'Resolved')
      // A visible event after the moves: the ticket reply bell rings for the team only,
      // so wait on the move's own activity row instead.
      await pollFor('the last move to land', async () => {
        const [row] = await supportDb()`SELECT count(*)::int AS n FROM ticket_activity
          WHERE ticket_id = ${toUuid(ticket.id as `ticket_${string}`)}`
        return (row.n as number) >= 4 ? true : null
      })
      await new Promise((r) => setTimeout(r, 3_000))
      expect((await bells()).length).toBe(bellCount)
      expect((await mailTo(customerEmail)).length).toBe(mailCount)
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-28 a signed-in customer mints a stream token and streams their thread, by token or by cookie',
    { tag: '@core' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const { conversation } = await visitorSend(request, token, `${marker} stream`)
      const context = await portalContext(browser, customer)
      const minted = await portalFn<{ token: string }>(
        context.request,
        'mintConversationStreamTokenFn'
      )
      expect(minted.error).toBeUndefined()
      const byToken = await streamStatus(
        `conversationId=${conversation.id}&token=${minted.value!.token}`
      )
      expect(byToken.status).toBe(200)
      const cookies = await context.cookies()
      const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      const byCookie = await streamStatus(`conversationId=${conversation.id}`, { cookie })
      expect(byCookie.status).toBe(200)
      // Signed out there is nothing to mint with.
      const anon = await portalFn(request, 'mintConversationStreamTokenFn')
      expect(anon.error).toBeDefined()
      await context.close()
    }
  )

  test(
    "CUS-P-09 internal activity never moves a requester's ticket up the list; a public reply does",
    { tag: '@nightly' },
    async ({ browser, playwright, people, customerEmail, marker }) => {
      const admin = await adminRequest(playwright)
      const customer = await mintCustomer({ email: customerEmail })
      const a = await createTicket(admin, {
        title: `${marker} A`,
        requesterPrincipalId: customer.principalId,
      })
      await new Promise((r) => setTimeout(r, 1_100))
      const b = await createTicket(admin, {
        title: `${marker} B`,
        requesterPrincipalId: customer.principalId,
      })
      const context = await portalContext(browser, customer)
      const order = async () => {
        const res = await portalFn<{ tickets: Array<{ ticketId: string }> }>(
          context.request,
          'getMyTicketsFn'
        )
        return res.value!.tickets.map((t) => t.ticketId)
      }
      expect(await order()).toEqual([b.id, a.id])

      await adminFn(admin, 'addTicketNoteFn', { ticketId: a.id, content: `${marker} note` })
      await adminFn(admin, 'assignTicketFn', {
        ticketId: a.id,
        assigneePrincipalId: people.people.agentB.principalId,
      })
      await adminFn(admin, 'setTicketPriorityFn', { ticketId: a.id, priority: 'urgent' })
      expect(await order()).toEqual([b.id, a.id])

      await adminFn(admin, 'sendTicketMessageFn', { ticketId: a.id, content: `${marker} reply` })
      await pollFor('A to move to the top', async () => ((await order())[0] === a.id ? true : null))
      await admin.dispose()
      await context.close()
    }
  )

  test(
    'CUS-P-19 the 21st portal send in the window is refused as too fast',
    { tag: '@nightly' },
    async ({ browser, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const context = await portalContext(browser, customer)
      const first = await portalFn<{ conversation: { id: string } }>(
        context.request,
        'sendConversationMessageFn',
        { content: `${marker} 1` }
      )
      const id = first.value!.conversation.id
      for (let i = 2; i <= 20; i++) {
        const r = await portalFn(context.request, 'sendConversationMessageFn', {
          conversationId: id,
          content: `${marker} ${i}`,
        })
        expect(r.error).toBeUndefined()
      }
      const over = await portalFn(context.request, 'sendConversationMessageFn', {
        conversationId: id,
        content: `${marker} 21`,
      })
      // The RATE_LIMITED code and retryAfter do not cross the wire (see the
      // quarantined CUS-W-19 twin); the refusal and its message do.
      expect(over.error?.message).toBe(
        'You are sending messages too quickly. Please wait a moment.'
      )
      expect(await messageCount(id)).toBe(20)
      await context.close()
    }
  )
})

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

test.describe('portal support: attachments, sign-in and reconnects', () => {
  test(
    'CUS-P-20 a portal attachment uploads, shows in the thread and reaches the inbox; uploads are gated and throttled',
    { tag: '@core' },
    async ({ browser, request, asPerson, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} see attached`
      const { conversation } = await visitorSend(request, token, opening)
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })

      const fileName = `${marker}.png`
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({ name: fileName, mimeType: 'image/png', buffer: PNG_1X1 })
      const caption = `${marker} with a file`
      await composer(page).click()
      await composer(page).fill(caption)
      const send = page.getByRole('button', { name: 'Send', exact: true })
      await expect(send).toBeEnabled({ timeout: 15_000 })
      await send.click()
      await expect(page.getByText(caption)).toBeVisible({ timeout: 15_000 })

      const [message] = await pollFor('the attachment row', async () => {
        const rows = await supportDb()`SELECT attachments FROM conversation_messages
          WHERE content = ${caption} AND attachments IS NOT NULL`
        return rows.length ? rows : null
      })
      const attachments = message.attachments as Array<{ name: string; url: string }>
      expect(attachments.map((a) => a.name)).toEqual([fileName])
      const shown = `img[src*="${fileName}"]`
      await expect(page.locator(shown).first()).toBeAttached()

      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(admin.getByText(caption).first()).toBeVisible({ timeout: 15_000 })
      await expect(admin.locator(shown).first()).toBeAttached({ timeout: 15_000 })

      // No session: 401. Over the per-user budget (20 a minute): 429.
      const signedOut = await request.post(`/api/portal/files?name=x.png`, {
        headers: { 'content-type': 'image/png' },
        data: PNG_1X1,
      })
      expect(signedOut.status()).toBe(401)
      await supportDb()`
        INSERT INTO rate_bucket (workspace_key, key, count, window_expires_at)
        VALUES ('_', ${`portal-file-upload:user:${customer.userId}`}, 20, NOW() + interval '60 seconds')
        ON CONFLICT (workspace_key, key) DO UPDATE SET count = 20,
          window_expires_at = NOW() + interval '60 seconds'`
      const throttled = await context.request.post(`/api/portal/files?name=x.png`, {
        headers: { 'content-type': 'image/png' },
        data: PNG_1X1,
      })
      expect(throttled.status()).toBe(429)
      expect(await throttled.json()).toEqual({ error: 'Too many uploads, slow down' })
      expect(Number(throttled.headers()['retry-after'])).toBeGreaterThan(0)
      await context.close()
    }
  )

  test(
    'CUS-P-29 a customer signs in by magic link from the email and sees their support threads',
    { tag: '@core' },
    async ({ page, request, customerEmail, marker }) => {
      enableMagicLinkMethod()
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} my thread`
      await visitorSend(request, token, opening)

      await page.goto('/support')
      await expect(page.getByText('Sign in to view your conversations')).toBeVisible({
        timeout: 15_000,
      })
      clearSigninRateLimit()
      const sent = await page.request.post('/api/auth/portal-signin', {
        data: { email: customerEmail, callbackURL: '/support' },
        headers: { origin: new URL(page.url()).origin },
      })
      expect(sent.ok()).toBeTruthy()
      const mail = await waitForMail({ to: customerEmail, timeoutMs: 20_000 })
      const link = linksIn(mail).find((l) => l.includes('magic-link') || l.includes('verify'))
      expect(link).toBeTruthy()
      await page.goto(link!.replace(/&amp;/g, '&'))
      await page.waitForURL(/\/support/, { timeout: 15_000 })
      await page.goto('/support')
      await expect(page.getByRole('link', { name: new RegExp(opening) })).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByRole('link', { name: /^Admin$/ })).toHaveCount(0)
    }
  )

  test(
    'CUS-P-27 after the stream drops, the reconnect brings the missed public reply once and never the note',
    { tag: '@nightly' },
    async ({ browser, request, customerEmail, marker }) => {
      const customer = await mintCustomer({ email: customerEmail })
      const token = await mintSessionToken(customer.userUuid)
      const opening = `${marker} flaky wifi`
      const { conversation } = await visitorSend(request, token, opening)
      const context = await portalContext(browser, customer)
      const page = await context.newPage()
      const live = threadStreamOpen(page, conversation.id)
      await page.goto(`/support/${conversation.id}`)
      await expect(page.getByText(opening)).toBeVisible({ timeout: 15_000 })
      await live

      await context.setOffline(true)
      const api = agentApi(request)
      const reply = `${marker} missed reply`
      await api.note(conversation.id, `${marker} missed note`)
      await api.reply(conversation.id, reply)
      await context.setOffline(false)

      await expect(page.getByText(reply)).toHaveCount(1, { timeout: 30_000 })
      await expect(page.getByText(`${marker} missed note`)).toHaveCount(0)
      await context.close()
    }
  )
})
