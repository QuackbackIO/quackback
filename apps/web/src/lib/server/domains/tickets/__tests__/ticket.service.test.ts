/**
 * Real-DB coverage for the ticket service (support platform §4.2): create
 * resolves the default status and assigns a number; the close/reopen lifecycle
 * stamps and clears resolvedAt and counts reopens; the first-response stamp is
 * once-only; and assignment is polymorphic with no clearing rule. Runs inside
 * the db-test-fixture rollback transaction (see server/__tests__/README.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type PrincipalId,
  type TeamId,
  type UserId,
  type TicketId,
  type ConversationId,
} from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  tickets,
  ticketStatuses,
  teams,
  teamMembers,
  principal,
  user,
  settings,
  companies,
  conversationMessages,
  conversations,
  ticketConversations,
  ticketSubscriptions,
  eq,
  and,
  isNull,
  desc,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// Neutralize the fire-and-forget webhook bridge (it would otherwise resolve
// hook targets against Redis/db mid-rollback) and assert the service wires it.
const webhooks = vi.hoisted(() => ({
  emitTicketCreated: vi.fn().mockResolvedValue(undefined),
  emitTicketStatusChanged: vi.fn().mockResolvedValue(undefined),
  emitTicketAssigned: vi.fn().mockResolvedValue(undefined),
  // Posting a message (activity-enrichment tests) also fires these two.
  emitTicketReplied: vi.fn().mockResolvedValue(undefined),
  emitTicketNoteAdded: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../ticket.webhooks', () => webhooks)

// Realtime publish (unified inbox §3.2, M3): neutralize the real Redis-backed
// publish so these DB-fixture tests stay deterministic, and assert the
// service wires it — mirrors the webhooks mock above and conversation.service's
// own test convention.
const realtime = vi.hoisted(() => ({ publishTicketEvent: vi.fn() }))
vi.mock('@/lib/server/realtime/conversation-channels', () => realtime)

// Neutralize the fire-and-forget activity log: this suite's actors are mostly
// unbacked principal ids, and a real insert's FK failure would abort the
// fixture's shared transaction. Writer coverage (types + metadata) lives in
// ticket-activity.service.test.ts with backed principals.
vi.mock('../ticket-activity.service', () => ({
  recordTicketActivity: vi.fn(),
  listTicketActivity: vi.fn().mockResolvedValue([]),
}))

// config getters validate the full env (absent in tests); provide just what the
// attachment URL check (validateAttachments -> isTrustedAttachmentUrl) reads.
vi.mock('@/lib/server/config', () => ({
  config: { s3PublicUrl: undefined, baseUrl: 'http://localhost:3000' },
  getBaseUrl: () => 'http://localhost:3000',
}))

import {
  createTicket,
  setTicketStatus,
  assignTicket,
  setTicketPriority,
  softDeleteTicket,
  autoReopenOnRequesterReply,
  listTickets,
  getTicket,
  assertTicketVisible,
  bulkUpdateTickets,
} from '../ticket.service'
import { NotFoundError } from '@/lib/shared/errors'
import { listTicketMessages, sendTicketMessage, addTicketNote } from '../ticket-message.service'
import { unsubscribeFromTicket } from '../ticket-subscription.service'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: ticketStatuses.id }).from(ticketStatuses).limit(0)
    await db.select({ id: settings.id }).from(settings).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

function adminActor(): Actor {
  return {
    principalId: createId('principal') as PrincipalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

/** An admin actor backed by a real principal row — required for any write that
 *  posts a ticket-thread message (its FK on `principal_id` won't accept the
 *  bare, unbacked id `adminActor()` returns). */
async function messageAuthorActor(): Promise<Actor> {
  const principalId = await seedTeammate()
  return {
    principalId,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: resolveActorPermissions('admin'),
  }
}

/** getStageLabels (invoked by the DTO builder) needs a workspace settings row. */
async function seedSettings(): Promise<void> {
  await testDb
    .insert(settings)
    .values({ name: 'Test WS', slug: `test_${suffix()}`, createdAt: new Date() })
}

/** A deterministic default (open) status + a closed status, all rolled back. */
async function seedStatuses() {
  // Neutralize any committed default so our seeded default is the only one.
  await testDb
    .update(ticketStatuses)
    .set({ isDefault: false })
    .where(eq(ticketStatuses.isDefault, true))
  const [open] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Open',
      slug: `t_open_${suffix()}`,
      category: 'open',
      position: 100,
      isDefault: true,
      publicStage: 'received',
    })
    .returning()
  const [closed] = await testDb
    .insert(ticketStatuses)
    .values({
      name: 'T-Closed',
      slug: `t_closed_${suffix()}`,
      category: 'closed',
      position: 101,
      isDefault: false,
      publicStage: 'resolved',
    })
    .returning()
  return { open, closed }
}

async function seedTeammate(): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: `Agent-${suffix()}` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'member', type: 'user', createdAt: new Date() })
  return principalId
}

async function seedTeam(): Promise<TeamId> {
  const [team] = await testDb
    .insert(teams)
    .values({ name: `Team-${suffix()}` })
    .returning()
  return team.id
}

async function readTicket(id: TicketId) {
  const [row] = await testDb.select().from(tickets).where(eq(tickets.id, id)).limit(1)
  return row
}

