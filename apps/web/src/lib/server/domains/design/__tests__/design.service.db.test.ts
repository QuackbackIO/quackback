/**
 * The design service keeps one draft and numbered, immutable published
 * revisions per site. Publishing refuses a draft started from a revision that
 * is no longer published, restore publishes an old document as a new
 * revision, and only the newest revisions are kept.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  auditLog,
  eq,
  portalDesignRevisions,
  portalDesigns,
  principal,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { defaultDesign } from '@/lib/shared/design/schema'
import {
  discardDraft,
  getDesignState,
  getPublishedDesign,
  publishDraft,
  publishStartingDesign,
  restoreRevision,
  REVISIONS_KEPT,
  saveDraft,
} from '../design.service'
import { EMPTY_REVISION } from '../draft-revision'
import { listRevisions, readRevision } from '../revisions'

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
  await testDb.insert(principal).values({
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

describe('a new workspace’s starting design', () => {
  it('publishes it as the first version, with no author', async () => {
    const doc = withAccent('#0F766E')
    doc.nav.home.on = true
    expect(await testDb.transaction((tx) => publishStartingDesign(tx, doc))).toBe(true)
    const state = await getDesignState()
    expect(state?.published?.number).toBe(1)
    expect(state?.published?.document.nav.home.on).toBe(true)
    const [row] = await testDb.select().from(portalDesignRevisions)
    expect(row).toMatchObject({ source: 'conversion', principalId: null })
  })

  it('leaves a workspace that already has a design alone', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    await publishDraft({ ...who, source: 'appearance' })
    expect(await testDb.transaction((tx) => publishStartingDesign(tx, defaultDesign()))).toBe(false)
    expect((await getPublishedDesign())?.brand.light.accent).toBe('#0f766e')
    expect(await listRevisions()).toHaveLength(1)
  })
})

describe('drafts', () => {
  it('saves a validated draft and leaves the published design alone', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const state = await getDesignState()
    expect(state?.draft?.brand.light.accent).toBe('#0f766e')
    expect(state?.published).toBeNull()
    expect(await getPublishedDesign()).toBeNull()
  })

  it('stores an id on every Home block', async () => {
    const who = await admin()
    const doc = withAccent('#0F766E')
    // Written before the grid, at widths, which read as places.
    doc.pages.home.blocks = [
      { type: 'composer', width: 'full' },
      { type: 'ideas', width: 'half', sort: 'trending', count: 3 },
    ] as never
    await saveDraft(doc, who)
    expect((await getDesignState())?.draft?.pages.home.blocks.map((b) => b.id)).toEqual([
      'composer001',
      'ideas001',
    ])
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

describe('the versions list', () => {
  it('names who published each version, and no one for one made by setup', async () => {
    await testDb.transaction((tx) => publishStartingDesign(tx, defaultDesign()))
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    await publishDraft({ ...who, source: 'appearance' })
    expect((await listRevisions()).map((r) => [r.number, r.publishedBy])).toEqual([
      [2, 'Admin'],
      [1, null],
    ])
  })
})

describe('publishing a draft with overrides whose part is gone', () => {
  it('drops them, keeping every override that still reaches something', async () => {
    const who = await admin()
    const doc = withAccent('#0F766E')
    doc.overrides = [
      {
        id: 'part:block.zzzzzzzz.heading:heading',
        target: { scope: 'part', part: 'block.zzzzzzzz.heading', element: 'heading' },
        style: { base: { size: 20 } },
      },
      {
        id: 'page:feedback:button',
        target: { scope: 'page', page: 'feedback', element: 'button' },
        style: { base: { radius: 6 } },
      },
    ]
    await saveDraft(doc, who)
    await publishDraft({ ...who, source: 'appearance' })
    expect((await getPublishedDesign())?.overrides?.map((o) => o.id)).toEqual([
      'page:feedback:button',
    ])
  })
})

describe('two people saving the same draft', () => {
  it('refuses a save made against a draft that has changed since', async () => {
    const who = await admin()
    const opened = (await getDesignState())?.revision ?? EMPTY_REVISION
    // A colleague saves first.
    await saveDraft(withAccent('#0F766E'), who, opened)
    await expect(saveDraft(withAccent('#7A1F35'), who, opened)).rejects.toMatchObject({
      code: 'REVISION_MISMATCH',
    })
    expect((await getDesignState())?.draft?.brand.light.accent).toBe('#0f766e')
  })

  it('accepts a chain of saves that each send the revision the last one returned', async () => {
    const who = await admin()
    let revision = (await getDesignState())?.revision ?? EMPTY_REVISION
    revision = await saveDraft(withAccent('#0F766E'), who, revision)
    revision = await saveDraft(withAccent('#7A1F35'), who, revision)
    expect((await getDesignState())?.revision).toBe(revision)
  })

  it('moves the revision on when the draft is published or discarded', async () => {
    const who = await admin()
    const saved = await saveDraft(withAccent('#0F766E'), who)
    await publishDraft({ ...who, source: 'appearance' })
    const published = (await getDesignState())!.revision
    expect(published).not.toBe(saved)
    await saveDraft(withAccent('#7A1F35'), who)
    await discardDraft()
    expect((await getDesignState())!.revision).toBe(published)
  })

  it('refuses a discard made against a draft that has changed since', async () => {
    const who = await admin()
    const opened = await saveDraft(withAccent('#0F766E'), who)
    // A colleague saves on top before the discard lands.
    await saveDraft(withAccent('#7A1F35'), who, opened)
    await expect(discardDraft(opened)).rejects.toMatchObject({ code: 'REVISION_MISMATCH' })
    expect((await getDesignState())?.draft?.brand.light.accent).toBe('#7a1f35')
  })

  it('discards the draft named by its revision, and moves the draft count on', async () => {
    const who = await admin()
    const saved = await saveDraft(withAccent('#0F766E'), who)
    const [before] = await testDb.select().from(portalDesigns)
    const next = await discardDraft(saved)
    const [after] = await testDb.select().from(portalDesigns)
    expect(after!.draft).toBeNull()
    expect(after!.draftVersion).toBe(before!.draftVersion + 1)
    expect(next).toBe((await getDesignState())!.revision)
  })

  it('refuses a stale save even when two saves land in the same millisecond', async () => {
    const who = await admin()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-01T12:00:00Z') })
    try {
      const first = await saveDraft(withAccent('#0F766E'), who)
      const second = await saveDraft(withAccent('#7A1F35'), who, first)
      expect(second).not.toBe(first)
      await expect(saveDraft(withAccent('#1D4ED8'), who, first)).rejects.toMatchObject({
        code: 'REVISION_MISMATCH',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the revision when a save changes nothing', async () => {
    const who = await admin()
    const saved = await saveDraft(withAccent('#0F766E'), who)
    await expect(saveDraft(withAccent('#0F766E'), who, saved)).resolves.toBe(saved)
  })

  it('leaves a save without a revision to the last writer, as the API sends it', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    await expect(saveDraft(withAccent('#7A1F35'), who)).resolves.toBeTypeOf('string')
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
    await saveDraft(withAccent('#7A1F35'), who)
    await publishDraft({ ...who, source: 'appearance' })
    await saveDraft(withAccent('#1D4ED8'), who)
    // The draft says it started from revision 1, though revision 2 is live.
    await testDb.update(portalDesigns).set({ draftBaseRevisionId: first.revisionId })
    await expect(publishDraft({ ...who, source: 'appearance' })).rejects.toMatchObject({
      code: 'DESIGN_CHANGED',
    })
  })

  it('publishes only the draft revision that was reviewed', async () => {
    const who = await admin()
    const reviewed = await saveDraft(withAccent('#0F766E'), who)
    await saveDraft(withAccent('#7A1F35'), who, reviewed)
    await expect(
      publishDraft({ ...who, source: 'appearance', expectedRevision: reviewed })
    ).rejects.toMatchObject({ code: 'REVISION_MISMATCH' })
    const now = (await getDesignState())!.revision
    await expect(
      publishDraft({ ...who, source: 'appearance', expectedRevision: now })
    ).resolves.toMatchObject({ number: 1 })
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

describe('a design saved by a newer build', () => {
  // What a newer build might write: a field this build lacks and an option it does not offer.
  const newer = (stored: unknown) => {
    const doc = structuredClone(stored) as ReturnType<typeof defaultDesign>
    return {
      ...doc,
      brand: { ...doc.brand, logo: { ...doc.brand.logo, display: 'banner', tagline: 'Hi' } },
      layout: { ...doc.layout, heroShape: 'panel' },
    }
  }

  it('still renders its brand after a rollback', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const first = await publishDraft({ ...who, source: 'appearance' })
    const [row] = await testDb
      .select({ document: portalDesignRevisions.document })
      .from(portalDesignRevisions)
      .where(eq(portalDesignRevisions.id, first.revisionId))
    await testDb
      .update(portalDesignRevisions)
      .set({ document: newer(row!.document) })
      .where(eq(portalDesignRevisions.id, first.revisionId))
    await testDb.update(portalDesigns).set({ draft: newer(withAccent('#7a1f35')) })

    expect((await getPublishedDesign())?.brand.light.accent).toBe('#0f766e')
    const state = await getDesignState()
    expect(state?.published?.document.brand.logo.display).toBe('mark_and_name')
    expect(state?.draft?.brand.light.accent).toBe('#7a1f35')
    // Writing it back would lose what this build does not know, so writes wait for the update.
    expect(state?.newerFormat).toBe(true)
    await expect(restoreRevision(first.revisionId, who)).rejects.toMatchObject({
      code: 'DESIGN_NEWER_FORMAT',
    })
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

  it('keeps a draft under way as it was, with its authors and the version it started from', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const teal = await publishDraft({ ...who, source: 'appearance' })
    await saveDraft(withAccent('#7A1F35'), who)
    const [before] = await testDb.select().from(portalDesigns)
    await restoreRevision(teal.revisionId, who)
    const [after] = await testDb.select().from(portalDesigns)
    expect(after!.draft).toEqual(before!.draft)
    expect(after!.draftAuthors).toEqual(before!.draftAuthors)
    expect(Object.keys(after!.draftAuthors ?? {})).not.toHaveLength(0)
    expect(after!.draftUpdatedAt).toEqual(before!.draftUpdatedAt)
    expect(after!.draftBaseRevisionId).toBe(before!.draftBaseRevisionId)
  })

  it('makes a draft kept through a rollback be reviewed against the restored version before it publishes', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const good = await publishDraft({ ...who, source: 'appearance' })
    // A broken version goes live, and the person keeps editing on top of it.
    await saveDraft(withAccent('#FF0000'), who)
    await publishDraft({ ...who, source: 'appearance' })
    const broken = withAccent('#FF0000')
    broken.layout.width = 'wide'
    await saveDraft(broken, who)
    // They roll back to the good version.
    const restored = await restoreRevision(good.revisionId, who)
    expect((await getPublishedDesign())?.brand.light.accent).toBe('#0f766e')

    // The draft still holds what was rolled back, so publishing it asks for a review first.
    await expect(publishDraft({ ...who, source: 'appearance' })).rejects.toMatchObject({
      code: 'DESIGN_CHANGED',
    })
    expect((await getPublishedDesign())?.brand.light.accent).toBe('#0f766e')
    // A review against a version that is no longer live does not count.
    await expect(
      publishDraft({ ...who, source: 'appearance', reviewedAgainst: good.revisionId })
    ).rejects.toMatchObject({ code: 'DESIGN_CHANGED' })

    // Reviewed against the restored version, it publishes.
    await expect(
      publishDraft({ ...who, source: 'appearance', reviewedAgainst: restored.revisionId })
    ).resolves.toMatchObject({ number: 4 })
    expect((await getPublishedDesign())?.layout.width).toBe('wide')
  })

  it('reads an old version to copy into the draft, and nothing for one that does not exist', async () => {
    const who = await admin()
    await saveDraft(withAccent('#0F766E'), who)
    const teal = await publishDraft({ ...who, source: 'appearance' })
    await saveDraft(withAccent('#7A1F35'), who)
    await publishDraft({ ...who, source: 'appearance' })
    const read = await readRevision(teal.revisionId)
    expect(read).toMatchObject({ number: 1, document: { brand: { light: { accent: '#0f766e' } } } })
    expect(await readRevision(createId('portal_design_revision'))).toBeNull()
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
