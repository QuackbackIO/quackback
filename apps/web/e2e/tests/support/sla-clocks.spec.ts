/**
 * SLA clocks: the default policy at intake, apply_sla, hand-over to tickets,
 * first/next response, time to close, ticket time to resolve, the breach sweep
 * and the SLA timer triggers.
 *
 * Every conversation here comes through a real door (the widget, the portal,
 * inbound email, the REST API) so the default SLA and the event hooks run.
 * Timers never wait: a test moves its own row's due time and runs the sweep at
 * the wall clock.
 */
import { formatSlaCountdown } from '../../../src/lib/shared/conversation/sla'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import { runSweep } from '../../support/sweeps'
import { sink } from '../../support/webhook-sink-client'
import { createSupportApiKey } from '../../utils/db-helpers'
import {
  apiAs,
  createSlaPolicy,
  customerEmailsAgain,
  ensureDefaultSla,
  ensureSupportTickets,
  fnOk,
  isoMinutesFromNow,
  restAs,
  messagesOf,
  policyTargetsOf,
  seedPerson,
  setStampFields,
  slaEventsFor,
  slaStampOf,
  startEmailConversation,
  ticketConversationUuid,
  ticketRow,
  ticketSlaStampOf,
  ticketStatusId,
  uuidOf,
  waitForSlaEvent,
  waitForStamp,
  withLiveWorkflow,
  withSlaTimerLock,
  workflowRuns,
} from '../../support/sla-csat'

const HOUR_MS = 3_600_000

function msBetween(a: unknown, b: unknown): number {
  return new Date(String(a)).getTime() - new Date(String(b)).getTime()
}