describe.skipIf(!fixture.available)('ticket.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  beforeEach(() => Object.values(webhooks).forEach((m) => m.mockClear()))
  beforeEach(() => realtime.publishTicketEvent.mockClear())
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('createTicket resolves the default status and assigns a number', async () => {
    await seedSettings()
    await seedStatuses()
    const dto = await createTicket({ type: 'customer', title: 'Cannot log in' }, adminActor())

    expect(dto.status.category).toBe('open')
    expect(typeof dto.number).toBe('number')
    expect(dto.number).toBeGreaterThan(0)
    expect(dto.reference).toBe(`#${dto.number}`)
    expect(dto.stage.slot).toBe('received')
    expect(dto.stage.label).toBe('Received')
    expect(dto.resolvedAt).toBeNull()
    expect(dto.reopenedCount).toBe(0)
  })

  it('seeds the description as the opening thread message (agent, filed on behalf)', async () => {
    await seedSettings()
    await seedStatuses()
    const principalId = await seedTeammate()
    const actor: Actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const dto = await createTicket(
      { type: 'customer', title: 'Cannot log in', description: 'The login button does nothing' },
      actor
    )
    const page = await listTicketMessages(dto.id, { includeInternal: true })
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].content).toBe('The login button does nothing')
    // Filed by a teammate on someone's behalf -> opens as an agent message.
    expect(page.messages[0].senderType).toBe('agent')
  })

  it('attributes the opening message to the requester when they file it themselves', async () => {
    await seedSettings()
    await seedStatuses()
    const principalId = await seedTeammate()
    const actor: Actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const dto = await createTicket(
      {
        type: 'customer',
        title: 'Help',
        description: 'It broke',
        requesterPrincipalId: principalId,
      },
      actor
    )
    const page = await listTicketMessages(dto.id, { includeInternal: true })
    expect(page.messages[0].senderType).toBe('visitor')
  })

  it('seeds no opening message when the description is omitted', async () => {
    await seedSettings()
    await seedStatuses()
    const dto = await createTicket({ type: 'customer', title: 'Quiet ticket' }, adminActor())
    const page = await listTicketMessages(dto.id, {})
    expect(page.messages).toHaveLength(0)
  })

  it('seeds the opening message from descriptionJson: sanitized contentJson + derived content', async () => {
    await seedSettings()
    await seedStatuses()
    const principalId = await seedTeammate()
    const actor: Actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const descriptionJson = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First line.', marks: [{ type: 'bold' }] }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line.' }] },
      ],
    }
    const dto = await createTicket({ type: 'customer', title: 'Rich open', descriptionJson }, actor)
    const page = await listTicketMessages(dto.id, { includeInternal: true })
    expect(page.messages).toHaveLength(1)
    // No plain `description` was given: content is derived server-side from
    // the doc's text leaves (mirrors resolveMessageContent).
    expect(page.messages[0].content).toBe('First line.\nSecond line.')
    expect(page.messages[0].contentJson?.content?.[0]?.type).toBe('paragraph')
    expect(page.messages[0].contentJson?.content?.[0]?.content?.[0]?.marks?.[0]?.type).toBe('bold')
  })

  it('sanitizes a hostile descriptionJson before it is stored', async () => {
    await seedSettings()
    await seedStatuses()
    const principalId = await seedTeammate()
    const actor: Actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const descriptionJson = {
      type: 'doc' as const,
      content: [
        // Unknown node type: stripped entirely.
        { type: 'script', content: [{ type: 'text', text: 'evil' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Safe text.' }],
        },
        // javascript: src is neutralized to an empty (non-rendering) image.
        { type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'x' } },
      ],
    }
    const dto = await createTicket(
      { type: 'customer', title: 'Hostile open', descriptionJson },
      actor
    )
    const page = await listTicketMessages(dto.id, { includeInternal: true })
    const stored = page.messages[0]
    const types = stored.contentJson?.content?.map((n) => n.type)
    expect(types).not.toContain('script')
    expect(types).toEqual(['paragraph', 'image'])
    const imageNode = stored.contentJson?.content?.find((n) => n.type === 'image')
    expect(imageNode?.attrs?.src).toBe('')
    // Derived from the sanitized doc: the surviving paragraph's text, plus the
    // `[image]` placeholder for the (now-neutralized) image node.
    expect(stored.content).toBe('Safe text.\n[image]')
  })

  it('persists attachments on the opening message', async () => {
    await seedSettings()
    await seedStatuses()
    const principalId = await seedTeammate()
    const actor: Actor = {
      principalId,
      role: 'admin',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: resolveActorPermissions('admin'),
    }
    const attachments = [
      {
        url: '/api/storage/chat-images/photo.png',
        name: 'photo.png',
        contentType: 'image/png',
        size: 1024,
      },
    ]
    const dto = await createTicket(
      { type: 'customer', title: 'With attachment', attachments },
      actor
    )
    const page = await listTicketMessages(dto.id, { includeInternal: true })
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0].attachments).toHaveLength(1)
    expect(page.messages[0].attachments[0].name).toBe('photo.png')
    // No text and no descriptionJson: the derived content mirror stays blank.
    expect(page.messages[0].content).toBe('')
  })

  it('a public_stage crossing posts a status event into the ticket thread', async () => {
    await seedSettings()
    const { closed } = await seedStatuses() // default open projects 'received'; closed projects 'resolved'
    const actor = adminActor()
    const created = await createTicket({ type: 'customer', title: 'Crossing' }, actor)
    await setTicketStatus(created.id, closed.id, actor) // received -> resolved
    const page = await listTicketMessages(created.id, { includeInternal: true })
    const event = page.messages.find((m) => m.systemEvent?.kind === 'ticket_status_changed')
    expect(event).toBeDefined()
    expect(event?.systemEvent?.stageLabel).toBeTruthy()
    expect(event?.senderType).toBe('system')
  })

  it('a same-stage status change stays silent', async () => {
    await seedSettings()
    await seedStatuses() // default open projects 'received'
    const actor = adminActor()
    // Another open status projecting the SAME public stage.
    const [sameStage] = await testDb
      .insert(ticketStatuses)
      .values({
        name: 'Triaging',
        slug: `tri_${suffix()}`,
        category: 'open',
        position: 3,
        publicStage: 'received',
      })
      .returning()
    const created = await createTicket({ type: 'customer', title: 'Quiet' }, actor)
    await setTicketStatus(created.id, sameStage.id, actor) // received -> received
    const page = await listTicketMessages(created.id, { includeInternal: true })
    expect(
      page.messages.find((m) => m.systemEvent?.kind === 'ticket_status_changed')
    ).toBeUndefined()
  })

  // WO-3 slice 4: the requester bell itself (previously a direct
  // createNotification call here, asserted against inAppNotifications) now
  // rides the ticket.status_changed event/hook pipeline — see
  // events/__tests__/targets-ticket-status.test.ts (gating: null-stage
  // silent, same-stage silent, no-requester silent, tracker has no requester)
  // and events/__tests__/notification-handler.test.ts (title/body copy,
  // ported byte-for-byte from this file's old assertions: 'Moved from
  // Received to Resolved' / 'Open the ticket to see the latest update.').
  // What's left to characterize HERE is the service's own job: correctly
  // enrich the hook call with previousStage (unrecoverable after the UPDATE
  // commits) and the requester, on a real public_stage crossing.
  it('a public_stage crossing enriches the hook with previousStage + requester', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    const actor = adminActor()
    const requester = await seedTeammate()
    const created = await createTicket(
      { type: 'customer', title: 'Notify me', requesterPrincipalId: requester },
      actor
    )
    webhooks.emitTicketStatusChanged.mockClear() // ignore create-time noise
    await setTicketStatus(created.id, closed.id, actor) // received -> resolved
    expect(webhooks.emitTicketStatusChanged).toHaveBeenCalledTimes(1)
    const [, , , , stage, previousStage, requesterPrincipalId] =
      webhooks.emitTicketStatusChanged.mock.calls[0]
    expect(stage).toBe('resolved')
    expect(previousStage).toBe('received')
    expect(requesterPrincipalId).toBe(requester)
  })

  it('a status change with no prior stage enriches the hook with a null previousStage', async () => {
    await seedSettings()
    // Neutralize any committed default so our seeded default is the only one.
    await testDb
      .update(ticketStatuses)
      .set({ isDefault: false })
      .where(eq(ticketStatuses.isDefault, true))
    const [internal] = await testDb
      .insert(ticketStatuses)
      .values({
        name: 'T-Internal',
        slug: `t_internal_${suffix()}`,
        category: 'open',
        position: 102,
        isDefault: true,
        publicStage: null,
      })
      .returning()
    const [resolved] = await testDb
      .insert(ticketStatuses)
      .values({
        name: 'T-Resolved',
        slug: `t_resolved_${suffix()}`,
        category: 'closed',
        position: 103,
        isDefault: false,
        publicStage: 'resolved',
      })
      .returning()
    const actor = adminActor()
    const requester = await seedTeammate()
    const created = await createTicket(
      { type: 'customer', title: 'No prior stage', requesterPrincipalId: requester },
      actor
    )
    expect(created.status.id).toBe(internal.id) // starts on the publicStage-less default
    webhooks.emitTicketStatusChanged.mockClear()
    await setTicketStatus(created.id, resolved.id, actor) // null -> resolved
    const [, , , , stage, previousStage, requesterPrincipalId] =
      webhooks.emitTicketStatusChanged.mock.calls[0]
    expect(stage).toBe('resolved')
    expect(previousStage).toBeNull()
    expect(requesterPrincipalId).toBe(requester)
  })

  it('a status change with no requester enriches the hook with a null requesterPrincipalId', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    const actor = adminActor()
    const created = await createTicket({ type: 'back_office', title: 'No requester' }, actor)
    webhooks.emitTicketStatusChanged.mockClear()
    await setTicketStatus(created.id, closed.id, actor)
    const [, , , , , , requesterPrincipalId] = webhooks.emitTicketStatusChanged.mock.calls[0]
    expect(requesterPrincipalId).toBeNull()
  })

  it('closing stamps resolvedAt + firstResponseAt; reopening clears resolvedAt and counts the reopen', async () => {
    await seedSettings()
    const { open, closed } = await seedStatuses()
    const actor = adminActor()
    const created = await createTicket({ type: 'customer', title: 'Billing issue' }, actor)
    const id = created.id

    // Close: enter a closed-category status.
    await setTicketStatus(id, closed.id, actor)
    const afterClose = await readTicket(id)
    expect(afterClose.resolvedAt).not.toBeNull()
    expect(afterClose.reopenedCount).toBe(0)
    // First agent action stamped the first response.
    expect(afterClose.firstResponseAt).not.toBeNull()
    const stampedAt = afterClose.firstResponseAt

    // Reopen: move back out to an open status.
    await setTicketStatus(id, open.id, actor)
    const afterReopen = await readTicket(id)
    expect(afterReopen.resolvedAt).toBeNull()
    expect(afterReopen.reopenedCount).toBe(1)
    // The first-response stamp is once-only, never overwritten on later actions.
    expect(afterReopen.firstResponseAt?.getTime()).toBe(stampedAt?.getTime())
  })

  it('assignment is independent: assigning a team never clears the teammate (no-clear)', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = adminActor()
    const teammate = await seedTeammate()
    const teamId = await seedTeam()
    const created = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
    const id = created.id

    await assignTicket(id, { assigneePrincipalId: teammate }, actor)
    await assignTicket(id, { assigneeTeamId: teamId }, actor)
    const both = await readTicket(id)
    expect(both.assigneePrincipalId).toBe(teammate)
    expect(both.assigneeTeamId).toBe(teamId)

    // An explicit null clears only that side.
    await assignTicket(id, { assigneePrincipalId: null }, actor)
    const cleared = await readTicket(id)
    expect(cleared.assigneePrincipalId).toBeNull()
    expect(cleared.assigneeTeamId).toBe(teamId)
  })

  it('rejects a non-team-member assignee', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = adminActor()
    const created = await createTicket({ type: 'customer', title: 'Nope' }, actor)
    // An end-user principal (role 'user') is not assignable.
    const userId = createId('user') as UserId
    const endUser = createId('principal') as PrincipalId
    await testDb.insert(user).values({ id: userId, name: 'End User' })
    await testDb
      .insert(principal)
      .values({ id: endUser, userId, role: 'user', type: 'user', createdAt: new Date() })

    await expect(assignTicket(created.id, { assigneePrincipalId: endUser }, actor)).rejects.toThrow(
      /team member/i
    )
  })

  it('createTicket fires the ticket.created hook with the resolved status category + stage', async () => {
    await seedSettings()
    await seedStatuses() // default open projects 'received'
    const created = await createTicket({ type: 'customer', title: 'Hook me' }, adminActor())
    expect(webhooks.emitTicketCreated).toHaveBeenCalledTimes(1)
    const [, ticketArg, statusArg] = webhooks.emitTicketCreated.mock.calls[0]
    expect(ticketArg.id).toBe(created.id)
    expect(statusArg).toEqual({ category: 'open', stage: 'received' })
  })

  it('setTicketStatus fires the ticket.status_changed hook with the category move', async () => {
    await seedSettings()
    const { closed } = await seedStatuses()
    const actor = adminActor()
    const created = await createTicket({ type: 'customer', title: 'Move me' }, actor)
    webhooks.emitTicketStatusChanged.mockClear() // ignore any create-time noise
    await setTicketStatus(created.id, closed.id, actor)
    expect(webhooks.emitTicketStatusChanged).toHaveBeenCalledTimes(1)
    const [, , previousStatus, newStatus, stage] = webhooks.emitTicketStatusChanged.mock.calls[0]
    expect(previousStatus).toBe('open')
    expect(newStatus).toBe('closed')
    expect(stage).toBe('resolved')
  })

  it('assignTicket fires ticket.assigned on a change but stays silent on a no-op re-assign', async () => {
    await seedSettings()
    await seedStatuses()
    const actor = adminActor()
    const teammate = await seedTeammate()
    const created = await createTicket({ type: 'back_office', title: 'Assign me' }, actor)

    await assignTicket(created.id, { assigneePrincipalId: teammate }, actor)
    expect(webhooks.emitTicketAssigned).toHaveBeenCalledTimes(1)

    // Re-assigning the identical teammate changes nothing → no second hook.
    await assignTicket(created.id, { assigneePrincipalId: teammate }, actor)
    expect(webhooks.emitTicketAssigned).toHaveBeenCalledTimes(1)
  })

  describe('watcher auto-subscribe (ticket subscriptions)', () => {
    const subsFor = (ticketId: TicketId) =>
      testDb.select().from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, ticketId))

    it('createTicket subscribes the requester in the same transaction; no requester, no row', async () => {
      await seedSettings()
      await seedStatuses()
      const requester = await seedTeammate()

      const withRequester = await createTicket(
        { type: 'customer', title: 'Watched from birth', requesterPrincipalId: requester },
        adminActor()
      )
      const rows = await subsFor(withRequester.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ principalId: requester, reason: 'requester' })

      const withoutRequester = await createTicket(
        { type: 'back_office', title: 'Nobody asked' },
        adminActor()
      )
      expect(await subsFor(withoutRequester.id)).toHaveLength(0)
    })

    it('assignTicket subscribes the assignee on a real change only; unwatch + new assignment re-subscribes', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const first = await seedTeammate()
      const second = await seedTeammate()
      const created = await createTicket({ type: 'back_office', title: 'Assign me' }, actor)

      await assignTicket(created.id, { assigneePrincipalId: first }, actor)
      let rows = await subsFor(created.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ principalId: first, reason: 'assignee' })

      // Explicit unwatch, then a no-op re-assign: nothing moved, no row returns.
      await unsubscribeFromTicket(first, created.id)
      await assignTicket(created.id, { assigneePrincipalId: first }, actor)
      expect(await subsFor(created.id)).toHaveLength(0)

      // A real assignment change re-opts the new assignee in (D1 consequence,
      // pinned deliberately).
      await assignTicket(created.id, { assigneePrincipalId: second }, actor)
      await unsubscribeFromTicket(second, created.id)
      await assignTicket(created.id, { assigneePrincipalId: first }, actor)
      rows = await subsFor(created.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ principalId: first, reason: 'assignee' })
    })

    it('an agent reply subscribes the author as replier; an internal note subscribes nobody', async () => {
      await seedSettings()
      await seedStatuses()
      const author = await messageAuthorActor()
      const created = await createTicket({ type: 'customer', title: 'Reply watch' }, adminActor())

      await addTicketNote(author, { ticketId: created.id, content: 'internal note first' })
      expect(await subsFor(created.id)).toHaveLength(0)

      await sendTicketMessage(author, { ticketId: created.id, content: 'customer-visible reply' })
      const rows = await subsFor(created.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ principalId: author.principalId, reason: 'replier' })
    })
  })

  describe('realtime publish (unified inbox §3.2, M3)', () => {
    it('createTicket publishes ticket_updated with the created DTO', async () => {
      await seedSettings()
      await seedStatuses()
      const created = await createTicket({ type: 'customer', title: 'Realtime me' }, adminActor())
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(created.id, {
        kind: 'ticket_updated',
        ticket: expect.objectContaining({ id: created.id }),
      })
    })

    it('setTicketStatus publishes ticket_updated with the new status', async () => {
      await seedSettings()
      const { closed } = await seedStatuses()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Move me' }, actor)
      realtime.publishTicketEvent.mockClear()
      await setTicketStatus(created.id, closed.id, actor)
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(created.id, {
        kind: 'ticket_updated',
        ticket: expect.objectContaining({
          id: created.id,
          status: expect.objectContaining({ id: closed.id }),
        }),
      })
    })

    it('assignTicket publishes ticket_updated even on a no-op re-assign', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const teammate = await seedTeammate()
      const created = await createTicket({ type: 'back_office', title: 'Assign me' }, actor)
      await assignTicket(created.id, { assigneePrincipalId: teammate }, actor)
      realtime.publishTicketEvent.mockClear()

      await assignTicket(created.id, { assigneePrincipalId: teammate }, actor)
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(
        created.id,
        expect.objectContaining({ kind: 'ticket_updated' })
      )
    })

    it('setTicketPriority publishes ticket_updated with the new priority', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Prioritize me' }, actor)
      realtime.publishTicketEvent.mockClear()

      await setTicketPriority(created.id, 'urgent', actor)
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(created.id, {
        kind: 'ticket_updated',
        ticket: expect.objectContaining({ id: created.id, priority: 'urgent' }),
      })
    })

    it('softDeleteTicket publishes ticket_updated so other viewers refetch the list', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Delete me' }, actor)
      realtime.publishTicketEvent.mockClear()

      await softDeleteTicket(created.id, actor)
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(created.id, {
        kind: 'ticket_updated',
        ticket: expect.objectContaining({ id: created.id }),
      })
    })
  })

  describe('autoReopenOnRequesterReply (requester-reply reopen)', () => {
    /**
     * A default open + an awaiting-requester pending status (+ a closed one for
     * the closed-reopen case), with every committed OPEN status soft-deleted so
     * the seeded default is the reopen's only possible landing (the reopen
     * query filters deletedAt) — without this a committed status can outrank
     * the seeded one on position and make the landing stage nondeterministic.
     */
    async function seedReopenWorld() {
      await testDb
        .update(ticketStatuses)
        .set({ deletedAt: new Date() })
        .where(and(eq(ticketStatuses.category, 'open'), isNull(ticketStatuses.deletedAt)))
      const { open, closed } = await seedStatuses() // default open projects 'received'
      const [awaiting] = await testDb
        .insert(ticketStatuses)
        .values({
          name: 'Waiting',
          slug: `wait_${suffix()}`,
          category: 'pending',
          position: 150,
          publicStage: 'awaiting_requester',
        })
        .returning()
      return { open, closed, awaiting }
    }

    it('emits ticket.status_changed, publishes ticket_updated, and posts the thread stage event — the same signals as setTicketStatus', async () => {
      await seedSettings()
      const { awaiting } = await seedReopenWorld()
      const actor = adminActor()
      const requester = await seedTeammate()
      const created = await createTicket(
        { type: 'customer', title: 'Reopen me', requesterPrincipalId: requester },
        actor
      )
      await setTicketStatus(created.id, awaiting.id, actor) // received -> awaiting_requester
      webhooks.emitTicketStatusChanged.mockClear()
      realtime.publishTicketEvent.mockClear()

      const moved = await autoReopenOnRequesterReply(created.id, requester)
      expect(moved).toBe(true)
      // The reopen lands back on the seeded default open (stage 'received').
      expect((await readTicket(created.id)).statusId).not.toBe(awaiting.id)

      // ...the agent/integration-facing event, on the category axis like
      // setTicketStatus's, with the pre-write stage captured.
      expect(webhooks.emitTicketStatusChanged).toHaveBeenCalledTimes(1)
      const [eventActor, , previousStatus, newStatus, stage, previousStage, requesterPrincipalId] =
        webhooks.emitTicketStatusChanged.mock.calls[0]
      expect(previousStatus).toBe('pending')
      expect(newStatus).toBe('open')
      expect(previousStage).toBe('awaiting_requester')
      expect(stage).toBe('received')
      expect(requesterPrincipalId).toBe(requester)
      // ...attributed to the requester (a human 'user' actor), never an
      // anonymous system flip.
      expect(eventActor).toMatchObject({ principalId: requester, principalType: 'user' })

      // ...the realtime publish mirrors setTicketStatus...
      expect(realtime.publishTicketEvent).toHaveBeenCalledWith(created.id, {
        kind: 'ticket_updated',
        ticket: expect.objectContaining({ id: created.id }),
      })

      // ...and the customer-facing thread stage notice posts on the crossing.
      const page = await listTicketMessages(created.id, { includeInternal: true })
      const event = page.messages.find((m) => m.systemEvent?.kind === 'ticket_status_changed')
      expect(event).toBeDefined()
      expect(event?.senderType).toBe('system')
    })

    it('a closed ticket reopen reports the closed -> open category crossing', async () => {
      await seedSettings()
      const { closed } = await seedReopenWorld()
      const actor = adminActor()
      const requester = await seedTeammate()
      const created = await createTicket(
        { type: 'customer', title: 'Reopen from closed', requesterPrincipalId: requester },
        actor
      )
      await setTicketStatus(created.id, closed.id, actor) // received -> resolved
      webhooks.emitTicketStatusChanged.mockClear()

      const moved = await autoReopenOnRequesterReply(created.id, requester)
      expect(moved).toBe(true)
      expect(webhooks.emitTicketStatusChanged).toHaveBeenCalledTimes(1)
      const [, , previousStatus, newStatus, , previousStage] =
        webhooks.emitTicketStatusChanged.mock.calls[0]
      expect(previousStatus).toBe('closed')
      expect(newStatus).toBe('open')
      expect(previousStage).toBe('resolved')
    })

    it('an open ticket stays put and emits nothing', async () => {
      await seedSettings()
      await seedReopenWorld()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Already open' }, actor)
      webhooks.emitTicketStatusChanged.mockClear()
      realtime.publishTicketEvent.mockClear()

      const moved = await autoReopenOnRequesterReply(created.id, null)
      expect(moved).toBe(false)
      expect(webhooks.emitTicketStatusChanged).not.toHaveBeenCalled()
      expect(realtime.publishTicketEvent).not.toHaveBeenCalled()
    })
  })

  describe('agent-created tickets are born owned', () => {
    const subsFor = (ticketId: TicketId) =>
      testDb.select().from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, ticketId))

    async function seedCompany(name = 'Acme') {
      const [company] = await testDb
        .insert(companies)
        .values({ name: `${name}-${suffix()}` })
        .returning()
      return company
    }

    it('defaults the assignee to the creating agent and subscribes them as assignee', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor() // a backed admin principal
      const created = await createTicket({ type: 'back_office', title: 'Born owned' }, actor)

      expect((await readTicket(created.id)).assigneePrincipalId).toBe(actor.principalId)
      expect(created.assignee.principalId).toBe(actor.principalId)
      // The creator is the assignee, so one watcher row with the assignee reason.
      const rows = await subsFor(created.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ principalId: actor.principalId, reason: 'assignee' })
    })

    it('an explicit assignee wins over the creator default; the creator watches as manual', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      const teammate = await seedTeammate()
      const created = await createTicket(
        { type: 'customer', title: 'Explicitly assigned', assigneePrincipalId: teammate },
        actor
      )

      expect((await readTicket(created.id)).assigneePrincipalId).toBe(teammate)
      const rows = await subsFor(created.id)
      expect(rows).toHaveLength(2)
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ principalId: teammate, reason: 'assignee' }),
          expect.objectContaining({ principalId: actor.principalId, reason: 'manual' }),
        ])
      )
    })

    it('rejects an explicit assignee who is not a team member', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      // An end-user principal (role 'user') is not assignable.
      const userId = createId('user') as UserId
      const endUser = createId('principal') as PrincipalId
      await testDb.insert(user).values({ id: userId, name: 'End User' })
      await testDb
        .insert(principal)
        .values({ id: endUser, userId, role: 'user', type: 'user', createdAt: new Date() })

      await expect(
        createTicket({ type: 'customer', title: 'Nope', assigneePrincipalId: endUser }, actor)
      ).rejects.toThrow(/team member/i)
    })

    it("inherits the source conversation's assignee; an explicit assignee still wins", async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      const conversationAssignee = await seedTeammate()
      const visitor = await seedTeammate()
      const conversationId = createId('conversation') as ConversationId
      await testDb.insert(conversations).values({
        id: conversationId,
        visitorPrincipalId: visitor,
        channel: 'messenger',
        assignedAgentPrincipalId: conversationAssignee,
      })

      const created = await createTicket(
        { type: 'customer', title: 'From a conversation', sourceConversationId: conversationId },
        actor
      )
      expect((await readTicket(created.id)).assigneePrincipalId).toBe(conversationAssignee)
      const rows = await subsFor(created.id)
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ principalId: conversationAssignee, reason: 'assignee' }),
          expect.objectContaining({ principalId: actor.principalId, reason: 'manual' }),
        ])
      )

      // An explicit assignee beats the conversation inheritance.
      const explicit = await seedTeammate()
      const other = await createTicket(
        {
          type: 'customer',
          title: 'From a conversation, explicitly assigned',
          sourceConversationId: conversationId,
          assigneePrincipalId: explicit,
        },
        actor
      )
      expect((await readTicket(other.id)).assigneePrincipalId).toBe(explicit)
    })

    it("propagates the requester's company when none is given; an explicit company wins", async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      const company = await seedCompany()
      const otherCompany = await seedCompany('Other')
      const requester = await seedTeammate()
      await testDb
        .update(principal)
        .set({ companyId: company.id })
        .where(eq(principal.id, requester))

      const created = await createTicket(
        { type: 'customer', title: 'Company inferred', requesterPrincipalId: requester },
        actor
      )
      expect((await readTicket(created.id)).companyId).toBe(company.id)
      expect(created.company?.id).toBe(company.id)

      const explicit = await createTicket(
        {
          type: 'customer',
          title: 'Company explicit',
          requesterPrincipalId: requester,
          companyId: otherCompany.id,
        },
        actor
      )
      expect((await readTicket(explicit.id)).companyId).toBe(otherCompany.id)
    })

    it('a bare (unbacked) creator id gets no default assignee and no watcher row', async () => {
      await seedSettings()
      await seedStatuses()
      // adminActor()'s principal id is deliberately NOT backed by a row: a
      // default must never fail the create (or its subscription FK) — the
      // ticket is simply born unassigned, as before.
      const created = await createTicket({ type: 'back_office', title: 'Bare actor' }, adminActor())
      expect((await readTicket(created.id)).assigneePrincipalId).toBeNull()
      expect(await subsFor(created.id)).toHaveLength(0)
    })
  })

  describe('listTickets: search', () => {
    it('matches by ticket title', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const target = await createTicket(
        { type: 'customer', title: 'Cannot reset my password' },
        actor
      )
      await createTicket({ type: 'customer', title: 'Billing question' }, actor)

      const { tickets: results } = await listTickets({ search: 'password' }, actor)
      expect(results.map((t) => t.id)).toEqual([target.id])
    })

    it('matches a message (agent audience, so internal notes count)', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      const target = await createTicket({ type: 'customer', title: 'General question' }, actor)
      await addTicketNote(actor, {
        ticketId: target.id,
        content: 'escalate this to the payments squad',
      })
      await createTicket({ type: 'customer', title: 'Unrelated' }, actor)

      const { tickets: results } = await listTickets({ search: 'payments squad' }, actor)
      expect(results.map((t) => t.id)).toContain(target.id)
    })

    it('a bare or #-prefixed integer is a ticket-number fast path', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const target = await createTicket(
        { type: 'customer', title: 'Totally unrelated title' },
        actor
      )
      await createTicket({ type: 'customer', title: 'Another one' }, actor)

      const byBareNumber = await listTickets({ search: String(target.number) }, actor)
      expect(byBareNumber.tickets.map((t) => t.id)).toContain(target.id)

      const byHashNumber = await listTickets({ search: `#${target.number}` }, actor)
      expect(byHashNumber.tickets.map((t) => t.id)).toContain(target.id)
    })

    it('an empty/whitespace search does not filter the list', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      await createTicket({ type: 'customer', title: 'Ticket one' }, actor)
      await createTicket({ type: 'customer', title: 'Ticket two' }, actor)

      const { tickets: results } = await listTickets({ search: '   ' }, actor)
      expect(results.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('listTickets: priority filter', () => {
    it('restricts to tickets with the given priority', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const urgent = await createTicket(
        { type: 'customer', title: 'Urgent', priority: 'urgent' },
        actor
      )
      await createTicket({ type: 'customer', title: 'Low', priority: 'low' }, actor)

      const { tickets: results } = await listTickets({ priority: 'urgent' }, actor)
      expect(results.map((t) => t.id)).toEqual([urgent.id])
    })
  })

  describe('listTickets: excludeConversationLinked (unified inbox one-row rule)', () => {
    async function linkTicketToConversation(
      ticketId: TicketId,
      ticketType: 'customer' | 'back_office'
    ) {
      const visitor = await seedTeammate()
      const conversationId = createId('conversation') as ConversationId
      await testDb
        .insert(conversations)
        .values({ id: conversationId, visitorPrincipalId: visitor, channel: 'messenger' })
      await testDb.insert(ticketConversations).values({ ticketId, conversationId, ticketType })
      return conversationId
    }

    it('excludes a linked customer ticket but keeps an unlinked one', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const linked = await createTicket({ type: 'customer', title: 'Linked' }, actor)
      const unlinked = await createTicket({ type: 'customer', title: 'Unlinked' }, actor)
      await linkTicketToConversation(linked.id, 'customer')

      const { tickets: results } = await listTickets({ excludeConversationLinked: true }, actor)
      const ids = results.map((t) => t.id)
      expect(ids).toContain(unlinked.id)
      expect(ids).not.toContain(linked.id)
    })

    it('never excludes a linked back_office ticket (the flag is customer-only)', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const backOffice = await createTicket({ type: 'back_office', title: 'Internal task' }, actor)
      // A link row can exist for a non-customer ticket type (e.g. a tracker
      // cascade) without tripping the customer-only partial unique index.
      await linkTicketToConversation(backOffice.id, 'back_office')

      const { tickets: results } = await listTickets({ excludeConversationLinked: true }, actor)
      expect(results.map((t) => t.id)).toContain(backOffice.id)
    })

    it('does not constrain the list when the flag is omitted', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const linked = await createTicket({ type: 'customer', title: 'Linked' }, actor)
      await linkTicketToConversation(linked.id, 'customer')

      const { tickets: results } = await listTickets({}, actor)
      expect(results.map((t) => t.id)).toContain(linked.id)
    })
  })

  describe('listTickets: keyset cursor', () => {
    it('pages through the recent sort without dupes or gaps', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const a = await createTicket({ type: 'customer', title: 'Ticket A' }, actor)
      const b = await createTicket({ type: 'customer', title: 'Ticket B' }, actor)
      const c = await createTicket({ type: 'customer', title: 'Ticket C' }, actor)

      // Pin updatedAt explicitly (deterministic ordering, no timing flakiness):
      // C is most recent, then B, then A.
      await testDb
        .update(tickets)
        .set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') })
        .where(eq(tickets.id, a.id))
      await testDb
        .update(tickets)
        .set({ updatedAt: new Date('2026-01-02T00:00:00.000Z') })
        .where(eq(tickets.id, b.id))
      await testDb
        .update(tickets)
        .set({ updatedAt: new Date('2026-01-03T00:00:00.000Z') })
        .where(eq(tickets.id, c.id))

      const page1 = await listTickets({ limit: 2 }, actor)
      expect(page1.tickets.map((t) => t.id)).toEqual([c.id, b.id])
      expect(page1.hasMore).toBe(true)

      const page2 = await listTickets(
        { limit: 2, cursor: page1.tickets[page1.tickets.length - 1].id },
        actor
      )
      expect(page2.tickets.map((t) => t.id)).toEqual([a.id])
      expect(page2.hasMore).toBe(false)
    })

    it('the priority sort ranks by priority, keyset intact across pages', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const low = await createTicket(
        { type: 'customer', title: 'Low priority', priority: 'low' },
        actor
      )
      const urgent = await createTicket(
        { type: 'customer', title: 'Urgent priority', priority: 'urgent' },
        actor
      )
      const high = await createTicket(
        { type: 'customer', title: 'High priority', priority: 'high' },
        actor
      )

      const page1 = await listTickets({ sort: 'priority', limit: 1 }, actor)
      expect(page1.tickets.map((t) => t.id)).toEqual([urgent.id])
      expect(page1.hasMore).toBe(true)

      const page2 = await listTickets(
        { sort: 'priority', limit: 1, cursor: page1.tickets[0].id },
        actor
      )
      expect(page2.tickets.map((t) => t.id)).toEqual([high.id])
      expect(page2.hasMore).toBe(true)

      const page3 = await listTickets(
        { sort: 'priority', limit: 1, cursor: page2.tickets[0].id },
        actor
      )
      expect(page3.tickets.map((t) => t.id)).toEqual([low.id])
      expect(page3.hasMore).toBe(false)
    })

    it('an unknown cursor is ignored (first page, not a 500)', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Solo' }, actor)

      const page = await listTickets({ cursor: createId('ticket') as TicketId }, actor)
      expect(page.tickets.map((t) => t.id)).toContain(created.id)
    })
  })

  describe('listTickets + getTicket: activity enrichment', () => {
    it('carries the latest non-internal message as the preview + its timestamp as lastMessageAt', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      const created = await createTicket({ type: 'customer', title: 'Quiet ticket' }, actor)
      await sendTicketMessage(actor, {
        ticketId: created.id,
        content: 'the checkout page kept spinning',
      })

      const { tickets: results } = await listTickets({}, actor)
      const dto = results.find((t) => t.id === created.id)
      expect(dto?.lastMessagePreview).toBe('the checkout page kept spinning')
      expect(dto?.lastMessageAt).not.toBeNull()

      // getTicket (single-row path) populates the same fields.
      const single = await getTicket(created.id)
      expect(single.lastMessagePreview).toBe('the checkout page kept spinning')
      expect(single.lastMessageAt).not.toBeNull()
    })

    it('an internal note bumps lastMessageAt but the preview falls back to the title', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      const created = await createTicket({ type: 'customer', title: 'Note-only ticket' }, actor)
      await addTicketNote(actor, { ticketId: created.id, content: 'internal-only note' })

      const dto = await getTicket(created.id)
      expect(dto.lastMessagePreview).toBe('Note-only ticket')
      expect(dto.lastMessageAt).not.toBeNull()
    })

    it('a thread-less ticket has a null lastMessageAt and the title as its preview', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Untouched ticket' }, actor)

      const dto = await getTicket(created.id)
      expect(dto.lastMessagePreview).toBe('Untouched ticket')
      expect(dto.lastMessageAt).toBeNull()
    })

    it('a later internal note does not override a non-internal preview', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = await messageAuthorActor()
      const created = await createTicket({ type: 'customer', title: 'Mixed thread' }, actor)
      await sendTicketMessage(actor, { ticketId: created.id, content: 'customer-visible reply' })
      await addTicketNote(actor, { ticketId: created.id, content: 'a later internal note' })

      const dto = await getTicket(created.id)
      // lastMessageAt reflects the later (internal) activity...
      const [latestNote] = await testDb
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.ticketId, created.id),
            eq(conversationMessages.isInternal, true)
          )
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(1)
      expect(new Date(dto.lastMessageAt as string).getTime()).toBe(latestNote.createdAt.getTime())
      // ...but the preview still prefers the non-internal message.
      expect(dto.lastMessagePreview).toBe('customer-visible reply')
    })
  })

  describe('assertTicketVisible (unified inbox §2.5)', () => {
    it('returns the ticket for a workspace-wide viewer (ticket.view_all)', async () => {
      await seedSettings()
      const { open } = await seedStatuses()
      const [created] = await testDb
        .insert(tickets)
        .values({ title: 'Visible to all', statusId: open.id })
        .returning()

      const row = await assertTicketVisible(created.id as TicketId, adminActor())
      expect(row.id).toBe(created.id)
    })

    it('returns the ticket for a scoped viewer (ticket.view) assigned to them', async () => {
      await seedSettings()
      const { open } = await seedStatuses()
      const principalId = await seedTeammate()
      const [created] = await testDb
        .insert(tickets)
        .values({ title: 'Assigned to me', statusId: open.id, assigneePrincipalId: principalId })
        .returning()
      const scopedActor: Actor = {
        principalId,
        role: 'member',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: new Set<PermissionKey>([PERMISSIONS.TICKET_VIEW]),
      }

      const row = await assertTicketVisible(created.id as TicketId, scopedActor)
      expect(row.id).toBe(created.id)
    })

    it('returns the ticket for a scoped viewer via their team assignment', async () => {
      await seedSettings()
      const { open } = await seedStatuses()
      const principalId = await seedTeammate()
      const teamId = await seedTeam()
      await testDb.insert(teamMembers).values({ teamId, principalId })
      const [created] = await testDb
        .insert(tickets)
        .values({ title: 'Assigned to my team', statusId: open.id, assigneeTeamId: teamId })
        .returning()
      const scopedActor: Actor = {
        principalId,
        role: 'member',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: new Set<PermissionKey>([PERMISSIONS.TICKET_VIEW]),
      }

      const row = await assertTicketVisible(created.id as TicketId, scopedActor)
      expect(row.id).toBe(created.id)
    })

    it('404s for a scoped viewer (ticket.view only) on a ticket assigned elsewhere', async () => {
      await seedSettings()
      const { open } = await seedStatuses()
      const elsewhere = await seedTeammate()
      const [created] = await testDb
        .insert(tickets)
        .values({ title: 'Assigned elsewhere', statusId: open.id, assigneePrincipalId: elsewhere })
        .returning()
      const scopedActor: Actor = {
        principalId: await seedTeammate(),
        role: 'member',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: new Set<PermissionKey>([PERMISSIONS.TICKET_VIEW]),
      }

      await expect(assertTicketVisible(created.id as TicketId, scopedActor)).rejects.toThrow(
        NotFoundError
      )
    })

    it('404s for an actor with no ticket.view permission at all', async () => {
      await seedSettings()
      const { open } = await seedStatuses()
      const [created] = await testDb
        .insert(tickets)
        .values({ title: 'No permission', statusId: open.id })
        .returning()
      const powerless: Actor = {
        principalId: createId('principal') as PrincipalId,
        role: 'user',
        principalType: 'user',
        segmentIds: new Set(),
        permissions: new Set<PermissionKey>(),
      }

      await expect(assertTicketVisible(created.id as TicketId, powerless)).rejects.toThrow(
        NotFoundError
      )
    })

    it('404s for a non-existent ticket id', async () => {
      await expect(
        assertTicketVisible(createId('ticket') as TicketId, adminActor())
      ).rejects.toThrow(NotFoundError)
    })
  })

  describe('bulkUpdateTickets (support platform §4.6 bulk actions, ticket axis)', () => {
    it('routes an assign action to assignTicket, resolving each ticket', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const teammate = await seedTeammate()
      const t1 = await createTicket({ type: 'back_office', title: 'Bulk 1' }, actor)
      const t2 = await createTicket({ type: 'back_office', title: 'Bulk 2' }, actor)

      const result = await bulkUpdateTickets(
        [t1.id, t2.id],
        { type: 'assign', assignTo: teammate },
        actor
      )

      expect(result).toEqual({ succeeded: [t1.id, t2.id], failed: [] })
      expect((await readTicket(t1.id)).assigneePrincipalId).toBe(teammate)
      expect((await readTicket(t2.id)).assigneePrincipalId).toBe(teammate)
    })

    it('routes an assign_team action to assignTicket with the team id', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const teamId = await seedTeam()
      const created = await createTicket({ type: 'back_office', title: 'Bulk team' }, actor)

      const result = await bulkUpdateTickets([created.id], { type: 'assign_team', teamId }, actor)

      expect(result).toEqual({ succeeded: [created.id], failed: [] })
      expect((await readTicket(created.id)).assigneeTeamId).toBe(teamId)
    })

    it('routes a priority action to setTicketPriority', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Bulk priority' }, actor)

      const result = await bulkUpdateTickets(
        [created.id],
        { type: 'priority', priority: 'urgent' },
        actor
      )

      expect(result).toEqual({ succeeded: [created.id], failed: [] })
      expect((await readTicket(created.id)).priority).toBe('urgent')
    })

    it('routes a set_status action to setTicketStatus', async () => {
      await seedSettings()
      const { closed } = await seedStatuses()
      const actor = adminActor()
      const created = await createTicket({ type: 'customer', title: 'Bulk status' }, actor)

      const result = await bulkUpdateTickets(
        [created.id],
        { type: 'set_status', statusId: closed.id },
        actor
      )

      expect(result).toEqual({ succeeded: [created.id], failed: [] })
      expect((await readTicket(created.id)).statusId).toBe(closed.id)
    })

    it('isolates a per-item failure (unknown ticket id) without aborting the rest of the batch', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const t1 = await createTicket({ type: 'customer', title: 'Bulk isolate 1' }, actor)
      const missing = createId('ticket') as TicketId
      const t3 = await createTicket({ type: 'customer', title: 'Bulk isolate 3' }, actor)

      const result = await bulkUpdateTickets(
        [t1.id, missing, t3.id],
        { type: 'priority', priority: 'high' },
        actor
      )

      expect(result.succeeded).toEqual([t1.id, t3.id])
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].id).toBe(missing)
      expect((await readTicket(t1.id)).priority).toBe('high')
      expect((await readTicket(t3.id)).priority).toBe('high')
    })

    it('reuses the single-item op, so a successful bulk assign still fires ticket.assigned', async () => {
      await seedSettings()
      await seedStatuses()
      const actor = adminActor()
      const teammate = await seedTeammate()
      const created = await createTicket({ type: 'back_office', title: 'Bulk hook' }, actor)
      webhooks.emitTicketAssigned.mockClear()

      await bulkUpdateTickets([created.id], { type: 'assign', assignTo: teammate }, actor)

      expect(webhooks.emitTicketAssigned).toHaveBeenCalledTimes(1)
    })
  })
})
