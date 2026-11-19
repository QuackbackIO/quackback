/**
 * Customer ratings (CSAT): the end-of-thread prompt, the workflow rating block,
 * the rating email and the /csat landing page, the one-ask rule, the team note,
 * the csat_submitted trigger and webhook, and where ratings show to teammates.
 *
 * Visitors are fresh per test: an anonymous widget visitor, or a seeded
 * customer who signs in to the portal. Workflows are scoped to the test's own
 * customer (person.email) and taken down afterwards.
 */
import { randomUUID } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { clientIp } from '../../support/api-client'
import { pollFor, supportDb } from '../../support/db'
import { linksIn, waitForEmailLog } from '../../support/mailpit'
import { sink } from '../../support/webhook-sink-client'
import {
  apiAs,
  callFn,
  clickUntil,
  csatOf,
  ensureSupportTickets,
  eventsFor,
  fnOk,
  messagesOf,
  mintCsatToken,
  restAs,
  seedPerson,
  startEmailConversation,
  startPortalConversation,
  textDoc,
  ticketConversationUuid,
  ticketRow,
  ticketStatusId,
  uuidOf,
  waitForMailWhere,
  waitForRating,
  withLiveWorkflow,
  workflowRuns,
  type SeededPerson,
  type StartedConversation,
} from '../../support/sla-csat'

const TEAM_NOTE = (n: number) => `The customer rated this conversation ${n} out of 5`

/** A workflow step that asks for a rating in the thread. */
function requestCsatStep(id = 'csat') {
  return {
    id,
    type: 'request_csat',
    body: textDoc('How did we do?'),
    allowTypingInterrupt: false,
    commentPrompt: 'Anything we could improve?',
  }
}

/** Ask for a rating when this customer's conversation is closed. */
function askOnClose(customer: SeededPerson, marker: string) {
  return {
    name: `Ask ${marker}`,
    class: 'customer_facing' as const,
    triggerType: 'conversation.status_changed',
    onlyFor: customer.email,
    alsoWhen: [{ field: 'conversation.status', op: 'eq', value: 'closed' }],
    steps: [requestCsatStep()],
  }
}

async function close(admin: APIRequestContext, conversationId: string) {
  await fnOk(admin, 'setConversationStatusFn', { conversationId, status: 'closed' })
}

/** The rating block messages in a conversation. */
async function csatBlocks(conversationUuid: string) {
  return (await messagesOf(conversationUuid)).filter(
    (m) => (m.metadata?.block as { kind?: string } | undefined)?.kind === 'csat'
  )
}

async function waitForCsatBlock(conversationUuid: string) {
  return pollFor(
    'a rating block in the thread',
    async () => (await csatBlocks(conversationUuid))[0] ?? null,
    { timeoutMs: 20_000 }
  )
}

async function teamNotes(conversationUuid: string) {
  return (await messagesOf(conversationUuid)).filter((m) =>
    /rated this conversation/.test(m.content)
  )
}

/**
 * Exactly one event of `type` for the conversation. Events are emitted after
 * the write commits (not awaited), so wait for the first, then make sure no
 * second one follows.
 */
async function expectOneEvent(type: string, conversationId: string) {
  await expect.poll(async () => (await eventsFor(type, conversationId)).length).toBeGreaterThan(0)
  await new Promise((r) => setTimeout(r, 1000))
  expect(await eventsFor(type, conversationId)).toHaveLength(1)
}

/** A portal customer with a conversation a teammate has answered. */
async function answeredPortalConversation(
  playwright: Parameters<typeof apiAs>[0],
  marker: string,
  tag = 'customer'
): Promise<{
  customer: SeededPerson
  customerApi: APIRequestContext
  conversation: StartedConversation
  admin: APIRequestContext
}> {
  const admin = await apiAs(playwright, 'admin')
  const customer = await seedPerson(marker, 'customer', { tag })
  const customerApi = await apiAs(playwright, customer)
  const conversation = await startPortalConversation(customerApi, customer, `Question ${marker}`)
  await fnOk(admin, 'sendAgentMessageFn', {
    conversationId: conversation.id,
    content: `Answer ${marker}`,
  })
  return { customer, customerApi, conversation, admin }
}