test.describe('default SLA at intake', () => {
  test(
    'SLA-06 a new widget conversation carries the default SLA chip and an applied event',
    { tag: '@smoke' },
    async ({ browser, playwright, asPerson, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)

      // An anonymous visitor starts a conversation in the widget.
      const visitorContext = await browser.newContext()
      const widget = await visitorContext.newPage()
      await widget.goto('/widget')
      await widget.getByRole('button', { name: 'Messages', exact: true }).click()
      await widget
        .getByRole('button', { name: /Ask a question|New conversation|Send us a message/ })
        .first()
        .click()
      const composer = widget.locator('.ProseMirror[contenteditable="true"]')
      await expect(composer).toBeVisible({ timeout: 15_000 })
      await composer.fill(`Widget question ${marker}`)
      await widget.getByRole('button', { name: 'Send', exact: true }).click()

      const conversationUuid = await pollFor(
        'the widget conversation',
        async () => {
          const [row] = await supportDb()<{ conversation_id: string }[]>`
            SELECT conversation_id FROM conversation_messages
            WHERE content LIKE ${`%${marker}%`} AND sender_type = 'visitor' LIMIT 1`
          return row?.conversation_id ?? null
        },
        { timeoutMs: 20_000 }
      )

      // The stamp: the default policy's clocks, due from the apply instant.
      const stamp = await waitForStamp(conversationUuid, 'the default SLA stamp', () => true)
      expect(stamp.policyId).toMatch(/^sla_policy_/)
      expect(stamp.pausedSpans).toEqual([])
      expect(msBetween(stamp.firstResponseDueAt, stamp.appliedAt)).toBe(
        (await policyTargetsOf(stamp.policyId)).firstResponseTargetSecs! * 1000
      )
      expect(msBetween(stamp.timeToCloseDueAt, stamp.appliedAt)).toBe(
        (await policyTargetsOf(stamp.policyId)).timeToCloseTargetSecs! * 1000
      )
      expect(stamp.nextResponseTargetSecs).toBe(
        (await policyTargetsOf(stamp.policyId)).nextResponseTargetSecs!
      )
      await waitForSlaEvent({ conversationUuid }, 'applied')
      const applied = await slaEventsFor({ conversationUuid }, 'applied')
      expect(applied).toHaveLength(1)
      expect(applied[0].meta).toMatchObject({
        firstResponseDueAt: stamp.firstResponseDueAt,
        timeToCloseDueAt: stamp.timeToCloseDueAt,
      })

      // A teammate sees the chip on the conversation: about 4 hours to first response.
      const page = await asPerson('admin')
      const { fromUuid } = await import('@quackback/ids')
      await page.goto(`/admin/inbox?i=${fromUuid('conversation', conversationUuid)}`)
      await expect(page.getByText(`Widget question ${marker}`).first()).toBeVisible({
        timeout: 20_000,
      })
      const chip = page.locator('span[title$="· first response target"]').first()
      await expect(chip).toBeVisible({ timeout: 15_000 })
      // It counts down to the stamp's own first-response due time (any label
      // the next two minutes could show, so a slow page cannot flake it).
      const dueMs = new Date(String(stamp.firstResponseDueAt)).getTime()
      const labels = [-60, -30, 0, 30, 60, 90, 120].map((s) =>
        formatSlaCountdown(dueMs - Date.now() - s * 1000)
      )
      expect(labels).toContain(await chip.innerText())

      // The visitor's own copy carries no SLA.
      const visitorView = await widget.evaluate(async () => document.body.innerText)
      expect(visitorView).not.toContain('First response')
      await visitorContext.close()
      await admin.dispose()
    }
  )

  test(
    'SLA-07 a new customer ticket gets the default SLA at intake through REST and the portal',
    { tag: '@smoke' },
    async ({ playwright, baseURL, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      await ensureSupportTickets(playwright)
      const customer = await seedPerson(marker, 'customer')

      // REST: a teammate's key files a customer ticket for the requester.
      const key = createSupportApiKey('e2e-support-admin@example.com')
      const rest = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { authorization: `Bearer ${key}` },
      })
      const created = await rest.post('/api/v1/tickets', {
        data: {
          type: 'customer',
          title: `REST ticket ${marker}`,
          requesterPrincipalId: customer.principalId,
        },
      })
      expect(created.status(), await created.text()).toBe(201)
      const restTicketId = ((await created.json()) as { data: { id: string } }).data.id

      // Portal: the requester files their own ticket.
      const customerApi = await apiAs(playwright, customer)
      const mine = await fnOk<{ id: string }>(customerApi, 'createMyTicketFn', {
        title: `Portal ticket ${marker}`,
        description: 'Filed from the portal',
      })

      for (const ticketId of [restTicketId, mine.id]) {
        const ticketUuid = uuidOf(ticketId)
        const conversationUuid = await ticketConversationUuid(ticketUuid)
        // The backing conversation got the default SLA, then the ticket its TTR.
        const conversationStamp = await waitForStamp(
          conversationUuid,
          'conversation stamp',
          () => true
        )
        const ticketStamp = await pollFor('the ticket stamp', () => ticketSlaStampOf(ticketUuid))
        expect(ticketStamp.policyId).toBe(conversationStamp.policyId)
        expect(msBetween(ticketStamp.timeToResolveDueAt, ticketStamp.appliedAt)).toBe(
          (await policyTargetsOf(ticketStamp.policyId)).timeToResolveTargetSecs! * 1000
        )
        await waitForSlaEvent({ ticketUuid }, 'applied')
        const ticketApplied = await slaEventsFor({ ticketUuid }, 'applied')
        expect(ticketApplied).toHaveLength(1)
        expect(ticketApplied[0].meta).toMatchObject({
          timeToResolveDueAt: ticketStamp.timeToResolveDueAt,
        })
        await waitForSlaEvent({ conversationUuid }, 'applied')
        expect(await slaEventsFor({ conversationUuid }, 'applied')).toHaveLength(1)
      }

      // The internal ticket view carries the SLA.
      const internal = await fnOk<{ sla?: unknown }>(
        admin,
        'getTicketFn',
        { ticketId: mine.id },
        { method: 'GET' }
      )
      expect(internal.sla).toBeTruthy()
      const restBody = (await (await rest.get(`/api/v1/tickets/${restTicketId}`)).json()) as {
        data: Record<string, unknown>
      }
      // The REST ticket carries the SLA too.
      expect(restBody.data.sla).toMatchObject({
        policyName: expect.any(String),
        timeToResolveDueAt: expect.any(String),
        resolvedAt: null,
        paused: false,
      })

      await rest.dispose()
      await customerApi.dispose()
      await admin.dispose()
    }
  )
})

