/**
 * findBackfillCursor resolves the (createdAt, id) keyset anchor for SSE
 * reconnect backfill. The lookup must be scoped to the conversation the
 * caller is authorized for: a Last-Event-ID naming a message from another
 * conversation must resolve to no cursor, not shift the backfill window.
 * Same rule listMessages applies to its `before` cursor.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

// Rows the fake db serves; the where-predicate built from the mocked eq/and is
// evaluated against them so the test exercises filtering behavior, not just
// query shape.
const rows = [
  { id: 'msg_a', conversationId: 'conversation_A', createdAt: new Date('2026-06-01T10:00:00Z') },
  { id: 'msg_b', conversationId: 'conversation_B', createdAt: new Date('2026-06-01T11:00:00Z') },
]

type Cond = { col?: string; val?: unknown; all?: Cond[] }
const evalCond = (c: Cond, row: Record<string, unknown>): boolean =>
  c.all ? c.all.every((x) => evalCond(x, row)) : row[c.col!] === c.val

vi.mock('@/lib/server/db', () => {
  function makeChain() {
    let cond: Cond | null = null
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.from = () => chain
    chain.where = (c: Cond) => {
      cond = c
      return chain
    }
    chain.limit = () => chain
    chain.then = (resolve: (r: unknown[]) => unknown) =>
      resolve(rows.filter((r) => (cond ? evalCond(cond, r) : true)))
    return chain
  }
  return {
    db: { select: () => makeChain() },
    eq: (col: string, val: unknown) => ({ col, val }),
    and: (...all: Cond[]) => ({ all: all.filter(Boolean) }),
    or: (...c: unknown[]) => ({ or: c }),
    lt: () => ({}),
    gt: () => ({}),
    desc: () => ({}),
    asc: () => ({}),
    isNull: () => ({}),
    inArray: () => ({}),
    sql: Object.assign(() => ({}), { raw: () => ({}) }),
    conversationMessages: { id: 'id', conversationId: 'conversationId', createdAt: 'createdAt' },
    conversations: { id: 'id' },
    principal: { id: 'id' },
    user: { id: 'id' },
    conversationMessageReactions: {},
    conversationMessageMentions: {},
    conversationTagAssignments: {},
    tags: {},
  }
})

const { findBackfillCursor } = await import('../chat.query')

describe('findBackfillCursor', () => {
  it('returns the keyset anchor for a message in the conversation', async () => {
    const cursor = await findBackfillCursor('conversation_A' as ConversationId, 'msg_a')
    expect(cursor).toMatchObject({ id: 'msg_a' })
  })

  it('refuses a cursor message that belongs to another conversation', async () => {
    const cursor = await findBackfillCursor('conversation_A' as ConversationId, 'msg_b')
    expect(cursor).toBeNull()
  })

  it('returns null for an unknown message id', async () => {
    const cursor = await findBackfillCursor('conversation_A' as ConversationId, 'msg_nope')
    expect(cursor).toBeNull()
  })
})
