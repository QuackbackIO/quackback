/**
 * Team assignment and distribution (RTE): manual, round robin and balanced
 * teams, team settings, bulk assignment, workflow assign actions and the AI
 * agent's hand-off to the team.
 *
 * Runs in the `support-serial` project (see routing.spec.ts): distribution and
 * routing read who is online, so nothing else may run meanwhile.
 */
import { fromUuid, toUuid } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { FAKE_AI_FAIL, fakeAi } from '../../support/fake-ai-client'
import { callServerFn } from '../../support/server-fns'
import {
  adminApi,
  assignmentNotices,
  bellsFor,
  clearAllPresence,
  conversationState,
  conversationWithMessage,
  createCustomer,
  customerSays,
  goOnline,
  seedLoad,
  setRouting,
  systemNotices,
  waitForAssignee,
  waitForAssignmentNotices,
  waitForBell,
} from '../../support/routing'
import type { TestTeammate } from '../../support/teammates'

type Method = 'manual' | 'round_robin' | 'balanced'

test.beforeEach(async ({ playwright }) => {
  await clearAllPresence()
  await setRouting(playwright, false)
})

test.afterEach(async ({ playwright }) => {
  await setRouting(playwright, false)
})

async function settle(ms = 1_500): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** A team with an assignment method and members, made through the app. */
async function makeTeam(
  admin: APIRequestContext,
  marker: string,
  method: Method,
  members: TestTeammate[]
): Promise<{ id: string; name: string }> {
  const name = `Team ${marker.slice(-14)} ${Math.random().toString(36).slice(2, 6)}`
  const created = await callServerFn<{ id: string }>(admin, 'createTeamFn', {
    name,
    assignmentMethod: method,
  })
  expect(created.ok, created.error.slice(0, 200)).toBe(true)
  const set = await callServerFn(admin, 'setTeamMembersFn', {
    teamId: created.data.id,
    principalIds: members.map((m) => m.principalId),
  })
  expect(set.ok, set.error.slice(0, 200)).toBe(true)
  return { id: created.data.id, name }
}

async function newConversation(
  playwright: Parameters<Parameters<typeof test>[2]>[0]['playwright'],
  marker: string,
  text: string
): Promise<string> {
  const customer = await createCustomer(marker)
  return (await customerSays(await customer.api(playwright), `${text} ${marker}`)).conversationId
}

