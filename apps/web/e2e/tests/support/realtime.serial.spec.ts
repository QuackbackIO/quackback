/**
 * Realtime journeys that read "who is online" (RT-20, RT-21, RT-22): they run
 * in the support-serial project, one at a time with nothing else running, and
 * each starts from no presence rows.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { waitForEventHandled } from '../../support/bells'
import { pollFor, supportDb } from '../../support/db'
import { presenceRows, waitForPresence } from '../../support/presence'
import { callServerFn, personApi } from '../../support/server-fns'
import { openStream, type StreamEvent } from '../../support/streams'
import { fakeAi } from '../../support/fake-ai-client'
import {
  createVisitor,
  openWidgetAs,
  warmUpStream,
  warmUpWidgetThread,
  type TestVisitor,
} from '../../support/visitors'
import { clearPresence, setWidgetAssistant } from '../../support/workspace-settings'
import { setRouting } from '../../support/routing'

async function agentsOnline(visitor: TestVisitor): Promise<boolean> {
  const r = await callServerFn<{ agentsOnline: boolean }>(
    visitor.api,
    'widgetGetConversationPresenceFn',
    undefined,
    { method: 'GET' }
  )
  expect(r.ok, r.error).toBe(true)
  return r.data.agentsOnline
}

async function assigneeOf(conversationId: string): Promise<string | null> {
  const [row] = await supportDb()`SELECT assigned_agent_principal_id AS a FROM conversations
    WHERE id = ${toUuid(conversationId as `conversation_${string}`)}`
  return (row.a as string | null) ?? null
}

test.describe('realtime and presence', () => {
  test.beforeEach(async () => {
    await clearPresence()
  })

  test(
    'RT-20 holding the presence stream marks the teammate online, with a heartbeat that keeps it fresh',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      const visitor = await createVisitor(playwright)
      expect(await agentsOnline(visitor)).toBe(false)

      const stream = await openStream({ cookie: t.cookie, query: { scope: 'presence' } })
      const [first] = await waitForPresence(t.principalId, true)
      expect(first.is_agent).toBe(true)
      expect(await agentsOnline(visitor)).toBe(true)

      // The heartbeat (every 20 s) moves heartbeat_at forward while the tab stays.
      const refreshed = await pollFor(
        'a refreshed heartbeat',
        async () => {
          const rows = await presenceRows(t.principalId)
          const row = rows.find((r) => r.stream_id === first.stream_id)
          return row && row.heartbeat_at.getTime() > first.heartbeat_at.getTime() ? row : null
        },
        { timeoutMs: 35_000, intervalMs: 1_000 }
      )
      expect(Date.now() - refreshed.heartbeat_at.getTime()).toBeLessThan(45_000)

      // Online but Away does not count as available.
      expect(
        (
          await callServerFn(await t.api(playwright), 'setAgentAvailabilityFn', {
            availability: 'away',
          })
        ).ok
      ).toBe(true)
      expect(await agentsOnline(visitor)).toBe(false)
      stream.close()
    }
  )

  test(
    'RT-21 a teammate who sets themselves Away reads as offline in the widget',
    { tag: '@nightly' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(90_000)
      const restore = await setWidgetAssistant(false)
      try {
        const t = await newTeammate({ roleKey: 'support_lead' })
        const visitor = await createVisitor(playwright)
        const first = `away ${marker}`
        await visitor.send(first)
        // T's admin tab: the presence switch turns its stream on under automation.
        const admin = await t.newPage(browser)
        await admin.goto('/admin/feedback')
        const tab = await openStream({ cookie: t.cookie, query: { scope: 'presence' } })
        await waitForPresence(t.principalId, true)

        const widget = await openWidgetAs(browser, visitor, first)
        await expect(widget.getByText("We're online")).toBeVisible({ timeout: 15_000 })

        const account = admin.getByRole('button', { name: new RegExp(t.name) }).last()
        await expect(async () => {
          await account.click()
          await admin
            .getByRole('menuitem', { name: 'Set yourself as away' })
            .click({ timeout: 2_000 })
        }).toPass({ timeout: 15_000 })
        // Still connected, no longer available: the widget's next read says offline.
        expect(await presenceRows(t.principalId)).not.toEqual([])
        await expect.poll(() => agentsOnline(visitor), { timeout: 10_000 }).toBe(false)
        await expect(widget.getByText("We'll reply here")).toBeVisible({ timeout: 40_000 })
        tab.close()
      } finally {
        await restore()
      }
    }
  )

  test(
    'RT-14 the assistant trace and streamed answer reach the widget in order',
    { tag: '@core' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(90_000)
      // The assistant answers customers (a workspace setting; serial project, put back after).
      const restore = await setWidgetAssistant(true, true)
      try {
        const answer = `Here is the streamed answer for ${marker}, in several words so it arrives in pieces.`
        // The assistant answers in its structured shape: { text, citations }.
        await fakeAi.script({ marker, json: { text: answer, citations: [] } })
        const visitor = await createVisitor(playwright)
        const first = await visitor.send(`hello there ${marker}`)
        const { conversationId } = first
        // The first message gets its own answer; wait for it to land.
        await pollFor(
          'the first answer',
          async () => {
            const rows = await supportDb()`SELECT 1 FROM conversation_messages
            WHERE conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
              AND content = ${answer}`
            return rows.length > 0 ? true : null
          },
          { timeoutMs: 30_000 }
        )
        const widget = await openWidgetAs(browser, visitor, answer, conversationId)
        const teammate = await newTeammate({ roleKey: 'support_lead' })
        await warmUpWidgetThread(widget, await teammate.api(playwright), conversationId)
        const stream = await visitor.openStream(conversationId)
        await warmUpStream(stream, conversationId, {
          api: await teammate.api(playwright),
          fn: 'sendConversationTypingFn',
        })
        stream.mark()

        await visitor.send(`question ${marker}`, conversationId)
        const finalMessage = await stream.waitFor(
          (e) => e.event === 'message' && e.data.message?.content === answer,
          45_000
        )
        const at = (e: StreamEvent) => stream.events.indexOf(e)
        const activity = stream.matching((e) => e.event === 'assistant_activity')
        const deltas = stream.matching((e) => e.event === 'assistant_delta' && Boolean(e.data.text))
        expect(activity.length).toBeGreaterThan(0)
        expect(deltas.length).toBeGreaterThan(0)
        expect(activity.some((e) => at(e) < at(deltas[0]))).toBe(true)
        expect(at(deltas.at(-1)!)).toBeLessThan(at(finalMessage))
        // Each delta carries the whole text so far.
        const texts = deltas.map((e) => String(e.data.text))
        for (let i = 1; i < texts.length; i++) expect(texts[i].startsWith(texts[i - 1])).toBe(true)
        expect(answer.startsWith(texts.at(-1)!)).toBe(true)
        expect(finalMessage.data.message).toMatchObject({ isAssistant: true })
        await expect(widget.getByText(answer)).toHaveCount(2, { timeout: 15_000 })
        stream.close()
      } finally {
        await fakeAi.clear(marker)
        await restore()
      }
    }
  )

  test(
    'RT-15 a stream opened mid-turn replays the latest assistant activity, and none after',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(90_000)
      const restore = await setWidgetAssistant(true, true)
      try {
        const answer = `Slow answer for ${marker}.`
        // Slowed by a rule for this test's marker only, not shard-wide.
        await fakeAi.script({ marker, json: { text: answer, citations: [] }, delayMs: 6_000 })
        const visitor = await createVisitor(playwright)
        const { conversationId } = await visitor.send(`slow ${marker}`)
        await fakeAi.waitForRequests({ contains: marker })
        // The turn is running: a new subscriber gets the snapshot after connecting.
        const late = await visitor.openStream(conversationId)
        const snapshot = await late.waitFor((e) => e.event === 'assistant_activity', 5_000)
        expect(snapshot.data.conversationId).toBe(conversationId)
        await late.waitFor(
          (e) => e.event === 'message' && e.data.message?.content === answer,
          30_000
        )
        late.close()

        // Turn over: a fresh stream replays nothing.
        // (The snapshot comes before any live frame, so a typing frame after it
        // proves the replay step is over.)
        const after = await visitor.openStream(conversationId)
        const teammate = await newTeammate({ roleKey: 'support_lead' })
        await warmUpStream(after, conversationId, {
          api: await teammate.api(playwright),
          fn: 'sendConversationTypingFn',
        })
        expect(after.matching((e) => e.event === 'assistant_activity')).toEqual([])
        after.close()
      } finally {
        await fakeAi.clear(marker)
        await restore()
      }
    }
  )

  test(
    'RT-22 with routing on, the last stream closing returns unanswered open conversations to the queue',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      const tApi = await t.api(playwright)
      // Away, so routing hands nothing to the observer and the freed
      // conversations wait in the queue, where the observer sees them.
      const observer = await newTeammate({ roleKey: 'support_lead', availability: 'away' })
      const admin = await personApi(playwright, 'admin')

      const start = async (text: string) => {
        const v = await createVisitor(playwright)
        const c = await v.send(`${text} ${marker}`)
        const r = await callServerFn(admin, 'assignConversationFn', {
          conversationId: c.conversationId,
          assignTo: t.principalId,
        })
        expect(r.ok, r.error).toBe(true)
        return { visitor: v, id: c.conversationId }
      }
      const unanswered = await start('unanswered')
      const answered = await start('answered')
      expect(
        (
          await callServerFn(tApi, 'sendAgentMessageFn', {
            conversationId: answered.id,
            content: `replied ${marker}`,
          })
        ).ok
      ).toBe(true)
      const closed = await start('closed')
      expect(
        (
          await callServerFn(tApi, 'setConversationStatusFn', {
            conversationId: closed.id,
            status: 'closed',
          })
        ).ok
      ).toBe(true)
      const noted = await start('noted')
      // A private note is not an answer.
      expect(
        (
          await callServerFn(tApi, 'addConversationNoteFn', {
            conversationId: noted.id,
            content: `note ${marker}`,
          })
        ).ok
      ).toBe(true)

      const tUuid = toUuid(t.principalId as `principal_${string}`)
      const watch = await openStream({ cookie: observer.cookie, query: { scope: 'inbox' } })
      await warmUpStream(watch, unanswered.id, {
        api: unanswered.visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })

      // T has two tabs: closing one changes nothing.
      const tab1 = await openStream({ cookie: t.cookie, query: { scope: 'inbox' } })
      const tab2 = await openStream({ cookie: t.cookie, query: { scope: 'presence' } })
      await pollFor('two presence rows', async () =>
        (await presenceRows(t.principalId)).length === 2 ? true : null
      )
      tab1.close()
      await pollFor('one presence row', async () =>
        (await presenceRows(t.principalId)).length === 1 ? true : null
      )
      expect(await assigneeOf(unanswered.id)).toBe(tUuid)

      // The last one closes with routing on: T went offline. (With routing off
      // the work stays with T, RTE-51.)
      await setRouting(playwright, true)
      try {
        tab2.close()
        await waitForPresence(t.principalId, false, 15_000)
        await pollFor('the unanswered conversation back in the queue', async () =>
          (await assigneeOf(unanswered.id)) === null ? true : null
        )
      } finally {
        await setRouting(playwright, false)
      }
      expect(await assigneeOf(noted.id)).toBeNull()
      expect(await assigneeOf(answered.id)).toBe(tUuid)
      expect(await assigneeOf(closed.id)).toBe(tUuid)

      // Teammates hear about each freed conversation.
      const freed = (id: string) => (e: StreamEvent) =>
        e.event === 'conversation' &&
        (e.data.conversation as { id?: string })?.id === id &&
        (e.data.conversation as { assignedAgent?: unknown }).assignedAgent === null
      await pollFor('a frame per freed conversation', async () =>
        watch.matching(freed(unanswered.id)).length > 0 &&
        watch.matching(freed(noted.id)).length > 0
          ? true
          : null
      )
      expect(watch.matching(freed(answered.id))).toEqual([])
      await waitForEventHandled(answered.id)
      watch.close()
      await admin.dispose()
    }
  )
})
