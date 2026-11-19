/**
 * Routing and assignment (RTE): the auto-assign switch, who a new
 * conversation goes to, manual assignment, claim by reply, the offline
 * re-queue, removal, and what customers never see.
 *
 * Runs in the `support-serial` project: routing switched on sends every new
 * conversation to whoever is online, so nothing else may run meanwhile. Each
 * test starts with routing off and no presence rows, and the routing
 * candidates are teammates the test makes itself.
 */
import { toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { createSupportApiKey, seedConversation } from '../../utils/db-helpers'
import { sendInboundEmail, supportInboxAddress } from '../../support/inbound-email'
import { callServerFn, personApi } from '../../support/server-fns'
import { openStream } from '../../support/streams'
import { waitForPresence } from '../../support/presence'
import {
  adminApi,
  assignmentNotices,
  bellsFor,
  clearAllPresence,
  conversationEvents,
  conversationState,
  conversationWithMessage,
  createCustomer,
  createRole,
  customerSays,
  goOnline,
  seedLoad,
  setRouting,
  systemNotices,
  waitForAssignee,
  waitForAssignmentNotices,
  waitForBell,
} from '../../support/routing'

test.beforeEach(async ({ playwright }) => {
  await clearAllPresence()
  await setRouting(playwright, false)
})

test.afterEach(async ({ playwright }) => {
  await setRouting(playwright, false)
})

/** The inbox header's assignee control while it shows `name` (avatar initials come first). */
function assigneeButton(page: Page, name: string) {
  return page.locator('#admin-main').getByRole('button', {
    name: new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
  })
}

/** Give the event hooks (bells, webhooks) time to settle before checking an absence. */
async function settle(ms = 1_500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

test.describe('the routing switch', () => {
  test(
    'RTE-01 routing is off by default: the card shows the switch off',
    { tag: '@core' },
    async ({ asPerson, playwright }) => {
      const admin = await asPerson('admin')
      await admin.goto('/admin/settings/channels')
      await expect(admin.getByRole('heading', { name: 'Conversation routing' })).toBeVisible({
        timeout: 20_000,
      })
      await expect(admin.getByText('Applies to new conversations on every channel.')).toBeVisible()
      await expect(admin.getByText('Assign to an agent who is online.')).toBeVisible()
      const toggle = admin.getByRole('switch', { name: 'Auto-assign new conversations' })
      await expect(toggle).not.toBeChecked()

      const api = await adminApi(playwright)
      const stored = await callServerFn(api, 'fetchConversationRoutingFn', undefined, {
        method: 'GET',
      })
      expect(stored.data).toEqual({ enabled: false, strategy: 'auto_assign_active' })
    }
  )

  test(
    'RTE-02 the admin turns routing on and off; it persists across a reload',
    { tag: '@core' },
    async ({ asPerson, playwright }) => {
      const api = await adminApi(playwright)
      const read = async () =>
        (
          await callServerFn<{ enabled: boolean }>(api, 'fetchConversationRoutingFn', undefined, {
            method: 'GET',
          })
        ).data

      const admin = await asPerson('admin')
      await admin.goto('/admin/settings/channels')
      const toggle = admin.getByRole('switch', { name: 'Auto-assign new conversations' })
      await expect(toggle).toBeEnabled({ timeout: 20_000 })
      await expect(toggle).not.toBeChecked()

      await expect(async () => {
        await toggle.click()
        await expect(toggle).toBeChecked({ timeout: 2_000 })
      }).toPass({ timeout: 15_000 })
      await expect.poll(read).toEqual({ enabled: true, strategy: 'auto_assign_active' })

      await admin.reload()
      await expect(toggle).toBeChecked({ timeout: 20_000 })

      await toggle.click()
      await expect(toggle).not.toBeChecked()
      await expect.poll(read).toEqual({ enabled: false, strategy: 'auto_assign_active' })
      await admin.reload()
      await expect(toggle).not.toBeChecked({ timeout: 20_000 })
    }
  )

  test(
    'RTE-03 Owner and Admin read and change routing; a role with neither key is refused; the strategy is fixed',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const body = { enabled: false, strategy: 'auto_assign_active' }
      const owner = await newTeammate({ roleKey: 'owner', principalRole: 'admin' })
      for (const api of [await adminApi(playwright), await owner.api(playwright)]) {
        expect(
          (await callServerFn(api, 'fetchConversationRoutingFn', undefined, { method: 'GET' })).ok
        ).toBe(true)
        expect((await callServerFn(api, 'updateConversationRoutingFn', body)).ok).toBe(true)
      }

      const contributor = await personApi(playwright, 'contributor')
      const read = await callServerFn(contributor, 'fetchConversationRoutingFn', undefined, {
        method: 'GET',
      })
      expect(read.ok).toBe(false)
      expect(read.error).toContain('lacks it')
      const write = await callServerFn(contributor, 'updateConversationRoutingFn', {
        ...body,
        enabled: true,
      })
      expect(write.ok).toBe(false)

      // RTE-04: only the one strategy is accepted.
      const admin = await adminApi(playwright)
      const other = await callServerFn(admin, 'updateConversationRoutingFn', {
        enabled: true,
        strategy: 'round_robin',
      })
      expect(other.ok).toBe(false)
      const stored = await callServerFn(admin, 'fetchConversationRoutingFn', undefined, {
        method: 'GET',
      })
      expect(stored.data).toEqual({ enabled: false, strategy: 'auto_assign_active' })
    }
  )

  test(
    'RTE-03 a Support lead (routing.manage) may read and change the routing switch',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Known bug: the routing switch is gated on settings.manage, not routing.manage (functions/settings.ts:930, :940)',
      },
    },
    async ({ playwright, newTeammate }) => {
      const lead = await newTeammate({ roleKey: 'support_lead' })
      const api = await lead.api(playwright)
      const read = await callServerFn(api, 'fetchConversationRoutingFn', undefined, {
        method: 'GET',
      })
      expect(read.ok, read.error.slice(0, 200)).toBe(true)
      const write = await callServerFn(api, 'updateConversationRoutingFn', {
        enabled: false,
        strategy: 'auto_assign_active',
      })
      expect(write.ok, write.error.slice(0, 200)).toBe(true)
    }
  )
})