test.describe('the end-of-thread prompt', () => {
  test(
    'CSAT-01 a visitor rates a closed conversation from the widget prompt and the teammate sees it',
    { tag: '@smoke' },
    async ({ browser, playwright, asPerson, marker }) => {
      test.setTimeout(90_000)
      // Its own client address, so the anonymous sign-in has its own rate
      // limit bucket instead of loopback's, shared with every other test.
      const visitorContext = await browser.newContext({
        extraHTTPHeaders: { 'x-e2e-client-ip': clientIp() },
      })
      const widget = await visitorContext.newPage()
      // Every live stream the widget opens, to know when this thread's is up.
      const streams: string[] = []
      widget.on('response', (res) => {
        if (res.url().includes('/api/chat/stream') && res.status() === 200) streams.push(res.url())
      })
      await widget.goto('/widget')
      await widget.getByRole('button', { name: 'Messages', exact: true }).click()
      await widget
        .getByRole('button', { name: /Ask a question|New conversation|Send us a message/ })
        .first()
        .click()
      const composer = widget.locator('.ProseMirror[contenteditable="true"]')
      await expect(composer).toBeVisible({ timeout: 15_000 })
      await composer.fill(`Rate me ${marker}`)
      await widget.getByRole('button', { name: 'Send', exact: true }).click()
      const conversationUuid = await pollFor('the widget conversation', async () => {
        const [row] = await supportDb()<{ conversation_id: string }[]>`
          SELECT conversation_id FROM conversation_messages
          WHERE content = ${`Rate me ${marker}`} LIMIT 1`
        return row?.conversation_id ?? null
      })
      const conversationId = fromUuid('conversation', conversationUuid)
      // Close only once the thread's live stream is open, so the close is
      // seen live rather than raced against the subscription.
      await expect
        .poll(() => streams.some((url) => url.includes(conversationId)), { timeout: 20_000 })
        .toBe(true)

      const admin = await apiAs(playwright, 'admin')
      await close(admin, conversationId)

      // The prompt appears live in the visitor's thread once it is closed.
      const fourStars = widget.getByRole('button', { name: 'Rate 4 of 5' })
      await expect(fourStars).toBeVisible({ timeout: 15_000 })
      await expect(widget.getByText('How was your conversation?')).toBeVisible()
      await fourStars.click()
      await expect(widget.getByText('Thanks! Anything we could improve?')).toBeVisible()
      await expect(widget.getByRole('button', { name: 'Send feedback' })).toBeVisible()

      const rated = await waitForRating(conversationUuid)
      expect(rated.csat_rating).toBe(4)
      expect(rated.csat_submitted_at).not.toBeNull()
      await pollFor('the team note', async () => (await teamNotes(conversationUuid))[0] ?? null)
      await expectOneEvent('conversation.csat_submitted', conversationId)

      // The teammate sees the note and the stars on the conversation.
      const page = await asPerson('admin')
      await page.goto(`/admin/inbox?i=${conversationId}`)
      await expect(page.getByText(TEAM_NOTE(4))).toBeVisible({ timeout: 20_000 })
      // The detail panel's CSAT row: four lit stars and one muted.
      const stars = page
        .locator('span.text-warning')
        .filter({ has: page.locator('span.text-muted-foreground\\/40') })
        .first()
      await expect(stars).toHaveText('★★★★★')
      await expect(stars.locator('span')).toHaveText('★')
      await visitorContext.close()
      await admin.dispose()
    }
  )

  test(
    'CSAT-02 a comment after rating is saved on the same rating and shown to teammates',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      test.setTimeout(90_000)
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)

      const context = await browser.newContext({ storageState: customer.statePath })
      const portal = await context.newPage()
      await portal.goto(`/support/${conversation.id}`)
      await portal.getByRole('button', { name: 'Rate 5 of 5' }).click()
      await portal
        .getByRole('textbox', { name: 'Add a comment (optional)' })
        .fill(`  Great ${marker}  `)
      await portal.getByRole('button', { name: 'Send feedback' }).click()

      await expect
        .poll(async () => (await csatOf(conversation.uuid)).csat_comment)
        .toBe(`Great ${marker}`)
      expect((await csatOf(conversation.uuid)).csat_rating).toBe(5)
      await expect
        .poll(
          async () => (await eventsFor('conversation.csat_comment_added', conversation.id)).length
        )
        .toBe(1)

      // A second comment overwrites it without a new event; no second rating event or note.
      await fnOk(customerApi, 'submitCsatFn', {
        conversationId: conversation.id,
        rating: 5,
        comment: `Even better ${marker}`,
      })
      await expect
        .poll(async () => (await csatOf(conversation.uuid)).csat_comment)
        .toBe(`Even better ${marker}`)
      await expectOneEvent('conversation.csat_comment_added', conversation.id)
      await expectOneEvent('conversation.csat_submitted', conversation.id)
      expect(await teamNotes(conversation.uuid)).toHaveLength(1)

      // Teammates get the comment through the comment event (webhooks, workflows).
      const [added] = await eventsFor('conversation.csat_comment_added', conversation.id)
      expect(JSON.stringify(added.payload)).toContain(`Great ${marker}`)
      await context.close()
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-03 a conversation keeps its first rating',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const { customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)
      await fnOk(customerApi, 'submitCsatFn', { conversationId: conversation.id, rating: 2 })
      const first = await waitForRating(conversation.uuid)
      const again = await fnOk<{ ok: boolean }>(customerApi, 'submitCsatFn', {
        conversationId: conversation.id,
        rating: 5,
      })
      expect(again.ok).toBe(true)
      const after = await csatOf(conversation.uuid)
      expect(after.csat_rating).toBe(2)
      expect(after.csat_submitted_at?.getTime()).toBe(first.csat_submitted_at?.getTime())
      await expectOneEvent('conversation.csat_submitted', conversation.id)
      expect(await teamNotes(conversation.uuid)).toHaveLength(1)
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-05 a teammate, another visitor and bad ratings are refused',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const { customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)

      const byTeammate = await callFn(admin, 'submitCsatFn', {
        conversationId: conversation.id,
        rating: 5,
      })
      expect(byTeammate.ok).toBe(false)
      const other = await seedPerson(marker, 'customer', { tag: 'other' })
      const otherApi = await apiAs(playwright, other)
      const byOther = await callFn(otherApi, 'submitCsatFn', {
        conversationId: conversation.id,
        rating: 5,
      })
      expect(byOther.ok).toBe(false)
      for (const rating of [0, 6, 2.5]) {
        const bad = await callFn(customerApi, 'submitCsatFn', {
          conversationId: conversation.id,
          rating,
        })
        expect(bad.ok, `rating ${rating}`).toBe(false)
      }
      expect((await csatOf(conversation.uuid)).csat_rating).toBeNull()

      await Promise.all([admin.dispose(), customerApi.dispose(), otherApi.dispose()])
    }
  )

  test(
    'CSAT-20 the rating note is internal: the teammate thread has it, the visitor thread does not',
    { tag: '@core' },
    async ({ browser, playwright, asPerson, marker }) => {
      test.setTimeout(90_000)
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)
      // The visitor has the thread open while rating.
      const context = await browser.newContext({ storageState: customer.statePath })
      const portal = await context.newPage()
      await portal.goto(`/support/${conversation.id}`)
      await expect(portal.getByText(`Answer ${marker}`)).toBeVisible({ timeout: 20_000 })
      await portal.getByRole('button', { name: 'Rate 3 of 5' }).click()
      await waitForRating(conversation.uuid)
      const [note] = await pollFor('the team note', async () => {
        const notes = await teamNotes(conversation.uuid)
        return notes.length ? notes : null
      })
      expect(note.is_internal || note.sender_type === 'system').toBe(true)

      const agent = await asPerson('admin')
      await agent.goto(`/admin/inbox?i=${conversation.id}`)
      await expect(agent.getByText(TEAM_NOTE(3))).toBeVisible({ timeout: 20_000 })

      // Neither the open visitor page (live) nor a fresh read shows it.
      await expect(portal.getByText(/rated this conversation/)).toHaveCount(0)
      await portal.reload()
      await expect(portal.getByText(`Answer ${marker}`)).toBeVisible({ timeout: 20_000 })
      await expect(portal.getByText(/rated this conversation/)).toHaveCount(0)
      const visitorView = await fnOk(
        customerApi,
        'listConversationMessagesFn',
        {
          conversationId: conversation.id,
        },
        { method: 'GET' }
      )
      expect(JSON.stringify(visitorView)).not.toContain('rated this conversation')

      // Only the first rating posts it.
      await fnOk(customerApi, 'submitCsatFn', { conversationId: conversation.id, rating: 5 })
      await new Promise((r) => setTimeout(r, 1500))
      expect(await teamNotes(conversation.uuid)).toHaveLength(1)
      await context.close()
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )
})

