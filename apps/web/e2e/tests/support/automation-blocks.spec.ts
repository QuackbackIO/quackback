/**
 * Workflow conversational blocks, seen from the widget: message, reply
 * buttons, collect data/reply, CSAT, reply time, ticket form, send_webhook.
 * Journeys WFL-39..56 (e2e-plan section 9).
 *
 * Every workflow is scoped to the test's own conversation (the marker in the
 * visitor's message, or a scope attribute set on the conversation) and is
 * deleted afterwards: live workflows fire workspace-wide.
 */
import { fromUuid } from '@quackback/ids'
import type { Request } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb, pollFor } from '../../support/db'
import { sink } from '../../support/webhook-sink-client'
import { linksIn } from '../../support/mailpit'
import { setWidgetSurfaces } from '../../utils/db-helpers'
import {
  attrChain,
  attributeOf,
  closeInInbox,
  conversationRow,
  createAttributeDefinition,
  doc,
  emailConversation,
  markerChain,
  messagesOf,
  runEventKinds,
  setScopeAttribute,
  waitForRun,
  widgetSend,
  widgetStartConversation,
  withWorkflows,
} from '../../support/automation'

test.describe.configure({ timeout: 90_000 })

async function eventPayloads(conversationId: string, type: string) {
  return supportDb()`SELECT payload FROM events WHERE type = ${type}
                     AND (payload -> 'message' ->> 'conversationId' = ${conversationId}
                          OR payload -> 'conversation' ->> 'id' = ${conversationId})
                     ORDER BY id`
}

function yesNoNodes(marker: string, allowTyping = true) {
  return [
    {
      id: 'ask',
      type: 'reply_buttons',
      body: doc(`Did that help ${marker}?`),
      options: [
        { key: 'yes', label: 'Yes' },
        { key: 'no', label: 'No' },
      ],
      allowTyping,
    },
    { id: 'said-yes', type: 'message', body: doc(`Great, glad ${marker}`) },
    { id: 'said-no', type: 'message', body: doc(`Sorry about ${marker}`) },
  ]
}

const yesNoEdges = [
  { from: 'ask', to: 'said-yes', branch: 'yes' },
  { from: 'ask', to: 'said-no', branch: 'no' },
]

test(
  'WFL-44 reply buttons: tapping Yes posts the label and resumes down the yes branch',
  { tag: '@smoke' },
  async ({ page, marker }) => {
    await withWorkflows(
      [
        {
          name: `Buttons ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, yesNoNodes(marker), yesNoEdges),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Question ${marker}`)

        // The block reaches the widget with its two buttons; the run parks.
        await expect(page.getByText(`Did that help ${marker}?`)).toBeVisible({ timeout: 20_000 })
        const parked = await waitForRun(conversationId, workflowId, 'waiting')
        expect(parked.cursor).toMatchObject({ waitKind: 'input', blockKind: 'buttons' })
        expect(parked.cursor.blockMessageId).toBeTruthy()
        const block = (await messagesOf(conversationId)).find((m) =>
          m.content.startsWith(`Did that help ${marker}?`)
        )
        expect(block?.content).toBe(`Did that help ${marker}?\n[Yes] [No]`)

        await page.getByRole('button', { name: 'Yes', exact: true }).click()

        // The yes branch's message follows; the no branch never runs.
        await expect(page.getByText(`Great, glad ${marker}`)).toBeVisible({ timeout: 20_000 })
        const done = await waitForRun(conversationId, workflowId, 'done')
        expect(await runEventKinds(done.id)).toContain('block_engaged')
        const messages = await messagesOf(conversationId)
        expect(messages.some((m) => m.content.includes(`Sorry about ${marker}`))).toBe(false)

        // The visitor's reply is the server-derived label with the block correlation.
        const reply = messages.find((m) => m.sender_type === 'visitor' && m.content === 'Yes')
        expect(reply?.metadata).toMatchObject({
          blockReply: { kind: 'buttons', buttonKey: 'yes' },
        })
        const created = await pollFor('message.created for the tap', async () => {
          const rows = await eventPayloads(conversationId, 'message.created')
          return rows.find((r) => r.payload.message?.content === 'Yes') ?? null
        })
        expect(created.payload.message.blockReplyKind).toBe('buttons')
      }
    )
  }
)

