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
import { pruneEventsOutbox } from '../events-sweep'

/**
 * WO-20 — retention compactor prunes OLD PUBLISHED rows only; recent published
 * and any unpublished rows survive.
 */

async function seed(entityId: string, opts: { publishedAt: Date | null }): Promise<void> {
  await db.insert(events).values({
    eventId: createId('event'),
    type: 'post.created',
    entityType: 'post',
    entityId,
    actorType: 'user',
    payload: { postId: entityId },
    context: { depth: 0 },
    schemaVersion: 1,
    publishedAt: opts.publishedAt,
  })
}

describe('pruneEventsOutbox (WO-20)', () => {
  it('deletes published rows past the window but keeps recent + unpublished', async () => {
    const marker = createId('post')
    const oldPublished = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) // 100 days
    const recentPublished = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day

    await seed(marker, { publishedAt: oldPublished })
    await seed(marker, { publishedAt: recentPublished })
    await seed(marker, { publishedAt: null }) // never delivered — must survive

    const pruned = await pruneEventsOutbox(90)
    expect(pruned).toBeGreaterThanOrEqual(1)

    const remaining = await db.select().from(events).where(eq(events.entityId, marker))
    expect(remaining).toHaveLength(2)
    // The 100-day-old published row is gone; recent + unpublished remain.
    expect(remaining.some((r) => r.publishedAt === null)).toBe(true)
    expect(remaining.every((r) => r.publishedAt === null || r.publishedAt > oldPublished)).toBe(
      true
    )
  })

  it('never deletes an unpublished row regardless of age', async () => {
    const marker = createId('post')
    // occurredAt defaults to now, but even a very old unpublished row must stay;
    // publishedAt IS NULL is the only thing that matters.
    await seed(marker, { publishedAt: null })
    await pruneEventsOutbox(0) // aggressive: prune everything published
    const remaining = await db.select().from(events).where(eq(events.entityId, marker))
    expect(remaining).toHaveLength(1)
    expect(remaining[0].publishedAt).toBeNull()
  })
})
