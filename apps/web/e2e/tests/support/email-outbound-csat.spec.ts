/**
 * Rating by email: the workflow rating request, the rating links in the close
 * email, the /csat landing page, and an in-thread rating on a resolved ticket
 * (journeys CUS-O-21..27, CUS-O-29).
 *
 * Oracles: Mailpit, the conversation row (csat_rating / csat_comment), its
 * internal notes, and the events the app recorded.
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { conversationReplyAddress } from '../../support/inbound-email'
import { linksIn } from '../../support/mailpit'
import {
  agentReply,
  apiAs,
  conversation,
  conversationForMessage,
  conversationTypeId,
  createCustomerTicket,
  deliver,
  enableSupportTickets,
  emailLogForConversation,
  eventsFor,
  mailText,
  mailsMatching,
  messagesIn,
  mintCsatToken,
  openWidgetAs,
  personalKeyFor,
  principalForUserEmail,
  principalTypeId,
  retireWorkflow,
  seedCustomer,
  seedLiveWorkflow,
  sendColdMail,
  setConversationStatus,
  setTicketStatus,
  ticketStatusId,
  tiptapDoc,
  uuidOf,
  waitForConversation,
  waitForMailMatching,
} from '../../support/email-journeys'

const WORKSPACE = 'Acme Corp'
const RESOLVED = 'marked this conversation as resolved'

/** A cold email from `from` and the email conversation it opened. */
async function coldThread(request: APIRequestContext, from: string, marker: string) {
  const subject = `Rate us ${marker}`
  const sent = await sendColdMail(request, { from, subject, text: `Help please ${marker}` })
  expect(sent.http).toBe(200)
  const row = await conversationForMessage(sent.messageId)
  return { subject, row, id: conversationTypeId(row.id) }
}

/** Close an email conversation and return the rating links from its close email. */
async function closeAndGetRatingLinks(
  playwright: import('@playwright/test').Playwright,
  baseURL: string,
  adminEmail: string,
  customerEmail: string,
  conversationId: string
) {
  const api = await apiAs(playwright, baseURL, personalKeyFor(adminEmail))
  await setConversationStatus(api, conversationId, 'closed')
  await api.dispose()
  const mail = await waitForMailMatching({ to: customerEmail, body: RESOLVED })
  return linksIn(mail).filter((href) => href.includes('/csat?token='))
}

/**
 * The page an emailed face link opens, without its `rating` parameter, for the
 * tests of what happens after the page opens. CUS-O-23 opens a link with it.
 */
function tokenOnly(link: string) {
  return csatPath(new URL(link).searchParams.get('token')!)
}

/** The /csat link path (on this suite's origin) for a token and rating. */
function csatPath(token: string, rating?: number | string) {
  const q = new URLSearchParams({ token })
  if (rating !== undefined) q.set('rating', String(rating))
  return `/csat?${q.toString()}`
}

async function csatEvents(conversationId: string, type: string) {
  return (await eventsFor(conversationId)).filter((e) => e.type === type)
}

async function rateOnPage(page: Page, rating: number) {
  await page.getByRole('button', { name: `Rate ${rating} of 5` }).click()
  await expect(page.getByText('Thanks for the feedback')).toBeVisible()
}