test.describe('default SLA at intake: webhook', () => {
  test(
    'SLA-07 the ticket.created webhook carries the ticket SLA',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const customer = await seedPerson(marker, 'customer')
      const rest = await restAs(playwright)
      const hook = await rest.post('/api/v1/webhooks', {
        data: { url: sink.url(marker), events: ['ticket.created'] },
      })
      expect(hook.status(), await hook.text()).toBe(201)
      const { data: webhook } = (await hook.json()) as { data: { id: string } }
      try {
        const created = await rest.post('/api/v1/tickets', {
          data: {
            type: 'customer',
            title: `Hook ticket ${marker}`,
            requesterPrincipalId: customer.principalId,
          },
        })
        expect(created.status()).toBe(201)
        const [delivery] = await sink.waitForDeliveries(marker, {
          where: (d) => d.body.includes(marker),
        })
        expect(delivery.body).toContain('"sla"')
        expect(delivery.body).toContain('timeToResolveDueAt')
      } finally {
        await rest.delete(`/api/v1/webhooks/${webhook.id}`)
        await rest.dispose()
        await admin.dispose()
      }
    }
  )
})

test.describe('apply and hand over', () => {
  test(
    'SLA-08 a workflow apply_sla replaces the default on the conversation and stamps its ticket',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      await ensureSupportTickets(playwright)
      const policy = await createSlaPolicy(admin, {
        name: `Apply ${marker}`,
        firstResponseTargetSecs: 2 * 3600,
        timeToResolveTargetSecs: 3 * 3600,
      })
      const customer = await seedPerson(marker, 'customer')

      // Conversation target: the workflow's policy wins over the default.
      const conversation = await withLiveWorkflow(
        admin,
        {
          name: `Apply SLA ${marker}`,
          triggerType: 'conversation.created',
          onlyFor: customer.email,
          steps: [
            { id: 'apply', type: 'action', action: { type: 'apply_sla', policyId: policy.id } },
          ],
        },
        async () => {
          const started = await startEmailConversation(request, marker, { customer })
          await waitForStamp(
            started.uuid,
            'the workflow policy stamp',
            (s) => s.policyId === policy.id
          )
          return started
        }
      )
      const stamp = (await slaStampOf(conversation.uuid))!
      expect(stamp.policyName).toBe(`Apply ${marker}`)
      expect(msBetween(stamp.firstResponseDueAt, stamp.appliedAt)).toBe(2 * HOUR_MS)
      // One SLA per conversation: no time-to-close clock from the default survives.
      expect(stamp.timeToCloseDueAt ?? null).toBeNull()
      const appliedPolicies = (
        await slaEventsFor({ conversationUuid: conversation.uuid }, 'applied')
      ).map((e) => e.policy_id)
      expect(appliedPolicies).toContain(uuidOf(policy.id))

      // Ticket target: stamps the linked customer ticket with the policy's TTR.
      // The requester files it themselves (an API key is a service actor, and
      // service-caused events never start workflows).
      const customerApi = await apiAs(playwright, customer)
      await withLiveWorkflow(
        admin,
        {
          name: `Apply ticket SLA ${marker}`,
          triggerType: 'ticket.created',
          onlyFor: customer.email,
          steps: [
            {
              id: 'apply',
              type: 'action',
              action: { type: 'apply_sla', policyId: policy.id, target: 'ticket' },
            },
          ],
        },
        async () => {
          const mine = await fnOk<{ id: string }>(customerApi, 'createMyTicketFn', {
            title: `Apply ticket ${marker}`,
            description: 'Filed from the portal',
          })
          const ticketUuid = uuidOf(mine.id)
          const ticketStamp = await pollFor(
            'the workflow policy on the ticket',
            async () => {
              const s = await ticketSlaStampOf(ticketUuid)
              return s?.policyId === policy.id ? s : null
            },
            { timeoutMs: 20_000 }
          )
          expect(msBetween(ticketStamp.timeToResolveDueAt, ticketStamp.appliedAt)).toBe(3 * HOUR_MS)
        }
      )
      await customerApi.dispose()
      await admin.dispose()
    }
  )

  test(
    'SLA-09 linking a customer ticket to an SLA conversation hands time to resolve to the ticket',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      await ensureSupportTickets(playwright)
      const conversation = await startEmailConversation(request, marker)
      const conversationStamp = await waitForStamp(
        conversation.uuid,
        'the default stamp',
        () => true
      )

      const ticket = await fnOk<{ id: string }>(admin, 'createTicketFn', {
        type: 'customer',
        title: `From conversation ${marker}`,
        conversationId: conversation.id,
      })
      const ticketUuid = uuidOf(ticket.id)
      expect(await ticketSlaStampOf(ticketUuid)).toBeNull()
      const linkedAt = Date.now()
      await fnOk(admin, 'linkTicketToConversationFn', {
        ticketId: ticket.id,
        conversationId: conversation.id,
      })

      const ticketStamp = await pollFor('the handed-over ticket stamp', () =>
        ticketSlaStampOf(ticketUuid)
      )
      expect(ticketStamp.policyId).toBe(conversationStamp.policyId)
      // The clock starts at the link, not when the conversation began.
      expect(new Date(String(ticketStamp.appliedAt)).getTime()).toBeGreaterThanOrEqual(
        linkedAt - 1000
      )
      expect(msBetween(ticketStamp.timeToResolveDueAt, ticketStamp.appliedAt)).toBe(
        (await policyTargetsOf(ticketStamp.policyId)).timeToResolveTargetSecs! * 1000
      )
      await waitForSlaEvent({ ticketUuid }, 'applied')
      await admin.dispose()
    }
  )
})

