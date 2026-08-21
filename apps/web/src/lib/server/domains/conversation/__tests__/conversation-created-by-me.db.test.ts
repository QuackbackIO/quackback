/**
 * Real-Postgres proof of the "Created by me" inbox view: the
 * `startedByPrincipalId` list filter surfaces exactly the conversations whose
 * FIRST message was agent-authored by that principal — an agent who merely
 * replied later is not the starter, and one teammate's view never lists
 * another's threads.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  createId,
  type ConversationId,
  type ConversationMessageId,
  type PrincipalId,
  type UserId,
} from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

import {
  db,
  conversations,
  conversationMessages,
  principal,
  user,
  inArray,
  sql,
} from '@/lib/server/db'
import { listConversationsForAgent } from '../conversation.query'

let available = false
try {
  await db.execute(sql`select 1`)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
}

let agentA: PrincipalId | null = null
let agentB: PrincipalId | null = null
let visitorId: PrincipalId | null = null
let userIds: UserId[] = []
let seededIds: ConversationId[] = []

function agentActor(id: PrincipalId | null): Actor {
  return {
    principalId: id,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
  }
}

async function seedMessage(
  conversationId: ConversationId,
  authorId: PrincipalId,
  senderType: 'agent' | 'visitor',
  createdAt: Date
) {
  await db.insert(conversationMessages).values({
    id: createId('conversation_message') as ConversationMessageId,
    conversationId,
    principalId: authorId,
    senderType,
    content: 'seed',
    createdAt,
  })
}

const T0 = new Date('2026-01-01T00:00:00Z')
const T1 = new Date('2026-01-01T01:00:00Z')

async function seedFixtures() {
  const ua = createId('user') as UserId
  const ub = createId('user') as UserId
  const uv = createId('user') as UserId
  userIds = [ua, ub, uv]
  agentA = createId('principal') as PrincipalId
  agentB = createId('principal') as PrincipalId
  visitorId = createId('principal') as PrincipalId
  await db.insert(user).values([
    { id: ua, name: 'Agent A' },
    { id: ub, name: 'Agent B' },
    { id: uv, name: 'Visitor' },
  ])
  await db.insert(principal).values([
    { id: agentA, userId: ua, role: 'admin', type: 'user', createdAt: new Date() },
    { id: agentB, userId: ub, role: 'admin', type: 'user', createdAt: new Date() },
    { id: visitorId, userId: uv, role: 'user', type: 'user', createdAt: new Date() },
  ])

  // Started by agent A (agent-composed opener), visitor replied later.
  const convStartedByA = createId('conversation') as ConversationId
  // Visitor-started; agent A only replied — NOT "created by" A.
  const convVisitorStarted = createId('conversation') as ConversationId
  // Started by agent B — invisible to A's "Created by me".
  const convStartedByB = createId('conversation') as ConversationId
  seededIds = [convStartedByA, convVisitorStarted, convStartedByB]
  await db.insert(conversations).values([
    { id: convStartedByA, visitorPrincipalId: visitorId, channel: 'messenger' },
    { id: convVisitorStarted, visitorPrincipalId: visitorId, channel: 'messenger' },
    { id: convStartedByB, visitorPrincipalId: visitorId, channel: 'messenger' },
  ])

  await seedMessage(convStartedByA, agentA, 'agent', T0)
  await seedMessage(convStartedByA, visitorId, 'visitor', T1)
  await seedMessage(convVisitorStarted, visitorId, 'visitor', T0)
  await seedMessage(convVisitorStarted, agentA, 'agent', T1)
  await seedMessage(convStartedByB, agentB, 'agent', T0)

  return { convStartedByA, convVisitorStarted, convStartedByB }
}

afterEach(async () => {
  if (!available) return
  if (seededIds.length > 0)
    await db.delete(conversations).where(inArray(conversations.id, seededIds))
  const principals = [agentA, agentB, visitorId].filter((p): p is PrincipalId => !!p)
  if (principals.length > 0) await db.delete(principal).where(inArray(principal.id, principals))
  if (userIds.length > 0) await db.delete(user).where(inArray(user.id, userIds))
  agentA = agentB = visitorId = null
  userIds = []
  seededIds = []
})

afterAll(async () => {
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client
  await client?.end?.()
})

describe.skipIf(!available)('created-by-me inbox filter', () => {
  it('lists exactly the conversations whose first message the agent authored', async () => {
    const { convStartedByA, convVisitorStarted, convStartedByB } = await seedFixtures()

    const page = await listConversationsForAgent(
      { startedByPrincipalId: agentA! },
      agentActor(agentA)
    )
    const ids = page.conversations.map((c) => c.id)

    expect(ids).toContain(convStartedByA)
    // Replying later does not make the agent the thread's starter.
    expect(ids).not.toContain(convVisitorStarted)
    // Another teammate's composed thread is not mine.
    expect(ids).not.toContain(convStartedByB)
  })

  it("one teammate's view does not list another's started threads", async () => {
    const { convStartedByA, convStartedByB } = await seedFixtures()

    const ids = (
      await listConversationsForAgent({ startedByPrincipalId: agentB! }, agentActor(agentB))
    ).conversations.map((c) => c.id)

    expect(ids).toContain(convStartedByB)
    expect(ids).not.toContain(convStartedByA)
  })
})