test.describe('who a new conversation goes to', () => {
  test(
    'RTE-06 a new widget conversation goes to the one online teammate; the notice is agent-only',
    { tag: '@smoke' },
    async ({ page, asPerson, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      await setRouting(playwright, true)
      const agent = await newTeammate({
        roleKey: 'support_lead',
        name: `Agent ${marker.slice(-8)}`,
      })
      const online = await goOnline(agent)

      await page.goto('/widget')
      await page.getByRole('button', { name: 'Messages', exact: true }).click()
      await page.getByRole('button', { name: /Ask a question/ }).click()
      const composer = page.locator('.ProseMirror[contenteditable="true"]')
      await composer.click()
      const text = `Routing smoke ${marker}`
      await composer.fill(text)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(page.getByText(text)).toBeVisible({ timeout: 15_000 })

      const conversationId = await conversationWithMessage(text)
      await waitForAssignee(conversationId, agent.principalId)
      await waitForAssignmentNotices(conversationId, 1)
      const notices = await assignmentNotices(conversationId)
      expect(notices).toEqual([
        {
          content: `Conversation assigned to ${agent.name}`,
          isInternal: true,
          kind: 'assigned',
          workflowName: null,
        },
      ])
      await waitForBell(agent.principalId, conversationId, 'conversation_assigned')

      // The agent thread shows the notice; the visitor's thread never does.
      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversationId}`)
      await expect(admin.getByText(`Conversation assigned to ${agent.name}`)).toBeVisible({
        timeout: 20_000,
      })
      await page.reload()
      await page.getByRole('button', { name: 'Messages', exact: true }).click()
      await page.getByText(text).first().click()
      await expect(page.getByText(text).first()).toBeVisible()
      await expect(page.getByText(/Conversation assigned to/)).toHaveCount(0)
      online.close()
    }
  )

  test(
    'RTE-07 the least-loaded online teammate gets it; equal load goes to the smaller id',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      await setRouting(playwright, true)
      const a = await newTeammate({ roleKey: 'support_lead' })
      const b = await newTeammate({ roleKey: 'support_lead' })
      await seedLoad(a.principalId, 2, `${marker}-a`)
      await seedLoad(b.principalId, 1, `${marker}-b`)
      const streams = [await goOnline(a), await goOnline(b)]

      const first = await createCustomer(marker)
      const one = await customerSays(await first.api(playwright), `first ${marker}`)
      await waitForAssignee(one.conversationId, b.principalId)

      // Now both carry two open conversations: the smaller principal id wins.
      const smaller = a.principalId < b.principalId ? a : b
      const second = await createCustomer(marker)
      const two = await customerSays(await second.api(playwright), `second ${marker}`)
      await waitForAssignee(two.conversationId, smaller.principalId)
      for (const s of streams) s.close()
    }
  )

  test(
    'RTE-08 with nobody online the conversation stays in the Unassigned queue, with no notice',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      await setRouting(playwright, true)
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `nobody ${marker}`
      )
      await settle()
      const state = await conversationState(conversationId)
      expect(state.assignedAgent).toBeNull()
      expect(state.assignedTeam).toBeNull()
      expect(await assignmentNotices(conversationId)).toEqual([])
      expect(await conversationEvents(conversationId, 'conversation.assigned')).toEqual([])

      // It is in the Unassigned queue a scoped teammate works from.
      const scoped = await personApi(playwright, 'scoped')
      const list = await callServerFn<{ items: Array<{ id: string }> }>(
        scoped,
        'listConversationsFn',
        { assignee: 'unassigned', status: 'open', search: marker },
        { method: 'GET' }
      )
      expect(list.ok, list.error.slice(0, 300)).toBe(true)
      expect(JSON.stringify(list.data)).toContain(conversationId)
    }
  )

  test(
    'RTE-09 an online teammate who is Away is not routed to',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      await setRouting(playwright, true)
      const away = await newTeammate({ roleKey: 'support_lead', availability: 'away' })
      const online = await goOnline(away)
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `away ${marker}`
      )
      await settle()
      expect((await conversationState(conversationId)).assignedAgent).toBeNull()
      expect(await assignmentNotices(conversationId)).toEqual([])
      online.close()
    }
  )

  test(
    'RTE-10 with routing off nobody is assigned, even with a teammate online',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const online = await goOnline(agent)
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(await customer.api(playwright), `off ${marker}`)
      await settle()
      expect((await conversationState(conversationId)).assignedAgent).toBeNull()
      expect(await assignmentNotices(conversationId)).toEqual([])
      online.close()
    }
  )

  test(
    'RTE-12 a test-customer thread stays with its owner and is not counted as load',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      await setRouting(playwright, true)
      const one = await newTeammate({ roleKey: 'support_lead' })
      const two = await newTeammate({ roleKey: 'support_lead' })
      // The owner is the larger id, so if their test thread counted as load the
      // tie would go to the other teammate.
      const [other, owner] = one.principalId < two.principalId ? [one, two] : [two, one]
      await seedLoad(other.principalId, 1, marker)
      const streams = [await goOnline(owner), await goOnline(other)]

      const tester = await createCustomer(`${marker}-test`)
      await supportDb()`UPDATE principal SET test_owner_principal_id = ${toUuid(owner.principalId as `principal_${string}`)}
                      WHERE id = ${toUuid(tester.principalId as `principal_${string}`)}`
      const testThread = await customerSays(await tester.api(playwright), `trying ${marker}`)
      await waitForAssignee(testThread.conversationId, owner.principalId)
      expect(await assignmentNotices(testThread.conversationId)).toEqual([])

      const real = await createCustomer(marker)
      const realThread = await customerSays(await real.api(playwright), `real ${marker}`)
      await waitForAssignee(realThread.conversationId, owner.principalId)
      for (const s of streams) s.close()
    }
  )

  test(
    'RTE-13 a cold inbound email is routed like a widget conversation',
    { tag: '@core' },
    async ({ playwright, request, marker, customerEmail, newTeammate }) => {
      await setRouting(playwright, true)
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const online = await goOnline(agent)
      const res = await sendInboundEmail(request, {
        from: customerEmail,
        to: supportInboxAddress(),
        subject: `Routed mail ${marker}`,
        text: `Please help ${marker}`,
        messageId: `<${marker}@customers.example>`,
      })
      expect(res.status(), await res.text()).toBe(200)
      const conversationId = await conversationWithMessage(`Please help ${marker}`)
      await waitForAssignee(conversationId, agent.principalId)
      await waitForAssignmentNotices(conversationId, 1)
      expect((await assignmentNotices(conversationId)).map((n) => n.content)).toEqual([
        `Conversation assigned to ${agent.name}`,
      ])
      online.close()
    }
  )

  test(
    'RTE-14 a customer reopening a closed conversation keeps its assignee, or none',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await adminApi(playwright)
      const keeper = await newTeammate({ roleKey: 'support_lead' })
      const other = await newTeammate({ roleKey: 'support_lead' })

      const c1 = await createCustomer(marker)
      const c1Api = await c1.api(playwright)
      const assigned = await customerSays(c1Api, `assigned ${marker}`)
      const c2 = await createCustomer(marker)
      const c2Api = await c2.api(playwright)
      const unassigned = await customerSays(c2Api, `unassigned ${marker}`)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId: assigned.conversationId,
        assignTo: keeper.principalId,
      })
      for (const id of [assigned.conversationId, unassigned.conversationId]) {
        const closed = await callServerFn(admin, 'setConversationStatusFn', {
          conversationId: id,
          status: 'closed',
        })
        expect(closed.ok, closed.error.slice(0, 200)).toBe(true)
      }

      // Routing is on and someone else is online when the customers come back.
      await setRouting(playwright, true)
      const online = await goOnline(other)
      await customerSays(c1Api, `back again ${marker}`, assigned.conversationId)
      await customerSays(c2Api, `back again ${marker}`, unassigned.conversationId)
      await settle()
      expect(await conversationState(assigned.conversationId)).toMatchObject({
        status: 'open',
        assignedAgent: keeper.principalId,
      })
      expect(await conversationState(unassigned.conversationId)).toMatchObject({
        status: 'open',
        assignedAgent: null,
      })
      expect(await assignmentNotices(unassigned.conversationId)).toEqual([])
      online.close()
    }
  )
})

test.describe('assigning by hand', () => {
  test(
    'RTE-16 the admin assigns a conversation to a teammate from the inbox',
    { tag: '@smoke' },
    async ({ asPerson, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const b = await newTeammate({ roleKey: 'support_lead', name: `Bea ${marker.slice(-10)}` })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `hand ${marker}`
      )

      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversationId}`)
      await expect(admin.getByText(`hand ${marker}`).first()).toBeVisible({ timeout: 20_000 })
      await expect(async () => {
        await admin.getByRole('button', { name: 'Unassigned', exact: true }).click()
        await admin.getByRole('menuitem', { name: b.name }).click({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })

      await expect(assigneeButton(admin, b.name)).toBeVisible()
      await expect(admin.getByText(`Conversation assigned to ${b.name}`)).toBeVisible()
      await waitForAssignee(conversationId, b.principalId)
      const bell = await waitForBell(b.principalId, conversationId, 'conversation_assigned')
      expect(bell.title).toBe('You were assigned a conversation')
    }
  )

  test(
    'RTE-17 "Assign to me" assigns the caller, posts the notice and rings no bell for them',
    { tag: '@core' },
    async ({ browser, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const me = await newTeammate({ roleKey: 'support_lead', name: `Mo ${marker.slice(-10)}` })
      const other = await newTeammate({ roleKey: 'support_lead' })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `mine ${marker}`
      )

      const page = await me.newPage(browser)
      await page.goto(`/admin/inbox?i=${conversationId}`)
      await expect(page.getByText(`mine ${marker}`).first()).toBeVisible({ timeout: 20_000 })
      await expect(async () => {
        await page.getByRole('button', { name: 'Unassigned', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Assign to me' }).click({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      await expect(assigneeButton(page, me.name)).toBeVisible()
      await expect(page.getByText(`Conversation assigned to ${me.name}`)).toBeVisible()
      await waitForAssignee(conversationId, me.principalId)

      // A later assignment by the same person bells its assignee: once that bell
      // is in, the first assignment's hooks have run too.
      const api = await me.api(playwright)
      await callServerFn(api, 'assignConversationFn', {
        conversationId,
        assignTo: other.principalId,
      })
      await waitForBell(other.principalId, conversationId, 'conversation_assigned')
      expect(
        (await bellsFor(me.principalId, conversationId)).filter(
          (b) => b.type === 'conversation_assigned'
        )
      ).toEqual([])
    }
  )

  test(
    'RTE-19 unassigning clears the assignee with no notice and returns it to Unassigned',
    { tag: '@core' },
    async ({ asPerson, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const b = await newTeammate({ roleKey: 'support_lead', name: `Una ${marker.slice(-10)}` })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `drop ${marker}`
      )
      const api = await adminApi(playwright)
      await callServerFn(api, 'assignConversationFn', { conversationId, assignTo: b.principalId })
      expect(await assignmentNotices(conversationId)).toHaveLength(1)

      const admin = await asPerson('admin')
      await admin.goto(`/admin/inbox?i=${conversationId}`)
      await expect(admin.getByText(`drop ${marker}`).first()).toBeVisible({ timeout: 20_000 })
      await expect(async () => {
        await assigneeButton(admin, b.name).click()
        await admin.getByRole('menuitem', { name: 'Unassign' }).click({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      await expect(admin.getByRole('button', { name: 'Unassigned', exact: true })).toBeVisible()
      await waitForAssignee(conversationId, null)
      expect(await assignmentNotices(conversationId)).toHaveLength(1)
      // The event row is written after the update returns: wait for it.
      await expect
        .poll(async () =>
          (await conversationEvents(conversationId, 'conversation.assigned')).some(
            (e) =>
              e.payload.assignedAgentPrincipalId === null &&
              e.payload.previousAgentPrincipalId === b.principalId
          )
        )
        .toBe(true)
    }
  )

  test(
    'RTE-20 assigning to someone who is not a teammate is refused and changes nothing',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(await customer.api(playwright), `who ${marker}`)
      const api = await adminApi(playwright)
      const res = await callServerFn(api, 'assignConversationFn', {
        conversationId,
        assignTo: customer.principalId,
      })
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_ASSIGNEE')
      expect(res.error).toContain('Can only assign to a team member')
      expect((await conversationState(conversationId)).assignedAgent).toBeNull()
      expect(await assignmentNotices(conversationId)).toEqual([])
    }
  )

  test(
    'RTE-21 a role without conversation.assign is refused; a Contributor may assign',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const roleKey = await createRole(marker, ['conversation.view', 'conversation.reply'])
      const noAssign = await newTeammate({ roleKey })
      const target = await newTeammate({ roleKey: 'support_lead' })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `perm ${marker}`
      )

      const refused = await callServerFn(await noAssign.api(playwright), 'assignConversationFn', {
        conversationId,
        assignTo: target.principalId,
      })
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain('conversation.assign')
      expect((await conversationState(conversationId)).assignedAgent).toBeNull()

      const contributor = await personApi(playwright, 'contributor')
      const allowed = await callServerFn(contributor, 'assignConversationFn', {
        conversationId,
        assignTo: target.principalId,
      })
      expect(allowed.ok, allowed.error.slice(0, 200)).toBe(true)
      expect((await conversationState(conversationId)).assignedAgent).toBe(target.principalId)
    }
  )

  test(
    'RTE-22 reassigning a snoozed conversation wakes it; the assignee reassigning their own does not',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const owner = await newTeammate({ roleKey: 'support_lead' })
      const next = await newTeammate({ roleKey: 'support_lead' })
      const ownerApi = await owner.api(playwright)
      const admin = await adminApi(playwright)
      const until = new Date(Date.now() + 24 * 3600_000).toISOString()

      const snoozedFor = async (text: string) => {
        const customer = await createCustomer(marker)
        const { conversationId } = await customerSays(await customer.api(playwright), text)
        await callServerFn(admin, 'assignConversationFn', {
          conversationId,
          assignTo: owner.principalId,
        })
        const snoozed = await callServerFn(ownerApi, 'snoozeConversationFn', {
          conversationId,
          until,
        })
        expect(snoozed.ok, snoozed.error.slice(0, 200)).toBe(true)
        expect((await conversationState(conversationId)).status).toBe('snoozed')
        return conversationId
      }

      // Someone other than the assignee reassigns: it wakes.
      const woken = await snoozedFor(`wake ${marker}`)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId: woken,
        assignTo: next.principalId,
      })
      expect(await conversationState(woken)).toMatchObject({
        status: 'open',
        snoozedUntil: null,
        assignedAgent: next.principalId,
      })
      await expect
        .poll(async () => (await conversationEvents(woken, 'conversation.status_changed')).length)
        .toBeGreaterThan(0)

      // The assignee hands their own snoozed conversation on: it stays snoozed.
      const kept = await snoozedFor(`keep ${marker}`)
      await callServerFn(ownerApi, 'assignConversationFn', {
        conversationId: kept,
        assignTo: next.principalId,
      })
      expect(await conversationState(kept)).toMatchObject({
        status: 'snoozed',
        assignedAgent: next.principalId,
      })
    }
  )

  test(
    "RTE-50 a scoped teammate cannot assign another team's conversation; the Unassigned queue is theirs to take",
    { tag: '@core' },
    async ({ playwright, people, marker }) => {
      const hidden = seedConversation(`${marker} hidden`)
      await supportDb()`UPDATE conversations SET assigned_team_id = ${toUuid(people.teams.support as `team_${string}`)}
                      WHERE id = ${toUuid(hidden.conversationId as `conversation_${string}`)}`
      const scoped = await personApi(playwright, 'scoped')
      const assign = await callServerFn(scoped, 'assignConversationFn', {
        conversationId: hidden.conversationId,
        assignTo: 'me',
      })
      expect(assign.code).toBe('CONVERSATION_NOT_FOUND')
      const team = await callServerFn(scoped, 'assignConversationTeamFn', {
        conversationId: hidden.conversationId,
        teamId: people.teams.billing,
      })
      expect(team.code).toBe('CONVERSATION_NOT_FOUND')
      const bulk = await callServerFn<{ succeeded: string[]; failed: Array<{ id: string }> }>(
        scoped,
        'bulkUpdateConversationsFn',
        { conversationIds: [hidden.conversationId], action: { type: 'assign', assignTo: 'me' } }
      )
      expect(bulk.data.succeeded).toEqual([])
      expect(bulk.data.failed.map((f) => f.id)).toEqual([hidden.conversationId])
      expect(await conversationState(hidden.conversationId)).toMatchObject({
        assignedAgent: null,
        assignedTeam: people.teams.support,
      })

      const open = seedConversation(`${marker} open`)
      const take = await callServerFn(scoped, 'assignConversationFn', {
        conversationId: open.conversationId,
        assignTo: 'me',
      })
      expect(take.ok, take.error.slice(0, 200)).toBe(true)
      expect((await conversationState(open.conversationId)).assignedAgent).toBe(
        people.people.scoped.principalId
      )
    }
  )
})

test.describe('claiming by reply', () => {
  test(
    'RTE-33 the first teammate reply claims an unassigned conversation, with no notice',
    { tag: '@core' },
    async ({ browser, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `claim ${marker}`
      )
      const [before] = await supportDb()`SELECT waiting_since FROM conversations
                                        WHERE id = ${toUuid(conversationId as `conversation_${string}`)}`
      expect(before.waiting_since).not.toBeNull()

      const page = await agent.newPage(browser)
      await page.goto(`/admin/inbox?i=${conversationId}`)
      await expect(page.getByText(`claim ${marker}`).first()).toBeVisible({ timeout: 20_000 })
      const reply = `On it ${marker}`
      const editor = page.locator('.ProseMirror[contenteditable="true"]').last()
      await expect(async () => {
        await editor.click()
        await editor.fill(reply)
        await page.getByRole('button', { name: 'Send reply' }).click({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })

      await waitForAssignee(conversationId, agent.principalId)
      await expect(assigneeButton(page, agent.name)).toBeVisible()
      const [after] = await supportDb()`SELECT waiting_since FROM conversations
                                       WHERE id = ${toUuid(conversationId as `conversation_${string}`)}`
      expect(after.waiting_since).toBeNull()
      expect(await assignmentNotices(conversationId)).toEqual([])
      await expect
        .poll(
          async () => (await conversationEvents(conversationId, 'conversation.assigned')).length
        )
        .toBe(1)
      await settle()
      expect(await bellsFor(agent.principalId, conversationId)).toEqual(
        expect.not.arrayContaining([expect.objectContaining({ type: 'conversation_assigned' })])
      )
    }
  )

  test(
    'RTE-34 a reply on a conversation assigned to someone else keeps that assignee',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const holder = await newTeammate({ roleKey: 'support_lead' })
      const helper = await newTeammate({ roleKey: 'support_lead' })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `keep ${marker}`
      )
      await callServerFn(await adminApi(playwright), 'assignConversationFn', {
        conversationId,
        assignTo: holder.principalId,
      })
      const assignedEvents = async () =>
        (await conversationEvents(conversationId, 'conversation.assigned')).length
      await expect.poll(assignedEvents).toBe(1)
      const sent = await callServerFn(await helper.api(playwright), 'sendAgentMessageFn', {
        conversationId,
        content: `helping ${marker}`,
      })
      expect(sent.ok, sent.error.slice(0, 200)).toBe(true)
      expect((await conversationState(conversationId)).assignedAgent).toBe(holder.principalId)
      await settle()
      expect(await assignedEvents()).toBe(1)
    }
  )

  test(
    'RTE-35 a reply through an API key posts but never claims',
    { tag: '@core' },
    async ({ request, playwright, marker, people }) => {
      // A personal key is a service principal too. (The harness mints personal
      // keys only: a workspace key needs a grantable role.)
      for (const kind of ['personal'] as const) {
        const key = createSupportApiKey(people.people.admin.email, kind)
        const customer = await createCustomer(`${marker}-${kind}`)
        const { conversationId } = await customerSays(
          await customer.api(playwright),
          `api ${kind} ${marker}`
        )
        const res = await request.post(`/api/v1/conversations/${conversationId}/reply`, {
          headers: { authorization: `Bearer ${key}` },
          data: { content: `Reply by ${kind} key ${marker}` },
        })
        expect(res.status(), await res.text()).toBeLessThan(300)
        await conversationWithMessage(`Reply by ${kind} key ${marker}`)
        expect((await conversationState(conversationId)).assignedAgent, kind).toBeNull()
      }
    }
  )

  test(
    "RTE-36 REST assign: 200 with the conversation and the notice; 400 on a bad body; 404 outside a personal key's scope",
    { tag: '@core' },
    async ({ request, playwright, people, marker, newTeammate }) => {
      const target = await newTeammate({ roleKey: 'support_lead' })
      const adminKey = createSupportApiKey(people.people.admin.email, 'personal')
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `rest ${marker}`
      )
      const auth = { authorization: `Bearer ${adminKey}` }

      const ok = await request.post(`/api/v1/conversations/${conversationId}/assign`, {
        headers: auth,
        data: { assigneePrincipalId: target.principalId },
      })
      expect(ok.status(), await ok.text()).toBe(200)
      expect(JSON.stringify(await ok.json())).toContain(target.principalId)
      expect((await assignmentNotices(conversationId)).map((n) => n.content)).toEqual([
        `Conversation assigned to ${target.name}`,
      ])

      const bad = await request.post(`/api/v1/conversations/${conversationId}/assign`, {
        headers: auth,
        data: { assigneePrincipalId: 42 },
      })
      expect(bad.status()).toBe(400)
      expect(await bad.text()).toContain('Invalid request body')

      const hidden = seedConversation(`${marker} hidden`)
      await supportDb()`UPDATE conversations SET assigned_team_id = ${toUuid(people.teams.support as `team_${string}`)}
                      WHERE id = ${toUuid(hidden.conversationId as `conversation_${string}`)}`
      const scopedKey = createSupportApiKey(people.people.scoped.email, 'personal')
      const outside = await request.post(`/api/v1/conversations/${hidden.conversationId}/assign`, {
        headers: { authorization: `Bearer ${scopedKey}` },
        data: { assigneePrincipalId: null },
      })
      expect(outside.status()).toBe(404)
      expect((await conversationState(hidden.conversationId)).assignedTeam).toBe(
        people.teams.support
      )
    }
  )
})

test.describe('going offline', () => {
  test(
    'RTE-41 closing the last inbox tab frees unanswered work and routes it to who is online',
    { tag: '@core' },
    async ({ browser, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      await setRouting(playwright, true)
      const leaving = await newTeammate({ roleKey: 'support_lead' })
      const staying = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)

      // Created while nobody is online, then handed to the teammate who leaves.
      const c1 = await createCustomer(marker)
      const unanswered = await customerSays(await c1.api(playwright), `unanswered ${marker}`)
      const c2 = await createCustomer(marker)
      const answered = await customerSays(await c2.api(playwright), `answered ${marker}`)
      for (const id of [unanswered.conversationId, answered.conversationId]) {
        await callServerFn(admin, 'assignConversationFn', {
          conversationId: id,
          assignTo: leaving.principalId,
        })
      }
      await callServerFn(await leaving.api(playwright), 'sendAgentMessageFn', {
        conversationId: answered.conversationId,
        content: `I replied ${marker}`,
      })

      const page = await leaving.newPage(browser)
      await page.goto('/admin/inbox')
      await waitForPresence(leaving.principalId, true, 20_000)
      const online = await goOnline(staying)

      await page.context().close()
      await waitForAssignee(unanswered.conversationId, staying.principalId, 20_000)
      await waitForAssignmentNotices(unanswered.conversationId, 2)
      expect((await assignmentNotices(unanswered.conversationId)).at(-1)?.content).toBe(
        `Conversation assigned to ${staying.name}`
      )
      await waitForBell(staying.principalId, unanswered.conversationId, 'conversation_assigned')
      expect((await conversationState(answered.conversationId)).assignedAgent).toBe(
        leaving.principalId
      )
      online.close()
    }
  )

  test(
    'RTE-42 setting Away stops new routing but keeps assigned work',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const customer = await createCustomer(marker)
      const held = await customerSays(await customer.api(playwright), `held ${marker}`)
      await callServerFn(await adminApi(playwright), 'assignConversationFn', {
        conversationId: held.conversationId,
        assignTo: agent.principalId,
      })
      await setRouting(playwright, true)
      const online = await goOnline(agent)
      const away = await callServerFn(await agent.api(playwright), 'setAgentAvailabilityFn', {
        availability: 'away',
      })
      expect(away.ok, away.error.slice(0, 200)).toBe(true)

      const next = await createCustomer(marker)
      const fresh = await customerSays(await next.api(playwright), `fresh ${marker}`)
      await settle()
      expect((await conversationState(fresh.conversationId)).assignedAgent).toBeNull()
      expect((await conversationState(held.conversationId)).assignedAgent).toBe(agent.principalId)
      online.close()
    }
  )

  test(
    'RTE-43 closing one of two inbox tabs keeps the teammate online and frees nothing',
    { tag: '@nightly' },
    async ({ browser, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `two tabs ${marker}`
      )
      await callServerFn(await adminApi(playwright), 'assignConversationFn', {
        conversationId,
        assignTo: agent.principalId,
      })
      const first = await agent.newPage(browser)
      await first.goto('/admin/inbox')
      const second = await first.context().newPage()
      await second.goto('/admin/inbox')
      await expect
        .poll(async () => (await waitForPresence(agent.principalId, true)).length, {
          timeout: 20_000,
        })
        .toBe(2)

      await second.close()
      await expect
        .poll(async () => (await waitForPresence(agent.principalId, true)).length, {
          timeout: 20_000,
        })
        .toBe(1)
      await settle()
      expect((await conversationState(conversationId)).assignedAgent).toBe(agent.principalId)
    }
  )

  test(
    'RTE-44 freed conversations spread across the online team one at a time',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      await setRouting(playwright, true)
      const leaving = await newTeammate({ roleKey: 'support_lead' })
      const b = await newTeammate({ roleKey: 'support_lead' })
      const c = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const ids: string[] = []
      for (const n of [1, 2]) {
        const customer = await createCustomer(`${marker}-${n}`)
        const { conversationId } = await customerSays(
          await customer.api(playwright),
          `freed ${n} ${marker}`
        )
        await callServerFn(admin, 'assignConversationFn', {
          conversationId,
          assignTo: leaving.principalId,
        })
        ids.push(conversationId)
      }
      const leavingStream = await goOnline(leaving)
      const streams = [await goOnline(b), await goOnline(c)]
      leavingStream.close()
      await expect
        .poll(
          async () => {
            const owners = await Promise.all(
              ids.map(async (id) => (await conversationState(id)).assignedAgent)
            )
            return owners.sort()
          },
          { timeout: 20_000 }
        )
        .toEqual([b.principalId, c.principalId].sort())
      for (const s of streams) s.close()
    }
  )
})

