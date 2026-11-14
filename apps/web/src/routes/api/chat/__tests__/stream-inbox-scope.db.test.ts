/**
 * The realtime inbox follows each teammate's scope, end to end on real rows.
 *
 * Real here: the stream route and its scope cache, every publisher in
 * conversation-channels with its by-id scope read, the writers that move an
 * item (assign, team assign, offline requeue, ticket assign) and the writers
 * that change a scope (team membership, role), all against seeded rows in the
 * rollback transaction. Stood in for: the NOTIFY transport, by an in-process
 * loopback that keeps the production contract (the handler gets the channel,
 * the payload as a JSON string, and the scope envelope beside it); a NOTIFY is
 * only delivered at commit, and the fixture never commits. pubsub.db.test.ts
 * covers the real wire. Also stood in for: the stream token signature, the
 * session read, the feature-flag gate, presence and the activity snapshot.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  createId,
  type ConversationId,
  type PrincipalId,
  type RoleId,
  type TeamId,
  type TicketId,
  type UserId,
} from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversations,
  eq,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  settings,
  invitation,
  teamMembers,
  teams,
  tickets,
  ticketStatuses,
  user,
} from '@/lib/server/db'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { TypeId } from '@quackback/ids'

type TicketStatusId = TypeId<'ticket_status'>

/** The loopback bus: every publish, and the handlers subscribed per channel. */
const bus = vi.hoisted(() => ({
  wire: [] as Array<{ channel: string; payload: unknown; scope: unknown }>,
  handlers: new Map<string, Set<(c: string, m: string, s?: unknown) => void>>(),
  /** Runs inside subscribe, before the handlers register: the connect window. */
  beforeSubscribe: null as null | (() => Promise<void>),
}))

vi.mock('@/lib/server/realtime/pubsub', () => {
  const deliver = (channel: string, payload: unknown, scope?: unknown) => {
    bus.wire.push({ channel, payload, scope })
    // As `dispatch` does: the payload arrives as a string, the envelope beside it.
    const message = JSON.stringify(payload ?? null)
    const s = scope === undefined ? undefined : JSON.parse(JSON.stringify(scope))
    for (const fn of bus.handlers.get(channel) ?? []) fn(channel, message, s)
  }
  return {
    publish: (channel: string, payload: unknown, scope?: unknown) =>
      deliver(channel, payload, scope),
    publishAsync: async (channel: string, payload: unknown, scope?: unknown) =>
      deliver(channel, payload, scope),
    subscribe: async (
      channels: string[],
      onMessage: (c: string, m: string, s?: unknown) => void
    ) => {
      await bus.beforeSubscribe?.()
      for (const c of channels) {
        let set = bus.handlers.get(c)
        if (!set) bus.handlers.set(c, (set = new Set()))
        set.add(onMessage)
      }
      return async () => {
        for (const c of channels) bus.handlers.get(c)?.delete(onMessage)
      }
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/realtime/stream-token', () => ({
  verifyStreamToken: (token: string | null) => {
    if (!token) return null
    const dot = token.lastIndexOf('.')
    return { principalId: token.slice(0, dot), scope: token.slice(dot + 1) }
  },
}))
vi.mock('@/lib/server/auth', () => ({ auth: { api: { getSession: vi.fn(async () => null) } } }))
// The invite accept is a server function: its builder runs the handler, and
// the session is whoever a case says it is.
const session = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('@/lib/server/auth/session', () => ({ getSession: async () => session.current }))
vi.mock('@/lib/server/auth/magic-link-mint', () => ({ revokeMagicLinkTokens: async () => {} }))
vi.mock('@/lib/server/domains/settings/settings.support', () => ({
  isConversationsEnabledFor: vi.fn(async () => true),
  isSupportTicketsEnabled: vi.fn(async () => true),
}))
vi.mock('@/lib/server/realtime/presence', () => ({
  markPresent: vi.fn(async () => {}),
  refreshPresence: vi.fn(async () => {}),
  clearPresence: vi.fn(async () => false),
  isAnyAgentOnline: vi.fn(async () => false),
  listOnlineAgentIds: vi.fn(async () => []),
}))
vi.mock('@/lib/server/domains/assistant/assistant-activity-snapshot', () => ({
  readActivitySnapshot: vi.fn(async () => null),
}))
// Routing for the offline requeue: declines unless a case names a target.
const routing = vi.hoisted(() => ({ to: null as string | null }))
vi.mock('@/lib/server/domains/conversation/routing', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  routeConversation: vi.fn(async () => ({ assignedPrincipalId: routing.to })),
}))
// Author loading runs between a write's reads and its publish: a case can
// land a reassignment in that gap.
const authors = vi.hoisted(() => ({ before: null as null | (() => Promise<void>) }))
vi.mock('@/lib/server/domains/principals/principal-display', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/server/domains/principals/principal-display')>()
  return {
    ...actual,
    loadAuthors: async (...args: Parameters<typeof actual.loadAuthors>) => {
      const hook = authors.before
      authors.before = null
      await hook?.()
      return actual.loadAuthors(...args)
    },
  }
})
// The scope reload's team read, real unless a case makes it fail.
const teamRead = vi.hoisted(() => ({ failNext: 0 }))
vi.mock('@/lib/server/domains/teams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/domains/teams')>()
  return {
    ...actual,
    teamIdsForPrincipal: vi.fn(async (id: PrincipalId) => {
      if (teamRead.failNext > 0) {
        teamRead.failNext -= 1
        // Slow enough that frames published meanwhile queue behind it.
        await new Promise((r) => setTimeout(r, 50))
        throw new Error('team read failed')
      }
      return actual.teamIdsForPrincipal(id)
    }),
  }
})

