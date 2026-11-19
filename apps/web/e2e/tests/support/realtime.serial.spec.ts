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
import { createVisitor, openWidgetAs, warmUpStream, type TestVisitor } from '../../support/visitors'
import { clearPresence, setWidgetAssistant } from '../../support/workspace-settings'

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
        await expect(widget.getByText("We'll reply by email")).toBeVisible({ timeout: 40_000 })
        tab.close()
      } finally {
        await restore()
      }
    }
  )

  test(
    'RT-22 the last stream closing returns unanswered open conversations to the queue',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      const tApi = await t.api(playwright)
      const observer = await newTeammate({ roleKey: 'support_lead' })
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

      // The last one closes: T went offline.
      tab2.close()
      await waitForPresence(t.principalId, false, 15_000)
      await pollFor('the unanswered conversation back in the queue', async () =>
        (await assigneeOf(unanswered.id)) === null ? true : null
      )
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