test.describe('rating request emails', () => {
  test(
    'CUS-O-21 a workflow rating block on an email conversation sends one rating request email',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Waits on an owner decision: the workflow asks on an open conversation, which #1102 skips',
      },
    },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      test.setTimeout(90_000)
      await seedCustomer(customerEmail, 'Rhea Rater')
      const thread = await coldThread(request, customerEmail, marker)
      const prompt = `How was your help today ${marker}?`
      const workflowId = await seedLiveWorkflow({
        name: `Rating ${marker}`,
        triggerType: 'message.created',
        personEmail: customerEmail,
        then: [{ type: 'request_csat', body: tiptapDoc(prompt), allowTypingInterrupt: true }],
      })
      try {
        // The app caches "is any workflow live" for 30 s, and a row written
        // straight to the table does not clear it: keep writing until a
        // message reaches the workflow.
        let n = 0
        await expect(async () => {
          n++
          const sent = await deliver(request, {
            from: customerEmail,
            to: conversationReplyAddress(thread.id),
            subject: `Re: ${thread.subject}`,
            text: `Any news ${n} ${marker}?`,
          })
          expect(sent.status).toBe('ingested')
          await waitForMailMatching({ to: customerEmail, body: prompt }, 4_000)
        }).toPass({ timeout: 60_000, intervals: [1_000] })

        const mail = await waitForMailMatching({ to: customerEmail, body: prompt })
        expect(mail.Subject).toBe(`Re: ${thread.subject}`)
        const text = mailText(mail)
        expect(text).toContain('How did we do?')
        expect(text).toContain('Click a face above to rate your experience.')
        expect(text).toContain(
          `You received this email because you had a conversation with ${WORKSPACE}.`
        )
        const links = linksIn(mail).filter((h) => h.includes('/csat?token='))
        expect(links.map((h) => new URL(h).searchParams.get('rating'))).toEqual([
          '1',
          '2',
          '3',
          '4',
          '5',
        ])
        expect(new Set(links.map((h) => new URL(h).searchParams.get('token'))).size).toBe(1)
        expect(new URL(links[0]).origin).toBe(supportEnv().baseUrl)

        // The block is in the thread, as the assistant's message.
        const block = (await messagesIn(thread.row.id)).find(
          (m) => (m.metadata as { block?: { kind?: string } } | null)?.block?.kind === 'csat'
        )
        expect(block).toBeTruthy()
        const log = await pollFor('the CsatRequestEmail log row', async () =>
          (await emailLogForConversation(thread.row.id)).find(
            (r) => r.email_type === 'CsatRequestEmail'
          )
        )
        expect(log.status).toBe('sent')

        // Asked once: more messages, then a teammate reply arrives, and still one ask.
        await deliver(request, {
          from: customerEmail,
          to: conversationReplyAddress(thread.id),
          subject: `Re: ${thread.subject}`,
          text: `One more thing ${marker}`,
        })
        const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
        await agentReply(api, thread.id, `Sentinel answer ${marker}`)
        await api.dispose()
        await waitForMailMatching({ to: customerEmail, body: `Sentinel answer ${marker}` })
        expect(await mailsMatching({ to: customerEmail, body: prompt })).toHaveLength(1)
      } finally {
        await retireWorkflow(workflowId)
      }
    }
  )

  test(
    'CUS-O-22 the close email carries rating links only while unrated and never asked',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, customerEmail, marker }) => {
      const admin = people.people.admin.email
      // Never rated, never asked: links.
      const fresh = await coldThread(request, customerEmail, marker)
      expect(
        await closeAndGetRatingLinks(playwright, baseURL!, admin, customerEmail, fresh.id)
      ).toHaveLength(5)

      // Already rated: the close email keeps its follow-up line but drops the faces.
      const ratedEmail = `rated-${customerEmail}`
      const rated = await coldThread(request, ratedEmail, `${marker}-rated`)
      await supportDb()`
        UPDATE conversations SET csat_rating = 5, csat_submitted_at = now() WHERE id = ${rated.row.id}`
      expect(
        await closeAndGetRatingLinks(playwright, baseURL!, admin, ratedEmail, rated.id)
      ).toEqual([])
      const ratedMail = await waitForMailMatching({ to: ratedEmail, body: RESOLVED })
      expect(mailText(ratedMail)).not.toContain('How did we do?')
      expect(mailText(ratedMail)).toContain('Not sorted? Just reply to this email')

      // A rating request email already went out on the thread: no links.
      const askedEmail = `asked-${customerEmail}`
      const asked = await coldThread(request, askedEmail, `${marker}-asked`)
      await supportDb()`
        INSERT INTO email_log (id, direction, email_type, provider, address, subject, status,
                               conversation_id)
        VALUES (${crypto.randomUUID()}, 'outbound', 'CsatRequestEmail', 'smtp', ${askedEmail},
                ${`Re: ${asked.subject}`}, 'sent', ${asked.row.id})`
      expect(
        await closeAndGetRatingLinks(playwright, baseURL!, admin, askedEmail, asked.id)
      ).toEqual([])
    }
  )
})