test.describe('the rating block', () => {
  test(
    'CSAT-06 a workflow request_csat posts a rating block after close without reopening',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      test.setTimeout(90_000)
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await withLiveWorkflow(admin, askOnClose(customer, marker), async () => {
        await close(admin, conversation.id)
        const block = await waitForCsatBlock(conversation.uuid)
        expect(block.metadata?.block).toMatchObject({
          kind: 'csat',
          waiting: true,
          commentPrompt: 'Anything we could improve?',
        })
        expect((await csatOf(conversation.uuid)).status).toBe('closed')

        // The visitor sees the block's faces, and no end-of-thread prompt.
        const context = await browser.newContext({ storageState: customer.statePath })
        const portal = await context.newPage()
        await portal.goto(`/support/${conversation.id}`)
        await expect(portal.getByRole('button', { name: '4 of 5' })).toBeVisible({
          timeout: 20_000,
        })
        await expect(portal.getByRole('button', { name: 'Rate 4 of 5' })).toHaveCount(0)
        await context.close()
      })
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-07 answering the block records the rating when it is sent, once',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      test.setTimeout(90_000)
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await withLiveWorkflow(admin, askOnClose(customer, marker), async (workflow) => {
        await close(admin, conversation.id)
        await waitForCsatBlock(conversation.uuid)
        const context = await browser.newContext({ storageState: customer.statePath })
        const portal = await context.newPage()
        await portal.goto(`/support/${conversation.id}`)
        await portal.getByRole('button', { name: '2 of 5' }).click()

        const rated = await waitForRating(conversation.uuid)
        expect(rated.csat_rating).toBe(2)
        const reply = await pollFor(
          'the block reply message',
          async () =>
            (await messagesOf(conversation.uuid)).find(
              (m) => m.sender_type === 'visitor' && m.metadata?.blockReply
            ) ?? null
        )
        expect(reply.metadata?.blockReply).toMatchObject({ kind: 'csat', rating: 2 })
        // The waiting run resumes and finds it rated: one rating, one event, one note.
        await expect
          .poll(async () => (await workflowRuns(workflow.id)).map((r) => r.state).join(','))
          .toBe('done')
        await expectOneEvent('conversation.csat_submitted', conversation.id)
        expect(await teamNotes(conversation.uuid)).toHaveLength(1)
        await context.close()
      })
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-09 a rating reply never reopens a resolved ticket or closed conversation; a plain reply does',
    { tag: '@smoke' },
    async ({ browser, playwright, marker }) => {
      test.setTimeout(120_000)
      await ensureSupportTickets(playwright)
      const admin = await apiAs(playwright, 'admin')
      const customer = await seedPerson(marker, 'customer')
      const customerApi = await apiAs(playwright, customer)
      const ticket = await fnOk<{ id: string }>(customerApi, 'createMyTicketFn', {
        title: `Ticket ${marker}`,
        description: `Ticket question ${marker}`,
      })
      const ticketUuid = uuidOf(ticket.id)
      const conversationUuid = await ticketConversationUuid(ticketUuid)
      const conversationId = fromUuid('conversation', conversationUuid)
      const closedStatus = await ticketStatusId('closed')

      await withLiveWorkflow(admin, askOnClose(customer, marker), async () => {
        await fnOk(admin, 'setTicketStatusFn', { ticketId: ticket.id, statusId: closedStatus })
        await close(admin, conversationId)
        await waitForCsatBlock(conversationUuid)

        // The requester taps a face on the block in their portal thread.
        const context = await browser.newContext({ storageState: customer.statePath })
        const portal = await context.newPage()
        await portal.goto(`/support/${conversationId}`)
        await portal.getByRole('button', { name: '5 of 5' }).click()
        await waitForRating(conversationUuid)
        // The reopen reaction runs on the queue: give it time, then both stay closed.
        await new Promise((r) => setTimeout(r, 4000))
        expect((await csatOf(conversationUuid)).status).toBe('closed')
        expect((await ticketRow(ticketUuid)).status_id).toBe(uuidOf(closedStatus))

        // A plain message reopens both.
        await fnOk(customerApi, 'sendConversationMessageFn', {
          conversationId,
          content: `Actually, one more thing ${marker}`,
        })
        await expect.poll(async () => (await csatOf(conversationUuid)).status).toBe('open')
        await expect
          .poll(async () => (await ticketRow(ticketUuid)).status_id, { timeout: 20_000 })
          .not.toBe(uuidOf(closedStatus))
        await context.close()
      })
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-10 a conversation workflow and a ticket workflow asking at once post one block; a rated thread is not asked',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      test.setTimeout(120_000)
      await ensureSupportTickets(playwright)
      const admin = await apiAs(playwright, 'admin')
      const customer = await seedPerson(marker, 'customer')
      const customerApi = await apiAs(playwright, customer)
      const ticket = await fnOk<{ id: string }>(customerApi, 'createMyTicketFn', {
        title: `Pair ${marker}`,
        description: `Pair question ${marker}`,
      })
      const conversationUuid = await ticketConversationUuid(uuidOf(ticket.id))
      const conversationId = fromUuid('conversation', conversationUuid)
      const onTicketClose = {
        name: `Ask on ticket close ${marker}`,
        class: 'customer_facing' as const,
        triggerType: 'ticket.status_changed',
        triggerSettings: { ticketStatusCategory: 'closed' },
        onlyFor: customer.email,
        steps: [requestCsatStep()],
      }
      await withLiveWorkflow(admin, askOnClose(customer, marker), async (first) => {
        await withLiveWorkflow(admin, onTicketClose, async (second) => {
          const closedStatus = await ticketStatusId('closed')
          await Promise.all([
            fnOk(admin, 'setTicketStatusFn', { ticketId: ticket.id, statusId: closedStatus }),
            close(admin, conversationId),
          ])
          await waitForCsatBlock(conversationUuid)
          // Both workflows have had their turn: one block, never two.
          await expect
            .poll(
              async () =>
                (await workflowRuns(first.id)).length + (await workflowRuns(second.id)).length,
              { timeout: 20_000 }
            )
            .toBeGreaterThanOrEqual(1)
          await new Promise((r) => setTimeout(r, 4000))
          expect(await csatBlocks(conversationUuid)).toHaveLength(1)
        })
      })

      // Rated from the prompt first: a later ask posts nothing.
      const rated = await answeredPortalConversation(playwright, `${marker}-r`, 'rated')
      await withLiveWorkflow(
        admin,
        {
          ...askOnClose(rated.customer, `${marker}-r`),
          triggerType: 'conversation.csat_submitted',
          alsoWhen: [],
        },
        async (workflow) => {
          await close(rated.admin, rated.conversation.id)
          await fnOk(rated.customerApi, 'submitCsatFn', {
            conversationId: rated.conversation.id,
            rating: 4,
          })
          // The run reaches its ask (it parks there) but posts no block.
          await expect
            .poll(async () => (await workflowRuns(workflow.id))[0]?.state, { timeout: 15_000 })
            .toBe('waiting')
          await new Promise((r) => setTimeout(r, 1500))
          expect(await csatBlocks(rated.conversation.uuid)).toHaveLength(0)
        }
      )
      await Promise.all([
        admin.dispose(),
        customerApi.dispose(),
        rated.admin.dispose(),
        rated.customerApi.dispose(),
      ])
    }
  )
})

