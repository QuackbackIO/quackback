/**
 * The AI agent answering in the widget, and the workflow step that hands the
 * conversation to it. Journeys WFL-57..81 (e2e-plan section 9). The model is
 * the fake AI server, scripted per test by a marker in the visitor message.
 *
 * Most of these need the AI agent's widget answers on
 * (messenger.assistant.respond), a single workspace switch that makes the AI
 * answer EVERY widget message. They are tagged `@isolated` and skipped in the
 * shared shards; the support-isolated CI job runs them on a database of their
 * own (E2E_SUPPORT_ISOLATED=1).
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { fakeAi, FAKE_AI_FAIL } from '../../support/fake-ai-client'
import {
  ISOLATED,
  ISOLATED_SKIP,
  conversationRow,
  doc,
  enableAssistantRespond,
  markerChain,
  messagesOf,
  openInboxThread,
  replyInInbox,
  runEventKinds,
  runsFor,
  waitForRun,
  widgetSend,
  widgetStartConversation,
  withWorkflows,
} from '../../support/automation'
import { toUuid } from '@quackback/ids'

test.describe.configure({ timeout: 90_000 })

function cid(conversationId: string): string {
  return toUuid(conversationId as `conversation_${string}`)
}

async function involvementsOf(conversationId: string) {
  return supportDb()`SELECT status, triggered_by, handoff_reason, last_assistant_answer_at
                     FROM assistant_involvements WHERE conversation_id = ${cid(conversationId)}
                     ORDER BY created_at`
}

test.describe('AI agent in the widget', { tag: '@isolated' }, () => {
  test.beforeAll(async () => {
    if (ISOLATED) await enableAssistantRespond()
  })
  test.beforeEach(() => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
  })

  test(
    "WFL-67 a widget message gets the model's answer as a persisted AI message with an involvement",
    { tag: '@core' },
    async ({ page, marker }) => {
      await fakeAi.script({ marker, reply: `Here is how to do it ${marker}` })
      const conversationId = await widgetStartConversation(page, `How do I export ${marker}?`)
      await expect(page.getByText(`Here is how to do it ${marker}`)).toBeVisible({
        timeout: 30_000,
      })

      const [request] = await fakeAi.waitForRequests({ contains: marker, endpoint: 'chat' })
      expect(request.stream).toBe(true)
      const answer = (await messagesOf(conversationId)).find((m) =>
        m.content.includes(`Here is how to do it ${marker}`)
      )
      expect(answer?.sender_type).toBe('agent')
      expect(answer?.is_internal).toBe(false)
      const [author] =
        await supportDb()`SELECT type FROM principal WHERE id = ${answer!.principal_id}`
      expect(author.type).toBe('service')
      const [involvement] = await involvementsOf(conversationId)
      expect(involvement).toMatchObject({ status: 'active', triggered_by: 'first_touch' })
      expect(involvement.last_assistant_answer_at).not.toBeNull()
    }
  )

  test(
    'WFL-70 a model failure hands off with no AI text and reason system_error',
    { tag: '@core' },
    async ({ page, marker }) => {
      const conversationId = await widgetStartConversation(
        page,
        `Broken model ${marker} ${FAKE_AI_FAIL}`
      )
      await expect(page.getByText('Connecting you to the team').first()).toBeVisible({
        timeout: 45_000,
      })
      await expect
        .poll(async () => (await involvementsOf(conversationId)).at(-1)?.handoff_reason, {
          timeout: 15_000,
        })
        .toBe('system_error')
      const rows = await messagesOf(conversationId)
      const assistantText = rows.filter(
        (m) =>
          m.sender_type === 'agent' && !m.is_internal && m.content !== 'Connecting you to the team'
      )
      expect(
        assistantText.filter((m) => !(m.metadata as { systemEvent?: unknown } | null)?.systemEvent)
      ).toHaveLength(0)
      const requests = await fakeAi.requests({ contains: marker, endpoint: 'chat' })
      expect(requests.every((r) => r.status === 500)).toBe(true)
    }
  )

  test(
    'WFL-68 after a teammate reply the AI stays silent on the next visitor message',
    { tag: '@nightly' },
    async ({ page, asPerson, marker }) => {
      await fakeAi.script({ marker, reply: `First answer ${marker}` })
      const conversationId = await widgetStartConversation(page, `Question ${marker}`)
      await expect(page.getByText(`First answer ${marker}`)).toBeVisible({ timeout: 30_000 })
      await replyInInbox(await asPerson('admin'), conversationId, `Teammate takes over ${marker}`)
      const follow = `Follow-up ${marker}-after`
      await widgetSend(page, follow)
      await page.waitForTimeout(5_000)
      expect(await fakeAi.requests({ contains: `${marker}-after`, endpoint: 'chat' })).toHaveLength(
        0
      )
      const answers = (await messagesOf(conversationId)).filter((m) =>
        m.content.includes(`First answer ${marker}`)
      )
      expect(answers).toHaveLength(1)
    }
  )

  test(
    'WFL-57 the let-the-AI-answer step parks an assistant wait with an expiry; visitor messages do not end it',
    { tag: '@nightly' },
    async ({ page, marker }) => {
      await fakeAi.script({ marker, reply: `Step answer ${marker}` })
      await withWorkflows(
        [
          {
            name: `AI step ${marker}`,
            class: 'customer_facing',
            triggerType: 'message.created',
            live: true,
            graph: markerChain(
              marker,
              [
                { id: 'ai', type: 'let_assistant_answer', instructions: 'Be brief.' },
                { id: 'done', type: 'message', body: doc(`Resolved path ${marker}`) },
                { id: 'esc', type: 'message', body: doc(`Escalated path ${marker}`) },
              ],
              [
                { from: 'ai', to: 'done' },
                { from: 'ai', to: 'esc', branch: 'escalated' },
              ]
            ),
          },
        ],
        async ([id]) => {
          const conversationId = await widgetStartConversation(page, `Step ${marker}`)
          const run = await waitForRun(conversationId, id, 'waiting', 30_000)
          expect(run.cursor).toMatchObject({ waitKind: 'assistant' })
          expect(run.cursor.expiresAt).toBeTruthy()
          await expect(page.getByText(`Step answer ${marker}`).first()).toBeVisible({
            timeout: 30_000,
          })
          await widgetSend(page, `More detail ${Date.now()}`)
          await page.waitForTimeout(3_000)
          expect((await runsFor(conversationId, id)).map((r) => r.state)).toEqual(['waiting'])
        }
      )
    }
  )

  test(
    'WFL-69 the model hands off: the visitor sees its reply, the team gets the hand-off note',
    { tag: '@core' },
    async ({ page, asPerson, marker }) => {
      const conversationId = await openWithDefaultReply(page)
      await scriptHandoff(marker)
      await widgetSend(page, `I want a human ${marker}`)
      await expect(page.getByText(`A teammate will pick this up ${marker}`)).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByText('Connecting you to the team').first()).toBeVisible({
        timeout: 15_000,
      })

      await expect
        .poll(async () => (await involvementsOf(conversationId)).at(-1)?.status, {
          timeout: 15_000,
        })
        .toBe('handed_off')
      expect((await involvementsOf(conversationId)).at(-1)?.handoff_reason).toBe('explicit_request')
      const note = (await messagesOf(conversationId)).find(
        (m) => m.is_internal && m.content.includes(`Refund for order ${marker}`)
      )
      expect(note?.content).toContain('Check the refund policy')
      expect((await conversationRow(conversationId)).status).toBe('open')
      const admin = await asPerson('admin')
      await openInboxThread(admin, conversationId)
      await expect(admin.getByText(`Refund for order ${marker}`).first()).toBeVisible({
        timeout: 15_000,
      })
      // One "Connecting you" only.
      const connecting = (await messagesOf(conversationId)).filter((m) =>
        m.content.includes('Connecting you to the team')
      )
      expect(connecting).toHaveLength(1)
    }
  )

  test(
    'WFL-71 after a hand-off the widget gets no AI turn, but a workflow step re-engages the AI',
    { tag: '@nightly' },
    async ({ page, marker }) => {
      const conversationId = await openWithDefaultReply(page)
      await scriptHandoff(marker)
      await widgetSend(page, `I want a human ${marker}`)
      await expect
        .poll(async () => (await involvementsOf(conversationId)).at(-1)?.status, {
          timeout: 30_000,
        })
        .toBe('handed_off')

      const quiet = `quiet-${Date.now().toString(36)}`
      await widgetSend(page, `Still there ${quiet}?`)
      await page.waitForTimeout(5_000)
      expect(await fakeAi.requests({ contains: quiet, endpoint: 'chat' })).toHaveLength(0)

      const again = `again-${Date.now().toString(36)}`
      await fakeAi.script({ marker: again, reply: `Back from the step ${again}` })
      await withWorkflows(
        [
          {
            name: `Re-engage ${marker}`,
            class: 'customer_facing',
            triggerType: 'message.created',
            live: true,
            graph: markerChain(again, [{ id: 'ai', type: 'let_assistant_answer' }]),
          },
        ],
        async () => {
          await widgetSend(page, `Try again ${again}`)
          await expect(page.getByText(`Back from the step ${again}`)).toBeVisible({
            timeout: 30_000,
          })
        }
      )
    }
  )

  test(
    'WFL-76 the model closes the conversation: closed by a service actor with "Conversation ended"',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'end_conversation is always denied: it needs conversation.set_status, which the AI agent permission ceiling (assistant.actor.ts ASSISTANT_PERMISSIONS) does not hold',
      },
    },
    async ({ page, marker }) => {
      const conversationId = await openWithDefaultReply(page)
      await fakeAi.script({
        marker,
        json: { text: `Glad that is sorted ${marker}`, citations: [] },
      })
      await fakeAi.script({
        marker,
        times: 1,
        toolCalls: [{ name: 'end_conversation', arguments: { reason: 'Customer confirmed done' } }],
      })
      await widgetSend(page, `All done thanks ${marker}`)
      await expect
        .poll(async () => (await conversationRow(conversationId)).status, { timeout: 30_000 })
        .toBe('closed')
      const ended = (await messagesOf(conversationId)).find(
        (m) => m.content === 'Conversation ended'
      )
      expect(ended, 'Conversation ended notice').toBeTruthy()
      const [event] = await supportDb()`SELECT actor_type FROM events
        WHERE type = 'conversation.status_changed'
          AND payload -> 'conversation' ->> 'id' = ${conversationId} ORDER BY id DESC LIMIT 1`
      expect(event.actor_type).toBe('service')
    }
  )

  test(
    'WFL-77 the AI agent inbox buckets list escalated and pending conversations with counts',
    { tag: '@nightly' },
    async ({ browser, asPerson }) => {
      // One pending (the AI answered), one escalated (the model failed).
      const pendingPage = await (await browser.newContext()).newPage()
      const pending = await openWithDefaultReply(pendingPage)
      const escalatedPage = await (await browser.newContext()).newPage()
      const escalatedText = `Escalate me ${Date.now().toString(36)} ${FAKE_AI_FAIL}`
      const escalated = await widgetStartConversation(escalatedPage, escalatedText)
      await expect
        .poll(async () => (await involvementsOf(escalated)).at(-1)?.status, { timeout: 45_000 })
        .toBe('handed_off')
      expect((await involvementsOf(pending)).at(-1)?.status).toBe('active')

      const admin = await asPerson('admin')
      await admin.goto('/admin/inbox?view=quinn&ai=escalated')
      await expect(admin.getByRole('button', { name: /^Escalated \d+$/ })).toBeVisible({
        timeout: 20_000,
      })
      await expect(admin.getByText(/Escalate me/).first()).toBeVisible({ timeout: 15_000 })
      const pendingPreview = (await messagesOf(pending)).at(-1)!.content
      await admin.goto('/admin/inbox?view=quinn&ai=pending')
      await expect(admin.getByRole('button', { name: /^Pending \d+$/ })).toBeVisible({
        timeout: 20_000,
      })
      await expect(admin.getByText(pendingPreview.slice(0, 20)).first()).toBeVisible({
        timeout: 15_000,
      })
      const count = async (label: string) =>
        Number(
          (
            await admin.getByRole('button', { name: new RegExp(`^${label} \\d+$`) }).textContent()
          )?.replace(/\D/g, '')
        )
      expect(await count('Escalated')).toBeGreaterThanOrEqual(1)
      expect(await count('Pending')).toBeGreaterThanOrEqual(1)
    }
  )
})

/**
 * Open a widget conversation with a neutral first message and wait for the
 * fake model's scripted answer. Later messages carry the test's marker, so a
 * scripted rule never answers the inbox spam check on the first message, and
 * the thread history holds no failure marker.
 */