test.describe('the /csat landing page', () => {
  test(
    'CUS-O-23 a valid link shows the five faces and records nothing on load',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, page, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const links = await closeAndGetRatingLinks(
        playwright,
        baseURL!,
        people.people.admin.email,
        customerEmail,
        thread.id
      )
      await page.goto(tokenOnly(links[3]))
      await expect(page.getByText('How did we do?')).toBeVisible()
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      for (let r = 1; r <= 5; r++) {
        await expect(page.getByRole('button', { name: `Rate ${r} of 5` })).toBeVisible()
      }
      // As a prefetching mail scanner would: load it twice. Nothing is recorded.
      await page.reload()
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      const row = await conversation(thread.row.id)
      expect(row.csat_rating).toBeNull()
      expect(row.csat_submitted_at).toBeNull()
      expect(await csatEvents(thread.id, 'conversation.csat_submitted')).toEqual([])
    }
  )

  test(
    'CUS-O-23 an emailed face link opens with its face preselected and records nothing',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, page, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const links = await closeAndGetRatingLinks(
        playwright,
        baseURL!,
        people.people.admin.email,
        customerEmail,
        thread.id
      )
      await page.goto(new URL(links[3]).pathname + new URL(links[3]).search)
      await expect(page.getByText('How did we do?')).toBeVisible()
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      for (let r = 1; r <= 5; r++) {
        await expect(page.getByRole('button', { name: `Rate ${r} of 5` })).toBeVisible()
      }
      await expect(page.getByRole('button', { name: 'Rate 4 of 5' })).toHaveClass(/ring-2/)
      await expect(page.getByRole('button', { name: 'Rate 3 of 5' })).not.toHaveClass(/ring-2/)
      // Give a prefetching mail scanner every chance: nothing is recorded.
      await page.reload()
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      const row = await conversation(thread.row.id)
      expect(row.csat_rating).toBeNull()
      expect(row.csat_submitted_at).toBeNull()
      expect(await csatEvents(thread.id, 'conversation.csat_submitted')).toEqual([])
    }
  )

  test(
    'CUS-O-24 clicking a face from the close email records the rating',
    { tag: '@smoke' },
    async ({ request, playwright, baseURL, people, page, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const links = await closeAndGetRatingLinks(
        playwright,
        baseURL!,
        people.people.admin.email,
        customerEmail,
        thread.id
      )
      await page.goto(tokenOnly(links[3]))
      await page.getByRole('button', { name: 'Rate 4 of 5' }).click()
      await expect(page.getByText('Thanks for the feedback')).toBeVisible()
      await expect(page.getByText('Your rating has been recorded.')).toBeVisible()
      await expect(page.getByPlaceholder("Anything you'd like to add? (optional)")).toBeVisible()
      await expect(page.getByRole('button', { name: 'Send comment' })).toBeVisible()

      const row = await waitForConversation(thread.row.id, 'the rating', (r) => r.csat_rating === 4)
      expect(row.csat_submitted_at).not.toBeNull()
      const notes = (await messagesIn(thread.row.id)).filter((m) => m.sender_type === 'system')
      expect(notes.map((m) => [m.content, m.is_internal])).toContainEqual([
        'The customer rated this conversation 4 out of 5',
        true,
      ])
      const [submitted] = await pollFor('csat_submitted', async () => {
        const rows = await csatEvents(thread.id, 'conversation.csat_submitted')
        return rows.length ? rows : null
      })
      expect(submitted.payload).toMatchObject({ rating: 4 })
    }
  )

  test(
    'CUS-O-25 a comment after rating is saved once and announced once',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, page, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const links = await closeAndGetRatingLinks(
        playwright,
        baseURL!,
        people.people.admin.email,
        customerEmail,
        thread.id
      )
      const link = tokenOnly(links[4])
      await page.goto(link)
      await rateOnPage(page, 5)
      await page
        .getByPlaceholder("Anything you'd like to add? (optional)")
        .fill('  Quick and kind  ')
      await page.getByRole('button', { name: 'Send comment' }).click()
      await expect(page.getByText('Thanks, your comment has been added.')).toBeVisible()
      await waitForConversation(
        thread.row.id,
        'the comment',
        (r) => r.csat_comment === 'Quick and kind'
      )
      await expect
        .poll(async () => (await csatEvents(thread.id, 'conversation.csat_comment_added')).length)
        .toBe(1)

      // The same link again: a second comment overwrites, with no second event.
      await page.goto(link)
      await rateOnPage(page, 5)
      await page.getByPlaceholder("Anything you'd like to add? (optional)").fill('Changed my mind')
      await page.getByRole('button', { name: 'Send comment' }).click()
      await expect(page.getByText('Thanks, your comment has been added.')).toBeVisible()
      const row = await waitForConversation(
        thread.row.id,
        'the second comment',
        (r) => r.csat_comment === 'Changed my mind'
      )
      expect(row.csat_rating).toBe(5)
      expect(await csatEvents(thread.id, 'conversation.csat_comment_added')).toHaveLength(1)
      expect(await csatEvents(thread.id, 'conversation.csat_submitted')).toHaveLength(1)
    }
  )

  test(
    'CUS-O-26 a second click with another face keeps the first rating',
    { tag: '@core' },
    async ({ request, playwright, baseURL, people, page, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const links = await closeAndGetRatingLinks(
        playwright,
        baseURL!,
        people.people.admin.email,
        customerEmail,
        thread.id
      )
      await page.goto(tokenOnly(links[1]))
      await rateOnPage(page, 2)
      await waitForConversation(thread.row.id, 'first rating', (r) => r.csat_rating === 2)

      await page.goto(tokenOnly(links[4]))
      await rateOnPage(page, 5)
      // The page cannot tell; the record can.
      const row = await conversation(thread.row.id)
      expect(row.csat_rating).toBe(2)
      expect(await csatEvents(thread.id, 'conversation.csat_submitted')).toHaveLength(1)
      const notes = (await messagesIn(thread.row.id)).filter((m) =>
        m.content.startsWith('The customer rated this conversation')
      )
      expect(notes.map((m) => m.content)).toEqual([
        'The customer rated this conversation 2 out of 5',
      ])
    }
  )

  test(
    'CUS-O-27 missing, tampered, expired and out-of-range links show their states',
    { tag: '@core' },
    async ({ request, page, playwright, baseURL, people, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const visitor = principalTypeId(thread.row.visitor_principal_id)
      // A rating is only taken once the conversation is closed: close it so
      // the valid link below records.
      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      await setConversationStatus(api, thread.id, 'closed')
      await api.dispose()

      await page.goto('/csat')
      await expect(page.getByText('Missing Link')).toBeVisible()
      await expect(
        page.getByText(
          'This link is missing some information. Please use the link from your email.'
        )
      ).toBeVisible()

      const valid = mintCsatToken(thread.id, visitor)
      const tampered = valid.slice(0, -2) + (valid.endsWith('AA') ? 'BB' : 'AA')
      await page.goto(csatPath(tampered))
      await expect(page.getByText('Link Expired')).toBeVisible()
      await expect(
        page.getByText('This rating link has expired or is no longer valid.')
      ).toBeVisible()

      const expired = mintCsatToken(thread.id, visitor, -1_000)
      await page.goto(csatPath(expired))
      await expect(page.getByText('Link Expired')).toBeVisible()

      for (const rating of ['abc']) {
        await page.goto(csatPath(valid, rating))
        await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
        for (let r = 1; r <= 5; r++) {
          await expect(page.getByRole('button', { name: `Rate ${r} of 5` })).not.toHaveClass(
            /ring-2/
          )
        }
      }
      await rateOnPage(page, 3)
      await waitForConversation(thread.row.id, 'the rating', (r) => r.csat_rating === 3)
    }
  )

  test(
    'CUS-O-27 an out-of-range numeric rating still opens the page with nothing preselected',
    { tag: '@core' },
    async ({ request, page, customerEmail, marker }) => {
      const thread = await coldThread(request, customerEmail, marker)
      const valid = mintCsatToken(thread.id, principalTypeId(thread.row.visitor_principal_id))
      await page.goto(csatPath(valid, 9))
      await expect(page.getByText('Tap a face to confirm your rating.')).toBeVisible()
      for (let r = 1; r <= 5; r++) {
        await expect(page.getByRole('button', { name: `Rate ${r} of 5` })).not.toHaveClass(/ring-2/)
      }
    }
  )
})

