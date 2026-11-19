/**
 * Notification emails for support: team alerts, ticket emails (received,
 * assigned, reply, resolved), note mentions, customer conversation emails
 * (reply, agent-started, close, auto-acknowledgement), the email log and
 * delivery events, the "Pause all email" switch, and the SLA warning/breach
 * emails.
 *
 * Recipients are fresh per test (seeded teammates, teams and customers), and
 * mail is matched by its recipient plus the test's marker or the
 * conversation's id, never by counting a shared mailbox. A "sends nothing"
 * check always waits for a later mail that does send first.
 */
import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import {
  sendInboundEmail,
  supportInboxAddress,
  ticketReplyAddress,
} from '../../support/inbound-email'
import {
  emailLogFor,
  getMailHeaders,
  linksIn,
  mailTo,
  waitForEmailLog,
  type MailpitMessage,
} from '../../support/mailpit'
import { runSweep } from '../../support/sweeps'
import {
  apiAs,
  clickUntil,
  customerEmailsAgain,
  ensureDefaultSla,
  ensureSupportTickets,
  fnOk,
  isoMinutesFromNow,
  pageAs,
  restAs,
  retireTeammate,
  seedPerson,
  seedTeam,
  setStampFields,
  startEmailConversation,
  startPortalConversation,
  ticketConversationUuid,
  ticketRow,
  ticketStatusId,
  uuidOf,
  fullMailTo,
  waitForMailWhere,
  waitForStamp,
  withLiveWorkflow,
  withSlaTimerLock,
  type SeededPerson,
} from '../../support/sla-csat'

/** Bell rows of a type for a person. */
async function bells(principalUuid: string, type: string) {
  return supportDb()<{ title: string; body: string | null; metadata: unknown }[]>`
    SELECT title, body, metadata FROM in_app_notifications
    WHERE principal_id = ${principalUuid} AND type = ${type} ORDER BY created_at`
}

/** A customer ticket filed by the REST API for a fresh requester. */
async function restTicket(
  playwright: Parameters<typeof restAs>[0],
  requester: SeededPerson,
  title: string
): Promise<{ id: string; uuid: string; label: string }> {
  await ensureSupportTickets(playwright)
  const rest = await restAs(playwright)
  const res = await rest.post('/api/v1/tickets', {
    data: { type: 'customer', title, requesterPrincipalId: requester.principalId },
  })
  expect(res.status(), await res.text()).toBe(201)
  const id = ((await res.json()) as { data: { id: string } }).data.id
  await rest.dispose()
  const uuid = uuidOf(id)
  return { id, uuid, label: `#${(await ticketRow(uuid)).number}` }
}

/** Every message anywhere whose text mentions `text` (Mailpit full-text search). */
async function mailsMentioning(text: string): Promise<{ ID: string; Subject: string }[]> {
  const query = encodeURIComponent(`"${text}"`)
  const res = await fetch(`${supportEnv().mailpitApiUrl}/api/v1/search?query=${query}&limit=50`)
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`)
  return ((await res.json()) as { messages?: { ID: string; Subject: string }[] }).messages ?? []
}

/** Is any teammate's live inbox open right now (an in-scope teammate online)? */
async function anyAgentPresent(): Promise<boolean> {
  const [row] = await supportDb()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM presence_stream
    WHERE is_agent = true AND heartbeat_at > now() - interval '45 seconds'`
  return row.n > 0
}