test.describe('removal', () => {
  test(
    'RTE-45 a removed teammate keeps their assignments, loses their keys and cannot be picked again',
    { tag: '@core' },
    async ({ browser, request, playwright, marker, newTeammate }) => {
      const leaver = await newTeammate({ roleKey: 'support_lead' })
      const key = createSupportApiKey(leaver.email, 'personal')
      expect(
        (
          await request.get('/api/v1/conversations', {
            headers: { authorization: `Bearer ${key}` },
          })
        ).status()
      ).toBe(200)
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(
        await customer.api(playwright),
        `left ${marker}`
      )
      const admin = await adminApi(playwright)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId,
        assignTo: leaver.principalId,
      })
      const noticesBefore = await systemNotices(conversationId)

      const removed = await callServerFn(admin, 'removeTeamMemberFn', {
        principalId: leaver.principalId,
      })
      expect(removed.ok, removed.error.slice(0, 200)).toBe(true)

      expect((await conversationState(conversationId)).assignedAgent).toBe(leaver.principalId)
      expect(await systemNotices(conversationId)).toEqual(noticesBefore)
      expect(
        (
          await request.get('/api/v1/conversations', {
            headers: { authorization: `Bearer ${key}` },
          })
        ).status()
      ).toBe(401)

      const other = await createCustomer(marker)
      const second = await customerSays(await other.api(playwright), `again ${marker}`)
      const again = await callServerFn(admin, 'assignConversationFn', {
        conversationId: second.conversationId,
        assignTo: leaver.principalId,
      })
      expect(again.code).toBe('INVALID_ASSIGNEE')

      // Their session no longer opens the admin.
      const page = await leaver.newPage(browser)
      await page.goto('/admin/inbox')
      await expect(page).not.toHaveURL(/\/admin\/inbox/, { timeout: 20_000 })
    }
  )

  test('RTE-46 removing yourself is refused', { tag: '@core' }, async ({ playwright, people }) => {
    const admin = await adminApi(playwright)
    const res = await callServerFn(admin, 'removeTeamMemberFn', {
      principalId: people.people.admin.principalId,
    })
    expect(res.code).toBe('CANNOT_REMOVE_SELF')
    expect(res.error).toContain('You cannot remove yourself from the team')
    const [row] = await supportDb()`SELECT role FROM principal
      WHERE id = ${toUuid(people.people.admin.principalId as `principal_${string}`)}`
    expect(row.role).toBe('admin')
  })
})