test.describe('clocks settle', () => {
  test(
    'SLA-11 first response settles on the first teammate reply, not on notes or workspace-key replies',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const conversation = await startEmailConversation(request, marker)
      await waitForStamp(conversation.uuid, 'the default stamp', () => true)

      // A note and a workspace-key reply are not a teammate's first response.
      await fnOk(admin, 'addConversationNoteFn', {
        conversationId: conversation.id,
        content: `Internal note ${marker}`,
      })
      const workspaceKey = await restAs(playwright, 'workspace')
      const automated = await workspaceKey.post(`/api/v1/conversations/${conversation.id}/reply`, {
        data: { content: `Automated reply ${marker}` },
      })
      expect(automated.status(), await automated.text()).toBe(201)
      // Give the queued reactions for the note and the automated reply time to run.
      await new Promise((r) => setTimeout(r, 3000))
      expect((await slaStampOf(conversation.uuid))!.firstResponseAt ?? null).toBeNull()

      // The teammate's reply settles it, at the reply's own time.
      await fnOk(admin, 'sendAgentMessageFn', {
        conversationId: conversation.id,
        content: `Teammate reply ${marker}`,
      })
      const settled = await waitForStamp(conversation.uuid, 'first response settled', (s) =>
        Boolean(s.firstResponseAt)
      )
      const [reply] = await supportDb()<{ created_at: Date }[]>`
        SELECT created_at FROM conversation_messages
        WHERE conversation_id = ${conversation.uuid} AND content = ${`Teammate reply ${marker}`}`
      expect(new Date(String(settled.firstResponseAt)).getTime()).toBe(reply.created_at.getTime())
      await waitForSlaEvent({ conversationUuid: conversation.uuid }, 'first_response_met')
      expect(
        await slaEventsFor({ conversationUuid: conversation.uuid }, 'first_response_met')
      ).toHaveLength(1)

      // A personal key made today acts as its teammate: its reply settles a fresh clock.
      const second = await startEmailConversation(request, `${marker}-pk`)
      await waitForStamp(second.uuid, 'the default stamp', () => true)
      const personal = await restAs(playwright, 'personal')
      const viaKey = await personal.post(`/api/v1/conversations/${second.id}/reply`, {
        data: { content: `Personal key reply ${marker}` },
      })
      expect(viaKey.status(), await viaKey.text()).toBe(201)
      await waitForStamp(second.uuid, 'first response by personal key', (s) =>
        Boolean(s.firstResponseAt)
      )
      await workspaceKey.dispose()
      await personal.dispose()
      await admin.dispose()
    }
  )

  test(
    'SLA-12 each customer message after the first response arms a next response clock the next reply settles',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(90_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const conversation = await startEmailConversation(request, marker)
      await waitForStamp(conversation.uuid, 'the default stamp', () => true)
      const reply = (content: string) =>
        fnOk(admin, 'sendAgentMessageFn', { conversationId: conversation.id, content })

      // Before a first response a second customer message arms nothing.
      await customerEmailsAgain(request, conversation, `Still waiting ${marker}`)
      await reply(`First ${marker}`)
      const afterFirst = await waitForStamp(conversation.uuid, 'first response', (s) =>
        Boolean(s.firstResponseAt)
      )
      expect(afterFirst.nextResponseCycleAt ?? null).toBeNull()

      await customerEmailsAgain(request, conversation, `One more thing ${marker}`)
      const armed = await waitForStamp(conversation.uuid, 'next response armed', (s) =>
        Boolean(s.nextResponseCycleAt)
      )
      expect(msBetween(armed.nextResponseDueAt, armed.nextResponseCycleAt)).toBe(
        (await policyTargetsOf(armed.policyId)).nextResponseTargetSecs! * 1000
      )
      expect(armed.nextResponseAt ?? null).toBeNull()

      await reply(`Second ${marker}`)
      await waitForStamp(conversation.uuid, 'next response settled', (s) =>
        Boolean(s.nextResponseAt)
      )
      await waitForSlaEvent({ conversationUuid: conversation.uuid }, 'next_response_met')

      // A new cycle: two customer messages, one reply settles it once.
      await customerEmailsAgain(request, conversation, `Again ${marker}`)
      await customerEmailsAgain(request, conversation, `And again ${marker}`)
      await waitForStamp(
        conversation.uuid,
        'next cycle armed',
        (s) => Boolean(s.nextResponseCycleAt) && !s.nextResponseAt
      )
      await reply(`Third ${marker}`)
      await waitForStamp(conversation.uuid, 'next cycle settled', (s) => Boolean(s.nextResponseAt))
      const met = await pollFor('two next_response_met events', async () => {
        const rows = await slaEventsFor(
          { conversationUuid: conversation.uuid },
          'next_response_met'
        )
        return rows.length >= 2 ? rows : null
      })
      expect(met).toHaveLength(2)
      await admin.dispose()
    }
  )

  test(
    'SLA-13 time to close settles on the first close; reopen and close again change nothing',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const conversation = await startEmailConversation(request, marker)
      await waitForStamp(conversation.uuid, 'the default stamp', () => true)
      const setStatus = (status: string) =>
        fnOk(admin, 'setConversationStatusFn', { conversationId: conversation.id, status })

      await setStatus('closed')
      const first = await waitForStamp(conversation.uuid, 'resolved', (s) => Boolean(s.resolvedAt))
      await waitForSlaEvent({ conversationUuid: conversation.uuid }, 'resolution_met')
      await setStatus('open')
      await setStatus('closed')
      // The second close's reaction runs on the queue: give it time, then compare.
      await new Promise((r) => setTimeout(r, 3000))
      const after = (await slaStampOf(conversation.uuid))!
      expect(after.resolvedAt).toBe(first.resolvedAt)
      expect(
        await slaEventsFor({ conversationUuid: conversation.uuid }, 'resolution_met')
      ).toHaveLength(1)
      await admin.dispose()
    }
  )

  test(
    'SLA-14 ticket time to resolve settles on the first close and never re-arms',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      await ensureSupportTickets(playwright)
      const customer = await seedPerson(marker, 'customer')
      const rest = await restAs(playwright)
      const created = await rest.post('/api/v1/tickets', {
        data: {
          type: 'customer',
          title: `TTR ${marker}`,
          requesterPrincipalId: customer.principalId,
        },
      })
      expect(created.status()).toBe(201)
      const ticketId = ((await created.json()) as { data: { id: string } }).data.id
      const ticketUuid = uuidOf(ticketId)
      await pollFor('the ticket stamp', () => ticketSlaStampOf(ticketUuid))
      const closed = await ticketStatusId('closed')
      const open = await ticketStatusId('open')

      await fnOk(admin, 'setTicketStatusFn', { ticketId, statusId: closed })
      const first = await pollFor('ticket resolved', async () => {
        const s = await ticketSlaStampOf(ticketUuid)
        return s?.resolvedAt ? s : null
      })
      await waitForSlaEvent({ ticketUuid }, 'time_to_resolve_met')
      await fnOk(admin, 'setTicketStatusFn', { ticketId, statusId: open })
      await fnOk(admin, 'setTicketStatusFn', { ticketId, statusId: closed })
      expect((await ticketRow(ticketUuid)).status_id).toBe(uuidOf(closed))
      await new Promise((r) => setTimeout(r, 3000))
      expect((await ticketSlaStampOf(ticketUuid))!.resolvedAt).toBe(first.resolvedAt)
      expect(await slaEventsFor({ ticketUuid }, 'time_to_resolve_met')).toHaveLength(1)
      await rest.dispose()
      await admin.dispose()
    }
  )
})