test.describe('in-thread rating', () => {
  test(
    'CUS-O-29 rating a resolved ticket in the thread records it and reopens nothing',
    { tag: '@core' },
    async ({ browser, playwright, baseURL, people, customerEmail, marker }) => {
      await enableSupportTickets()
      const identity = { id: marker, email: customerEmail, name: 'Tess Ticket' }
      // The widget creates the customer on first identify.
      let context = await browser.newContext()
      await openWidgetAs(await context.newPage(), identity)
      await context.close()
      const principalUuid = await principalForUserEmail(customerEmail)

      const api = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      const ticket = await createCustomerTicket(
        api,
        principalTypeId(principalUuid),
        `Rate ticket ${marker}`
      )
      await setTicketStatus(api, ticket.id, await ticketStatusId('Resolved'))
      await api.dispose()
      const [pair] = await supportDb()<{ conversation_id: string }[]>`
        SELECT conversation_id FROM ticket_conversations WHERE ticket_id = ${uuidOf(ticket.id)}`
      const pairId = conversationTypeId(pair.conversation_id)
      // Closed by a teammate (the thread records the close), then the ask.
      const closer = await apiAs(playwright, baseURL!, personalKeyFor(people.people.admin.email))
      await setConversationStatus(closer, pairId, 'closed')
      await closer.dispose()
      await waitForConversation(pair.conversation_id, 'closed', (r) => r.status === 'closed')
      // A rating block in the thread with no workflow run waiting on it.
      const block = {
        v: 1,
        runId: `no-run-${marker}`,
        nodeId: 'csat',
        waiting: true,
        kind: 'csat',
        allowTypingInterrupt: false,
      }
      await supportDb()`
        INSERT INTO conversation_messages
          (id, conversation_id, principal_id, sender_type, content, is_internal, metadata, created_at)
        VALUES (${toUuid(generateId('conversation_msg'))}, ${pair.conversation_id},
                ${uuidOf(people.people.admin.principalId)}, 'agent', ${`Rate us ${marker}`}, false,
                ${supportDb().json({ block } as never)}, now())`
      await supportDb()`UPDATE conversations SET last_message_preview = ${`Rate us ${marker}`},
                        last_message_at = now() WHERE id = ${pair.conversation_id}`

      context = await browser.newContext()
      const widget = await openWidgetAs(await context.newPage(), identity)
      await widget.getByRole('button', { name: /^(?:\d+ unread )?Messages$/ }).click()
      await widget.getByText(`Rate us ${marker}`).first().click()
      await widget.getByRole('button', { name: '5 of 5' }).click()
      await expect(widget.getByText(/thanks/i).first()).toBeVisible({ timeout: 10_000 })
      await context.close()

      const row = await waitForConversation(
        pair.conversation_id,
        'the rating',
        (r) => r.csat_rating === 5
      )
      expect(row.status).toBe('closed')
      await expect
        .poll(async () => (await csatEvents(pairId, 'conversation.csat_submitted')).length)
        .toBe(1)
      // The visitor's answer is announced as a block reply of kind csat.
      await expect
        .poll(async () =>
          (await eventsFor(pairId)).some(
            (e) =>
              e.type === 'message.created' &&
              (e.payload as { message?: { blockReplyKind?: string } }).message?.blockReplyKind ===
                'csat'
          )
        )
        .toBe(true)
      // Give the queued reopen hook its chance, then: still resolved.
      await new Promise((r) => setTimeout(r, 3_000))
      const [t] = await supportDb()<{ category: string }[]>`
        SELECT s.category FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id
        WHERE t.id = ${uuidOf(ticket.id)}`
      expect(t.category).toBe('closed')
      expect((await conversation(pair.conversation_id)).status).toBe('closed')
    }
  )
})