test.describe('assigning to a team', () => {
  test(
    'RTE-23 a manual team: team set, assignee kept, team notice, members belled except the actor',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const actor = await newTeammate({ roleKey: 'support_lead' })
      const member = await newTeammate({ roleKey: 'support_lead' })
      const holder = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'manual', [actor, member])
      const conversationId = await newConversation(playwright, marker, 'team')
      await callServerFn(admin, 'assignConversationFn', {
        conversationId,
        assignTo: holder.principalId,
      })

      const res = await callServerFn<{ id: string; assignedTeamId: string }>(
        await actor.api(playwright),
        'assignConversationTeamFn',
        { conversationId, teamId: team.id }
      )
      expect(res.ok, res.error.slice(0, 200)).toBe(true)
      expect(res.data).toEqual({ id: conversationId, assignedTeamId: team.id })
      expect(await conversationState(conversationId)).toMatchObject({
        assignedTeam: team.id,
        assignedAgent: holder.principalId,
      })
      expect(
        (await assignmentNotices(conversationId)).map((n) => [n.kind, n.content, n.isInternal])
      ).toEqual([
        ['assigned', `Conversation assigned to ${holder.name}`, true],
        ['team_assigned', `Conversation assigned to the ${team.name} team`, true],
      ])
      const bell = await waitForBell(member.principalId, conversationId, 'conversation_assigned')
      expect(bell.title).toBe('A conversation was assigned to your team')
      await settle()
      expect(
        (await bellsFor(actor.principalId, conversationId)).filter(
          (b) => b.type === 'conversation_assigned'
        )
      ).toEqual([])
    }
  )

  test(
    'RTE-24 a round-robin team rotates over online members from the cursor',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const members = [
        await newTeammate({ roleKey: 'support_lead' }),
        await newTeammate({ roleKey: 'support_lead' }),
        await newTeammate({ roleKey: 'support_lead' }),
      ]
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'round_robin', members)
      const streams = await Promise.all(members.map((m) => goOnline(m)))
      const sorted = [...members].sort((a, b) => (a.principalId < b.principalId ? -1 : 1))

      const picks: string[] = []
      for (let i = 0; i < 4; i++) {
        const conversationId = await newConversation(playwright, marker, `rr ${i}`)
        await callServerFn(admin, 'assignConversationTeamFn', { conversationId, teamId: team.id })
        const state = await conversationState(conversationId)
        picks.push(state.assignedAgent ?? 'none')
        const picked = sorted.find((m) => m.principalId === state.assignedAgent)
        expect((await assignmentNotices(conversationId)).map((n) => n.content)).toEqual([
          `Conversation assigned to the ${team.name} team`,
          `Conversation assigned to ${picked?.name}`,
        ])
      }
      expect(picks).toEqual([...sorted, sorted[0]].map((m) => m.principalId))
      const [row] = await supportDb()`SELECT rr_cursor_principal_id FROM teams
                                     WHERE id = ${toUuid(team.id as `team_${string}`)}`
      expect(fromUuid('principal', row.rr_cursor_principal_id as string)).toBe(
        sorted[0].principalId
      )
      for (const s of streams) s.close()
    }
  )

  test(
    'RTE-25 a balanced team picks the online member with the fewest open conversations',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const busy = await newTeammate({ roleKey: 'support_lead' })
      const free = await newTeammate({ roleKey: 'support_lead' })
      const offline = await newTeammate({ roleKey: 'support_lead' })
      await seedLoad(busy.principalId, 2, marker)
      await seedLoad(free.principalId, 1, marker)
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'balanced', [busy, free, offline])
      const streams = [await goOnline(busy), await goOnline(free)]
      const conversationId = await newConversation(playwright, marker, 'balanced')
      await callServerFn(admin, 'assignConversationTeamFn', { conversationId, teamId: team.id })
      expect((await conversationState(conversationId)).assignedAgent).toBe(free.principalId)
      for (const s of streams) s.close()
    }
  )

  test(
    'RTE-26 with no member online the team is set, the assignee kept, and only the team notice posts',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const member = await newTeammate({ roleKey: 'support_lead' })
      const holder = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'round_robin', [member])
      const conversationId = await newConversation(playwright, marker, 'nobody')
      await callServerFn(admin, 'assignConversationFn', {
        conversationId,
        assignTo: holder.principalId,
      })
      await callServerFn(admin, 'assignConversationTeamFn', { conversationId, teamId: team.id })
      expect(await conversationState(conversationId)).toMatchObject({
        assignedTeam: team.id,
        assignedAgent: holder.principalId,
      })
      expect((await assignmentNotices(conversationId)).map((n) => n.kind)).toEqual([
        'assigned',
        'team_assigned',
      ])
    }
  )

  test(
    'RTE-27 when distribution picks the current assignee only the team notice posts',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const member = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'balanced', [member])
      const online = await goOnline(member)
      const conversationId = await newConversation(playwright, marker, 'same')
      await callServerFn(admin, 'assignConversationFn', {
        conversationId,
        assignTo: member.principalId,
      })
      await callServerFn(admin, 'assignConversationTeamFn', { conversationId, teamId: team.id })
      expect((await conversationState(conversationId)).assignedAgent).toBe(member.principalId)
      expect((await assignmentNotices(conversationId)).map((n) => n.kind)).toEqual([
        'assigned',
        'team_assigned',
      ])
      online.close()
    }
  )

  test(
    'RTE-28 re-selecting the team is a no-op; clearing it keeps the assignee with no notice',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const member = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'round_robin', [member])
      const conversationId = await newConversation(playwright, marker, 'again')
      await callServerFn(admin, 'assignConversationFn', {
        conversationId,
        assignTo: member.principalId,
      })
      await callServerFn(admin, 'assignConversationTeamFn', { conversationId, teamId: team.id })
      const notices = await systemNotices(conversationId)

      // A member is online now: a real re-selection would distribute.
      const online = await goOnline(member)
      const again = await callServerFn(admin, 'assignConversationTeamFn', {
        conversationId,
        teamId: team.id,
      })
      expect(again.ok).toBe(true)
      expect(await systemNotices(conversationId)).toEqual(notices)

      const cleared = await callServerFn(admin, 'assignConversationTeamFn', {
        conversationId,
        teamId: null,
      })
      expect(cleared.data).toEqual({ id: conversationId, assignedTeamId: null })
      expect(await conversationState(conversationId)).toMatchObject({
        assignedTeam: null,
        assignedAgent: member.principalId,
      })
      expect(await systemNotices(conversationId)).toEqual(notices)
      online.close()
    }
  )

  test(
    'RTE-29 RTE-31 a deleted or missing team is not found; only teammates can be members',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const member = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'manual', [member])
      const customer = await createCustomer(marker)
      const conversationId = (await customerSays(await customer.api(playwright), `gone ${marker}`))
        .conversationId

      const notMember = await callServerFn(admin, 'setTeamMembersFn', {
        teamId: team.id,
        principalIds: [member.principalId, customer.principalId],
      })
      expect(notMember.code).toBe('INVALID_TEAM_MEMBER')
      expect(notMember.error).toContain('Only teammates can be team members')

      expect((await callServerFn(admin, 'deleteTeamFn', { id: team.id })).ok).toBe(true)
      const deletedMembers = await callServerFn(admin, 'setTeamMembersFn', {
        teamId: team.id,
        principalIds: [member.principalId],
      })
      expect(deletedMembers.code).toBe('TEAM_NOT_FOUND')

      for (const teamId of [team.id, fromUuid('team', crypto.randomUUID())]) {
        const res = await callServerFn(admin, 'assignConversationTeamFn', {
          conversationId,
          teamId,
        })
        expect(res.code, teamId).toBe('TEAM_NOT_FOUND')
      }
      expect((await conversationState(conversationId)).assignedTeam).toBeNull()
      expect(await systemNotices(conversationId)).toEqual([])
    }
  )

  test(
    'RTE-30 the team dialog offers three methods, defaults to Manual and saves the choice; the default team cannot be deleted',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      test.setTimeout(60_000)
      const admin = await asPerson('admin')
      await admin.goto('/admin/settings/teams')
      await expect(async () => {
        await admin.getByRole('button', { name: 'New team' }).click()
        await expect(admin.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 20_000 })
      const dialog = admin.getByRole('dialog')
      const method = dialog.locator('#team-method')
      await expect(method).toContainText('Manual (assign the team only)')
      await method.click()
      for (const label of [
        'Manual (assign the team only)',
        'Round robin (rotate over online members)',
        'Balanced (least busy online member)',
      ]) {
        await expect(admin.getByRole('option', { name: label })).toBeVisible()
      }
      await admin.getByRole('option', { name: 'Round robin (rotate over online members)' }).click()
      const name = `Dialog ${marker.slice(-12)}`
      await dialog.locator('#team-name').fill(name)
      await dialog.getByRole('button', { name: /^(Create|Create team|Save)$/ }).click()
      await expect(dialog).toBeHidden()
      await expect(admin.getByText(name)).toBeVisible()
      await expect(admin.getByText(/Round robin/).first()).toBeVisible()
      const [row] =
        await supportDb()`SELECT assignment_method FROM teams WHERE name = ${name} AND deleted_at IS NULL`
      expect(row.assignment_method).toBe('round_robin')

      const api = await adminApi(playwright)
      const [defaultTeam] =
        await supportDb()`SELECT id FROM teams WHERE is_default AND deleted_at IS NULL LIMIT 1`
      const res = await callServerFn(api, 'deleteTeamFn', {
        id: fromUuid('team', defaultTeam.id as string),
      })
      expect(res.code).toBe('TEAM_IS_DEFAULT')
      expect(res.error).toContain('The default team cannot be deleted')
    }
  )

  test(
    'RTE-32 bulk assign and bulk team assign apply to each conversation and report failures per item',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const target = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'manual', [target])
      const ids = [
        await newConversation(playwright, marker, 'bulk 1'),
        await newConversation(playwright, marker, 'bulk 2'),
      ]
      const missing = fromUuid('conversation', crypto.randomUUID())

      const assign = await callServerFn<{ succeeded: string[]; failed: Array<{ id: string }> }>(
        admin,
        'bulkUpdateConversationsFn',
        {
          conversationIds: [ids[0], missing, ids[1]],
          action: { type: 'assign', assignTo: target.principalId },
        }
      )
      expect(assign.data.succeeded).toEqual(ids)
      expect(assign.data.failed.map((f) => f.id)).toEqual([missing])

      const toTeam = await callServerFn<{ succeeded: string[]; failed: Array<{ id: string }> }>(
        admin,
        'bulkUpdateConversationsFn',
        { conversationIds: [missing, ...ids], action: { type: 'assign_team', teamId: team.id } }
      )
      expect(toTeam.data.succeeded).toEqual(ids)
      expect(toTeam.data.failed.map((f) => f.id)).toEqual([missing])
      for (const id of ids) {
        expect(await conversationState(id)).toMatchObject({
          assignedAgent: target.principalId,
          assignedTeam: team.id,
        })
        expect((await assignmentNotices(id)).map((n) => n.kind)).toEqual([
          'assigned',
          'team_assigned',
        ])
      }
    }
  )
})