test(
  'WFL-42 message block: appears live from the AI agent identity with variables filled',
  { tag: '@core' },
  async ({ page, asPerson, marker }) => {
    await withWorkflows(
      [
        {
          name: `Message ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            {
              id: 'hello',
              type: 'message',
              body: doc(
                `Welcome to {workspace_name} [${marker}] {first_name|friend} email:{email}.`
              ),
            },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Hi ${marker}`)
        const run = await waitForRun(conversationId, workflowId, 'done')
        expect(await runEventKinds(run.id)).toContain('block_sent')

        const sent = (await messagesOf(conversationId)).find((m) =>
          m.content.includes(`[${marker}]`)
        )
        expect(sent, 'block message').toBeTruthy()
        expect(sent!.sender_type).toBe('agent')
        expect(sent!.is_internal).toBe(false)
        expect(sent!.metadata).toMatchObject({
          block: { v: 1, kind: 'message', waiting: false, nodeId: 'hello' },
        })
        // Variables filled: workspace name and the visitor's name; the
        // anonymous visitor's (synthetic) email resolves to nothing.
        expect(sent!.content).toBe(`Welcome to Acme Corp [${marker}] Anonymous email:.`)

        // Live in the widget, and in the inbox from the AI agent identity.
        await expect(page.getByText(`[${marker}] Anonymous email:.`)).toBeVisible({
          timeout: 15_000,
        })
        const [author] = await supportDb()`SELECT display_name, type FROM principal
                                           WHERE id = ${sent!.principal_id}`
        expect(author.type).toBe('service')
        const admin = await asPerson('admin')
        await admin.goto(`/admin/inbox?i=${conversationId}`)
        await expect(admin.getByText(`[${marker}] Anonymous email:.`).first()).toBeVisible({
          timeout: 15_000,
        })
        await expect(admin.getByText(author.display_name).first()).toBeVisible()
        expect((await conversationRow(conversationId)).waiting_since).toBeNull()
      }
    )
  }
)