test.describe('breaches', () => {
  test(
    'SLA-19 the breach sweep records an overdue clock once, for conversations and tickets',
    { tag: '@core' },
    async ({ playwright, request, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      await ensureSupportTickets(playwright)
      const conversation = await startEmailConversation(request, marker)
      await waitForStamp(conversation.uuid, 'the default stamp', () => true)
      const customer = await seedPerson(marker, 'customer')
      const rest = await restAs(playwright)
      const created = await rest.post('/api/v1/tickets', {
        data: {
          type: 'customer',
          title: `Breach ${marker}`,
          requesterPrincipalId: customer.principalId,
        },
      })
      expect(created.status()).toBe(201)
      const ticketUuid = uuidOf(((await created.json()) as { data: { id: string } }).data.id)
      await pollFor('the ticket stamp', () => ticketSlaStampOf(ticketUuid))

      // Nothing is overdue yet: a sweep at the wall clock records nothing for these.
      await runSweep(request, 'sla-breach-sweep')
      expect(
        await slaEventsFor({ conversationUuid: conversation.uuid }, 'first_response_breached')
      ).toEqual([])

      await setStampFields('conversations', conversation.uuid, {
        firstResponseDueAt: isoMinutesFromNow(-2),
      })
      await setStampFields('tickets', ticketUuid, { timeToResolveDueAt: isoMinutesFromNow(-2) })
      await runSweep(request, 'sla-breach-sweep')
      await runSweep(request, 'sla-breach-sweep')

      const stamp = await waitForStamp(conversation.uuid, 'breach noted', (s) =>
        Boolean(s.firstResponseBreachedAt)
      )
      expect(stamp.firstResponseAt ?? null).toBeNull()
      expect(
        await slaEventsFor({ conversationUuid: conversation.uuid }, 'first_response_breached')
      ).toHaveLength(1)
      await pollFor('ticket breach noted', async () => {
        const s = await ticketSlaStampOf(ticketUuid)
        return s?.resolutionBreachedAt ? s : null
      })
      expect(await slaEventsFor({ ticketUuid }, 'time_to_resolve_breached')).toHaveLength(1)
      await rest.dispose()
      await admin.dispose()
    }
  )

  test(
    'SLA-20 a reply after a breach settles late and keeps the one breach',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const conversation = await startEmailConversation(request, marker)
      await waitForStamp(conversation.uuid, 'the default stamp', () => true)
      await setStampFields('conversations', conversation.uuid, {
        firstResponseDueAt: isoMinutesFromNow(-10),
      })
      await runSweep(request, 'sla-breach-sweep')
      await waitForSlaEvent({ conversationUuid: conversation.uuid }, 'first_response_breached')

      await fnOk(admin, 'sendAgentMessageFn', {
        conversationId: conversation.id,
        content: `Late ${marker}`,
      })
      const late = await waitForSlaEvent(
        { conversationUuid: conversation.uuid },
        'first_response_settled_after_breach'
      )
      expect(Number(late.meta.overdueSecs)).toBeGreaterThanOrEqual(600)
      expect((await slaStampOf(conversation.uuid))!.firstResponseAt).toBeTruthy()
      expect(
        await slaEventsFor({ conversationUuid: conversation.uuid }, 'first_response_breached')
      ).toHaveLength(1)
      await admin.dispose()
    }
  )
})