async function openWithDefaultReply(page: import('@playwright/test').Page): Promise<string> {
  const opening = `Opening ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  await fakeAi.script({ marker: opening, reply: `Happy to help ${opening}` })
  const conversationId = await widgetStartConversation(page, opening)
  await expect(page.getByText(`Happy to help ${opening}`).first()).toBeVisible({ timeout: 30_000 })
  return conversationId
}

/** The model calls handoff_to_human once, then answers with text. */
async function scriptHandoff(marker: string): Promise<void> {
  // After a tool call the turn ends with a structured answer ({ text, citations }).
  await fakeAi.script({
    marker,
    json: { text: `A teammate will pick this up ${marker}`, citations: [] },
  })
  await fakeAi.script({
    marker,
    times: 1,
    toolCalls: [
      {
        name: 'handoff_to_human',
        arguments: {
          reason: 'explicit_request',
          customerNeed: `Refund for order ${marker}`,
          attempted: [],
          recommendedNextStep: 'Check the refund policy',
        },
      },
    ],
  })
}

test(
  'WFL-58 with the AI agent not eligible the step logs "assistant declined" and follows the escalated branch at once',
  { tag: '@nightly' },
  async ({ page, marker }) => {
    // In the shared shards the AI agent's widget answers are off: not eligible.
    test.skip(ISOLATED, 'the isolated job turns the AI agent on')
    await withWorkflows(
      [
        {
          name: `Declined ${marker}`,
          class: 'customer_facing',
          triggerType: 'message.created',
          live: true,
          graph: markerChain(
            marker,
            [
              { id: 'ai', type: 'let_assistant_answer' },
              { id: 'done', type: 'message', body: doc(`Resolved path ${marker}`) },
              { id: 'esc', type: 'message', body: doc(`Escalated path ${marker}`) },
            ],
            [
              { from: 'ai', to: 'done' },
              { from: 'ai', to: 'esc', branch: 'escalated' },
            ]
          ),
        },
      ],
      async ([id]) => {
        const conversationId = await widgetStartConversation(page, `No AI ${marker}`)
        await expect(page.getByText(`Escalated path ${marker}`)).toBeVisible({ timeout: 20_000 })
        const run = await waitForRun(conversationId, id, 'done')
        expect(await runEventKinds(run.id)).not.toContain('waiting')
        expect(
          (await messagesOf(conversationId)).some((m) =>
            m.content.includes(`Resolved path ${marker}`)
          )
        ).toBe(false)
        // Only the inbox spam check reads the message; no AI turn is asked for.
        const turns = (await fakeAi.requests({ contains: marker, endpoint: 'chat' })).filter(
          (r) => !r.text.includes('You are a spam filter')
        )
        expect(turns).toHaveLength(0)
      }
    )
  }
)