import { Route } from '../stream'
import { acceptInvitationFn } from '@/lib/server/functions/invitations'
import {
  publishAgentConversationEvent,
  publishConversationEvent,
  publishConversationMessage,
  publishConversationUpdate,
  publishTicketEvent,
  publishTyping,
} from '@/lib/server/realtime/conversation-channels'
import { inboxPublishesSettled } from '@/lib/server/realtime/inbox-publish'
import { publishInboxScopeChanged } from '@/lib/server/realtime/inbox-scope-invalidate'
import {
  assignConversation,
  assignTeam,
  requeueUnansweredOnAgentOffline,
} from '@/lib/server/domains/conversation/conversation.service'
import { conversationToDTO } from '@/lib/server/domains/conversation/conversation.query'
import { assignTicket } from '@/lib/server/domains/tickets/ticket.service'
import { sendTicketMessage } from '@/lib/server/domains/tickets/ticket-message.service'
import { addPrincipalToDefaultTeam, setTeamMembers } from '@/lib/server/domains/teams'
import { setPrincipalRole } from '@/lib/server/domains/principals/principal.factory'
import { deleteRole, updateRole } from '@/lib/server/domains/roles/role.service'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import type { Actor } from '@/lib/server/policy/types'

type RouteOpts = { server: { handlers: { GET: (a: { request: Request }) => Promise<Response> } } }
const GET = (Route as unknown as { options: RouteOpts }).options.server.handlers.GET

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: tickets.id }).from(tickets).limit(0)
    await db.select({ id: conversations.id }).from(conversations).limit(0)
    await db.select({ id: principalRoleAssignments.id }).from(principalRoleAssignments).limit(0)
  },
})

const openStreams: Array<() => Promise<void>> = []

if (fixture.available) {
  beforeEach(async () => {
    bus.wire.length = 0
    bus.handlers.clear()
    bus.beforeSubscribe = null
    authors.before = null
    teamRead.failNext = 0
    routing.to = null
    await fixture.begin()
  })
  afterEach(async () => {
    for (const close of openStreams.splice(0)) await close()
    await inboxPublishesSettled()
    vi.useRealTimers()
    await fixture.rollback()
  })
  afterAll(() => fixture.close())
}

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