test(
  'WFL-39 send_webhook: the sink receives workflow.send_webhook with the run ids, signed',
  { tag: '@nightly' },
  async ({ request, customerEmail, marker }) => {
    await withWorkflows(
      [
        {
          name: `Webhook ${marker}`,
          class: 'background',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            { id: 'hook', type: 'action', action: { type: 'send_webhook', url: sink.url(marker) } },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await emailConversation(request, customerEmail, `Ping ${marker}`)
        const run = await waitForRun(conversationId, workflowId, 'done')
        const runId = fromUuid('workflow_run', run.id)
        const [delivery] = await sink.waitForDeliveries(marker)
        expect(delivery.headers['x-quackback-event']).toBe('workflow.send_webhook')
        const body = delivery.json as Record<string, unknown>
        expect(body).toMatchObject({
          id: `workflow:${runId}:hook`,
          type: 'workflow.send_webhook',
          data: { conversationId, workflowId, runId, actionId: 'hook' },
        })
        expect(typeof body.createdAt).toBe('string')
        // The delivery id doubles as the idempotency key. (Unlike outgoing
        // webhooks, the workflow action carries no signature header.)
        expect(delivery.headers['x-quackback-delivery-id']).toBe(`workflow:${runId}:hook`)
        expect(delivery.headers['idempotency-key']).toBe(`workflow:${runId}:hook`)
        expect(await runEventKinds(run.id)).not.toContain('action_failed:send_webhook')
      }
    )
  }
)

test(
  'WFL-43 a message block on a closed conversation reopens it',
  { tag: '@nightly' },
  async ({ page, asPerson, marker }) => {
    const key = `e2e_scope_${Date.now().toString(36)}`
    await withWorkflows(
      [
        {
          name: `Reopen ${marker}`,
          class: 'customer_facing',
          triggerType: 'conversation.status_changed',
          live: true,
          graph: attrChain(key, marker, [
            { id: 'note', type: 'message', body: doc(`One more thing ${marker}`) },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Close me ${marker}`)
        await setScopeAttribute(conversationId, key, marker)
        await closeInInbox(await asPerson('admin'), conversationId)
        // The workflow fires on the close; its block reopens the thread.
        await waitForRun(conversationId, workflowId, 'done')
        await expect(page.getByText(`One more thing ${marker}`)).toBeVisible({ timeout: 20_000 })
        await expect
          .poll(async () => (await conversationRow(conversationId)).status, { timeout: 15_000 })
          .toBe('open')
      }
    )
  }
)

test(
  'WFL-45 a forged or repeated block reply is stored as plain text and never resumes',
  { tag: '@core' },
  async ({ page, marker }) => {
    await withWorkflows(
      [
        {
          name: `Forged ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, yesNoNodes(marker), yesNoEdges),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Forge ${marker}`)
        await expect(page.getByText(`Did that help ${marker}?`)).toBeVisible({ timeout: 20_000 })
        const parked = await waitForRun(conversationId, workflowId, 'waiting')

        // Rewrite the widget's own tap request to carry an unknown button key.
        let tapRequest: Request | null = null
        await page.route('**/_serverFn/**', async (route) => {
          const body = route.request().postData() ?? ''
          if (body.includes('buttonKey') && body.includes('"yes"')) {
            tapRequest = route.request()
            await route.continue({ postData: body.replace('"yes"', '"no-such-button"') })
            return
          }
          await route.continue()
        })
        await page.getByRole('button', { name: 'Yes', exact: true }).click()
        await expect.poll(() => tapRequest !== null, { timeout: 10_000 }).toBe(true)

        // Stored as ordinary text: no block correlation; the run is interrupted,
        // not resumed (no block_engaged, neither branch ran).
        const stored = await pollFor('the forged reply', async () => {
          const rows = await messagesOf(conversationId)
          return rows.find((m) => m.sender_type === 'visitor' && m.content === 'Yes') ?? null
        })
        expect(stored.metadata?.blockReply).toBeUndefined()
        const ended = await waitForRun(conversationId, workflowId, 'interrupted')
        expect(ended.id).toBe(parked.id)
        expect(ended.ended_at).not.toBeNull()
        expect(await runEventKinds(ended.id)).not.toContain('block_engaged')

        // Replaying the genuine tap against the settled block is plain text too.
        await page.unroute('**/_serverFn/**')
        const original = tapRequest as unknown as Request
        const replay = await page.request.post(original.url(), {
          headers: await original.allHeaders(),
          data: original.postData() ?? '',
        })
        expect(replay.status(), await replay.text()).toBe(200)
        const rows = await pollFor('the replayed reply', async () => {
          const all = await messagesOf(conversationId)
          const yes = all.filter((m) => m.sender_type === 'visitor' && m.content === 'Yes')
          return yes.length >= 2 ? all : null
        })
        const visitorYes = rows.filter((m) => m.sender_type === 'visitor' && m.content === 'Yes')
        expect(visitorYes.every((m) => m.metadata?.blockReply === undefined)).toBe(true)
        expect(rows.some((m) => m.content.includes(`Great, glad ${marker}`))).toBe(false)
        expect(rows.some((m) => m.content.includes(`Sorry about ${marker}`))).toBe(false)
      }
    )
  }
)

test(
  'WFL-47 collect data: the select answer shows the option label and is stored with source customer',
  { tag: '@core' },
  async ({ page, marker }) => {
    const options = [
      { id: 'opt_basic', label: 'Basic plan' },
      { id: 'opt_pro', label: 'Pro plan' },
    ]
    const key = await createAttributeDefinition({
      key: `e2e_plan_${Date.now().toString(36)}`,
      label: `Plan ${marker}`,
      fieldType: 'select',
      options,
    })
    await withWorkflows(
      [
        {
          name: `Collect ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            {
              id: 'collect',
              type: 'collect_data',
              body: doc(`Which plan ${marker}?`),
              attributeKey: key,
              fieldType: 'select',
              options,
              required: true,
            },
            { id: 'thanks', type: 'message', body: doc(`Thanks for the plan ${marker}`) },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Plans ${marker}`)
        await expect(page.getByText(`Which plan ${marker}?`)).toBeVisible({ timeout: 20_000 })
        await page.getByRole('combobox').last().click()
        await page.getByRole('option', { name: 'Pro plan' }).click()
        await page.getByRole('button', { name: 'Submit' }).click()

        // The run continues to the next step.
        await expect(page.getByText(`Thanks for the plan ${marker}`)).toBeVisible({
          timeout: 20_000,
        })
        await waitForRun(conversationId, workflowId, 'done')
        const answer = (await messagesOf(conversationId)).find(
          (m) => m.sender_type === 'visitor' && m.content === 'Pro plan'
        )
        expect(answer?.metadata).toMatchObject({
          blockReply: { kind: 'collect', value: 'opt_pro' },
        })
        expect(await attributeOf(conversationId, key)).toMatchObject({
          v: 'opt_pro',
          src: 'customer',
        })
        const changed = await pollFor('attribute_changed', async () => {
          const rows = await eventPayloads(conversationId, 'conversation.attribute_changed')
          return rows[0] ?? null
        })
        expect(JSON.stringify(changed.payload)).toContain(key)
      }
    )
  }
)

test(
  'WFL-47 collect data: a value a teammate already set is not overwritten by the customer',
  { tag: '@core' },
  async ({ page, marker }) => {
    const key = await createAttributeDefinition({
      key: `e2e_order_${Date.now().toString(36)}`,
      label: `Order ${marker}`,
      fieldType: 'text',
    })
    await withWorkflows(
      [
        {
          name: `Locked ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            {
              id: 'collect',
              type: 'collect_data',
              body: doc(`Order number ${marker}?`),
              attributeKey: key,
              fieldType: 'text',
              required: true,
            },
            { id: 'after', type: 'message', body: doc(`Moving on ${marker}`) },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Order ${marker}`)
        await expect(page.getByText(`Order number ${marker}?`)).toBeVisible({ timeout: 20_000 })
        await waitForRun(conversationId, workflowId, 'waiting')
        // A teammate fills the slot before the customer answers.
        await setScopeAttribute(conversationId, key, 'TEAM-1')
        await page.locator('input:visible').last().fill('CUST-2')
        await page.getByRole('button', { name: 'Submit' }).click()
        // The run logs the refused write and carries on.
        const run = await waitForRun(conversationId, workflowId, 'done')
        expect(await runEventKinds(run.id)).toContain('action_failed:set_attribute')
        expect(await attributeOf(conversationId, key)).toMatchObject({
          v: 'TEAM-1',
          src: 'teammate',
        })
      }
    )
  }
)

test(
  'WFL-48 collect reply: the trimmed reply is stored as the attribute',
  { tag: '@nightly' },
  async ({ page, marker }) => {
    const key = await createAttributeDefinition({
      key: `e2e_reason_${Date.now().toString(36)}`,
      label: `Reason ${marker}`,
      fieldType: 'text',
    })
    await withWorkflows(
      [
        {
          name: `Collect reply ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            {
              id: 'ask',
              type: 'collect_reply',
              body: doc(`Tell us why ${marker}`),
              attributeKey: key,
            },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Why ${marker}`)
        await expect(page.getByText(`Tell us why ${marker}`)).toBeVisible({ timeout: 20_000 })
        await waitForRun(conversationId, workflowId, 'waiting')
        await widgetSend(page, `because reasons ${Date.now()}`)
        const run = await waitForRun(conversationId, workflowId, 'done')
        expect(await runEventKinds(run.id)).toContain('block_engaged')
        const attr = await attributeOf(conversationId, key)
        expect(attr?.src).toBe('customer')
        expect(String(attr?.v)).toMatch(/^because reasons \d+$/)
      }
    )
  }
)

test(
  'WFL-49 typing over a buttons block interrupts the parked run',
  { tag: '@nightly' },
  async ({ page, marker }) => {
    await withWorkflows(
      [
        {
          name: `Typing ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, yesNoNodes(marker, true), yesNoEdges),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Typing ${marker}`)
        await expect(page.getByText(`Did that help ${marker}?`)).toBeVisible({ timeout: 20_000 })
        await waitForRun(conversationId, workflowId, 'waiting')
        // allowTyping: the composer stays usable, and free text ends the wait.
        await widgetSend(page, `Something else entirely ${Date.now()}`)
        const run = await waitForRun(conversationId, workflowId, 'interrupted')
        expect(run.ended_at).not.toBeNull()
        const rows = await messagesOf(conversationId)
        expect(rows.some((m) => m.content.includes(`Great, glad ${marker}`))).toBe(false)
        expect(rows.some((m) => m.content.includes(`Sorry about ${marker}`))).toBe(false)
      }
    )
  }
)

test(
  'WFL-50 CSAT block: a face plus comment records the rating as the visitor with a team note',
  { tag: '@core' },
  async ({ page, asPerson, marker }) => {
    const key = `e2e_scope_${Date.now().toString(36)}`
    await withWorkflows(
      [
        {
          name: `CSAT ${marker}`,
          class: 'customer_facing',
          triggerType: 'conversation.status_changed',
          live: true,
          graph: attrChain(
            key,
            marker,
            [
              {
                id: 'rate',
                type: 'request_csat',
                body: doc(`How did we do ${marker}?`),
                allowTypingInterrupt: false,
                commentPrompt: `Tell us more ${marker}`,
              },
              { id: 'r4', type: 'action', action: { type: 'set_priority', priority: 'low' } },
            ],
            [{ from: 'rate', to: 'r4', branch: '4' }]
          ),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Rate ${marker}`)
        await setScopeAttribute(conversationId, key, marker)
        const admin = await asPerson('admin')
        await closeInInbox(admin, conversationId)

        await expect(page.getByText(`How did we do ${marker}?`)).toBeVisible({ timeout: 20_000 })
        await waitForRun(conversationId, workflowId, 'waiting')
        const resolvedAt = (await conversationRow(conversationId)).resolved_at
        const block = (await messagesOf(conversationId)).find((m) =>
          m.content.startsWith(`How did we do ${marker}?`)
        )
        expect(block?.metadata).toMatchObject({ block: { kind: 'csat' } })

        await page.getByRole('button', { name: '4 of 5' }).click()
        await expect(page.getByText(`Tell us more ${marker}`)).toBeVisible({ timeout: 10_000 })
        await page.getByRole('textbox', { name: 'Add a comment (optional)' }).fill(`Nice ${marker}`)
        await page.getByRole('button', { name: 'Send feedback' }).click()

        await expect
          .poll(async () => (await conversationRow(conversationId)).csat_rating, {
            timeout: 15_000,
          })
          .toBe(4)
        const run = await waitForRun(conversationId, workflowId, 'done')
        expect(await runEventKinds(run.id)).toContain('block_engaged')
        // The '4' edge ran; the conversation stayed closed with resolvedAt unchanged.
        const row = await conversationRow(conversationId)
        expect(row.priority).toBe('low')
        expect(row.status).toBe('closed')
        expect(String(row.resolved_at)).toBe(String(resolvedAt))
        const note = (await messagesOf(conversationId)).find((m) =>
          m.content.includes('The customer rated this conversation 4 out of 5')
        )
        expect(note?.is_internal).toBe(true)
        await pollFor('csat_submitted event', async () => {
          const rows = await eventPayloads(conversationId, 'conversation.csat_submitted')
          return rows[0] ?? null
        })
      }
    )
  }
)

test(
  'WFL-52 CSAT block on an email conversation also mails one-click rating links',
  { tag: '@nightly' },
  async ({ request, asPerson, customerEmail, marker }) => {
    const key = `e2e_scope_${Date.now().toString(36)}`
    await withWorkflows(
      [
        {
          name: `CSAT mail ${marker}`,
          class: 'customer_facing',
          triggerType: 'conversation.status_changed',
          live: true,
          graph: attrChain(key, marker, [
            {
              id: 'rate',
              type: 'request_csat',
              body: doc(`Rate us ${marker}`),
              allowTypingInterrupt: false,
            },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await emailConversation(request, customerEmail, `Mail ${marker}`)
        await setScopeAttribute(conversationId, key, marker)
        await closeInInbox(await asPerson('admin'), conversationId)
        await waitForRun(conversationId, workflowId, 'waiting')
        const mail = await pollFor(
          'a CSAT mail with rating links',
          async () => {
            const { mailTo, getMail } = await import('../../support/mailpit')
            for (const summary of await mailTo(customerEmail)) {
              const full = await getMail(summary.ID)
              if (linksIn(full).some((l) => /csat|rat/i.test(l))) return full
            }
            return null
          },
          { timeoutMs: 20_000 }
        )
        const ratingLinks = linksIn(mail).filter((l) => /csat|rat/i.test(l))
        expect(ratingLinks.length).toBeGreaterThanOrEqual(1)
      }
    )
  }
)

test(
  'WFL-55 reply-time block posts the office-hours reply time as block kind replyTime',
  { tag: '@nightly' },
  async ({ page, marker }) => {
    await withWorkflows(
      [
        {
          name: `Reply time ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [{ id: 'eta', type: 'show_reply_time' }]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `When ${marker}`)
        await waitForRun(conversationId, workflowId, 'done')
        const block = (await messagesOf(conversationId)).find(
          (m) => (m.metadata as { block?: { kind?: string } } | null)?.block?.kind === 'replyTime'
        )
        expect(block, 'reply-time block').toBeTruthy()
        expect(['online', 'away']).toContain(
          (block!.metadata as { block: { status: string } }).block.status
        )
        expect(block!.content.length).toBeGreaterThan(0)
        await expect(page.getByText(block!.content.split('\n')[0]).first()).toBeVisible({
          timeout: 15_000,
        })
      }
    )
  }
)

test(
  'WFL-56 ticket form block renders the intake form, the run continues, submit files a ticket',
  { tag: '@core' },
  async ({ page, marker, customerEmail }) => {
    // Widget ticket filing needs the tickets surface on (only ever turned on).
    setWidgetSurfaces(true)
    await withWorkflows(
      [
        {
          name: `Ticket form ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(marker, [
            { id: 'form', type: 'send_ticket_form', body: doc(`File it here ${marker}`) },
          ]),
        },
      ],
      async ([workflowId]) => {
        const conversationId = await widgetStartConversation(page, `Bug ${marker}`)
        await expect(page.getByText(`File it here ${marker}`)).toBeVisible({ timeout: 20_000 })
        // No park: the run is done once the form is posted.
        await waitForRun(conversationId, workflowId, 'done')
        const block = (await messagesOf(conversationId)).find((m) =>
          m.content.includes(`File it here ${marker}`)
        )
        expect(block?.metadata).toMatchObject({ block: { kind: 'ticketForm', waiting: false } })

        // The intake form, its required field announced by label.
        const subject = page.getByRole('textbox', { name: /Subject/ })
        await expect(subject).toBeVisible({ timeout: 15_000 })
        await expect(subject).toHaveAttribute('aria-required', 'true')
        await subject.fill(`Ticket ${marker}`)
        await page.getByRole('textbox', { name: 'Details' }).fill(`Steps for ${marker}`)
        const email = page.getByRole('textbox', { name: 'Email' })
        if (await email.isVisible()) await email.fill(customerEmail)
        await page.getByRole('button', { name: 'Create ticket' }).click()
        await pollFor('the filed ticket', async () => {
          const [t] = await supportDb()`SELECT id FROM tickets WHERE title = ${`Ticket ${marker}`}`
          return t ?? null
        })
      }
    )
  }
)
