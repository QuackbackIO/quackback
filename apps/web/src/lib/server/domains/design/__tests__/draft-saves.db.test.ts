/**
 * Automatic draft saves: before anything replaces unpublished work, the draft
 * as it was is kept, so it can be copied back in after a reload. They have
 * their own cap, so they never push out a checkpoint or a look.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  and,
  eq,
  portalDesignSaved,
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
const savedApi = await import('../saved')
const { DRAFT_SAVES_KEPT, DRAFT_SAVE_EVERY_MS, saveDraftAside } = await import('../draft-saves')
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

async function person(name: string) {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name, email: `${userId}@example.com` })
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

/** The automatic draft saves, newest first, with the stored draft each holds. */
async function draftSaves() {
  const rows = await testDb
    .select({
      name: portalDesignSaved.name,
      document: portalDesignSaved.document,
      createdAt: portalDesignSaved.createdAt,
    })
    .from(portalDesignSaved)
    .where(eq(portalDesignSaved.kind, 'auto'))
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

const accentOf = (document: unknown) =>
  (document as ReturnType<typeof defaultDesign>).brand.light.accent

async function storedDraft() {
  const [row] = await testDb.select({ draft: portalDesigns.draft }).from(portalDesigns)
  return row?.draft ?? null
}

/** Makes every automatic draft save old enough that another one is due. */
async function ageDraftSaves() {
  await testDb
    .update(portalDesignSaved)
    .set({ createdAt: new Date(Date.now() - DRAFT_SAVE_EVERY_MS - 1000) })
    .where(eq(portalDesignSaved.kind, 'auto'))
}

/** A draft that already has a recent automatic save, so only the write under test adds one. */
async function editing(who: Awaited<ReturnType<typeof person>>, accent = '#7A1F35') {
  await service.saveDraft(withAccent('#0F766E'), who)
  const first = await service.publishDraft({ ...who, source: 'appearance' })
  await service.saveDraft(withAccent(accent), who)
  const before = await draftSaves()
  // The first save over a draft with no saves yet takes one, so the timer is quiet now.
  await service.saveDraft(withAccent('#2244AA'), who)
  expect((await draftSaves()).length).toBe(before.length + 1)
  return { first, count: before.length + 1 }
}

describe('before a write replaces the draft', () => {
  it('saves it aside before a discard, credited to who saved it', async () => {
    const sam = await person('Sam Rivera')
    const { count } = await editing(sam)
    const draft = await storedDraft()
    await actions.discardDesignDraft()
    const saves = await draftSaves()
    expect(saves).toHaveLength(count + 1)
    expect(saves[0]).toMatchObject({ name: 'Before discard', document: draft })
    expect((await savedApi.listSaved()).drafts[0]).toMatchObject({
      name: 'Before discard',
      createdBy: 'Sam Rivera',
    })
  })

  it('saves it aside before a restore', async () => {
    const who = await person('Ada')
    const { first, count } = await editing(who)
    const draft = await storedDraft()
    await service.restoreRevision(first.revisionId, who)
    const saves = await draftSaves()
    expect(saves).toHaveLength(count + 1)
    expect(saves[0]).toMatchObject({ name: 'Before restore', document: draft })
  })

  it('saves theirs aside before Keep mine replaces it', async () => {
    const who = await person('Ada')
    const { count } = await editing(who)
    const theirs = await storedDraft()
    await actions.saveDesignDraft(withAccent('#111111'), who, undefined, 'keep-mine')
    const saves = await draftSaves()
    expect(saves).toHaveLength(count + 1)
    expect(saves[0]).toMatchObject({ name: 'Before Keep mine', document: theirs })
  })

  it('saves it aside before a brand match', async () => {
    const who = await person('Ada')
    const { count } = await editing(who)
    const draft = await storedDraft()
    await actions.saveDesignDraft(withAccent('#111111'), who, undefined, 'brand-match')
    expect(await draftSaves()).toHaveLength(count + 1)
    expect((await draftSaves())[0]).toMatchObject({ name: 'Before brand match', document: draft })
  })

  it('saves it aside before a large Quackback AI change, and not before a small one', async () => {
    const who = await person('Ada')
    const { count } = await editing(who)
    const ai = { ...who, via: 'ai' as const }
    await actions.saveDesignDraft(withAccent('#111111'), ai, undefined, 'ai')
    expect(await draftSaves()).toHaveLength(count)

    const draft = await storedDraft()
    const large = withAccent('#222222')
    large.mode = 'dark'
    large.layout.width = 'wide'
    large.layout.density = 'compact'
    large.shape.corners = 'sharp'
    large.brand.light.background = '#fffffe'
    await actions.saveDesignDraft(large, ai, undefined, 'ai')
    expect(await draftSaves()).toHaveLength(count + 1)
    expect((await draftSaves())[0]).toMatchObject({ name: 'Before Quackback AI', document: draft })
  })

  it('saves someone else’s draft aside before an API or MCP patch, and not the caller’s own', async () => {
    const sam = await person('Sam Rivera')
    const agent = await person('Key owner')
    const { count } = await editing(sam)
    const draft = await storedDraft()
    const { revision } = await actions.readDesignForEditing()
    expect(
      await actions.patchDesignDraft({ layout: { density: 'compact' } }, agent, revision)
    ).toMatchObject({ ok: true })
    expect(await draftSaves()).toHaveLength(count + 1)
    expect((await draftSaves())[0]).toMatchObject({
      name: 'Before an API change',
      document: draft,
    })

    // The draft is the caller's own now: their next patch saves nothing aside.
    const next = await actions.readDesignForEditing()
    await actions.patchDesignDraft({ layout: { width: 'wide' } }, agent, next.revision)
    expect(await draftSaves()).toHaveLength(count + 1)
  })

  it('saves it aside on the first save of an editing session', async () => {
    const who = await person('Ada')
    const { count } = await editing(who)
    const draft = await storedDraft()
    await actions.saveDesignDraft(withAccent('#111111'), who, undefined, 'session')
    expect((await draftSaves())[0]).toMatchObject({ name: 'Start of editing', document: draft })
    expect(await draftSaves()).toHaveLength(count + 1)
  })

  it('saves it aside when the last one is older than the interval, and not before', async () => {
    const who = await person('Ada')
    const { count } = await editing(who)
    await service.saveDraft(withAccent('#111111'), who)
    expect(await draftSaves()).toHaveLength(count)
    await ageDraftSaves()
    const draft = await storedDraft()
    await service.saveDraft(withAccent('#222222'), who)
    expect(await draftSaves()).toHaveLength(count + 1)
    expect((await draftSaves())[0]).toMatchObject({ name: 'While editing', document: draft })
  })

  it('saves nothing aside without a draft', async () => {
    const who = await person('Ada')
    await service.saveDraft(withAccent('#0F766E'), who, undefined, undefined, 'session')
    await service.publishDraft({ ...who, source: 'appearance' })
    await service.discardDraft()
    expect(await draftSaves()).toHaveLength(0)
  })
})

describe('the builder saving the draft aside', () => {
  it('saves the stored draft before Copy into draft, and the person’s own draft before Load their changes', async () => {
    const who = await person('Ada')
    const { count } = await editing(who)
    const draft = await storedDraft()
    expect(await savedApi.saveDraftAsideNow('copy', who)).toEqual({ ok: true, saved: true })
    expect((await draftSaves())[0]).toMatchObject({
      name: 'Before Copy into draft',
      document: draft,
    })
    const mine = withAccent('#333333')
    await savedApi.saveDraftAsideNow('load-theirs', who, mine)
    const saves = await draftSaves()
    expect(saves).toHaveLength(count + 2)
    expect(saves[0]!.name).toBe('Before Load their changes')
    expect(accentOf(saves[0]!.document)).toBe('#333333')
  })

  it('reads one back to copy into the draft', async () => {
    const who = await person('Ada')
    await editing(who, '#7A1F35')
    await actions.discardDesignDraft()
    const [entry] = (await savedApi.listSaved()).drafts
    const read = await savedApi.readCheckpoint(entry!.id)
    expect(read).toMatchObject({ ok: true, name: 'Before discard' })
    if (read.ok) expect(read.design.brand.light.accent).toBe('#2244aa')
  })
})

describe('keeping draft saves', () => {
  it(`keeps the newest ${DRAFT_SAVES_KEPT}, skips one the same as the newest, and never touches checkpoints or looks`, async () => {
    const who = await person('Ada')
    await service.saveDraft(withAccent('#0F766E'), who)
    await savedApi.saveDesign('checkpoint', 'Mine', withAccent('#0F766E'), who)
    await savedApi.saveDesign('look', 'Teal', withAccent('#0F766E'), who)
    const [row] = await testDb.select().from(portalDesigns)
    await testDb.delete(portalDesignSaved).where(eq(portalDesignSaved.kind, 'auto'))
    for (let i = 0; i < DRAFT_SAVES_KEPT + 5; i++) {
      const document = withAccent(`#0000${(i + 16).toString(16).padStart(2, '0')}`)
      await testDb.transaction((tx) => saveDraftAside(tx, row!, 'timer', who.principalId, document))
    }
    const same = withAccent('#000000')
    await testDb.transaction((tx) => saveDraftAside(tx, row!, 'timer', who.principalId, same))
    expect(
      await testDb.transaction((tx) => saveDraftAside(tx, row!, 'timer', who.principalId, same))
    ).toBe(false)
    expect(await draftSaves()).toHaveLength(DRAFT_SAVES_KEPT)
    const named = await testDb
      .select({ kind: portalDesignSaved.kind })
      .from(portalDesignSaved)
      .where(and(eq(portalDesignSaved.designId, row!.id)))
    expect(named.filter((one) => one.kind !== 'auto').map((one) => one.kind).sort()).toEqual([
      'checkpoint',
      'look',
    ])
  })
})