async function seedPrincipal(role: 'admin' | 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `Inbox ${role}`, email: `inbox-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

async function assignCustomRole(principalId: PrincipalId, granted: PermissionKey[]) {
  const roleId = createId('role') as RoleId
  await testDb.insert(roles).values({ id: roleId, key: roleId, name: 'Scoped', isSystem: false })
  for (const key of granted) {
    const [row] = await testDb
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.key, key))
      .limit(1)
    await testDb.insert(rolePermissions).values({ roleId, permissionId: row.id })
  }
  await testDb.insert(principalRoleAssignments).values({ principalId, roleId })
  return roleId
}

const SCOPED_KEYS = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.TICKET_ASSIGN,
] as PermissionKey[]

/**
 * A scoped teammate on team X, a workspace-wide viewer, an admin who does the
 * writes, and a conversation and a ticket on each of teams X and Y.
 */
async function seedWorld() {
  // Ticket DTOs read the workspace's stage labels.
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date() })
  const scoped = await seedPrincipal('member')
  const scopedRole = await assignCustomRole(scoped, SCOPED_KEYS)
  const viewAll = await seedPrincipal('member')
  const viewAllRole = await assignCustomRole(viewAll, [
    ...SCOPED_KEYS,
    PERMISSIONS.CONVERSATION_VIEW_ALL,
    PERMISSIONS.TICKET_VIEW_ALL,
  ])
  const admin = await seedPrincipal('admin')
  const other = await seedPrincipal('member')
  const visitor = await seedPrincipal('user')

  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: scoped })

  const conv = {
    x: createId('conversation') as ConversationId,
    y: createId('conversation') as ConversationId,
  }
  await testDb.insert(conversations).values([
    { id: conv.x, visitorPrincipalId: visitor, channel: 'messenger', assignedTeamId: teamX },
    { id: conv.y, visitorPrincipalId: visitor, channel: 'messenger', assignedTeamId: teamY },
  ])
  const statusId = createId('ticket_status') as TicketStatusId
  await testDb.insert(ticketStatuses).values({ id: statusId, name: 'New', slug: `st-${suffix()}` })
  const ticket = { x: createId('ticket') as TicketId, y: createId('ticket') as TicketId }
  await testDb.insert(tickets).values([
    { id: ticket.x, title: 'x', statusId, assigneeTeamId: teamX },
    { id: ticket.y, title: 'y', statusId, assigneeTeamId: teamY },
  ])
  const adminActor: Actor = {
    principalId: admin,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: permissionsForLegacyRole('admin'),
  }
  return {
    scoped,
    viewAll,
    admin,
    other,
    visitor,
    teamX,
    teamY,
    conv,
    ticket,
    adminActor,
    scopedRole,
    viewAllRole,
  }
}

type Frame = { event: string; data: { kind?: string } & Record<string, unknown> }

/** Open an inbox stream and collect its named frames as they arrive. */
async function openInbox(principalId: PrincipalId, query = 'scope=inbox') {
  const before = bus.handlers.get('conversation:inbox')?.size ?? 0
  const res = await GET({
    request: new Request(
      `http://test/api/chat/stream?${query}&token=${encodeURIComponent(`${principalId}.dashboard`)}`
    ),
  })
  expect(res.status).toBe(200)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let done = false
  void (async () => {
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (chunk.done) {
        done = true
        return
      }
      text += decoder.decode(chunk.value)
    }
  })()
  if (query === 'scope=inbox') {
    await until(() => (bus.handlers.get('conversation:inbox')?.size ?? 0) > before)
  }
  const frames = (): Frame[] =>
    text
      .split('\n\n')
      .map((block) => {
        const event = /^event: (.+)$/m.exec(block)?.[1]
        const data = /^data: (.+)$/m.exec(block)?.[1]
        return event && data ? { event, data: JSON.parse(data) } : null
      })
      .filter((f): f is Frame => f !== null)
  const close = async () => {
    await reader.cancel().catch(() => {})
  }
  openStreams.push(close)
  return { frames, isDone: () => done, close }
}

async function until(predicate: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('timed out')
}

/** Let every chained publish, and the frames it delivers, land. */
async function settle(): Promise<void> {
  await inboxPublishesSettled()
  await new Promise((r) => setTimeout(r, 20))
}

/** Publish an agent-side `ticket_read` for a ticket, marked `at`. */
function publishTicketRead(ticketId: TicketId, at: string): void {
  publishTicketEvent(ticketId, { kind: 'ticket_read', ticketId, side: 'agent', at })
}

