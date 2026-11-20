/**
 * Presence (PRS-*): who counts as online, Online versus Away, what the widget
 * tells the customer, office hours, and which bells presence holds back.
 *
 * Runs in the support-serial project (one test at a time, nothing else
 * running), so "nobody is online" can hold: every test starts from no
 * presence rows.
 */
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { bellsFor, waitForBells, waitForEventHandled, type BellRow } from '../../support/bells'
import { pollFor, supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { emailLogFor } from '../../support/mailpit'
import { presenceRows, waitForPresence } from '../../support/presence'
import { callServerFn, personApi } from '../../support/server-fns'
import { openStream, type OpenStream } from '../../support/streams'
import type { TestTeammate } from '../../support/teammates'
import {
  createVisitor,
  openWidgetAs,
  warmUpStream,
  warmUpWidgetThread,
  type TestVisitor,
} from '../../support/visitors'
import { clearPresence, setWidgetAssistant } from '../../support/workspace-settings'

interface Presence {
  agentsOnline: boolean
  withinOfficeHours: boolean | null
  nextOpenAt: string | null
}

async function widgetPresence(visitor: TestVisitor): Promise<Presence> {
  const r = await callServerFn<Presence>(
    visitor.api,
    'widgetGetConversationPresenceFn',
    undefined,
    {
      method: 'GET',
    }
  )
  expect(r.ok, r.error).toBe(true)
  return r.data
}

/** Hold a teammate's presence stream open (as their browser tab would). */
async function goOnline(t: TestTeammate): Promise<OpenStream> {
  const s = await openStream({ cookie: t.cookie, query: { scope: 'presence' } })
  expect(s.status).toBe(200)
  await waitForPresence(t.principalId, true)
  return s
}

async function goOffline(t: TestTeammate, s: OpenStream): Promise<void> {
  s.close()
  await waitForPresence(t.principalId, false, 15_000)
}

async function availability(principalId: string): Promise<string> {
  const [row] = await supportDb()`SELECT chat_availability FROM principal
    WHERE id = ${toUuid(principalId as `principal_${string}`)}`
  return row.chat_availability as string
}

test.describe('presence', () => {
  test.beforeEach(async () => {
    await clearPresence()
  })

  test(
    'PRS-01 an admin page opens a presence-only stream that marks the teammate online',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const t = await newTeammate({ roleKey: 'support_lead' })
      // The first bytes, read raw.
      const controller = new AbortController()
      const res = await fetch(`${supportEnv().baseUrl}/api/chat/stream?scope=presence`, {
        headers: { cookie: t.cookie, accept: 'text/event-stream' },
        signal: controller.signal,
      })
      expect(res.status).toBe(200)
      const reader = res.body!.getReader()
      let text = ''
      while (!text.includes(': connected')) {
        const { value, done } = await reader.read()
        if (done) break
        text += new TextDecoder().decode(value)
      }
      expect(text).toContain('retry: 3000')
      expect(text).toContain(': connected')
      const rows = await waitForPresence(t.principalId, true)
      expect(rows.every((r) => r.is_agent)).toBe(true)
      controller.abort()
      await waitForPresence(t.principalId, false, 15_000)

      // It carries no conversation frames, while the inbox stream does.
      const presence = await openStream({ cookie: t.cookie, query: { scope: 'presence' } })
      const inbox = await openStream({ cookie: t.cookie, query: { scope: 'inbox' } })
      const visitor = await createVisitor(playwright)
      const { conversationId } = await visitor.send(`presence only ${marker}`)
      await warmUpStream(inbox, conversationId, {
        api: visitor.api,
        fn: 'widgetSendConversationTypingFn',
      })
      await visitor.send(`second ${marker}`, conversationId)
      await inbox.waitFor((e) => e.event === 'message' && e.raw.includes(`second ${marker}`))
      expect(presence.events).toEqual([])
      presence.close()
      inbox.close()
    }
  )

  test(
    'PRS-02 the inbox stream also marks the teammate online, until it closes',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const t = await newTeammate({ roleKey: 'support_lead' })
      const visitor = await createVisitor(playwright)
      expect((await widgetPresence(visitor)).agentsOnline).toBe(false)
      const inbox = await openStream({ cookie: t.cookie, query: { scope: 'inbox' } })
      const rows = await waitForPresence(t.principalId, true)
      expect(rows[0].is_agent).toBe(true)
      expect((await widgetPresence(visitor)).agentsOnline).toBe(true)
      inbox.close()
      await waitForPresence(t.principalId, false, 15_000)
      expect((await widgetPresence(visitor)).agentsOnline).toBe(false)
    }
  )

  test(
    'PRS-03 a customer is refused the agent scopes and no session is unauthorized',
    { tag: '@core' },
    async ({ people }) => {
      for (const scope of ['inbox', 'presence']) {
        const customer = await openStream({ person: 'customer', query: { scope } })
        expect(customer.status, scope).toBe(403)
        const nobody = await openStream({ query: { scope } })
        expect(nobody.status, scope).toBe(401)
      }
      expect(await presenceRows(people.people.customer.principalId)).toEqual([])
    }
  )

  test(
    'PRS-06 a presence row past the 45 s TTL no longer counts as online',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const t = await newTeammate({ roleKey: 'support_lead' })
      const visitor = await createVisitor(playwright)
      const s = await goOnline(t)
      expect((await widgetPresence(visitor)).agentsOnline).toBe(true)
      // A crashed replica's row: its heartbeat stopped 60 s ago.
      await supportDb()`UPDATE presence_stream SET heartbeat_at = now() - interval '60 seconds'
      WHERE principal_id = ${t.principalId}`
      expect((await widgetPresence(visitor)).agentsOnline).toBe(false)
      s.close()
    }
  )

  test(
    'PRS-08 a teammate sets themselves Away from the account menu, and it sticks',
    { tag: '@core' },
    async ({ browser, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      const page = await t.newPage(browser)
      await page.goto('/admin/feedback')
      const account = page.getByRole('button', { name: new RegExp(t.name) }).last()
      const dot = account.locator('.bg-success')
      await expect(dot).toHaveCount(1, { timeout: 15_000 })

      await expect(async () => {
        await account.click()
        await page.getByRole('menuitem', { name: 'Set yourself as away' }).click({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await expect(dot).toHaveCount(0)
      await pollFor('away saved', async () =>
        (await availability(t.principalId)) === 'away' ? true : null
      )

      await page.reload()
      await expect(account).toBeVisible({ timeout: 15_000 })
      await expect(dot).toHaveCount(0)
      await expect(async () => {
        await account.click()
        await expect(page.getByRole('menuitem', { name: 'Set yourself as active' })).toBeVisible({
          timeout: 2_000,
        })
      }).toPass({ timeout: 15_000 })
      await page.getByRole('menuitem', { name: 'Set yourself as active' }).click()
      await pollFor('online saved', async () =>
        (await availability(t.principalId)) === 'online' ? true : null
      )
      await expect(dot).toHaveCount(1)
    }
  )

  test(
    'PRS-09 setting availability needs conversation.view',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const t = await newTeammate({ roleKey: 'e2e_no_support' })
      const api = await t.api(playwright)
      const r = await callServerFn(api, 'setAgentAvailabilityFn', { availability: 'away' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('conversation.view')
      expect(await availability(t.principalId)).toBe('online')

      // The same call works for a teammate who has it.
      const lead = await newTeammate({ roleKey: 'support_lead' })
      const ok = await callServerFn(await lead.api(playwright), 'setAgentAvailabilityFn', {
        availability: 'away',
      })
      expect(ok.ok, ok.error).toBe(true)
      expect(await availability(lead.principalId)).toBe('away')
    }
  )

  test.describe('the widget badge (assistant off)', () => {
    let restore: (() => Promise<void>) | null = null
    test.beforeAll(async () => {
      restore = await setWidgetAssistant(false)
    })
    test.afterAll(async () => {
      await restore?.()
    })

    test(
      'PRS-11 the widget says online only while an available teammate is online',
      { tag: '@core' },
      async ({ playwright, browser, marker, newTeammate }) => {
        test.setTimeout(60_000)
        const t = await newTeammate({ roleKey: 'support_lead' })
        const visitor = await createVisitor(playwright)
        const first = `badge ${marker}`
        await visitor.send(first)
        const s = await goOnline(t)

        const widget = await openWidgetAs(browser, visitor, first)
        await expect(widget.getByText("We're online")).toBeVisible({ timeout: 15_000 })

        // Online but Away: not available. The widget polls every 30 s; a reload
        // reads a fresh server answer.
        expect(
          (
            await callServerFn(await t.api(playwright), 'setAgentAvailabilityFn', {
              availability: 'away',
            })
          ).ok
        ).toBe(true)
        expect(await presenceRows(t.principalId)).not.toEqual([])
        await widget.reload()
        await widget.getByText(first).first().click()
        await expect(widget.getByText("We'll reply here")).toBeVisible({ timeout: 15_000 })
        await expect(widget.getByText("We're online")).toHaveCount(0)
        s.close()
      }
    )

    test(
      'PRS-12 a teammate reply flips the widget to online before its next poll',
      { tag: '@nightly' },
      async ({ playwright, browser, marker, newTeammate }) => {
        test.setTimeout(60_000)
        const t = await newTeammate({ roleKey: 'support_lead' })
        const api = await t.api(playwright)
        const visitor = await createVisitor(playwright)
        const first = `offline at first ${marker}`
        const { conversationId } = await visitor.send(first)
        const widget = await openWidgetAs(browser, visitor, first)
        await expect(widget.getByText("We'll reply here")).toBeVisible({ timeout: 15_000 })
        // Nobody online: the teammate's typing (activity on this thread) is the
        // only sign someone is there, and the badge flips at once, well before
        // the 30 s poll (which would still say nobody is online).
        expect((await widgetPresence(visitor)).agentsOnline).toBe(false)
        await warmUpWidgetThread(widget, api, conversationId)
        await expect(widget.getByText("We're online")).toBeVisible({ timeout: 3_000 })
        expect((await widgetPresence(visitor)).agentsOnline).toBe(false)
        expect(
          (
            await callServerFn(api, 'sendAgentMessageFn', {
              conversationId,
              content: `here ${marker}`,
            })
          ).ok
        ).toBe(true)
        await expect(widget.getByText(`here ${marker}`)).toBeVisible({ timeout: 15_000 })
        await expect(widget.getByText("We're online")).toBeVisible()
      }
    )
  })

  test(
    'PRS-15 the Home resume card shows the online dot only for an open conversation',
    { tag: '@nightly' },
    async ({ playwright, browser, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const restore = await setWidgetAssistant(false)
      try {
        const t = await newTeammate({ roleKey: 'support_lead', name: `Resume ${marker.slice(-6)}` })
        const api = await t.api(playwright)
        const visitor = await createVisitor(playwright)
        const { conversationId } = await visitor.send(`resume ${marker}`)
        expect(
          (
            await callServerFn(api, 'sendAgentMessageFn', {
              conversationId,
              content: `back soon ${marker}`,
            })
          ).ok
        ).toBe(true)
        const s = await goOnline(t)

        const widget = await openWidgetAs(browser, visitor)
        const home = async () => {
          await widget.goto('/widget')
          const card = widget.getByRole('button', { name: `Open conversation with ${t.name}` })
          await expect(card).toBeVisible({ timeout: 15_000 })
          return card
        }
        const open = await home()
        await expect(open.locator('.bg-emerald-500')).toHaveCount(1, { timeout: 10_000 })

        expect(
          (await callServerFn(api, 'setConversationStatusFn', { conversationId, status: 'closed' }))
            .ok
        ).toBe(true)
        const closed = await home()
        await expect(closed.locator('.bg-emerald-500')).toHaveCount(0)
        expect((await widgetPresence(visitor)).agentsOnline).toBe(true)
        s.close()
      } finally {
        await restore()
      }
    }
  )

  test(
    'PRS-10 an Away teammate gets no new conversations but keeps the ones they have',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const admin = await personApi(playwright, 'admin')
      const before = await callServerFn<{ enabled: boolean; strategy: string }>(
        admin,
        'fetchConversationRoutingFn',
        undefined,
        {
          method: 'GET',
        }
      )
      expect(before.ok, before.error).toBe(true)
      try {
        expect(
          (
            await callServerFn(admin, 'updateConversationRoutingFn', {
              enabled: true,
              strategy: 'auto_assign_active',
            })
          ).ok
        ).toBe(true)
        const t = await newTeammate({ roleKey: 'support_lead', availability: 'away' })
        const tApi = await t.api(playwright)
        const visitor = await createVisitor(playwright)
        // T's existing work: answered, so it is theirs to keep.
        const kept = await visitor.send(`kept ${marker}`)
        expect(
          (
            await callServerFn(tApi, 'sendAgentMessageFn', {
              conversationId: kept.conversationId,
              content: `mine ${marker}`,
            })
          ).ok
        ).toBe(true)
        const s = await goOnline(t)

        const assignee = async (id: string) => {
          const [row] = await supportDb()`SELECT assigned_agent_principal_id AS a FROM conversations
          WHERE id = ${toUuid(id as `conversation_${string}`)}`
          return row.a as string | null
        }
        const tUuid = toUuid(t.principalId as `principal_${string}`)

        // Away and online, and nobody else online: a new conversation is not routed.
        const other = await createVisitor(playwright)
        const fresh = await other.send(`unrouted ${marker}`)
        await waitForEventHandled(fresh.messageId, { type: 'message.created' })
        expect(await assignee(fresh.conversationId)).toBeNull()
        expect(await assignee(kept.conversationId)).toBe(tUuid)

        // Back to available: the next new conversation goes to T.
        expect(
          (await callServerFn(tApi, 'setAgentAvailabilityFn', { availability: 'online' })).ok
        ).toBe(true)
        const third = await createVisitor(playwright)
        const routed = await third.send(`routed ${marker}`)
        await pollFor('routing to T', async () =>
          (await assignee(routed.conversationId)) === tUuid ? true : null
        )
        s.close()
      } finally {
        await callServerFn(admin, 'updateConversationRoutingFn', {
          enabled: before.data.enabled,
          strategy: 'auto_assign_active',
        })
        await admin.dispose()
      }
    }
  )

  test.describe('office hours', () => {
    type Schedule = {
      enabled: boolean
      timezone: string
      intervals: Array<{ day: number; start: string; end: string }>
      holidays: Array<{ date: string; name?: string; recurringAnnual: boolean }>
    }
    let original: Schedule | null = null
    test.beforeAll(async ({ playwright }) => {
      const admin = await personApi(playwright, 'admin')
      const r = await callServerFn<Schedule>(admin, 'fetchOfficeHoursFn', undefined, {
        method: 'GET',
      })
      expect(r.ok, r.error).toBe(true)
      original = r.data
      await admin.dispose()
    })
    test.afterAll(async ({ playwright }) => {
      if (!original) return
      const admin = await personApi(playwright, 'admin')
      await callServerFn(admin, 'updateOfficeHoursFn', original)
      await admin.dispose()
    })

    test(
      'PRS-13 office hours make the widget available with nobody online, and say when the team is back',
      { tag: '@core' },
      async ({ playwright, browser, marker }) => {
        test.setTimeout(60_000)
        const restore = await setWidgetAssistant(false)
        try {
          const admin = await personApi(playwright, 'admin')
          const now = new Date()
          const open: Schedule = {
            enabled: true,
            timezone: 'UTC',
            // Open all of today (UTC). A window around "now" wraps past midnight
            // between 23:00 and 01:00 and reads as closed.
            intervals: [
              { day: now.getUTCDay(), start: '00:00', end: '12:00' },
              { day: now.getUTCDay(), start: '12:00', end: '00:00' },
            ],
            holidays: [],
          }
          expect((await callServerFn(admin, 'updateOfficeHoursFn', open)).ok).toBe(true)
          const visitor = await createVisitor(playwright)
          const first = `hours ${marker}`
          await visitor.send(first)
          const p = await widgetPresence(visitor)
          expect(p).toMatchObject({ agentsOnline: false, withinOfficeHours: true })
          const widget = await openWidgetAs(browser, visitor, first)
          await expect(widget.getByText("We're online")).toBeVisible({ timeout: 15_000 })

          // Closed now, open again tomorrow: offline, with when.
          const tomorrow = (now.getUTCDay() + 1) % 7
          const closed: Schedule = {
            ...open,
            intervals: [{ day: tomorrow, start: '10:00', end: '11:00' }],
          }
          expect((await callServerFn(admin, 'updateOfficeHoursFn', closed)).ok).toBe(true)
          const q = await widgetPresence(visitor)
          expect(q.withinOfficeHours).toBe(false)
          expect(q.nextOpenAt).toBeTruthy()
          expect(new Date(q.nextOpenAt!).getUTCHours()).toBe(10)
          await widget.reload()
          await widget.getByText(first).first().click()
          await expect(widget.getByText("We'll reply here")).toBeVisible({ timeout: 15_000 })
          await expect(widget.getByText(/Back /)).toBeVisible()
          await admin.dispose()
        } finally {
          await restore()
        }
      }
    )

    test(
      'PRS-14 office hours need office_hours.manage: a support lead may, a contributor may not',
      { tag: '@core' },
      async ({ playwright, newTeammate }) => {
        const lead = await (await newTeammate({ roleKey: 'support_lead' })).api(playwright)
        const read = await callServerFn<Schedule>(lead, 'fetchOfficeHoursFn', undefined, {
          method: 'GET',
        })
        expect(read.ok, read.error).toBe(true)
        const write = await callServerFn(lead, 'updateOfficeHoursFn', read.data)
        expect(write.ok, write.error).toBe(true)

        const contributor = await personApi(playwright, 'contributor')
        const refusedRead = await callServerFn(contributor, 'fetchOfficeHoursFn', undefined, {
          method: 'GET',
        })
        expect(refusedRead.ok).toBe(false)
        expect(refusedRead.error).toContain('office_hours.manage')
        const refusedWrite = await callServerFn(contributor, 'updateOfficeHoursFn', {
          ...read.data,
          enabled: !read.data.enabled,
        })
        expect(refusedWrite.ok).toBe(false)
        const after = await callServerFn<Schedule>(lead, 'fetchOfficeHoursFn', undefined, {
          method: 'GET',
        })
        expect(after.data.enabled).toBe(read.data.enabled)
      }
    )
  })

  test.describe('alerts held by presence', () => {
    test(
      'PRS-17 the first visitor message always bells; a follow-up is held while a teammate is online',
      { tag: '@core' },
      async ({ playwright, marker, newTeammate }) => {
        test.setTimeout(60_000)
        const watcher = await newTeammate({ roleKey: 'support_lead' })
        const online = await newTeammate({ roleKey: 'support_lead' })
        const visitor = await createVisitor(playwright)

        // Someone online does not hold the FIRST message's bell.
        const s = await goOnline(online)
        const { conversationId } = await visitor.send(`first ${marker}`)
        const first = await waitForBells(watcher.principalId, conversationId, (r) => r.length >= 1)
        expect(first[0]).toMatchObject({
          type: 'chat_message',
          title: `New message from ${visitor.name}`,
        })
        expect(first[0].body).toContain(`first ${marker}`)

        // A follow-up while an available teammate is online: held.
        const held = await visitor.send(`held ${marker}`, conversationId)
        await waitForEventHandled(held.messageId, { type: 'message.created' })
        // Offline again: the next follow-up bells, and the held one never came.
        await goOffline(online, s)
        await visitor.send(`after ${marker}`, conversationId)
        const rows = await waitForBells(watcher.principalId, conversationId, (r) =>
          r.some((b) => b.body?.includes(`after ${marker}`))
        )
        expect(rows.some((b) => b.body?.startsWith(`held ${marker}`))).toBe(false)
        expect(rows).toHaveLength(2)
      }
    )

    test(
      'PRS-18 a follow-up is held only by an online, available teammate who can see the conversation',
      { tag: '@core' },
      async ({ playwright, people, marker, newTeammate }) => {
        test.setTimeout(90_000)
        const supportTeam = people.teams.support
        // T works the Support team and is offline; S is online but works Billing.
        const t = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [supportTeam] })
        const s = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [people.teams.billing] })
        const away = await newTeammate({
          roleKey: 'e2e_scoped_agent',
          teams: [supportTeam],
          availability: 'away',
        })
        const admin = await personApi(playwright, 'admin')
        const visitor = await createVisitor(playwright)
        const { conversationId } = await visitor.send(`scoped ${marker}`)
        const followUps = (rows: BellRow[]) => rows.filter((b) => !b.body?.startsWith('scoped '))
        expect(
          (
            await callServerFn(admin, 'assignConversationTeamFn', {
              conversationId,
              teamId: supportTeam,
            })
          ).ok
        ).toBe(true)

        // S (out of scope) and an Away teammate in scope are online: neither holds.
        const sStream = await goOnline(s)
        const awayStream = await goOnline(away)
        await visitor.send(`not held ${marker}`, conversationId)
        await waitForBells(t.principalId, conversationId, (r) =>
          r.some((b) => b.body?.includes(`not held ${marker}`))
        )
        // The out-of-scope teammate (belled for the first message, while it sat
        // in the Unassigned queue) gets nothing once it is the Support team's.
        expect(followUps(await bellsFor(s.principalId, conversationId))).toEqual([])

        // An available teammate in scope online: held for everyone.
        const holder = await newTeammate({ roleKey: 'e2e_scoped_agent', teams: [supportTeam] })
        const holderStream = await goOnline(holder)
        const held = await visitor.send(`held ${marker}`, conversationId)
        await waitForEventHandled(held.messageId, { type: 'message.created' })
        await goOffline(holder, holderStream)
        await visitor.send(`released ${marker}`, conversationId)
        const rows = await waitForBells(t.principalId, conversationId, (r) =>
          r.some((b) => b.body?.includes(`released ${marker}`))
        )
        expect(rows.some((b) => b.body?.startsWith(`held ${marker}`))).toBe(false)
        expect(followUps(await bellsFor(s.principalId, conversationId))).toEqual([])
        sStream.close()
        awayStream.close()
        await admin.dispose()
      }
    )
  })

  test(
    'PRS-16 the reply email waits on the visitor being away from the thread',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const t = await newTeammate({ roleKey: 'support_lead' })
      const api = await t.api(playwright)
      const email = `${marker}@customers.example`
      const visitor = await createVisitor(playwright, { email })
      const { conversationId } = await visitor.send(`email me ${marker}`)

      // While the visitor's thread is open, a reply sends no email.
      const live = await visitor.openStream(conversationId)
      await warmUpStream(live, conversationId, { api, fn: 'sendConversationTypingFn' })
      await waitForPresence(await visitor.principalId(), true)
      expect(
        (
          await callServerFn(api, 'sendAgentMessageFn', {
            conversationId,
            content: `while here ${marker}`,
          })
        ).ok
      ).toBe(true)
      await live.waitFor((e) => e.event === 'message' && e.raw.includes(`while here ${marker}`))

      // Gone: the next reply is emailed.
      live.close()
      await waitForPresence(await visitor.principalId(), false, 15_000)
      expect(
        (
          await callServerFn(api, 'sendAgentMessageFn', {
            conversationId,
            content: `while away ${marker}`,
          })
        ).ok
      ).toBe(true)
      const rows = await pollFor(
        'the reply email',
        async () => {
          const r = await emailLogFor(email)
          return r.length > 0 ? r : null
        },
        { timeoutMs: 20_000 }
      )
      expect(rows).toHaveLength(1)
    }
  )

  test(
    'PRS-21 removing a teammate closes their open inbox stream and clears its presence',
    { tag: '@nightly' },
    async ({ playwright, newTeammate }) => {
      const t = await newTeammate({ roleKey: 'support_lead' })
      const inbox = await openStream({ cookie: t.cookie, query: { scope: 'inbox' } })
      await waitForPresence(t.principalId, true)
      const admin = await personApi(playwright, 'admin')
      const removed = await callServerFn(admin, 'removeTeamMemberFn', {
        principalId: t.principalId,
      })
      expect(removed.ok, removed.error).toBe(true)
      await pollFor('the stream to close', async () => (inbox.isOpen() ? null : true), {
        timeoutMs: 20_000,
      })
      await waitForPresence(t.principalId, false, 15_000)
      const again = await openStream({ cookie: t.cookie, query: { scope: 'inbox' } })
      expect(again.status).toBe(403)
      await admin.dispose()
    }
  )
})
