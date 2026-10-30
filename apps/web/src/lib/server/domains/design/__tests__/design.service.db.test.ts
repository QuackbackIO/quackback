/**
 * The design service keeps one draft and numbered, immutable published
 * revisions per site. Publishing refuses a draft started from a revision that
 * is no longer published, restore publishes an old document as a new
 * revision, and only the newest revisions are kept.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { auditLog, eq, portalDesignRevisions, principal, user } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { defaultDesign } from '@/lib/shared/design/schema'
import {
  discardDraft,
  getDesignState,
  getPublishedDesign,
  listRevisions,
  publishDraft,
  restoreRevision,
  REVISIONS_KEPT,
  saveDraft,
} from '../design.service'

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function admin() {
  const userId = createId('user') as UserId
  const id = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({
      id,
      userId,
      role: 'admin',
      type: 'user',
      displayName: 'Admin',
      createdAt: new Date(),
    })
  return {
    principalId: id,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
}

const withAccent = (accent: string) => {
  const doc = defaultDesign()
  doc.brand.light.accent = accent
  return doc
}

describe('drafts', () => {
  it('saves a validated draft and leaves the published design alone', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const state = await getDesignState()
    expect(state?.draft?.brand.light.accent).toBe('#0f766e')
    expect(state?.published).toBeNull()
    expect(await getPublishedDesign()).toBeNull()
  })

  it('refuses a document that is not a design', async () => {
    const who = await admin()
    await expect(saveDraft({ version: 2 }, who)).rejects.toMatchObject({ code: 'INVALID_DESIGN' })
  })

  it('refuses a design whose ink cannot be read', async () => {
    const who = await admin()
    const doc = defaultDesign()
    doc.brand.light.ink = '#fefefe'
    await expect(saveDraft(doc, who)).rejects.toMatchObject({ code: 'UNREADABLE_DESIGN' })
  })

  it('discards a draft', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    await discardDraft()
    expect((await getDesignState())?.draft).toBeNull()
  })
})

describe('publishing', () => {
  it('publishes the draft as revision 1, then 2', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const first = await publishDraft({ ...who, source: 'appearance' })
    expect(first.number).toBe(1)
    expect((await getPublishedDesign())?.brand.light.accent).toBe('#0f766e')
    expect((await getDesignState())?.draft).toBeNull()

    await saveDraft(withAccent('#7A1F35'), who)
    const second = await publishDraft({ ...who, source: 'ai', message: 'Burgundy' })
    expect(second.number).toBe(2)
    expect((await getPublishedDesign())?.brand.light.accent).toBe('#7a1f35')
    expect((await listRevisions()).map((r) => [r.number, r.source, r.message])).toEqual([
      [2, 'ai', 'Burgundy'],
      [1, 'appearance', null],
    ])
  })

  it('refuses when there is no draft', async () => {
    const who = await admin()
    await expect(publishDraft({ ...who, source: 'appearance' })).rejects.toMatchObject({
      code: 'NO_DRAFT',
    })
  })

  it('refuses a draft started before another publish', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const first = await publishDraft({ ...who, source: 'appearance' })
    await saveDraft(withAccent('#7A1F35'), who) // started from revision 1
    await restoreRevision(first.revisionId, who) // publishes revision 2 meanwhile
    await expect(publishDraft({ ...who, source: 'appearance' })).rejects.toMatchObject({
      code: 'DESIGN_CHANGED',
    })
  })

  it('records an audit row for each publish and restore', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const first = await publishDraft({ ...who, source: 'appearance' })
    await restoreRevision(first.revisionId, who)
    const rows = await testDb
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorUserId, who.actor.userId))
    expect(rows.map((r) => r.eventType).sort()).toEqual(['design.published', 'design.restored'])
  })
})

describe('restore', () => {
  it('publishes an old document as a new revision', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const teal = await publishDraft({ ...who, source: 'appearance' })
    await saveDraft(withAccent('#7A1F35'), who)
    await publishDraft({ ...who, source: 'appearance' })

    const restored = await restoreRevision(teal.revisionId, who)
    expect(restored.number).toBe(3)
    expect((await getPublishedDesign())?.brand.light.accent).toBe('#0f766e')
    expect((await listRevisions())[0]).toMatchObject({ number: 3, source: 'restore' })
  })

  it('refuses a revision that does not exist', async () => {
    const who = await admin()
    await expect(restoreRevision(createId('portal_design_revision'), who)).rejects.toMatchObject({
      code: 'REVISION_NOT_FOUND',
    })
  })
})

describe('retention', () => {
  it(`keeps the newest ${REVISIONS_KEPT} revisions`, async () => {
    const who = await admin()
    for (let i = 0; i < REVISIONS_KEPT + 2; i++) {
      await saveDraft(withAccent(i % 2 ? '#0F766E' : '#7A1F35'), who)
      await publishDraft({ ...who, source: 'api' })
    }
    const numbers = (
      await testDb.select({ number: portalDesignRevisions.number }).from(portalDesignRevisions)
    ).map((r) => r.number)
    expect(numbers).toHaveLength(REVISIONS_KEPT)
    expect(Math.min(...numbers)).toBe(3)
    expect(Math.max(...numbers)).toBe(REVISIONS_KEPT + 2)
  })
})
