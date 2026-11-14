/**
 * The world the real-DB conversation visibility matrices run in: a scoped
 * teammate in team X, a visitor, and conversations on either team or none.
 * Import it after mocking `@/lib/server/db` onto the test database.
 */
import {
  createId,
  type ConversationId,
  type ConversationMessageId,
  type PrincipalId,
  type TeamId,
  type UserId,
} from '@quackback/ids'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  conversationMessages,
  conversations,
  eq,
  principal,
  settings,
  teamMembers,
  teams,
  user,
  PERMISSIONS,
  type PermissionKey,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'

export const suffix = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

export const NOT_FOUND = { code: 'CONVERSATION_NOT_FOUND', statusCode: 404 }
export const MESSAGE_NOT_FOUND = { code: 'MESSAGE_NOT_FOUND', statusCode: 404 }

/** A teammate whose conversation and ticket keys follow their teams. */
export const SCOPED_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.CONVERSATION_NOTE,
  PERMISSIONS.CONVERSATION_SET_STATUS,
  PERMISSIONS.CONVERSATION_ASSIGN,
  PERMISSIONS.CONVERSATION_MANAGE,
  PERMISSIONS.CONVERSATION_SET_TAGS,
  PERMISSIONS.CONVERSATION_MANAGE_TAGS,
  PERMISSIONS.CONVERSATION_SET_ATTRIBUTES,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.TICKET_REPLY,
  PERMISSIONS.TICKET_CREATE,
  PERMISSIONS.POST_CREATE,
  PERMISSIONS.ROUTING_MANAGE,
]

/** A workspace-wide service actor (a workspace API key). */
export const workspaceKey: Actor = {
  principalId: null,
  role: 'admin',
  principalType: 'service',
  segmentIds: new Set(),
  permissions: new Set(SCOPED_PERMISSIONS),
}

export async function seedPerson(role: 'member' | 'user'): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: `P-${suffix()}`, email: `p-${suffix()}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role, type: 'user', createdAt: new Date() })
  return principalId
}

/**
 * A scoped teammate in team X, a visitor, and a `conversation(team)` maker.
 * Each conversation has one visitor message; with `withOwnReply` it also has
 * one reply by the teammate.
 */
export async function seedWorld({ withOwnReply = false }: { withOwnReply?: boolean } = {}) {
  await testDb
    .insert(settings)
    .values({ name: 'Acme', slug: `acme-${suffix()}`, createdAt: new Date() })
  const teammate = await seedPerson('member')
  const visitor = await seedPerson('user')
  const teamX = createId('team') as TeamId
  const teamY = createId('team') as TeamId
  await testDb.insert(teams).values([
    { id: teamX, name: `X-${suffix()}` },
    { id: teamY, name: `Y-${suffix()}` },
  ])
  await testDb.insert(teamMembers).values({ teamId: teamX, principalId: teammate })

  async function conversation(
    team: TeamId | null,
    extra: Partial<typeof conversations.$inferInsert> = {}
  ) {
    const id = createId('conversation') as ConversationId
    await testDb.insert(conversations).values({
      id,
      visitorPrincipalId: visitor,
      channel: 'messenger',
      assignedTeamId: team,
      ...extra,
    })
    const [message] = await testDb
      .insert(conversationMessages)
      .values({
        conversationId: id,
        principalId: visitor,
        senderType: 'visitor',
        content: 'Acme cannot sign in',
      })
      .returning()
    let ownReplyId = null as unknown as ConversationMessageId
    if (withOwnReply) {
      const [reply] = await testDb
        .insert(conversationMessages)
        .values({
          conversationId: id,
          principalId: teammate,
          senderType: 'agent',
          content: 'Looking into it',
        })
        .returning()
      ownReplyId = reply.id as ConversationMessageId
    }
    return { id, messageId: message.id as ConversationMessageId, ownReplyId }
  }

  const actor: Actor = {
    principalId: teammate,
    role: 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(SCOPED_PERMISSIONS),
  }
  const author = { principalId: teammate, displayName: 'Ana', avatarUrl: null }
  return { teammate, visitor, teamX, teamY, conversation, actor, author }
}

export type World = Awaited<ReturnType<typeof seedWorld>>

export async function row(id: ConversationId) {
  const [found] = await testDb.select().from(conversations).where(eq(conversations.id, id))
  return found
}

export async function messagesOn(id: ConversationId) {
  return testDb
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, id))
}

export async function agentMessagesOn(id: ConversationId) {
  return (await messagesOn(id)).filter((m) => m.senderType === 'agent')
}