test.describe('SLA timer triggers', () => {
  test(
    'SLA-21 approaching breach fires once per clock to a listening workflow',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(180_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const customer = await seedPerson(marker, 'customer')
      const conversation = await startEmailConversation(request, marker, { customer })
      await waitForStamp(conversation.uuid, 'the default stamp', () => true)

      await withSlaTimerLock(admin, async () => {
        // The warning fires with or without a workflow (#1090), so the
        // workflow listens before the clock enters the lead.
        await withLiveWorkflow(
          admin,
          {
            name: `Warn ${marker}`,
            triggerType: 'sla.approaching_breach',
            triggerSettings: { breachLeadMinutes: 15 },
            onlyFor: conversation.customerEmail,
            steps: [
              {
                id: 'note',
                type: 'action',
                action: { type: 'add_note', body: `Warned ${marker}` },
              },
            ],
          },
          async (workflow) => {
            // Due in 5 minutes: inside the 15-minute lead.
            await setStampFields('conversations', conversation.uuid, {
              firstResponseDueAt: isoMinutesFromNow(5),
            })
            await runSweep(request, 'workflow-sweep')
            await waitForStamp(conversation.uuid, 'warning claimed', (s) =>
              Boolean(s.firstResponseWarningFiredAt)
            )
            await pollFor(
              'the workflow note',
              async () =>
                (await messagesOf(conversation.uuid)).find(
                  (m) => m.content === `Warned ${marker}`
                ) ?? null,
              { timeoutMs: 20_000 }
            )
            await runSweep(request, 'workflow-sweep')
            await new Promise((r) => setTimeout(r, 2000))
            const runs = (await workflowRuns(workflow.id)).filter(
              (r) => r.conversation_id === conversation.uuid
            )
            expect(runs).toHaveLength(1)
          }
        )
      })
      await admin.dispose()
    }
  )

  test(
    'SLA-22 breached fires once per clock to a listening workflow',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      test.setTimeout(180_000)
      const admin = await apiAs(playwright, 'admin')
      await ensureDefaultSla(admin)
      const customer = await seedPerson(marker, 'customer')
      const conversation = await startEmailConversation(request, marker, { customer })
      await waitForStamp(conversation.uuid, 'the default stamp', () => true)

      await withSlaTimerLock(admin, async () => {
        await withLiveWorkflow(
          admin,
          {
            name: `Breached ${marker}`,
            triggerType: 'sla.breached',
            onlyFor: conversation.customerEmail,
            steps: [
              {
                id: 'note',
                type: 'action',
                action: { type: 'add_note', body: `Breached ${marker}` },
              },
            ],
          },
          async (workflow) => {
            await setStampFields('conversations', conversation.uuid, {
              firstResponseDueAt: isoMinutesFromNow(-1),
            })
            await runSweep(request, 'workflow-sweep')
            await waitForStamp(conversation.uuid, 'breach trigger claimed', (s) =>
              Boolean(s.firstResponseBreachTriggerFiredAt)
            )
            await pollFor(
              'the workflow note',
              async () =>
                (await messagesOf(conversation.uuid)).find(
                  (m) => m.content === `Breached ${marker}`
                ) ?? null,
              { timeoutMs: 20_000 }
            )
            await runSweep(request, 'workflow-sweep')
            await new Promise((r) => setTimeout(r, 2000))
            const runs = (await workflowRuns(workflow.id)).filter(
              (r) => r.conversation_id === conversation.uuid
            )
            expect(runs).toHaveLength(1)
          }
        )
      })
      await admin.dispose()
    }
  )
})
