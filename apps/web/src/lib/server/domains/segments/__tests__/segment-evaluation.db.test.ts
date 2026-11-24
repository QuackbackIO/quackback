/**
 * Real-DB coverage for dynamic segment evaluation: the rule SQL has to name
 * tables that exist, the diff has to read the rows other sources hold, and
 * evaluating every segment must survive one that fails. Runs inside the
 * db-test-fixture rollback transaction; each evaluation's own transaction
 * becomes a savepoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId, type BoardId, type PostId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  boards,
  eq,
  postComments,
  posts,
  postVotes,
  principal,
  segments,
  user,
  userSegments,
  type SegmentCondition,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

const sync = vi.hoisted(() => ({ failFor: null as string | null }))

// Outbound user-sync is out of scope here; it also gives a test a way to make
// one segment's evaluation fail.
vi.mock('@/lib/server/integrations/user-sync-notify', () => ({
  notifyUserSyncIntegrations: vi.fn(async (segmentName: string) => {
    if (segmentName === sync.failFor) throw new Error('relation "nowhere" does not exist')
  }),
}))

const log = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/lib/server/logger', () => {
  const noop = vi.fn()
  const child = () => ({ ...log, info: noop, warn: noop, debug: noop, trace: noop, child })
  return { logger: { ...log, info: noop, warn: noop, debug: noop, trace: noop, child } }
})

import { evaluateAllDynamicSegments, evaluateDynamicSegment } from '../segment.evaluation'
import { createSegment, updateSegment } from '../segment.service'
import type { SegmentId } from '@quackback/ids'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: segments.id }).from(segments).limit(0)
    await db.select({ id: userSegments.segmentId }).from(userSegments).limit(0)
    await db.select({ id: postVotes.id }).from(postVotes).limit(0)
    await db.select({ id: postComments.id }).from(postComments).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function seedPerson(marker: string): Promise<PrincipalId> {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb
    .insert(user)
    .values({ id: userId, name: 'Person', email: `${suffix()}-${marker}@example.com` })
  await testDb.insert(principal).values({
    id: principalId,
    userId,
    role: 'user',
    type: 'user',
    displayName: 'Person',
    createdAt: new Date(),
  })
  return principalId
}

async function seedPost(author: PrincipalId): Promise<PostId> {
  const boardId = createId('board') as BoardId
  await testDb.insert(boards).values({ id: boardId, slug: `seg-${suffix()}`, name: 'Board' })
  const postId = createId('post') as PostId
  await testDb
    .insert(posts)
    .values({ id: postId, boardId, title: 'Idea', content: 'Idea', principalId: author })
  return postId
}

function dynamic(name: string, marker: string, extra: SegmentCondition[] = []) {
  return createSegment({
    name,
    type: 'dynamic',
    rules: {
      match: 'all',
      conditions: [{ attribute: 'email', operator: 'contains', value: marker }, ...extra],
    },
  })
}

async function members(segmentId: SegmentId) {
  return testDb
    .select({ principalId: userSegments.principalId, addedBy: userSegments.addedBy })
    .from(userSegments)
    .where(eq(userSegments.segmentId, segmentId))
}

describe.skipIf(!fixture.available)('dynamic segment evaluation (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    sync.failFor = null
    log.error.mockClear()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('vote_count and comment_count rules count post_votes and live post_comments', async () => {
    const marker = suffix()
    const active = await seedPerson(marker)
    const deletedOnly = await seedPerson(marker)
    await seedPerson(marker) // no activity at all
    const postId = await seedPost(active)
    await testDb.insert(postVotes).values({ postId, principalId: active })
    await testDb.insert(postComments).values([
      { postId, principalId: active, content: 'hello' },
      { postId, principalId: deletedOnly, content: 'gone', deletedAt: new Date() },
    ])

    for (const attribute of ['vote_count', 'comment_count'] as const) {
      const seg = await dynamic(`${attribute} ${marker}`, marker, [
        { attribute, operator: 'gte', value: 1 },
      ])
      await expect(evaluateDynamicSegment(seg.id)).resolves.toMatchObject({ added: 1 })
      expect((await members(seg.id)).map((m) => m.principalId)).toEqual([active])

      const none = await dynamic(`no ${attribute} ${marker}`, marker, [
        { attribute, operator: 'is_not_set' },
      ])
      await evaluateDynamicSegment(none.id)
      // The idle person and the one whose only comment is deleted.
      expect((await members(none.id)).length, `${attribute} is_not_set`).toBe(2)
    }
  })

  it('does not report a matching person held by another source as added', async () => {
    const marker = suffix()
    const held = await seedPerson(marker)
    const fresh = await seedPerson(marker)
    const seg = await dynamic(`Held ${marker}`, marker)
    await testDb
      .insert(userSegments)
      .values({ principalId: held, segmentId: seg.id, addedBy: 'api' })

    await expect(evaluateDynamicSegment(seg.id)).resolves.toEqual({
      segmentId: seg.id,
      added: 1,
      removed: 0,
    })
    await expect(evaluateDynamicSegment(seg.id)).resolves.toEqual({
      segmentId: seg.id,
      added: 0,
      removed: 0,
    })
    const rows = await members(seg.id)
    expect(rows).toEqual(
      expect.arrayContaining([
        { principalId: held, addedBy: 'api' },
        { principalId: fresh, addedBy: 'dynamic' },
      ])
    )
    expect(rows).toHaveLength(2)
  })

  it('evaluates every dynamic segment even when one fails, and reports the failure', async () => {
    const marker = suffix()
    const person = await seedPerson(marker)
    const broken = await dynamic(`Broken ${marker}`, marker)
    const fine = await dynamic(`Fine ${marker}`, marker)
    sync.failFor = broken.name

    const results = await evaluateAllDynamicSegments()

    expect(results.find((r) => r.segmentId === fine.id)).toEqual({
      segmentId: fine.id,
      added: 1,
      removed: 0,
    })
    expect(results.find((r) => r.segmentId === broken.id)).toEqual({
      segmentId: broken.id,
      error: 'Evaluation failed',
    })
    expect(await members(fine.id)).toEqual([{ principalId: person, addedBy: 'dynamic' }])
    expect(await members(broken.id)).toEqual([])
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ segment_id: broken.id }),
      expect.any(String)
    )
  })

  it("refuses to clear a dynamic segment's rules, and keeps its members", async () => {
    const marker = suffix()
    const person = await seedPerson(marker)
    const seg = await dynamic(`Clear ${marker}`, marker)
    await evaluateDynamicSegment(seg.id)

    await expect(updateSegment(seg.id, { rules: null })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(
      updateSegment(seg.id, { rules: { match: 'all', conditions: [] } })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await evaluateDynamicSegment(seg.id)
    expect(await members(seg.id)).toEqual([{ principalId: person, addedBy: 'dynamic' }])
    const [row] = await testDb
      .select({ rules: segments.rules })
      .from(segments)
      .where(eq(segments.id, seg.id))
    expect(row.rules?.conditions).toHaveLength(1)
  })

  it('still lets a manual segment carry no rules', async () => {
    const seg = await createSegment({ name: `Manual ${suffix()}`, type: 'manual' })
    await expect(updateSegment(seg.id, { rules: null })).resolves.toMatchObject({ rules: null })
  })

  describe('evaluation schedule', () => {
    const scheduled = (name: string, pattern: string) =>
      createSegment({
        name,
        type: 'dynamic',
        rules: { match: 'all', conditions: [{ attribute: 'email', operator: 'eq', value: 'a' }] },
        evaluationSchedule: { enabled: true, pattern },
      })

    it.each(['0 * * * *', '*/15 9-17 * * 1-5', '0 0 1,15 * *'])('accepts %s', async (pattern) => {
      await expect(scheduled(`Ok ${suffix()}`, pattern)).resolves.toMatchObject({
        evaluationSchedule: { enabled: true, pattern },
      })
    })

    it.each(['99 99 * * *', '0 0 32 * *', '0 0 * 13 *', '0 0 * * * *', 'every hour'])(
      'refuses %s, which the scheduler cannot parse, and saves nothing',
      async (pattern) => {
        const name = `Bad ${suffix()}`
        await expect(scheduled(name, pattern)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
          message: 'Must be a valid cron expression',
        })
        expect(
          await testDb.select({ id: segments.id }).from(segments).where(eq(segments.name, name))
        ).toEqual([])
      }
    )

    it('refuses an unparseable schedule on update and keeps the old one', async () => {
      const seg = await scheduled(`Upd ${suffix()}`, '0 * * * *')
      await expect(
        updateSegment(seg.id, { evaluationSchedule: { enabled: true, pattern: '99 99 * * *' } })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      const [row] = await testDb
        .select({ schedule: segments.evaluationSchedule })
        .from(segments)
        .where(eq(segments.id, seg.id))
      expect(row.schedule).toEqual({ enabled: true, pattern: '0 * * * *' })
    })
  })
})
