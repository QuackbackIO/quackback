/**
 * Checkpoints and looks hold the draft as it was when saved, whatever changes
 * after. A workspace keeps a few looks and refuses another; old checkpoints
 * make way for new ones.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { eq, portalDesignSaved, principal, settings, user } from '@/lib/server/db'
import { defaultDesign } from '@/lib/shared/design/schema'
import { SAVED_LOOKS_MAX } from '@/lib/shared/design/looks'

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

const { CHECKPOINTS_KEPT, deleteSaved, listSaved, readCheckpoint, saveDesign } =
  await import('../saved')

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
    featureFlags: JSON.stringify({ portalDesignV2: true }),
    setupState: JSON.stringify({ version: 2, steps: { core: true, workspace: true }, goals: [] }),
  })
})
afterEach(async () => {
  await fixture.rollback()
})
afterAll(fixture.close)

async function admin() {
  const userId = createId('user') as UserId
  const principalId = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` })
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

let design = defaultDesign()

async function kept(
  kind: 'checkpoint' | 'look',
  name: string,
  author: Awaited<ReturnType<typeof admin>>
) {
  const result = await saveDesign(kind, name, design, author)
  if (!result.ok) throw new Error(result.message)
  return result.entry
}

describe('checkpoints', () => {
  it('hold the design as it was when saved, whatever changes after', async () => {
    const author = await admin()
    design = withAccent('#0f766e')
    const entry = await kept('checkpoint', 'Before the band', author)
    design = withAccent('#7a1f35')

    const read = await readCheckpoint(entry.id)
    expect(read.ok && read.design.brand.light.accent).toBe('#0f766e')
    expect(read.ok && read.name).toBe('Before the band')
    const { checkpoints, looks } = await listSaved()
    expect(checkpoints.map((each) => [each.name, each.createdBy])).toEqual([
      ['Before the band', 'Ada'],
    ])
    expect(looks).toEqual([])
  })

  it('make way for new ones once there are as many as are kept', async () => {
    const author = await admin()
    design = withAccent('#0f766e')
    const first = await kept('checkpoint', 'First', author)
    for (let i = 1; i <= CHECKPOINTS_KEPT; i++) await kept('checkpoint', `Next ${i}`, author)
    const { checkpoints } = await listSaved()
    expect(checkpoints).toHaveLength(CHECKPOINTS_KEPT)
    expect(checkpoints.some((each) => each.id === first.id)).toBe(false)
  })

  it('are not read as looks, and go when deleted', async () => {
    const author = await admin()
    design = withAccent('#0f766e')
    const look = await kept('look', 'Teal', author)
    expect(await readCheckpoint(look.id)).toMatchObject({ ok: false, code: 'SAVED_NOT_FOUND' })
    expect(await deleteSaved(look.id)).toEqual({ ok: true })
    expect(await deleteSaved(look.id)).toMatchObject({ ok: false, code: 'SAVED_NOT_FOUND' })
    expect(
      await testDb.select().from(portalDesignSaved).where(eq(portalDesignSaved.id, look.id))
    ).toEqual([])
  })
})

it('refuses a document that is not a design', async () => {
  expect(await saveDesign('checkpoint', 'Broken', { version: 2 }, await admin())).toMatchObject({
    ok: false,
    code: 'INVALID_DESIGN',
  })
})

describe('looks', () => {
  it('come with what they set, and a workspace keeps only a few', async () => {
    const author = await admin()
    design = withAccent('#0f766e')
    for (let i = 0; i < SAVED_LOOKS_MAX; i++) await kept('look', `Look ${i}`, author)
    expect(await saveDesign('look', 'One more', design, author)).toMatchObject({
      ok: false,
      code: 'SAVED_LOOK_LIMIT',
    })
    // Checkpoints are counted on their own.
    expect((await saveDesign('checkpoint', 'Still fine', design, author)).ok).toBe(true)
    const { looks } = await listSaved()
    expect(looks).toHaveLength(SAVED_LOOKS_MAX)
    expect(looks[0]!.look.brand.light.accent).toBe('#0f766e')
  })
})