test.describe('team emails', () => {
  test(
    'NTF-08 with no teammate online a visitor message emails the team with an Open inbox link',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      test.setTimeout(240_000)
      const teammate = await seedPerson(marker, 'teammate')
      const customer = await seedPerson(marker, 'customer')
      const customerApi = await apiAs(playwright, customer)
      try {
        // Any open inbox (another test's tab) silences the alert, by design.
        // Wait for a quiet moment, send, and retry only when someone was
        // online during the attempt.
        let delivered: { mail: MailpitMessage; conversationId: string } | null = null
        for (let attempt = 1; attempt <= 4 && !delivered; attempt++) {
          await pollFor(
            'no teammate online',
            async () => ((await anyAgentPresent()) ? null : true),
            {
              timeoutMs: 60_000,
              intervalMs: 500,
            }
          )
          const text = `Need a hand ${marker} attempt ${attempt}`
          const conversation = await startPortalConversation(customerApi, customer, text)
          const busy = await anyAgentPresent()
          try {
            const mail = await waitForMailWhere(
              teammate.email,
              'the team alert',
              (m) => m.Subject.includes(`attempt ${attempt}`),
              15_000
            )
            delivered = { mail, conversationId: conversation.id }
          } catch (err) {
            if (!busy && !(await anyAgentPresent())) throw err
          }
        }
        expect(delivered, 'a quiet attempt delivered the team alert').not.toBeNull()
        const { mail, conversationId } = delivered!
        expect(mail.Subject).toMatch(new RegExp(`^${customer.name}: `))
        expect(mail.HTML).toContain(`${customer.name} started a conversation in Acme Corp.`)
        expect(mail.HTML).toContain('Open inbox')
        expect(linksIn(mail).some((l) => l.endsWith(`/admin/inbox?i=${conversationId}`))).toBe(true)
        const row = await waitForEmailLog(teammate.email, {
          email_type: 'ConversationMessageEmail',
        })
        expect(row.conversation_id).toBe(uuidOf(conversationId))
      } finally {
        await customerApi.dispose()
        await retireTeammate(teammate)
      }
    }
  )

  test(
    'NTF-12 ticket assignment bells and emails the assignee, and emails the team on a team assignment',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      test.setTimeout(90_000)
      const team = await seedTeam(marker)
      const assignee = await seedPerson(marker, 'teammate', { tag: 'assignee' })
      const m1 = await seedPerson(marker, 'teammate', { tag: 'm1', teamUuids: [team.uuid] })
      const m2 = await seedPerson(marker, 'teammate', { tag: 'm2', teamUuids: [team.uuid] })
      const requester = await seedPerson(marker, 'customer')
      const admin = await apiAs(playwright, 'admin')
      try {
        const toPerson = await restTicket(playwright, requester, `Assign me ${marker}`)
        await fnOk(admin, 'assignTicketFn', {
          ticketId: toPerson.id,
          assigneePrincipalId: assignee.principalId,
        })
        const mine = await waitForMailWhere(assignee.email, 'the email', (m) =>
          m.Subject.includes(`Ticket ${toPerson.label} assigned to you`)
        )
        expect(mine.HTML).toContain(`was assigned to you.`)
        expect(linksIn(mine).some((l) => l.includes(`/admin/inbox?i=${toPerson.id}`))).toBe(true)
        await expect
          .poll(async () => (await bells(assignee.principalUuid, 'ticket_assigned')).length)
          .toBe(1)

        const toTeam = await restTicket(playwright, requester, `Team me ${marker}`)
        await fnOk(admin, 'assignTicketFn', { ticketId: toTeam.id, assigneeTeamId: team.id })
        for (const member of [m1, m2]) {
          await waitForMailWhere(member.email, 'the email', (m) =>
            m.Subject.includes(`Ticket ${toTeam.label} assigned to your team`)
          )
        }
        // The direct assignee of the first ticket got nothing for the team one.
        expect((await mailTo(assignee.email)).map((m) => m.Subject)).not.toContain(
          `Ticket ${toTeam.label} assigned to your team`
        )
      } finally {
        await admin.dispose()
        for (const p of [assignee, m1, m2]) await retireTeammate(p)
      }
    }
  )

  test(
    'NTF-14 a note mention bells and emails the teammate; an edit notifies only the newly mentioned',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(90_000)
      const b = await seedPerson(marker, 'teammate', { tag: 'b' })
      const c = await seedPerson(marker, 'teammate', { tag: 'c' })
      const admin = await apiAs(playwright, 'admin')
      try {
        const conversation = await startEmailConversation(request, marker)
        const mention = (p: SeededPerson) => ({
          type: 'mention',
          attrs: { id: p.principalId, label: p.name },
        })
        const doc = (people: SeededPerson[]) => ({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: `Look at this ${marker} ` },
                ...people.flatMap((p) => [mention(p), { type: 'text', text: ' ' }]),
              ],
            },
          ],
        })
        await fnOk(admin, 'addConversationNoteFn', {
          conversationId: conversation.id,
          content: `Look at this ${marker}`,
          contentJson: doc([b]),
        })
        const subject = 'Ada Admin mentioned you in an internal note'
        const toB = await waitForMailWhere(b.email, 'the email', (m) => m.Subject.includes(subject))
        expect(linksIn(toB).some((l) => l.includes(`/admin/inbox?i=${conversation.id}`))).toBe(true)
        await expect.poll(async () => (await bells(b.principalUuid, 'chat_mention')).length).toBe(1)

        const [note] = await supportDb()<{ id: string }[]>`
          SELECT id FROM conversation_messages
          WHERE conversation_id = ${conversation.uuid} AND is_internal = true
            AND content LIKE ${`Look at this ${marker}%`}`
        const { fromUuid } = await import('@quackback/ids')
        await fnOk(admin, 'editConversationMessageFn', {
          messageId: fromUuid('conversation_msg', note.id),
          content: `Look at this ${marker} again`,
          contentJson: doc([b, c]),
        })
        await waitForMailWhere(c.email, 'the email', (m) => m.Subject.includes(subject))
        // B was already mentioned: no second email or bell.
        await new Promise((r) => setTimeout(r, 1500))
        expect((await mailTo(b.email)).filter((m) => m.Subject === subject)).toHaveLength(1)
        expect(await bells(b.principalUuid, 'chat_mention')).toHaveLength(1)
      } finally {
        await admin.dispose()
        for (const p of [b, c]) await retireTeammate(p)
      }
    }
  )
})