test.describe('workflows and the AI agent', () => {
  /** Create a live workflow; returns its id. Paused again by the caller. */
  async function liveWorkflow(
    admin: APIRequestContext,
    name: string,
    triggerType: string,
    actions: Array<Record<string, unknown>>
  ): Promise<string> {
    const nodes = [
      { id: 't', type: 'trigger' },
      ...actions.map((action, i) => ({ id: `a${i}`, type: 'action', action })),
    ]
    const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }))
    const created = await callServerFn<{ id: string }>(admin, 'createWorkflowFn', {
      name,
      class: 'background',
      triggerType,
      graph: { nodes, edges },
    })
    expect(created.ok, created.error.slice(0, 300)).toBe(true)
    const live = await callServerFn(admin, 'setWorkflowStatusFn', {
      id: created.data.id,
      status: 'live',
    })
    expect(live.ok, live.error.slice(0, 300)).toBe(true)
    return created.data.id
  }

  async function setAssistantRespond(admin: APIRequestContext, on: boolean): Promise<void> {
    const res = await callServerFn(admin, 'updateWidgetAssistantDeploymentFn', {
      enabled: on,
      respond: on,
    })
    expect(res.ok, res.error.slice(0, 300)).toBe(true)
  }

  test(
    'RTE-37 workflow assign actions assign the agent and the team, naming the workflow',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const agent = await newTeammate({ roleKey: 'support_lead' })
      const admin = await adminApi(playwright)
      const team = await makeTeam(admin, marker, 'manual', [agent])
      const name = `Assign ${marker}`.slice(0, 100)
      // A trigger nothing in this spec fires; the run is started by hand.
      const workflowId = await liveWorkflow(admin, name, 'page.visited', [
        { type: 'assign_agent', principalId: agent.principalId },
        { type: 'assign_team', teamId: team.id },
      ])
      try {
        const conversationId = await newConversation(playwright, marker, 'workflow')
        const run = await callServerFn<{ ok: boolean }>(admin, 'runWorkflowManuallyFn', {
          workflowId,
          conversationId,
        })
        expect(run.ok, run.error.slice(0, 300)).toBe(true)
        await waitForAssignee(conversationId, agent.principalId)
        await expect
          .poll(async () => (await conversationState(conversationId)).assignedTeam)
          .toBe(team.id)
        await waitForAssignmentNotices(conversationId, 2)
        expect(await assignmentNotices(conversationId)).toEqual([
          {
            content: `Conversation assigned to ${agent.name}`,
            isInternal: true,
            kind: 'assigned',
            workflowName: name,
          },
          {
            content: `Conversation assigned to the ${team.name} team`,
            isInternal: true,
            kind: 'team_assigned',
            workflowName: null,
          },
        ])
      } finally {
        await callServerFn(admin, 'setWorkflowStatusFn', { id: workflowId, status: 'paused' })
      }
    }
  )

  test(
    'RTE-38 the AI agent hands off: the customer sees "Connecting you to the team" and an online teammate gets it',
    { tag: '@core' },
    async ({ page, playwright, marker, newTeammate }) => {
      test.setTimeout(90_000)
      const admin = await adminApi(playwright)
      await setAssistantRespond(admin, true)
      const agent = await newTeammate({ roleKey: 'support_lead' })
      // Routing is on but nobody is online when the conversation starts. The
      // model answers the turn late and with an error, so the AI agent hands
      // off; the teammate comes online meanwhile, so only the hand-off can
      // have routed it. (The turn reads settings memoised at the send, so the
      // switch must already be on then.)
      await setRouting(playwright, true)
      const handoff = `${marker}-handoff`
      await fakeAi.script({ marker: handoff, status: 400, delayMs: 5_000 })
      let online: Awaited<ReturnType<typeof goOnline>> | null = null
      try {
        await page.goto('/widget')
        await page.getByRole('button', { name: 'Messages', exact: true }).click()
        await page.getByRole('button', { name: /Ask a question/ }).click()
        const composer = page.locator('.ProseMirror[contenteditable="true"]')
        await composer.click()
        await composer.fill(`Need a person ${handoff}`)
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        const conversationId = await conversationWithMessage(`Need a person ${handoff}`)
        await settle(500)
        expect((await conversationState(conversationId)).assignedAgent).toBeNull()
        online = await goOnline(agent)

        await expect(page.getByText('Connecting you to the team')).toBeVisible({ timeout: 45_000 })
        await waitForAssignee(conversationId, agent.principalId)
        // The notice is written just after the claim.
        await expect.poll(async () => (await assignmentNotices(conversationId)).length).toBe(1)
        const notices = await systemNotices(conversationId)
        const handoffAt = notices.findIndex((n) => n.kind === 'assistant_handoff')
        expect(notices[handoffAt]).toMatchObject({
          content: 'Connecting you to the team',
          isInternal: false,
        })
        // The assignment came after the hand-off.
        expect(notices.slice(handoffAt + 1).map((n) => n.content)).toContain(
          `Conversation assigned to ${agent.name}`
        )
        expect((await assignmentNotices(conversationId)).map((n) => n.content)).toEqual([
          `Conversation assigned to ${agent.name}`,
        ])
        await expect(page.getByText(/Conversation assigned to/)).toHaveCount(0)
      } finally {
        online?.close()
        await fakeAi.clear(handoff)
        await setAssistantRespond(admin, false)
      }
    }
  )

  test(
    'RTE-39 with a live workflow on the hand-off the router stands down and the workflow assigns',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      test.setTimeout(90_000)
      const admin = await adminApi(playwright)
      const online = await newTeammate({ roleKey: 'support_lead' })
      const chosen = await newTeammate({ roleKey: 'support_lead' })
      await setAssistantRespond(admin, true)
      await setRouting(playwright, true)
      const name = `Handoff ${marker}`.slice(0, 100)
      const workflowId = await liveWorkflow(admin, name, 'assistant.handed_off', [
        { type: 'assign_agent', principalId: chosen.principalId },
      ])
      const handoff = `${marker}-handoff`
      await fakeAi.script({ marker: handoff, status: 400, delayMs: 5_000 })
      let stream: Awaited<ReturnType<typeof goOnline>> | null = null
      try {
        // Nobody is online at the start; someone is by the hand-off.
        const customer = await createCustomer(marker)
        const { conversationId } = await customerSays(
          await customer.api(playwright),
          `Hand me over ${handoff}`
        )
        expect((await conversationState(conversationId)).assignedAgent).toBeNull()
        stream = await goOnline(online)
        await waitForAssignee(conversationId, chosen.principalId, 45_000)
        await expect
          .poll(async () => (await assignmentNotices(conversationId)).length)
          .toBeGreaterThan(0)
        await settle()
        const assigned = await assignmentNotices(conversationId)
        expect(assigned).toEqual([
          {
            content: `Conversation assigned to ${chosen.name}`,
            isInternal: true,
            kind: 'assigned',
            workflowName: name,
          },
        ])
        await expect
          .poll(async () =>
            (await systemNotices(conversationId)).some((n) => n.kind === 'assistant_handoff')
          )
          .toBe(true)
      } finally {
        stream?.close()
        await fakeAi.clear(handoff)
        await callServerFn(admin, 'setWorkflowStatusFn', { id: workflowId, status: 'paused' })
        await setAssistantRespond(admin, false)
      }
    }
  )

  test(
    'RTE-40 a hand-off with nobody online stays unassigned and still tells the customer',
    { tag: '@core' },
    async ({ page, playwright, marker }) => {
      test.setTimeout(90_000)
      const admin = await adminApi(playwright)
      await setRouting(playwright, true)
      await setAssistantRespond(admin, true)
      try {
        await page.goto('/widget')
        await page.getByRole('button', { name: 'Messages', exact: true }).click()
        await page.getByRole('button', { name: /Ask a question/ }).click()
        const composer = page.locator('.ProseMirror[contenteditable="true"]')
        await composer.click()
        await composer.fill(`Anyone there ${marker} ${FAKE_AI_FAIL}`)
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await expect(page.getByText('Connecting you to the team')).toBeVisible({ timeout: 45_000 })
        const conversationId = await conversationWithMessage(`Anyone there ${marker}`)
        await settle()
        expect(await conversationState(conversationId)).toMatchObject({
          status: 'open',
          assignedAgent: null,
        })
        expect(await assignmentNotices(conversationId)).toEqual([])
      } finally {
        await setAssistantRespond(admin, false)
      }
    }
  )
})
