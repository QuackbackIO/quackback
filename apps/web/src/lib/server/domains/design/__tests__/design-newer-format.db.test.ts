/**
 * A design a newer build saved, met by this build after a blind rollback. It
 * still renders through the tolerant read, but every write is refused with
 * DESIGN_NEWER_FORMAT, so nothing the newer build stored is stripped for good.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  portalDesignRevisions,
  portalDesigns,
  principal,
  settings,
  user,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/cache')>()),
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}))
vi.mock('@/lib/server/local-cache', async (original) => ({
  ...(await original<typeof import('@/lib/server/local-cache')>()),
  localCacheGet: () => undefined,
  localCacheSet: () => undefined,
}))

const actions = await import('../design.actions')
const service = await import('../design.service')
const { defaultDesign } = await import('@/lib/shared/design/schema')

const fixture = await createDbTestFixture()
beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  await testDb.delete(settings)
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${createId('workspace').slice(-8)}`,
    createdAt: new Date(),
  })
})
afterEach(fixture.rollback)
afterAll(fixture.close)

async function author() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Admin', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: principalId, userId, role: 'admin', type: 'user', createdAt: new Date() })
  return {
    principalId,
    actor: { userId, email: `${userId}@example.com`, role: 'admin', type: 'user' as const },
  }
}

const withAccent = (accent: string) => {
  const doc = defaultDesign()
  doc.brand.light.accent = accent
  return doc
}

type Stored = Record<string, unknown> & ReturnType<typeof defaultDesign>

/** Format 4, as a newer build might write it: a higher version and a section this build lacks. */
const formatFour = (doc: Stored) => ({ ...doc, version: 4, motionKit: { enter: 'rise' } })

/** Still format 3, with an optional field a newer build added. */
const unknownField = (doc: Stored) => ({
  ...doc,
  brand: { ...doc.brand, logo: { ...doc.brand.logo, tagline: 'Feedback that ships' } },
})

/** Everything stored for the design, raw, so a test can say nothing moved. */
async function rawStore() {
  const [row] = await testDb.select().from(portalDesigns)
  const revisions = await testDb
    .select({ id: portalDesignRevisions.id, document: portalDesignRevisions.document })
    .from(portalDesignRevisions)
    .orderBy(portalDesignRevisions.number)
  return {
    draft: row?.draft ?? null,
    draftVersion: row?.draftVersion,
    publishedRevisionId: row?.publishedRevisionId ?? null,
    revisions,
  }
}

/** A published teal design and a wine draft, with `newer` applied to the stored draft. */
async function newerDraft(newer: (doc: Stored) => unknown) {
  const who = await author()
  await service.saveDraft(withAccent('#0F766E'), who)
  const first = await service.publishDraft({ ...who, source: 'appearance' })
  await service.saveDraft(withAccent('#7A1F35'), who)
  const [row] = await testDb.select({ draft: portalDesigns.draft }).from(portalDesigns)
  await testDb.update(portalDesigns).set({ draft: newer(row!.draft as Stored) })
  return { who, first }
}

/** A published design, with `newer` applied to the stored revision, and no draft. */
async function newerPublished(newer: (doc: Stored) => unknown) {
  const who = await author()
  await service.saveDraft(withAccent('#0F766E'), who)
  const first = await service.publishDraft({ ...who, source: 'appearance' })
  const [row] = await testDb
    .select({ document: portalDesignRevisions.document })
    .from(portalDesignRevisions)
  await testDb
    .update(portalDesignRevisions)
    .set({ document: newer(row!.document as Stored) })
  return { who, first }
}

const REFUSED = { ok: false, code: 'DESIGN_NEWER_FORMAT' }

describe.each([
  ['a format 4 document', formatFour],
  ['a format 3 document with a field this build does not know', unknownField],
])('a draft saved by a newer build: %s', (_, newer) => {
  it('says so to the editor, and still shows what this build can read', async () => {
    await newerDraft(newer)
    expect((await service.getDesignState())?.newerFormat).toBe(true)
    const editor = await actions.readDesignForEditing()
    expect(editor.newerFormat).toBe(true)
    expect(editor.design.brand.light.accent).toBe('#7a1f35')
  })

  it('refuses a save, a patch, a discard, a publish and a restore, leaving the stored jsonb as it was', async () => {
    const { who, first } = await newerDraft(newer)
    const before = await rawStore()

    expect(await actions.saveDesignDraft(withAccent('#123456'), who)).toMatchObject(REFUSED)
    // The REST PATCH and the MCP update both patch the draft.
    const { revision } = await actions.readDesignForEditing()
    expect(
      await actions.patchDesignDraft({ layout: { density: 'compact' } }, who, revision)
    ).toMatchObject(REFUSED)
    // A save that puts the draft back to what visitors see would drop it.
    const live = (await service.getDesignState())!.published!.document
    expect(await actions.saveDesignDraft(live, who)).toMatchObject(REFUSED)
    // The REST DELETE discards the draft.
    expect(await actions.discardDesignDraft()).toMatchObject(REFUSED)
    expect(await actions.publishDesign({ ...who, source: 'appearance' })).toMatchObject(REFUSED)
    expect(await actions.restoreDesign(first.revisionId, who)).toMatchObject(REFUSED)

    expect(await rawStore()).toEqual(before)
  })
})

describe.each([
  ['a format 4 document', formatFour],
  ['a format 3 document with a field this build does not know', unknownField],
])('a published version saved by a newer build: %s', (_, newer) => {
  it('still renders for visitors', async () => {
    await newerPublished(newer)
    expect((await service.getPublishedDesign())?.brand.light.accent).toBe('#0f766e')
  })

  it('refuses the first save of a draft built on it, leaving the stored jsonb as it was', async () => {
    const { who, first } = await newerPublished(newer)
    expect((await actions.readDesignForEditing()).newerFormat).toBe(true)
    const before = await rawStore()
    expect(await actions.saveDesignDraft(withAccent('#7A1F35'), who)).toMatchObject(REFUSED)
    expect(await actions.restoreDesign(first.revisionId, who)).toMatchObject(REFUSED)
    expect(await rawStore()).toEqual(before)
  })
})

describe('a design this build wrote', () => {
  it('is not marked as newer, and saves as before', async () => {
    const who = await author()
    expect(await actions.saveDesignDraft(withAccent('#0F766E'), who)).toMatchObject({ ok: true })
    expect((await service.getDesignState())?.newerFormat).toBe(false)
    expect((await actions.readDesignForEditing()).newerFormat).toBe(false)
  })

  it('refuses restoring an old version a newer build saved', async () => {
    const who = await author()
    await service.saveDraft(withAccent('#0F766E'), who)
    const first = await service.publishDraft({ ...who, source: 'appearance' })
    await service.saveDraft(withAccent('#7A1F35'), who)
    await service.publishDraft({ ...who, source: 'appearance' })
    const [old] = await testDb
      .select({ document: portalDesignRevisions.document })
      .from(portalDesignRevisions)
      .where(eq(portalDesignRevisions.id, first.revisionId))
    await testDb
      .update(portalDesignRevisions)
      .set({ document: formatFour(old!.document as Stored) })
      .where(eq(portalDesignRevisions.id, first.revisionId))
    expect((await actions.readDesignForEditing()).newerFormat).toBe(false)
    const before = await rawStore()
    expect(await actions.restoreDesign(first.revisionId, who)).toMatchObject(REFUSED)
    expect(await rawStore()).toEqual(before)
  })
})
