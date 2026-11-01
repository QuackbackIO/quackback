/**
 * What the Appearance view calls. It edits the draft if there is one, else
 * the published design, else the workspace's branding converted on the spot.
 * Every refusal the view must explain comes back as a value, because a thrown
 * error reaches the browser as a bare message.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, settings, user } from '@/lib/server/db'

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
    brandingConfig: JSON.stringify({ themeMode: 'light', light: { primary: '#7a1f35' } }),
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

const teal = () => {
  const doc = defaultDesign()
  doc.brand.light.accent = '#0f766e'
  return doc
}

describe('readDesignForEditing', () => {
  it('starts from the branding settings when nothing is stored', async () => {
    const state = await actions.readDesignForEditing()
    expect(state.source).toBe('converted')
    expect(state.design.brand.light.accent).toBe('#7a1f35')
    expect(state.design.mode).toBe('light')
    expect(state.published).toBeNull()
    expect(state.report.errors).toEqual([])
  })

  it('edits the draft over the published design', async () => {
    const who = await author()
    await actions.saveDesignDraft(teal(), who)
    expect(await actions.readDesignForEditing()).toMatchObject({ source: 'draft' })
    await actions.publishDesign({ ...who, source: 'appearance' })
    const state = await actions.readDesignForEditing()
    expect(state).toMatchObject({ source: 'published', published: { number: 1 } })
    expect(state.design.brand.light.accent).toBe('#0f766e')
    expect(state.live).toEqual(state.design)
    await actions.saveDesignDraft(defaultDesign(), who)
    const drafted = await actions.readDesignForEditing()
    expect(drafted.live.brand.light.accent).toBe('#0f766e')
    expect(drafted.design.brand.light.accent).not.toBe('#0f766e')
  })
})

describe('saveDesignDraft', () => {
  it('returns the contrast report with the saved draft', async () => {
    const who = await author()
    const doc = teal()
    doc.brand.light.accent = '#facc15'
    const result = await actions.saveDesignDraft(doc, who)
    expect(result.ok).toBe(true)
    expect(result.ok && result.report.adjustments.length).toBeGreaterThan(0)
  })

  it('returns a refusal for an unreadable design', async () => {
    const who = await author()
    const doc = defaultDesign()
    doc.brand.light.ink = '#fefefe'
    expect(await actions.saveDesignDraft(doc, who)).toMatchObject({
      ok: false,
      code: 'UNREADABLE_DESIGN',
    })
  })
})

describe('patchDesignDraft', () => {
  it('merges a patch onto the design being edited and saves it as the draft', async () => {
    const who = await author()
    const before = await actions.readDesignForEditing()
    const result = await actions.patchDesignDraft(
      { layout: { density: 'compact' } },
      who,
      before.revision
    )
    expect(result.ok).toBe(true)
    const after = await actions.readDesignForEditing()
    expect(after.source).toBe('draft')
    expect(after.design.layout.density).toBe('compact')
    // The rest came from the converted branding.
    expect(after.design.brand.light.accent).toBe('#7a1f35')
    expect(after.revision).not.toBe(before.revision)
  })

  it('refuses a patch made against an older revision', async () => {
    const who = await author()
    const before = await actions.readDesignForEditing()
    await actions.patchDesignDraft({ layout: { density: 'compact' } }, who, before.revision)
    expect(
      await actions.patchDesignDraft({ layout: { width: 'wide' } }, who, before.revision)
    ).toMatchObject({ ok: false, code: 'REVISION_MISMATCH' })
  })

  it('refuses a patch that breaks the design', async () => {
    const who = await author()
    expect(await actions.patchDesignDraft({ layout: { density: 'roomy' } }, who)).toMatchObject({
      ok: false,
      code: 'INVALID_DESIGN',
    })
  })
})

describe('publishDesign and restoreDesign', () => {
  it('returns a refusal when there is nothing to publish', async () => {
    const who = await author()
    expect(await actions.publishDesign({ ...who, source: 'appearance' })).toMatchObject({
      ok: false,
      code: 'NO_DRAFT',
    })
  })

  it('returns a refusal for a draft another publish overtook', async () => {
    const who = await author()
    await actions.saveDesignDraft(teal(), who)
    const first = await actions.publishDesign({ ...who, source: 'appearance' })
    if (!first.ok) throw new Error('expected a publish')
    await actions.saveDesignDraft(defaultDesign(), who)
    await actions.restoreDesign(first.revisionId, who)
    expect(await actions.publishDesign({ ...who, source: 'appearance' })).toMatchObject({
      ok: false,
      code: 'DESIGN_CHANGED',
    })
  })

  it('lists versions newest first', async () => {
    const who = await author()
    await actions.saveDesignDraft(teal(), who)
    await actions.publishDesign({ ...who, source: 'appearance', message: 'Teal' })
    const versions = await actions.listDesignVersions()
    expect(versions.map((v) => [v.number, v.message])).toEqual([[1, 'Teal']])
  })

  it('returns a refusal for a version that does not exist', async () => {
    const who = await author()
    expect(await actions.restoreDesign(createId('portal_design_revision'), who)).toMatchObject({
      ok: false,
      code: 'REVISION_NOT_FOUND',
    })
  })
})