test.describe('ticket emails to the requester', () => {
  test(
    'NTF-20 filing a ticket sends the requester one received email and writes no bell',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const requester = await seedPerson(marker, 'customer')
      await ensureSupportTickets(playwright)
      // Through the portal, as the requester.
      const customerApi = await apiAs(playwright, requester)
      const mine = await fnOk<{ id: string }>(customerApi, 'createMyTicketFn', {
        title: `Received ${marker}`,
        description: 'Please help',
      })
      const label = `#${(await ticketRow(uuidOf(mine.id))).number}`
      const mail = await waitForMailWhere(requester.email, 'the email', (m) =>
        m.Subject.includes(`We received your ticket ${label}: Received ${marker}`)
      )
      expect(mail.Text).toMatch(/We've got your ticket/i)
      expect(mail.HTML).toContain('View your ticket')
      // Through the REST API for them.
      const viaApi = await restTicket(playwright, requester, `Received API ${marker}`)
      await waitForMailWhere(requester.email, 'the email', (m) =>
        m.Subject.includes(`We received your ticket ${viaApi.label}: Received API ${marker}`)
      )
      expect(
        (await mailTo(requester.email)).filter((m) => m.Subject.startsWith('We received'))
      ).toHaveLength(2)
      const [count] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM in_app_notifications
        WHERE principal_id = ${requester.principalUuid} AND type = 'ticket_created'`
      expect(count.n).toBe(0)
      await customerApi.dispose()
    }
  )

  test(
    'NTF-17 an agent ticket reply emails the requester; the requester reply bells agent watchers only',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(90_000)
      const requester = await seedPerson(marker, 'customer')
      const watcher = await seedPerson(marker, 'teammate', { tag: 'watcher' })
      const admin = await apiAs(playwright, 'admin')
      try {
        const ticket = await restTicket(playwright, requester, `Reply ${marker}`)
        await fnOk(admin, 'adminAddTicketWatcherFn', {
          ticketId: ticket.id,
          principalId: watcher.principalId,
        })
        await fnOk(admin, 'sendTicketMessageFn', {
          ticketId: ticket.id,
          content: `We are on it ${marker}`,
        })
        // The requester's one email is the conversation's; the watcher gets
        // the ticket reply email.
        const reply = await waitForMailWhere(requester.email, 'the email', (m) =>
          m.HTML.includes(`We are on it ${marker}`)
        )
        expect(reply.HTML).toContain('replied to your conversation')
        await waitForMailWhere(
          watcher.email,
          'the ticket reply email',
          (m) =>
            m.Subject.includes(`New reply on ${ticket.label}: Reply ${marker}`) &&
            m.HTML.includes(`We are on it ${marker}`)
        )

        // The requester answers by email on the ticket thread.
        const res = await sendInboundEmail(request, {
          from: requester.email,
          to: ticketReplyAddress(ticket.id),
          subject: `Re: Reply ${marker}`,
          text: `Thanks ${marker}`,
          messageId: `<${randomUUID()}@customers.example>`,
        })
        expect(res.status(), await res.text()).toBe(200)
        await expect
          .poll(async () => (await bells(watcher.principalUuid, 'ticket_replied')).length, {
            timeout: 20_000,
          })
          .toBeGreaterThanOrEqual(1)
        // A later agent reply reaches the requester. By then they were never
        // mailed about their own reply, and the first agent reply reached them
        // once, never as the ticket reply email.
        await fnOk(admin, 'sendTicketMessageFn', {
          ticketId: ticket.id,
          content: `Glad to help ${marker}`,
        })
        await waitForMailWhere(requester.email, 'the later email', (m) =>
          m.HTML.includes(`Glad to help ${marker}`)
        )
        const mails = await fullMailTo(requester.email)
        expect(mails.filter((m) => m.Subject.startsWith('New reply on'))).toEqual([])
        expect(mails.filter((m) => m.HTML.includes(`We are on it ${marker}`))).toHaveLength(1)
        // Every mail is the confirmation or an agent reply (the later one may
        // quote their message, but none is about it).
        const other = mails.filter(
          (m) =>
            !m.Subject.startsWith('We received your ticket') &&
            !m.HTML.includes(`We are on it ${marker}`) &&
            !m.HTML.includes(`Glad to help ${marker}`)
        )
        expect(other.map((m) => m.Subject)).toEqual([])
      } finally {
        await admin.dispose()
        await retireTeammate(watcher)
      }
    }
  )

  test(
    'NTF-16 resolving a customer ticket emails the requester that it was resolved',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const requester = await seedPerson(marker, 'customer')
      const admin = await apiAs(playwright, 'admin')
      const ticket = await restTicket(playwright, requester, `Resolve ${marker}`)
      await fnOk(admin, 'setTicketStatusFn', {
        ticketId: ticket.id,
        statusId: await ticketStatusId('closed'),
      })
      const mail = await waitForMailWhere(requester.email, 'the email', (m) =>
        m.Subject.includes(`Your ticket ${ticket.label} was resolved`)
      )
      expect(mail.Text).toContain(
        "Reply on the ticket thread if this isn't fixed for you; replying reopens it."
      )
      const conversationUuid = await ticketConversationUuid(ticket.uuid)
      const { fromUuid } = await import('@quackback/ids')
      expect(
        linksIn(mail).some((l) =>
          l.includes(`/support/${fromUuid('conversation', conversationUuid)}`)
        )
      ).toBe(true)
      await admin.dispose()
    }
  )
})

test.describe('customer conversation emails', () => {
  test(
    'NTF-25 an agent reply emails an offline portal visitor, and not one with the thread open',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      test.setTimeout(120_000)
      const customer = await seedPerson(marker, 'customer')
      const customerApi = await apiAs(playwright, customer)
      const admin = await apiAs(playwright, 'admin')
      const conversation = await startPortalConversation(
        customerApi,
        customer,
        `Portal question ${marker}`
      )
      const reply = (content: string) =>
        fnOk(admin, 'sendAgentMessageFn', { conversationId: conversation.id, content })

      // Online: the visitor has the thread open.
      const portal = await pageAs(browser, customer)
      await portal.goto(`/support/${conversation.id}`)
      await pollFor('the visitor online', async () => {
        const [row] = await supportDb()<{ n: number }[]>`
          SELECT count(*)::int AS n FROM presence_stream WHERE principal_id = ${customer.principalId}`
        return row.n > 0 ? true : null
      })
      await reply(`While you are here ${marker}`)
      await expect(portal.getByText(`While you are here ${marker}`)).toBeVisible()
      await portal.context().close()

      // Offline: the next reply is emailed.
      await pollFor(
        'the visitor offline',
        async () => {
          const [row] = await supportDb()<{ n: number }[]>`
            SELECT count(*)::int AS n FROM presence_stream WHERE principal_id = ${customer.principalId}`
          return row.n === 0 ? true : null
        },
        { timeoutMs: 60_000, intervalMs: 500 }
      )
      await reply(`After you left ${marker}`)
      const mail = await waitForMailWhere(customer.email, 'the reply email', (m) =>
        m.HTML.includes(`After you left ${marker}`)
      )
      expect(mail.HTML).toContain('Ada Admin replied to your conversation with Acme Corp.')
      expect(mail.HTML).toContain('View conversation')
      expect(linksIn(mail).some((l) => l.includes(`/support/${conversation.id}`))).toBe(true)
      const headers = await getMailHeaders(mail.ID)
      expect(headers['Reply-To']?.[0] ?? '').toContain('@inbound.test')
      // The reply sent while they were online was never emailed.
      expect(
        (await fullMailTo(customer.email)).some((m) =>
          m.HTML.includes(`While you are here ${marker}`)
        )
      ).toBe(false)
      await Promise.all([admin.dispose(), customerApi.dispose()])
    }
  )

  test(
    'NTF-26 a reply on an email conversation always mails, threaded on the original',
    { tag: '@core' },
    async ({ browser, playwright, request, marker }) => {
      test.setTimeout(90_000)
      const customer = await seedPerson(marker, 'customer')
      const conversation = await startEmailConversation(request, marker, {
        customer,
        subject: `Threaded ${marker}`,
      })
      // The customer also has the thread open in the portal (online).
      const portal = await pageAs(browser, customer)
      await portal.goto(`/support/${conversation.id}`)
      const admin = await apiAs(playwright, 'admin')
      await fnOk(admin, 'sendAgentMessageFn', {
        conversationId: conversation.id,
        content: `By email anyway ${marker}`,
      })
      const mail = await waitForMailWhere(customer.email, 'the reply', (m) =>
        m.HTML.includes(`By email anyway ${marker}`)
      )
      expect(mail.Subject).toBe(`Re: Threaded ${marker}`)
      const row = await waitForEmailLog(customer.email, { email_type: 'ConversationReplyEmail' })
      expect(row.conversation_id).toBe(conversation.uuid)
      const headers = await getMailHeaders(mail.ID)
      const [original] = await supportDb()<{ id: string }[]>`
        SELECT metadata ->> 'emailMessageId' AS id FROM conversation_messages
        WHERE conversation_id = ${conversation.uuid} AND sender_type = 'visitor' LIMIT 1`
      const bare = original.id.replace(/[<>]/g, '')
      expect((headers['In-Reply-To'] ?? []).join(' ')).toContain(bare)
      await portal.context().close()
      await admin.dispose()
    }
  )

  test(
    'NTF-27 an agent-started conversation emails the customer the opening message',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const customer = await seedPerson(marker, 'customer')
      const admin = await apiAs(playwright, 'admin')
      await fnOk(admin, 'startAgentConversationFn', {
        targetPrincipalId: customer.principalId,
        content: `Reaching out ${marker}`,
      })
      const mail = await waitForMailWhere(customer.email, 'the opening message', (m) =>
        m.HTML.includes(`Reaching out ${marker}`)
      )
      // The conversation's subject is its opening line, so the subject is Re: that.
      expect(mail.Subject).toBe(`Re: Reaching out ${marker}`)
      expect(mail.HTML).toContain('Ada Admin from Acme Corp sent you a message.')
      await admin.dispose()
    }
  )

  test(
    'NTF-28 closing an email conversation sends the close email; auto-close says why; a spam end sends none',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(120_000)
      const admin = await apiAs(playwright, 'admin')
      const closeMails = async (customer: SeededPerson) =>
        (await fullMailTo(customer.email)).filter(
          (m) =>
            m.HTML.includes('marked this conversation as resolved') ||
            m.HTML.includes('was closed because')
        )

      // A teammate closes it.
      const plain = await seedPerson(marker, 'customer', { tag: 'plain' })
      const c1 = await startEmailConversation(request, `${marker}-1`, { customer: plain })
      await fnOk(admin, 'setConversationStatusFn', { conversationId: c1.id, status: 'closed' })
      const closed = await waitForMailWhere(plain.email, 'the close email', (m) =>
        m.HTML.includes('Not sorted? Just reply to this email and the conversation will reopen.')
      )
      expect(closed.HTML).toContain('How did we do?')
      expect(linksIn(closed).filter((l) => l.includes('/csat?token='))).toHaveLength(5)
      expect(linksIn(closed).some((l) => l.endsWith(`/support/${c1.id}`))).toBe(true)
      await waitForEmailLog(plain.email, { email_type: 'ConversationClosedEmail' })

      // A workflow auto-closes it.
      const quiet = await seedPerson(marker, 'customer', { tag: 'quiet' })
      const c2 = await startEmailConversation(request, `${marker}-2`, { customer: quiet })
      await withLiveWorkflow(
        admin,
        {
          name: `Auto-close ${marker}`,
          triggerType: 'message.created',
          onlyFor: quiet.email,
          alsoWhen: [{ field: 'message.body', op: 'contains', value: `Close me ${marker}` }],
          steps: [
            { id: 'close', type: 'action', action: { type: 'close', lifecycle: 'auto_closed' } },
          ],
        },
        async () => {
          await customerEmailsAgain(request, c2, `Close me ${marker}`)
          const auto = await waitForMailWhere(quiet.email, 'the auto-close email', (m) =>
            m.Text.includes("This conversation was closed because we haven't heard back from you.")
          )
          expect(auto.Text).toContain('Need anything else? Just reply')
        }
      )

      // Ended as spam: no close email. Then a normal close on a fresh one
      // does send, so the absence is real.
      const spam = await seedPerson(marker, 'customer', { tag: 'spam' })
      const c3 = await startEmailConversation(request, `${marker}-3`, { customer: spam })
      await fnOk(admin, 'endConversationFn', { conversationId: c3.id, reason: 'spam' })
      const c4 = await startEmailConversation(request, `${marker}-4`, { customer: spam })
      await fnOk(admin, 'setConversationStatusFn', { conversationId: c4.id, status: 'closed' })
      await waitForMailWhere(spam.email, 'the close email of the second', (m) =>
        linksIn(m).some((l) => l.endsWith(`/support/${c4.id}`))
      )
      const spamCloses = (await closeMails(spam)).filter((m) =>
        linksIn(m).some((l) => l.endsWith(`/support/${c3.id}`))
      )
      expect(spamCloses).toHaveLength(0)
      await admin.dispose()
    }
  )

  test(
    'NTF-29 a cold email gets one auto-acknowledgement, capped per sender, never for auto-generated mail',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      await fnOk(admin, 'updateEmailAutoAckFn', { enabled: true })
      const sender = `${marker}@customers.example`
      const cold = (subject: string, headers?: Record<string, string>) =>
        sendInboundEmail(request, {
          from: sender,
          to: supportInboxAddress(),
          subject,
          text: `Hello ${subject}`,
          messageId: `<${randomUUID()}@customers.example>`,
          headers,
        })
      const acks = async () =>
        (await emailLogFor(sender)).filter((r) => r.email_type === 'ConversationAutoAckEmail')

      // Auto-generated mail first: no acknowledgement for it.
      expect((await cold(`Robot ${marker}`, { 'auto-submitted': 'auto-generated' })).status()).toBe(
        200
      )
      expect((await cold(`First ${marker}`)).status()).toBe(200)
      const first = await waitForMailWhere(sender, 'the acknowledgement', (m) =>
        m.HTML.includes('We received your email and will get back to you shortly.')
      )
      const headers = await getMailHeaders(first.ID)
      expect(headers['Auto-Submitted']?.[0]).toBe('auto-replied')
      expect(headers['Precedence']?.[0]).toBe('auto_reply')
      expect(first.Subject).toContain(`First ${marker}`)
      expect(await acks()).toHaveLength(1)

      // Two more within the hour: the second is acknowledged, the third capped.
      expect((await cold(`Second ${marker}`)).status()).toBe(200)
      await pollFor('the second acknowledgement', async () =>
        (await acks()).length === 2 ? true : null
      )
      expect((await cold(`Third ${marker}`)).status()).toBe(200)
      await pollFor('the third conversation', async () => {
        const [row] = await supportDb()<{ n: number }[]>`
          SELECT count(*)::int AS n FROM conversations WHERE subject = ${`Third ${marker}`}`
        return row.n > 0 ? true : null
      })
      await new Promise((r) => setTimeout(r, 2000))
      expect(await acks()).toHaveLength(2)
      expect((await mailTo(sender)).some((m) => m.Subject.includes(`Robot ${marker}`))).toBe(false)
      await admin.dispose()
    }
  )
})

test.describe('the email log and delivery events', () => {
  test(
    'NTF-30 a sent email writes an email_log row matching what arrives in Mailpit',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const customer = await seedPerson(marker, 'customer')
      const admin = await apiAs(playwright, 'admin')
      await fnOk(admin, 'startAgentConversationFn', {
        targetPrincipalId: customer.principalId,
        content: `Logged ${marker}`,
      })
      const mail = await waitForMailWhere(customer.email, 'the email', (m) =>
        m.HTML.includes(`Logged ${marker}`)
      )
      const row = await waitForEmailLog(customer.email, { direction: 'outbound' })
      expect(row).toMatchObject({
        status: 'sent',
        provider: 'smtp',
        email_type: 'ConversationMessageEmail',
        subject: mail.Subject,
      })
      expect(row.conversation_id).not.toBeNull()
      expect(mail.To.map((t) => t.Address)).toEqual([customer.email])
      await admin.dispose()
    }
  )

  test(
    'NTF-31 a bounce or complaint event marks the matching email_log row',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      const sent: { address: string; messageId: string }[] = []
      for (const tag of ['bounce', 'complaint']) {
        const customer = await seedPerson(marker, 'customer', { tag })
        await fnOk(admin, 'startAgentConversationFn', {
          targetPrincipalId: customer.principalId,
          content: `Will ${tag} ${marker}`,
        })
        await waitForEmailLog(customer.email, { status: 'sent' })
        // SMTP has no delivery webhooks: give the row the id a provider
        // (Resend, SES) would have reported, as a provider send stores it.
        const providerId = `${tag}-${randomUUID()}`
        await supportDb()`UPDATE email_log SET provider_message_id = ${providerId}
                          WHERE address = ${customer.email} AND direction = 'outbound'`
        sent.push({ address: customer.email, messageId: providerId })
      }
      const token = supportEnv().app.EMAIL_INBOUND_SIGNING_SECRET
      const post = (body: unknown, t = token) =>
        request.post(`/api/chat/email/events?token=${encodeURIComponent(t)}`, { data: body })

      expect(
        (
          await post({ type: 'email.bounced', data: { email_id: sent[0].messageId } }, 'wrong')
        ).status()
      ).toBe(401)
      const bounced = await post({ type: 'email.bounced', data: { email_id: sent[0].messageId } })
      expect(await bounced.json()).toEqual({ status: 'recorded' })
      const complaint = await post({
        notificationType: 'Complaint',
        mail: { messageId: sent[1].messageId },
      })
      expect(await complaint.json()).toEqual({ status: 'recorded' })
      const unknown = await post({
        type: 'email.bounced',
        data: { email_id: `<${randomUUID()}@x>` },
      })
      expect(await unknown.json()).toEqual({ status: 'ignored' })

      expect((await emailLogFor(sent[0].address))[0].status).toBe('bounced')
      expect((await emailLogFor(sent[1].address))[0].status).toBe('complaint')
      await admin.dispose()
    }
  )
})

test.describe('Pause all email', () => {
  test(
    "NTF-23 pausing all email stops a teammate's ticket emails while the bells continue",
    { tag: '@nightly' },
    async ({ browser, playwright, marker }) => {
      test.setTimeout(120_000)
      const teammate = await seedPerson(marker, 'teammate')
      const requester = await seedPerson(marker, 'customer')
      const admin = await apiAs(playwright, 'admin')
      try {
        const page = await pageAs(browser, teammate)
        await page.goto('/admin/settings/notifications')
        const pause = page.getByRole('switch', { name: 'Pause all email notifications' })
        await expect(pause).toBeVisible({ timeout: 20_000 })
        await clickUntil(
          pause,
          page.locator(
            '[role="switch"][aria-checked="true"][aria-label="Pause all email notifications"]'
          )
        )
        await expect
          .poll(async () => {
            const [row] = await supportDb()<{ email_muted: boolean }[]>`
              SELECT email_muted FROM notification_preferences WHERE principal_id = ${teammate.principalUuid}`
            return row?.email_muted ?? false
          })
          .toBe(true)
        await page.context().close()

        // Paused: the assignment still bells, but sends no email. A second
        // assignee who is not paused gets theirs, so the absence is real.
        const control = await seedPerson(marker, 'teammate', { tag: 'control' })
        const ticket = await restTicket(playwright, requester, `Paused ${marker}`)
        await fnOk(admin, 'assignTicketFn', {
          ticketId: ticket.id,
          assigneePrincipalId: teammate.principalId,
        })
        await expect
          .poll(async () => (await bells(teammate.principalUuid, 'ticket_assigned')).length)
          .toBe(1)
        const other = await restTicket(playwright, requester, `Control ${marker}`)
        await fnOk(admin, 'assignTicketFn', {
          ticketId: other.id,
          assigneePrincipalId: control.principalId,
        })
        await waitForMailWhere(control.email, 'the email', (m) =>
          m.Subject.includes(`Ticket ${other.label} assigned to you`)
        )
        await new Promise((r) => setTimeout(r, 1500))
        // Only ticket mail is checked here; the team alert is the next test.
        expect(
          (await mailTo(teammate.email)).filter((m) => m.Subject.startsWith('Ticket '))
        ).toEqual([])
        await retireTeammate(control)
      } finally {
        await admin.dispose()
        await retireTeammate(teammate)
      }
    }
  )

  test(
    'NTF-23 pausing all email also stops the team alert for a visitor message',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      test.setTimeout(120_000)
      const paused = await seedPerson(marker, 'teammate', { tag: 'paused' })
      const control = await seedPerson(marker, 'teammate', { tag: 'control' })
      await supportDb()`INSERT INTO notification_preferences (id, principal_id, email_muted)
                        VALUES (${randomUUID()}, ${paused.principalUuid}, true)`
      const customer = await seedPerson(marker, 'customer')
      const customerApi = await apiAs(playwright, customer)
      try {
        await pollFor('no teammate online', async () => ((await anyAgentPresent()) ? null : true), {
          timeoutMs: 60_000,
          intervalMs: 500,
        })
        await startPortalConversation(customerApi, customer, `Paused alert ${marker}`)
        await waitForMailWhere(control.email, 'the control alert', (m) =>
          m.Subject.includes(`Paused alert ${marker}`)
        )
        expect(
          (await mailTo(paused.email)).filter((m) => m.Subject.includes(`Paused alert ${marker}`))
        ).toEqual([])
      } finally {
        await customerApi.dispose()
        for (const p of [paused, control]) await retireTeammate(p)
      }
    }
  )
})

test.describe('SLA emails', () => {
  /** Assign, backdate the first response into the warning window, and return. */
  async function dueSoonConversation(
    admin: APIRequestContext,
    request: APIRequestContext,
    marker: string,
    customer: SeededPerson,
    assign: { assignTo?: string; teamId?: string }
  ) {
    const conversation = await startEmailConversation(request, marker, { customer })
    await waitForStamp(conversation.uuid, 'the default stamp', () => true)
    if (assign.assignTo) {
      await fnOk(admin, 'assignConversationFn', {
        conversationId: conversation.id,
        assignTo: assign.assignTo,
      })
    }
    if (assign.teamId) {
      await supportDb()`UPDATE conversations SET assigned_team_id = ${uuidOf(assign.teamId)},
                          assigned_agent_principal_id = NULL WHERE id = ${conversation.uuid}`
    }
    return conversation
  }

  /** Messages in Mailpit that link to this conversation's inbox page. */
  async function slaMailsFor(
    address: string,
    conversationId: string,
    kind: 'SLA at risk' | 'SLA breached'
  ) {
    return (await fullMailTo(address)).filter(
      (m) =>
        m.Subject.startsWith(kind) &&
        linksIn(m).some((l) => l.endsWith(`/admin/inbox?i=${conversationId}`))
    )
  }

  test(
    'SLA-23 the warning email goes to the assignee, else the team, and nobody when unassigned',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(180_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const team = await seedTeam(marker)
      const b = await seedPerson(marker, 'teammate', { tag: 'b', teamUuids: [team.uuid] })
      const t1 = await seedPerson(marker, 'teammate', { tag: 't1', teamUuids: [team.uuid] })
      const customer = await seedPerson(marker, 'customer')
      try {
        await withSlaTimerLock(admin, async () => {
          const toB = await dueSoonConversation(admin, request, `${marker}-a`, customer, {
            assignTo: b.principalId,
          })
          await supportDb()`UPDATE conversations SET assigned_team_id = ${team.uuid} WHERE id = ${toB.uuid}`
          const toTeam = await dueSoonConversation(admin, request, `${marker}-b`, customer, {
            teamId: team.id,
          })
          const nobody = await dueSoonConversation(admin, request, `${marker}-c`, customer, {})
          for (const c of [toB, toTeam, nobody]) {
            await setStampFields('conversations', c.uuid, {
              firstResponseDueAt: isoMinutesFromNow(5),
            })
          }
          await withLiveWorkflow(
            admin,
            {
              name: `Warn mail ${marker}`,
              triggerType: 'sla.approaching_breach',
              triggerSettings: { breachLeadMinutes: 15 },
              onlyFor: customer.email,
              steps: [
                {
                  id: 'note',
                  type: 'action',
                  action: { type: 'add_note', body: `Warned ${marker}` },
                },
              ],
            },
            async () => {
              await runSweep(request, 'workflow-sweep')
              // (a) Assigned to B (and B's team): B only.
              const [toBMail] = await pollFor('the warning to B', async () => {
                const m = await slaMailsFor(b.email, toB.id, 'SLA at risk')
                return m.length ? m : null
              })
              expect(toBMail.Subject).toMatch(/^SLA at risk: first response due /)
              expect(toBMail.HTML).toContain('First response SLA approaching breach')
              expect(toBMail.Text).toContain(
                "You're receiving this because you're responsible for this conversation."
              )
              // (b) Team only: every member.
              for (const member of [b, t1]) {
                await pollFor(`the team warning to ${member.email}`, async () => {
                  const m = await slaMailsFor(member.email, toTeam.id, 'SLA at risk')
                  return m.length ? m : null
                })
              }
              expect(await slaMailsFor(t1.email, toB.id, 'SLA at risk')).toHaveLength(0)
              // (c) Unassigned: no one (its clock was claimed in the same sweep).
              await waitForStamp(nobody.uuid, 'the unassigned warning claimed', (s) =>
                Boolean(s.firstResponseWarningFiredAt)
              )
              const slaAtRisk = async (id: string) =>
                (await mailsMentioning(id)).filter((m) => m.Subject.startsWith('SLA at risk'))
              expect(await slaAtRisk(nobody.id)).toHaveLength(0)
              expect((await slaAtRisk(toB.id)).length).toBeGreaterThan(0)
              // No bell for SLA warnings.
              expect(await bells(b.principalUuid, 'sla_warning')).toHaveLength(0)
            }
          )
        })
      } finally {
        await admin.dispose()
        for (const p of [b, t1]) await retireTeammate(p)
      }
    }
  )

  test(
    'SLA-23 the warning email is sent without any workflow listening',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(120_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const b = await seedPerson(marker, 'teammate', { tag: 'b' })
      const customer = await seedPerson(marker, 'customer')
      try {
        await withSlaTimerLock(admin, async () => {
          const conversation = await dueSoonConversation(admin, request, marker, customer, {
            assignTo: b.principalId,
          })
          await setStampFields('conversations', conversation.uuid, {
            firstResponseDueAt: isoMinutesFromNow(5),
          })
          await runSweep(request, 'workflow-sweep')
          await pollFor('the warning to B', async () => {
            const m = await slaMailsFor(b.email, conversation.id, 'SLA at risk')
            return m.length ? m : null
          })
        })
      } finally {
        await admin.dispose()
        await retireTeammate(b)
      }
    }
  )

  test(
    'SLA-24 the breach email goes to the assignee with the breach subject',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(180_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const b = await seedPerson(marker, 'teammate', { tag: 'b' })
      const customer = await seedPerson(marker, 'customer')
      try {
        await withSlaTimerLock(admin, async () => {
          const conversation = await dueSoonConversation(admin, request, marker, customer, {
            assignTo: b.principalId,
          })
          await withLiveWorkflow(
            admin,
            {
              name: `Breach mail ${marker}`,
              triggerType: 'sla.breached',
              onlyFor: customer.email,
              steps: [
                {
                  id: 'note',
                  type: 'action',
                  action: { type: 'add_note', body: `Breached ${marker}` },
                },
              ],
            },
            async () => {
              await setStampFields('conversations', conversation.uuid, {
                firstResponseDueAt: isoMinutesFromNow(-1),
              })
              await runSweep(request, 'workflow-sweep')
              const [mail] = await pollFor('the breach email', async () => {
                const m = await slaMailsFor(b.email, conversation.id, 'SLA breached')
                return m.length ? m : null
              })
              expect(mail.Subject).toBe(`SLA breached: first response for ${customer.name}`)
              expect(mail.HTML).toContain('First response was due')
            }
          )
        })
      } finally {
        await admin.dispose()
        await retireTeammate(b)
      }
    }
  )

  test(
    "SLA-25 ticket time-to-resolve emails go to the linked conversation's owner, not the ticket's",
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(180_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      await ensureSupportTickets(playwright)
      const owner = await seedPerson(marker, 'teammate', { tag: 'owner' })
      const ticketAssignee = await seedPerson(marker, 'teammate', { tag: 'tassignee' })
      const customer = await seedPerson(marker, 'customer')
      const customerApi = await apiAs(playwright, customer)
      try {
        const ticket = await fnOk<{ id: string }>(customerApi, 'createMyTicketFn', {
          title: `TTR mail ${marker}`,
          description: 'Please',
        })
        const ticketUuid = uuidOf(ticket.id)
        const conversationUuid = await ticketConversationUuid(ticketUuid)
        const { fromUuid } = await import('@quackback/ids')
        const conversationId = fromUuid('conversation', conversationUuid)
        await pollFor('the ticket stamp', async () => (await ticketRow(ticketUuid)).sla_applied)
        await fnOk(admin, 'assignConversationFn', { conversationId, assignTo: owner.principalId })
        await fnOk(admin, 'assignTicketFn', {
          ticketId: ticket.id,
          assigneePrincipalId: ticketAssignee.principalId,
        })
        await withSlaTimerLock(admin, async () => {
          await setStampFields('tickets', ticketUuid, { timeToResolveDueAt: isoMinutesFromNow(5) })
          await withLiveWorkflow(
            admin,
            {
              name: `TTR warn ${marker}`,
              triggerType: 'sla.approaching_breach',
              triggerSettings: { breachLeadMinutes: 15 },
              onlyFor: customer.email,
              steps: [
                { id: 'note', type: 'action', action: { type: 'add_note', body: `TTR ${marker}` } },
              ],
            },
            async () => {
              await runSweep(request, 'workflow-sweep')
              const [mail] = await pollFor('the TTR warning to the owner', async () => {
                const m = await slaMailsFor(owner.email, conversationId, 'SLA at risk')
                return m.length ? m : null
              })
              expect(mail.Subject).toMatch(/^SLA at risk: time to resolve due /)
              expect(
                await slaMailsFor(ticketAssignee.email, conversationId, 'SLA at risk')
              ).toHaveLength(0)
            }
          )
        })
      } finally {
        await Promise.all([admin.dispose(), customerApi.dispose()])
        for (const p of [owner, ticketAssignee]) await retireTeammate(p)
      }
    }
  )
})