/** Publish a `ticket_read` marked `at`, and say whether this inbox received it. */
async function ticketReadReaches(
  inbox: Awaited<ReturnType<typeof openInbox>>,
  ticketId: TicketId,
  at: string
): Promise<boolean> {
  publishTicketRead(ticketId, at)
  await settle()
  return inbox.frames().some((f) => f.event === 'ticket_read' && f.data.at === at)
}

/** The ids an inbox frame is about, whatever its kind. */
function itemIdOf(frame: Frame): string | undefined {
  const d = frame.data as Record<string, { id?: string } | string | undefined>
  if (typeof d.conversationId === 'string') return d.conversationId
  if (typeof d.ticketId === 'string') return d.ticketId
  if (typeof d.id === 'string') return d.id
  return (d.conversation as { id?: string })?.id ?? (d.ticket as { id?: string })?.id
}

describe.skipIf(!fixture.available)('the realtime inbox follows scope (real Postgres)', () => {
  it("a scoped teammate never receives another team's frame, from every publisher", async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    const viewAll = await openInbox(w.viewAll)
    const message = (conversationId: ConversationId) =>
      ({ id: `conversation_msg_${suffix()}`, conversationId, attachments: [] }) as never

    for (const conversationId of [w.conv.y, w.conv.x]) {
      const [row] = await testDb
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
      publishConversationEvent(conversationId, {
        kind: 'read',
        conversationId,
        side: 'agent',
        at: new Date().toISOString(),
      })
      publishConversationMessage(conversationId, { visitor: message(conversationId) })
      publishTyping(conversationId, 'visitor', new Date().toISOString(), w.visitor)
      publishAgentConversationEvent({
        kind: 'message',
        conversationId,
        message: message(conversationId),
      })
      await publishConversationUpdate(conversationId, await conversationToDTO(row, 'agent'))
    }
    for (const ticketId of [w.ticket.y, w.ticket.x]) {
      publishTicketRead(ticketId, new Date().toISOString())
    }
    await settle()

    const scopedIds = scoped.frames().map(itemIdOf)
    expect(scopedIds).not.toContain(w.conv.y)
    expect(scopedIds).not.toContain(w.ticket.y)
    // Each of the five conversation publishers and the ticket publisher got through.
    expect(scopedIds.filter((id) => id === w.conv.x)).toHaveLength(5)
    expect(scopedIds.filter((id) => id === w.ticket.x)).toHaveLength(1)

    const allIds = viewAll.frames().map(itemIdOf)
    expect(allIds.filter((id) => id === w.conv.y)).toHaveLength(5)
    expect(allIds.filter((id) => id === w.ticket.y)).toHaveLength(1)
  })

  it('sends a removal, not the frame, to the teammate an assignment takes an item from', async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    const viewAll = await openInbox(w.viewAll)

    await assignTeam(w.conv.x, w.teamY, w.adminActor)
    await assignTicket(w.ticket.x, { assigneeTeamId: w.teamY }, w.adminActor)
    await settle()

    const removals = scoped.frames().filter((f) => f.event === 'inbox_item_removed')
    expect(removals.map((f) => f.data)).toEqual([
      { kind: 'inbox_item_removed', itemKind: 'conversation', id: w.conv.x },
      { kind: 'inbox_item_removed', itemKind: 'ticket', id: w.ticket.x },
    ])
    // The moved items' own frames never reach the teammate who lost them.
    expect(
      scoped
        .frames()
        .filter((f) => f.event !== 'inbox_item_removed')
        .map(itemIdOf)
    ).toEqual([])
    // A teammate who keeps the item gets the update, never a removal.
    expect(viewAll.frames().some((f) => f.event === 'inbox_item_removed')).toBe(false)
    expect(viewAll.frames().map((f) => f.event)).toContain('ticket_updated')
  })

  it('removes a conversation reassigned away from the teammate, and from the agent who went offline', async () => {
    const w = await seedWorld()
    await testDb
      .update(conversations)
      .set({ assignedAgentPrincipalId: w.scoped, assignedTeamId: null })
      .where(eq(conversations.id, w.conv.y))
    const scoped = await openInbox(w.scoped)

    await assignConversation(w.conv.y, w.other, w.adminActor)
    await settle()
    expect(scoped.frames().filter((f) => f.event === 'inbox_item_removed')).toHaveLength(1)

    // The offline requeue: the agent loses an unanswered conversation.
    await testDb
      .update(conversations)
      .set({ assignedAgentPrincipalId: w.scoped, status: 'open' })
      .where(eq(conversations.id, w.conv.y))
    await requeueUnansweredOnAgentOffline(w.scoped)
    await settle()
    expect(
      scoped
        .frames()
        .filter((f) => f.event === 'inbox_item_removed')
        .map((f) => f.data.id)
    ).toEqual([w.conv.y, w.conv.y])
  })

  it('removes a requeued conversation from the offline agent when routing gives it to someone else', async () => {
    const w = await seedWorld()
    await testDb
      .update(conversations)
      .set({ assignedAgentPrincipalId: w.scoped, assignedTeamId: null, status: 'open' })
      .where(eq(conversations.id, w.conv.y))
    const scoped = await openInbox(w.scoped)
    const viewAll = await openInbox(w.viewAll)
    routing.to = w.other
    await requeueUnansweredOnAgentOffline(w.scoped)
    await settle()
    expect(
      scoped
        .frames()
        .filter((f) => f.event === 'inbox_item_removed')
        .map((f) => f.data.id)
    ).toEqual([w.conv.y])
    const routed = viewAll.frames().filter((f) => f.event === 'conversation')
    expect(
      routed.map(
        (f) =>
          (f.data.conversation as { assignedAgent?: { principalId?: string } }).assignedAgent
            ?.principalId
      )
    ).toContain(w.other)
  })

  it('refreshes the cached scope at once when the teammate joins a team', async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    expect(await ticketReadReaches(scoped, w.ticket.y, 'a')).toBe(false)

    await setTeamMembers(w.teamY, [w.scoped])
    await settle()
    expect(scoped.frames().map((f) => f.event)).toContain('inbox_scope_changed')

    expect(await ticketReadReaches(scoped, w.ticket.y, 'b')).toBe(true)

    // And leaving the team takes it away again.
    await setTeamMembers(w.teamY, [])
    await settle()
    expect(await ticketReadReaches(scoped, w.ticket.y, 'c')).toBe(false)
  })

  it("refreshes every holder's scope when their role gains or loses keys, or is deleted", async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    const editor = { principalId: w.admin, permissions: [...permissionsForLegacyRole('admin')] }
    expect(await ticketReadReaches(scoped, w.ticket.y, 'before')).toBe(false)

    await updateRole(
      w.scopedRole,
      { permissionKeys: [...SCOPED_KEYS, PERMISSIONS.TICKET_VIEW_ALL] },
      editor
    )
    await settle()
    expect(await ticketReadReaches(scoped, w.ticket.y, 'granted')).toBe(true)

    await updateRole(w.scopedRole, { permissionKeys: SCOPED_KEYS }, editor)
    await settle()
    expect(await ticketReadReaches(scoped, w.ticket.y, 'revoked')).toBe(false)

    await deleteRole(w.scopedRole, { reassignToRoleId: w.viewAllRole }, editor)
    await settle()
    expect(await ticketReadReaches(scoped, w.ticket.y, 'reassigned')).toBe(true)
  })

  it('refreshes the cached scope when the teammate is enrolled in the default team', async () => {
    const w = await seedWorld()
    // The default team is the only one flagged; the seeded workspace may have its own.
    await testDb.update(teams).set({ isDefault: false })
    await testDb.update(teams).set({ isDefault: true }).where(eq(teams.id, w.teamY))
    const scoped = await openInbox(w.scoped)
    expect(await ticketReadReaches(scoped, w.ticket.y, 'before')).toBe(false)

    await addPrincipalToDefaultTeam(w.scoped)
    await settle()
    expect(scoped.frames().map((f) => f.event)).toContain('inbox_scope_changed')
    expect(await ticketReadReaches(scoped, w.ticket.y, 'enrolled')).toBe(true)
  })

  it('sends no scope signal for a role write that cannot move scope', async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    const editor = { principalId: w.admin, permissions: [...permissionsForLegacyRole('admin')] }
    // A key the scope rule never reads, and a write that keeps the same role.
    await updateRole(
      w.scopedRole,
      { permissionKeys: SCOPED_KEYS.filter((k) => k !== PERMISSIONS.CONVERSATION_REPLY) },
      editor
    )
    await setPrincipalRole({ principalId: w.scoped }, 'member')
    await settle()
    expect(scoped.frames().map((f) => f.event)).not.toContain('inbox_scope_changed')
    // The control: a key the rule reads does signal.
    await updateRole(
      w.scopedRole,
      { permissionKeys: [...SCOPED_KEYS, PERMISSIONS.TICKET_VIEW_ALL] },
      editor
    )
    await settle()
    expect(scoped.frames().map((f) => f.event)).toContain('inbox_scope_changed')
  })

  it('refreshes the scope of a teammate who accepts a scoped role invite while their inbox is open', async () => {
    const w = await seedWorld()
    // A Manager: a legacy member with no assignment rides the preset, view_all included.
    const manager = await seedPrincipal('member')
    const [account] = await testDb
      .select({ id: user.id, email: user.email })
      .from(user)
      .innerJoin(principal, eq(principal.userId, user.id))
      .where(eq(principal.id, manager))
    const inbox = await openInbox(manager)
    expect(await ticketReadReaches(inbox, w.ticket.y, 'before')).toBe(true)

    const [adminUser] = await testDb
      .select({ userId: principal.userId })
      .from(principal)
      .where(eq(principal.id, w.admin))
    const email = account.email
    const inviterId = adminUser.userId
    if (!email || !inviterId) throw new Error('seeded people have an email and a user')
    const invitationId = createId('invite')
    await testDb.insert(invitation).values({
      id: invitationId,
      email,
      status: 'pending',
      kind: 'team',
      role: 'member',
      roleId: w.scopedRole,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      inviterId,
    })
    session.current = {
      session: { id: 'sess_1' },
      user: { id: account.id, email, name: 'Manager', createdAt: new Date().toISOString() },
    }
    await acceptInvitationFn({ data: { invitationId } })
    await settle()

    expect(inbox.frames().map((f) => f.event)).toContain('inbox_scope_changed')
    expect(await ticketReadReaches(inbox, w.ticket.y, 'after')).toBe(false)
  })

  it('judges a ticket message by the owner at send time, not the one read before the write', async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    await ticketReadReaches(scoped, w.ticket.x, 'connect')
    // The ticket moves to team Y after the reply read it but before it published.
    authors.before = async () => {
      await testDb
        .update(tickets)
        .set({ assigneeTeamId: w.teamY })
        .where(eq(tickets.id, w.ticket.x))
    }
    await sendTicketMessage(w.adminActor, { ticketId: w.ticket.x, content: 'after the move' })
    await settle()
    expect(scoped.frames().map((f) => f.event)).not.toContain('ticket_message')
  })

  it('sees a scope change made between the connect reads and the subscribe', async () => {
    const w = await seedWorld()
    bus.beforeSubscribe = async () => {
      bus.beforeSubscribe = null
      // Joins team Y while the stream is connecting: its signal goes out to no one.
      await testDb.insert(teamMembers).values({ teamId: w.teamY, principalId: w.scoped })
      publishInboxScopeChanged([w.scoped])
    }
    const scoped = await openInbox(w.scoped)
    expect(await ticketReadReaches(scoped, w.ticket.y, 'joined')).toBe(true)
  })

  it('reloads a scope older than 60 seconds before filtering the next frame', async () => {
    const w = await seedWorld()
    vi.useFakeTimers({ toFake: ['Date'] })
    const scoped = await openInbox(w.scoped)
    // The first frame runs the stream's starting reload.
    expect(await ticketReadReaches(scoped, w.ticket.y, 'connect')).toBe(false)
    // A membership written without any signal: only the backstop can see it.
    await testDb.insert(teamMembers).values({ teamId: w.teamY, principalId: w.scoped })
    expect(await ticketReadReaches(scoped, w.ticket.y, 'a')).toBe(false)

    vi.setSystemTime(Date.now() + 61_000)
    expect(await ticketReadReaches(scoped, w.ticket.y, 'b')).toBe(true)
  })

  it('drops the frames that waited on a failed reload, and retries on the next frame', async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    // A working load first, so the cache holds team X: a frame dropped below
    // is dropped by the failed reload, not by an empty starting scope.
    expect(await ticketReadReaches(scoped, w.ticket.x, 'connect')).toBe(true)
    teamRead.failNext = 1
    publishInboxScopeChanged([w.scoped])
    publishTicketRead(w.ticket.x, 'lost')
    await settle()
    // Past the failed reload's slow read.
    await new Promise((r) => setTimeout(r, 100))
    expect(scoped.frames().some((f) => f.data.at === 'lost')).toBe(false)

    publishTicketRead(w.ticket.x, 'kept')
    await settle()
    const reads = scoped.frames().filter((f) => f.event === 'ticket_read')
    expect(reads.map((f) => f.data.at)).toEqual(['connect', 'kept'])
  })

  it('closes the stream when a reload finds the principal is no longer a teammate', async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    await setPrincipalRole({ principalId: w.scoped }, 'user')
    await settle()
    await until(() => scoped.isDone())
    expect(await ticketReadReaches(scoped, w.ticket.x, 'a')).toBe(false)
  })

  it('keeps the frames for one item in call order, across a reload', async () => {
    const w = await seedWorld()
    const scoped = await openInbox(w.scoped)
    const at = (n: number) => `2026-01-01T00:00:0${n}.000Z`
    publishConversationEvent(w.conv.x, {
      kind: 'read',
      conversationId: w.conv.x,
      side: 'agent',
      at: at(1),
    })
    publishInboxScopeChanged([w.scoped])
    // The first frame reads its row; the later two carry their envelope and
    // need no read, so without the per-item chain they would overtake it.
    const envelope = { assigneePrincipalId: null, teamId: w.teamX }
    for (const n of [2, 3]) {
      publishConversationEvent(
        w.conv.x,
        { kind: 'read', conversationId: w.conv.x, side: 'agent', at: at(n) },
        envelope
      )
    }
    await settle()
    expect(
      scoped
        .frames()
        .filter((f) => f.event === 'read')
        .map((f) => f.data.at)
    ).toEqual([at(1), at(2), at(3)])
  })

  it('drops an inbox frame that carries no scope envelope', async () => {
    const w = await seedWorld()
    const viewAll = await openInbox(w.viewAll)
    for (const fn of bus.handlers.get('conversation:inbox') ?? []) {
      fn('conversation:inbox', JSON.stringify({ kind: 'read', conversationId: w.conv.x }))
    }
    await settle()
    expect(viewAll.frames()).toEqual([])
  })

  it('visitor and per-item channels never carry the envelope, and still reach their subscriber', async () => {
    const w = await seedWorld()
    const visitorStream = await openInbox(w.visitor, `conversationId=${w.conv.x}`)
    await until(() => (bus.handlers.get(`conversation:${w.conv.x}`)?.size ?? 0) > 0)
    const [row] = await testDb.select().from(conversations).where(eq(conversations.id, w.conv.x))
    publishConversationEvent(w.conv.x, {
      kind: 'read',
      conversationId: w.conv.x,
      side: 'agent',
      at: 'a',
    })
    publishConversationMessage(w.conv.x, {
      visitor: { id: `conversation_msg_${suffix()}`, attachments: [] } as never,
    })
    publishTyping(w.conv.x, 'agent', 'a', w.admin)
    await publishConversationUpdate(w.conv.x, await conversationToDTO(row, 'agent'))
    publishTicketRead(w.ticket.x, 'a')
    await assignTeam(w.conv.x, w.teamY, w.adminActor)
    await settle()

    const offInbox = bus.wire.filter((e) => e.channel !== 'conversation:inbox')
    expect(offInbox.length).toBeGreaterThan(5)
    for (const e of offInbox) {
      expect(e.scope, e.channel).toBeUndefined()
      expect(JSON.stringify(e.payload)).not.toContain('"prev":')
    }
    expect(visitorStream.frames().map((f) => f.event)).toEqual(
      expect.arrayContaining(['read', 'message', 'typing', 'conversation'])
    )
    // Every inbox publish carried one.
    for (const e of bus.wire.filter((x) => x.channel === 'conversation:inbox')) {
      expect(e.scope).toBeDefined()
    }
  })
})