/** The /csat links in the close email to `address` (waits for it). */
async function closeEmailRatingLinks(address: string): Promise<string[]> {
  await waitForEmailLog(address, { email_type: 'ConversationClosedEmail' }, 20_000)
  const closeMail = await waitForMailWhere(address, 'the close email', (m) =>
    m.HTML.includes('Not sorted?')
  )
  return linksIn(closeMail).filter((l) => l.includes('/csat?token='))
}

/** A /csat landing URL for a conversation's visitor, as the email links it (no rating). */
function csatUrl(conversationId: string, principalId: string, ttlMs?: number) {
  return `/csat?token=${encodeURIComponent(mintCsatToken(conversationId, principalId, ttlMs))}`
}

test.describe('ratings by email', () => {
  test(
    'CSAT-11 on an email conversation the ask is also sent by email with rating links',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      const customer = await seedPerson(marker, 'customer')
      const conversation = await startEmailConversation(request, marker, {
        customer,
        subject: `Email help ${marker}`,
      })
      await withLiveWorkflow(admin, askOnClose(customer, marker), async () => {
        await close(admin, conversation.id)
        await waitForCsatBlock(conversation.uuid)
        const row = await waitForEmailLog(customer.email, { email_type: 'CsatRequestEmail' })
        expect(row.conversation_id).toBe(conversation.uuid)
        const mail = await waitForMailWhere(customer.email, 'the rating request', (m) =>
          m.HTML.includes('Click a face above to rate your experience.')
        )
        expect(mail.Subject).toBe(`Re: Email help ${marker}`)
        expect(mail.HTML).toContain('How did we do?')
        const faces = linksIn(mail).filter((l) => l.includes('/csat?token='))
        expect(faces.map((l) => new URL(l).searchParams.get('rating'))).toEqual([
          '1',
          '2',
          '3',
          '4',
          '5',
        ])
      })
      await admin.dispose()
    }
  )

  test(
    'CSAT-12 the close email has rating links unless the thread is rated or was asked by email',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(120_000)
      const admin = await apiAs(playwright, 'admin')
      const emailConversation = async (tag: string) => {
        const customer = await seedPerson(marker, 'customer', { tag })
        const conversation = await startEmailConversation(request, `${marker}-${tag}`, {
          customer,
        })
        return { customer, conversation }
      }

      // (1) Never rated or asked: the close email carries the five faces.
      const plain = await emailConversation('plain')
      await close(admin, plain.conversation.id)
      expect(await closeEmailRatingLinks(plain.customer.email)).toHaveLength(5)

      // (2) Rated first: no faces.
      const rated = await emailConversation('rated')
      await supportDb()`UPDATE conversations SET csat_rating = 4, csat_submitted_at = now()
                        WHERE id = ${rated.conversation.uuid}`
      await close(admin, rated.conversation.id)
      expect(await closeEmailRatingLinks(rated.customer.email)).toHaveLength(0)

      // (3) Already asked by email: no faces.
      const asked = await emailConversation('asked')
      await supportDb()`INSERT INTO email_log
                          (id, direction, email_type, address, subject, status, conversation_id)
                        VALUES (${randomUUID()}, 'outbound', 'CsatRequestEmail', ${asked.customer.email},
                                ${`Re: asked ${marker}`}, 'sent', ${asked.conversation.uuid})`
      await close(admin, asked.conversation.id)
      expect(await closeEmailRatingLinks(asked.customer.email)).toHaveLength(0)

      // (4) Only an unanswered rating block in the thread (the visitor may never
      // have seen it): the faces are still there.
      const blocked = await emailConversation('block')
      const block = { v: 1, runId: `run-${marker}`, nodeId: 'csat', waiting: true, kind: 'csat' }
      await supportDb()`INSERT INTO conversation_messages
                          (id, conversation_id, principal_id, sender_type, content, is_internal, metadata)
                        SELECT ${toUuid(generateId('conversation_msg'))}, id, visitor_principal_id, 'agent',
                               'How did we do?', false, ${supportDb().json({ block })}
                        FROM conversations WHERE id = ${blocked.conversation.uuid}`
      await close(admin, blocked.conversation.id)
      expect(await closeEmailRatingLinks(blocked.customer.email)).toHaveLength(5)
      await admin.dispose()
    }
  )

  test(
    'CSAT-13 the /csat page records the rating on a tap, then a comment, without signing in',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)
      const page = await (await browser.newContext()).newPage()
      await page.goto(csatUrl(conversation.id, customer.principalId))
      await expect(page.getByText('How did we do?')).toBeVisible()
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      // Opening the link records nothing (mail scanners open every link).
      await new Promise((r) => setTimeout(r, 1000))
      expect((await csatOf(conversation.uuid)).csat_rating).toBeNull()

      await page.getByRole('button', { name: 'Rate 4 of 5' }).click()
      await expect(page.getByText('Thanks for the feedback')).toBeVisible()
      await expect(page.getByText('Your rating has been recorded.')).toBeVisible()
      expect((await waitForRating(conversation.uuid)).csat_rating).toBe(4)
      await page.getByPlaceholder("Anything you'd like to add? (optional)").fill(`Nice ${marker}`)
      await page.getByRole('button', { name: 'Send comment' }).click()
      await expect(page.getByText('Thanks, your comment has been added.')).toBeVisible()
      expect((await csatOf(conversation.uuid)).csat_comment).toBe(`Nice ${marker}`)
      await expectOneEvent('conversation.csat_submitted', conversation.id)
      await expect
        .poll(
          async () => (await eventsFor('conversation.csat_comment_added', conversation.id)).length
        )
        .toBe(1)
      expect(await teamNotes(conversation.uuid)).toHaveLength(1)
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-13 an emailed rating link (with its rating) opens the page with that face preselected',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Every emailed link carries &rating=N, which the router parses as a number; csat.tsx validates it as a string, so the page answers 500 "Something went wrong". See QUARANTINE.md.',
      },
    },
    async ({ page, playwright, marker }) => {
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)
      const response = await page.goto(`${csatUrl(conversation.id, customer.principalId)}&rating=4`)
      expect(response?.status()).toBe(200)
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      await page.getByRole('button', { name: 'Rate 4 of 5' }).click()
      await expect(page.getByText('Thanks for the feedback')).toBeVisible()
      expect((await waitForRating(conversation.uuid)).csat_rating).toBe(4)
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-14 /csat with a missing, tampered or expired token shows the invalid link message',
    { tag: '@nightly' },
    async ({ page, playwright, marker }) => {
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await page.goto('/csat')
      await expect(page.getByText('Missing Link')).toBeVisible()
      await expect(
        page.getByText(
          'This link is missing some information. Please use the link from your email.'
        )
      ).toBeVisible()

      const good = mintCsatToken(conversation.id, customer.principalId)
      const tampered = `${good.slice(0, -2)}xx`
      const expired = mintCsatToken(conversation.id, customer.principalId, -60_000)
      for (const token of [tampered, expired]) {
        await page.goto(`/csat?token=${encodeURIComponent(token)}`)
        await expect(page.getByText('Link Expired')).toBeVisible()
        await expect(
          page.getByText('This rating link has expired or is no longer valid.')
        ).toBeVisible()
        const direct = await callFn<{ success: boolean; error?: string }>(
          customerApi,
          'recordCsatViaTokenFn',
          { token, rating: 3 }
        )
        expect(direct.data).toEqual({ success: false, error: 'invalid' })
      }
      // The good token on the same page works (the test above cannot pass on a broken page).
      await page.goto(`/csat?token=${encodeURIComponent(good)}`)
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      expect((await csatOf(conversation.uuid)).csat_rating).toBeNull()
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-15 a second email rating with a different face shows thanks and keeps the first',
    { tag: '@nightly' },
    async ({ page, playwright, marker }) => {
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)
      const url = csatUrl(conversation.id, customer.principalId)
      await page.goto(url)
      await page.getByRole('button', { name: 'Rate 2 of 5' }).click()
      await expect(page.getByText('Thanks for the feedback')).toBeVisible()
      await waitForRating(conversation.uuid)
      await page.goto(url)
      await page.getByRole('button', { name: 'Rate 5 of 5' }).click()
      await expect(page.getByText('Thanks for the feedback')).toBeVisible()
      expect((await csatOf(conversation.uuid)).csat_rating).toBe(2)
      await expectOneEvent('conversation.csat_submitted', conversation.id)
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'CSAT-16 rating through the email page for a deleted conversation shows a friendly failure',
    { tag: '@nightly' },
    async ({ page, playwright, marker }) => {
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)
      await page.goto(csatUrl(conversation.id, customer.principalId))
      const face = page.getByRole('button', { name: 'Rate 1 of 5' })
      await expect(face).toBeVisible()
      await supportDb()`DELETE FROM conversations WHERE id = ${conversation.uuid}`
      await face.click()
      await expect(page.getByText('Something went wrong. Please try again.')).toBeVisible()
      await expect(page.getByText('Thanks for the feedback')).toHaveCount(0)
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )
})

