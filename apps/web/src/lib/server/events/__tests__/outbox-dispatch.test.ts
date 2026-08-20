import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { createDb } = await import('@quackback/db/client')
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

import { db, events, eq } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import { writeEventToOutbox, extractEntityId } from '../outbox-dispatch'
import type { EventData } from '../types'

/**
 * WO-4 — the legacy dispatch bridge writes a real EventData to the outbox via
 * emit(), mapping type→catalogue def, actor, and the subject entity id.
 */

function postCreatedEvent(postId: string): EventData {
  return {
    id: createId('event'),
    type: 'post.created',
    timestamp: new Date().toISOString(),
    actor: { type: 'user', principalId: createId('principal') },
    data: {
      post: {
        id: postId,
        title: 'Hi',
        content: '',
        boardId: createId('board'),
        boardSlug: 'b',
        voteCount: 0,
      },
    },
  } as unknown as EventData
}

describe('writeEventToOutbox (WO-4 bridge)', () => {
  it('writes a post.created event to the outbox with the post id as entity', async () => {
    const postId = createId('post')
    const written = await writeEventToOutbox(postCreatedEvent(postId))
    expect(written).toBe(true)

    const rows = await db.select().from(events).where(eq(events.entityId, postId))
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('post.created')
    expect(rows[0].entityType).toBe('post')
    expect(rows[0].actorType).toBe('user')
    expect(rows[0].publishedAt).toBeNull()
  })

  it('returns false for a type with no catalogue entry (defensive, no throw)', async () => {
    const bogus = {
      ...postCreatedEvent(createId('post')),
      type: 'nope.not_real',
    } as unknown as EventData
    expect(await writeEventToOutbox(bogus)).toBe(false)
  })

  it('extractEntityId digs the subject id from varied data shapes', () => {
    const cid = createId('conversation')
    const conv = {
      id: createId('event'),
      type: 'assistant.handed_off',
      timestamp: '',
      actor: { type: 'service' },
      data: { conversationId: cid, reason: 'x' },
    } as unknown as EventData
    expect(extractEntityId(conv)).toBe(cid)

    const tid = createId('ticket')
    const tkt = {
      id: createId('event'),
      type: 'ticket.created',
      timestamp: '',
      actor: { type: 'service' },
      data: { ticket: { id: tid } },
    } as unknown as EventData
    expect(extractEntityId(tkt)).toBe(tid)
  })

  // Adjacent-systems fix: timer-driven events carry a caller-supplied
  // deterministic id so repeated sweep ticks over the same still-qualifying
  // condition dedupe. The outbox mints a fresh eventId per row, so without a
  // dedupe key a later tick would re-fire. writeEventToOutbox threads the
  // deterministic id into events.dedupeKey for timer types; the unique
  // events_dedupe_idx then collapses the repeat, and the second write is a
  // benign no-op (returns true, no throw).
  it('dedupes a repeated timer event by its deterministic id', async () => {
    const conversationId = createId('conversation')
    const timerId = `sb:${conversationId}:resolution`
    const event = {
      id: timerId,
      type: 'sla.breached',
      timestamp: new Date().toISOString(),
      actor: { type: 'service' },
      data: {
        conversationId,
        conversation: {
          id: conversationId,
          status: 'open',
          channel: 'messenger',
          priority: 'high',
        },
        clock: 'resolution',
        dueAt: new Date().toISOString(),
      },
    } as unknown as EventData

    expect(await writeEventToOutbox(event)).toBe(true)
    // Second tick over the same unbroken condition — same deterministic id.
    expect(await writeEventToOutbox(event)).toBe(true)

    const rows = await db.select().from(events).where(eq(events.dedupeKey, timerId))
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('sla.breached')
  })

  it('writes a non-timer event with a null dedupe key (index stays lean)', async () => {
    const postId = createId('post')
    await writeEventToOutbox(postCreatedEvent(postId))
    const rows = await db.select().from(events).where(eq(events.entityId, postId))
    expect(rows).toHaveLength(1)
    expect(rows[0].dedupeKey).toBeNull()
  })
})