test.describe('what customers see', () => {
  test(
    'RTE-47 customers never see assignment notices, new or old; other notices stay visible',
    { tag: '@core' },
    async ({ browser, asPerson, playwright, people, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'support_lead', name: `Alex ${marker.slice(-8)}` })
      const customer = await createCustomer(marker)
      const { conversationId } = await customerSays(await customer.api(playwright), `see ${marker}`)
      const admin = await adminApi(playwright)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId,
        assignTo: agent.principalId,
      })
      await callServerFn(admin, 'assignConversationTeamFn', {
        conversationId,
        teamId: people.teams.support,
      })
      // A legacy public assignment row from before notices became internal.
      await supportDb()`INSERT INTO conversation_messages (id, conversation_id, principal_id, sender_type, content, is_internal)
      VALUES (gen_random_uuid(), ${toUuid(conversationId as `conversation_${string}`)}, NULL, 'system',
              ${`Conversation assigned to Legacy ${marker.slice(-6)}`}, false)`
      await callServerFn(admin, 'sendAgentMessageFn', {
        conversationId,
        content: `Public answer ${marker}`,
      })
      const ended = await callServerFn(admin, 'endConversationFn', {
        conversationId,
        reason: 'resolved',
      })
      expect(ended.ok, ended.error.slice(0, 200)).toBe(true)
      const publicNotices = (await systemNotices(conversationId)).filter((n) => !n.isInternal)
      expect(publicNotices.length).toBeGreaterThan(1)
      const endNotice = publicNotices.at(-1)!.content

      const context = await browser.newContext({ storageState: customer.storageState })
      const portal = await context.newPage()
      await portal.goto(`/support/${conversationId}`)
      await expect(portal.getByText(`Public answer ${marker}`)).toBeVisible({ timeout: 20_000 })
      await expect(portal.getByText(endNotice).first()).toBeVisible()
      await expect(portal.getByText(/Conversation assigned to/)).toHaveCount(0)
      await context.close()

      const agentView = await asPerson('admin')
      await agentView.goto(`/admin/inbox?i=${conversationId}`)
      await expect(agentView.getByText(`Conversation assigned to ${agent.name}`)).toBeVisible({
        timeout: 20_000,
      })
      await expect(
        agentView.getByText(/Conversation assigned to the E2E Support team/)
      ).toBeVisible()
    }
  )

  test(
    "RTE-48 an assignment reaches the inbox stream but never the customer's stream",
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const watcher = await newTeammate({ roleKey: 'support_lead' })
      const customer = await createCustomer(marker)
      const customerApi = await customer.api(playwright)
      const { conversationId } = await customerSays(customerApi, `stream ${marker}`)

      const cookie = (
        customer.storageState.cookies as Array<{ name: string; value: string; secure: boolean }>
      )
        .filter((c) => !c.secure)
        .map((c) => `${c.name}=${c.value}`)
        .join('; ')
      const visitor = await openStream({ cookie, query: { conversationId } })
      expect(visitor.status).toBe(200)
      const inbox = await openStream({ cookie: watcher.cookie, query: { scope: 'inbox' } })
      expect(inbox.status).toBe(200)
      // Warm up both: a customer message reaches both streams.
      await customerSays(customerApi, `warm ${marker}`, conversationId)
      await visitor.waitFor((e) => e.raw.includes(`warm ${marker}`))
      await inbox.waitFor((e) => e.raw.includes(`warm ${marker}`))

      const admin = await adminApi(playwright)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId,
        assignTo: agent.principalId,
      })
      await inbox.waitFor(
        (e) => e.event === 'message' && e.raw.includes(`Conversation assigned to ${agent.name}`)
      )
      // A later public reply reaches the customer: the notice would have come first.
      await callServerFn(admin, 'sendAgentMessageFn', {
        conversationId,
        content: `after ${marker}`,
      })
      await visitor.waitFor((e) => e.raw.includes(`after ${marker}`))
      expect(visitor.matching((e) => e.raw.includes('Conversation assigned to'))).toEqual([])
      visitor.close()
      inbox.close()
    }
  )

  test(
    'RTE-49 the assignment bell follows the in-app preference and opens the conversation',
    { tag: '@core' },
    async ({ browser, playwright, marker, newTeammate }) => {
      test.setTimeout(60_000)
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const agentApi = await agent.api(playwright)
      const admin = await adminApi(playwright)
      const setInApp = async (on: boolean) => {
        const res = await callServerFn(agentApi, 'updateNotificationPreferencesFn', {
          matrix: { conversation_assigned: { inApp: on } },
        })
        expect(res.ok, res.error.slice(0, 200)).toBe(true)
      }

      await setInApp(false)
      const c1 = await createCustomer(marker)
      const muted = await customerSays(await c1.api(playwright), `muted ${marker}`)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId: muted.conversationId,
        assignTo: agent.principalId,
      })
      // Bound the absence: a later assignment to someone else is belled, so
      // the muted one's hooks have run by then.
      const witness = await newTeammate({ roleKey: 'support_lead' })
      const c3 = await createCustomer(marker)
      const later = await customerSays(await c3.api(playwright), `later ${marker}`)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId: later.conversationId,
        assignTo: witness.principalId,
      })
      await waitForBell(witness.principalId, later.conversationId, 'conversation_assigned')
      await settle()
      const mutedBells = async () =>
        (await bellsFor(agent.principalId, muted.conversationId)).filter(
          (b) => b.type === 'conversation_assigned'
        )
      expect(await mutedBells()).toEqual([])

      await setInApp(true)
      const c2 = await createCustomer(marker)
      const rung = await customerSays(await c2.api(playwright), `rung ${marker}`)
      await callServerFn(admin, 'assignConversationFn', {
        conversationId: rung.conversationId,
        assignTo: agent.principalId,
      })
      const bell = await waitForBell(
        agent.principalId,
        rung.conversationId,
        'conversation_assigned'
      )
      expect(bell.metadata?.conversationId).toBe(rung.conversationId)
      expect(await mutedBells()).toEqual([])

      const page = await agent.newPage(browser)
      await page.goto('/admin/notifications')
      await expect(async () => {
        await page.getByText('You were assigned a conversation').first().click()
        await expect(page).toHaveURL(new RegExp(`/admin/inbox\\?i=${rung.conversationId}`), {
          timeout: 3_000,
        })
      }).toPass({ timeout: 20_000 })
    }
  )
})