test.describe('after a rating', () => {
  test(
    'CSAT-18 a rating starts the csat_submitted workflow and sends a signed webhook',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      test.setTimeout(90_000)
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      const rest = await restAs(playwright)
      const hook = await rest.post('/api/v1/webhooks', {
        data: { url: sink.url(marker), events: ['conversation.csat_submitted'] },
      })
      expect(hook.status(), await hook.text()).toBe(201)
      const { data: webhook } = (await hook.json()) as { data: { id: string } }
      try {
        await withLiveWorkflow(
          admin,
          {
            name: `Rated ${marker}`,
            triggerType: 'conversation.csat_submitted',
            onlyFor: customer.email,
            steps: [
              {
                id: 'note',
                type: 'action',
                action: { type: 'add_note', body: `Got it ${marker}` },
              },
            ],
          },
          async (workflow) => {
            await close(admin, conversation.id)
            await fnOk(customerApi, 'submitCsatFn', {
              conversationId: conversation.id,
              rating: 5,
              comment: `Lovely ${marker}`,
            })
            await expect.poll(async () => (await workflowRuns(workflow.id)).length).toBe(1)
            await pollFor(
              'the workflow note',
              async () =>
                (await messagesOf(conversation.uuid)).find(
                  (m) => m.content === `Got it ${marker}`
                ) ?? null
            )
          }
        )
        const deliveries = await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(conversation.id),
        })
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0].headers['x-quackback-event']).toBe('conversation.csat_submitted')
        const body = JSON.parse(deliveries[0].body) as { data: Record<string, unknown> }
        expect(JSON.stringify(body.data)).toContain('"rating":5')
        // The comment has its own event; this one never repeats it.
        expect(JSON.stringify(body.data)).toContain('"comment":null')
        expect(JSON.stringify(body.data)).toContain('submittedAt')
      } finally {
        await rest.delete(`/api/v1/webhooks/${webhook.id}`)
        await Promise.all([rest.dispose(), admin.dispose(), customerApi.dispose()])
      }
    }
  )

  test(
    'CSAT-19 ratings show on the customer profile and in the support report',
    { tag: '@nightly' },
    async ({ playwright, asPerson, marker }) => {
      test.setTimeout(90_000)
      const { customer, customerApi, conversation, admin } = await answeredPortalConversation(
        playwright,
        marker
      )
      await close(admin, conversation.id)
      await fnOk(customerApi, 'submitCsatFn', { conversationId: conversation.id, rating: 4 })
      await waitForRating(conversation.uuid)

      const page = await asPerson('admin')
      await page.goto(`/admin/users?selected=${customer.principalId}`)
      const conversationsTab = page
        .getByRole('tab', { name: /^Conversations/ })
        .or(page.getByRole('button', { name: /^Conversations \(/ }))
        .first()
      const rating = page.getByText('★ 4/5').first()
      await clickUntil(conversationsTab, rating)

      await page.goto('/admin/analytics?section=support')
      await expect(page.getByText('Avg rating').first()).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('No CSAT responses for this period')).toHaveCount(0)
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )
})
