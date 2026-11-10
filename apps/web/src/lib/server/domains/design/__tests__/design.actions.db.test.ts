/**
 * What the Appearance view calls. It edits the draft if there is one, else
 * the published design, else the workspace's branding converted on the spot.
 * Every refusal the view must explain comes back as a value, because a thrown
 * error reaches the browser as a bare message.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { portalDesigns, principal, settings, user } from '@/lib/server/db'

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

const named = vi.hoisted(() => ({ calls: 0 }))
vi.mock('../draft-author-names', async (original) => {
  const real = await original<typeof import('../draft-author-names')>()
  return {
    ...real,
    authorNames: async (...args: Parameters<typeof real.authorNames>) => {
      named.calls++
      return real.authorNames(...args)
    },
  }
})

const plan = vi.hoisted(() => ({ customCss: true }))
vi.mock('@/lib/server/domains/settings/tier-enforce', async () => {
  const { TierLimitError } = await import('@/lib/server/errors/tier-limit-error')
  return {
    assertTierFeature: async (feature: string, friendly: string) => {
      if (feature === 'customCss' && !plan.customCss)
        throw new TierLimitError({
          limit: 'features.customCss',
          message: `${friendly} is not available on your plan. Upgrade to enable it.`,
        })
    },
  }
})

const actions = await import('../design.actions')
const { draftWaiting } = await import('../revisions')
const { defaultDesign } = await import('@/lib/shared/design/schema')
const { applyDraftOps } = await import('../draft-ops')
const { newBlock } = await import('@/lib/shared/design/home')

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

async function author(name = 'Admin') {
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
    expect(state.waiting).toBe(0)
    await actions.saveDesignDraft(defaultDesign(), who)
    const drafted = await actions.readDesignForEditing()
    expect(drafted.live.brand.light.accent).toBe('#0f766e')
    expect(drafted.design.brand.light.accent).not.toBe('#0f766e')
    // The changes waiting are counted here, for Settings > Portal.
    expect(drafted.waiting).toBeGreaterThan(0)
  })

  it('says when the draft was last saved, and nothing without a draft', async () => {
    expect((await actions.readDesignForEditing()).draftSavedAt).toBeNull()
    const who = await author()
    const before = Date.now()
    await actions.saveDesignDraft(teal(), who)
    const saved = (await actions.readDesignForEditing()).draftSavedAt
    expect(new Date(saved!).getTime()).toBeGreaterThanOrEqual(before - 1000)
    await actions.publishDesign({ ...who, source: 'appearance' })
    expect((await actions.readDesignForEditing()).draftSavedAt).toBeNull()
  })
})

describe('readDraftForChange', () => {
  it('reads what a server change starts from, without looking up who made each change', async () => {
    const who = await author()
    expect((await actions.readDraftForChange()).design.brand.light.accent).toBe('#7a1f35')
    await actions.saveDesignDraft(teal(), who)
    const editing = await actions.readDesignForEditing()
    named.calls = 0
    const change = await actions.readDraftForChange()
    expect(change).toEqual({ design: editing.design, revision: editing.revision })
    expect(named.calls).toBe(0)
  })
})

describe('who changed what', () => {
  /** The design being edited, which visitors see until a change is made. */
  const editing = async () => (await actions.readDesignForEditing()).design

  it('names each change by who made it last, and Quackback AI by name', async () => {
    const who = await author()
    const doc = await editing()
    doc.brand.light.accent = '#0f766e'
    await actions.saveDesignDraft(doc, who)
    doc.layout.cards = 'raised'
    await actions.saveDesignDraft(doc, { ...who, via: 'ai' })
    const { authors } = await actions.readDesignForEditing()
    expect(authors).toEqual({ 'brand.light.accent': 'Admin', 'layout.cards': 'Quackback AI' })
  })

  it('forgets a change once it is put back, and everyone once the draft goes', async () => {
    const who = await author()
    const doc = await editing()
    const accent = doc.brand.light.accent
    doc.brand.light.accent = '#0f766e'
    await actions.saveDesignDraft(doc, who)
    doc.brand.light.accent = accent
    doc.layout.cards = 'list'
    await actions.saveDesignDraft(doc, who)
    expect((await actions.readDesignForEditing()).authors).toEqual({ 'layout.cards': 'Admin' })
    await actions.discardDesignDraft()
    expect((await actions.readDesignForEditing()).authors).toEqual({})
    const [row] = await testDb.select({ authors: portalDesigns.draftAuthors }).from(portalDesigns)
    expect(row!.authors).toBeNull()
  })
})

describe('a draft put back to what visitors see', () => {
  const editing = async () => (await actions.readDesignForEditing()).design

  it('is no draft once it matches the published design again', async () => {
    const who = await author()
    await actions.saveDesignDraft(teal(), who)
    await actions.publishDesign({ ...who, source: 'appearance' })
    const doc = await editing()
    doc.layout.cards = doc.layout.cards === 'list' ? 'raised' : 'list'
    await actions.saveDesignDraft(doc, who)
    expect(await draftWaiting()).toBe(true)
    await actions.saveDesignDraft(teal(), who)
    const state = await actions.readDesignForEditing()
    expect(state).toMatchObject({ source: 'published', draftSavedAt: null, authors: {} })
    expect(await draftWaiting()).toBe(false)
  })

  it('is no draft once it matches the branding it was converted from again', async () => {
    const who = await author()
    const doc = await editing()
    const accent = doc.brand.light.accent
    doc.brand.light.accent = '#0f766e'
    await actions.saveDesignDraft(doc, who)
    doc.brand.light.accent = accent
    await actions.saveDesignDraft(doc, who)
    expect(await actions.readDesignForEditing()).toMatchObject({
      source: 'converted',
      draftSavedAt: null,
    })
    expect(await draftWaiting()).toBe(false)
  })

  it('reads what visitors see before it holds the draft row, so a one-connection pool never waits on itself', async () => {
    const who = await author()
    let rowsWhenRead = -1
    const { saveDraft } = await import('../design.service')
    await saveDraft(teal(), who, undefined, async () => {
      rowsWhenRead = (await testDb.select().from(portalDesigns)).length
      return defaultDesign()
    })
    // Read before the save's transaction creates and locks the design row.
    expect(rowsWhenRead).toBe(0)
  })

  it('never starts a draft for a save that changes nothing', async () => {
    const who = await author()
    await actions.saveDesignDraft(await editing(), who)
    expect(await draftWaiting()).toBe(false)
  })

  it('takes the next save against the revision the put-back save returned', async () => {
    const who = await author()
    const doc = await editing()
    const accent = doc.brand.light.accent
    doc.brand.light.accent = '#0f766e'
    const first = await actions.saveDesignDraft(doc, who)
    doc.brand.light.accent = accent
    const back = await actions.saveDesignDraft(doc, who, first.ok ? first.revision : undefined)
    expect(back.ok).toBe(true)
    doc.brand.light.accent = '#1d4ed8'
    const again = await actions.saveDesignDraft(doc, who, back.ok ? back.revision : undefined)
    expect(again.ok).toBe(true)
    expect(await draftWaiting()).toBe(true)
  })
})

describe('the workspace’s own CSS', () => {
  beforeEach(() => {
    plan.customCss = true
  })

  it('refuses CSS that reaches past styling, saying where', async () => {
    const who = await author()
    const doc = defaultDesign()
    doc.css = 'body {\n  background: url(https://example.com/x.png);\n}'
    const result = await actions.saveDesignDraft(doc, who)
    expect(result).toMatchObject({ ok: false, code: 'INVALID_CSS' })
    expect(!result.ok && result.message).toMatch(/^Line 2: url\(https:\/\/example\.com/)
  })

  it('saves CSS with warnings in the report', async () => {
    const who = await author()
    const doc = defaultDesign()
    doc.css = '.portal-nav__item { font-weight: 700; }'
    const result = await actions.saveDesignDraft(doc, who)
    expect(result.ok && result.report.css).toEqual([
      expect.objectContaining({
        fix: expect.objectContaining({ replace: '[data-qb-part="nav-item"]' }),
      }),
    ])
  })

  it('asks the plan for new CSS, but keeps CSS already published and lets it go', async () => {
    const who = await author()
    const styled = defaultDesign()
    styled.css = '[data-qb-part="post-card"] { border-width: 2px; }'
    await actions.saveDesignDraft(styled, who)
    await actions.publishDesign({ ...who, source: 'appearance' })

    plan.customCss = false
    const accent = structuredClone(styled)
    accent.brand.light.accent = '#0f766e'
    expect(await actions.saveDesignDraft(accent, who)).toMatchObject({ ok: true })
    const changed = structuredClone(styled)
    changed.css = '[data-qb-part="post-card"] { border-width: 3px; }'
    expect(await actions.saveDesignDraft(changed, who)).toMatchObject({
      ok: false,
      code: 'TIER_LIMIT_EXCEEDED',
    })
    const removed = structuredClone(styled)
    delete removed.css
    expect(await actions.saveDesignDraft(removed, who)).toMatchObject({ ok: true })
  })
})

describe('restoring a version with its own CSS', () => {
  beforeEach(() => {
    plan.customCss = true
  })

  it('asks the plan, unless the CSS is what visitors see now', async () => {
    const who = await author()
    const styled = defaultDesign()
    styled.css = '[data-qb-part="post-card"] { border-width: 2px; }'
    await actions.saveDesignDraft(styled, who)
    const first = await actions.publishDesign({ ...who, source: 'appearance' })
    const plain = defaultDesign()
    plain.brand.light.accent = '#0f766e'
    await actions.saveDesignDraft(plain, who)
    const second = await actions.publishDesign({ ...who, source: 'appearance' })
    if (!first.ok || !second.ok) throw new Error('publish failed')

    plan.customCss = false
    expect(await actions.restoreDesign(first.revisionId, who)).toMatchObject({
      ok: false,
      code: 'TIER_LIMIT_EXCEEDED',
    })
    // A version without CSS restores whatever the plan.
    expect(await actions.restoreDesign(second.revisionId, who)).toMatchObject({ ok: true })
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

  it('says who changed the draft, and when, as it refuses a stale save', async () => {
    const me = await author()
    const sam = await author('Sam')
    const opened = await actions.readDesignForEditing()
    await actions.saveDesignDraft(teal(), sam, opened.revision)
    const refused = await actions.saveDesignDraft(defaultDesign(), me, opened.revision)
    expect(refused).toMatchObject({
      ok: false,
      code: 'REVISION_MISMATCH',
      lastChange: { by: 'Sam', kind: 'saved' },
    })
    const at = Date.parse((refused as { lastChange: { at: string } }).lastChange.at)
    expect(Math.abs(Date.now() - at)).toBeLessThan(60_000)
    // Their own change in another tab names them as You.
    expect(await actions.saveDesignDraft(defaultDesign(), sam, opened.revision)).toMatchObject({
      lastChange: { by: 'You', kind: 'saved' },
    })
    // A publish since says so.
    const now = (await actions.readDesignForEditing()).revision
    await actions.publishDesign({ ...sam, source: 'appearance' })
    expect(await actions.saveDesignDraft(defaultDesign(), me, now)).toMatchObject({
      lastChange: { by: 'Sam', kind: 'published' },
    })
  })

  it('takes a patch written for format 2, with the hero keys named for the band', async () => {
    const who = await author()
    const result = await actions.patchDesignDraft(
      { layout: { band: 'brand', bandShape: 'inset', headerOnBand: true } },
      who
    )
    expect(result.ok).toBe(true)
    const { design } = await actions.readDesignForEditing()
    expect(design.version).toBe(3)
    expect(design.layout).toMatchObject({ hero: 'brand', heroShape: 'inset', headerOnHero: true })
    expect(design.layout).not.toHaveProperty('band')
  })

  it('takes a patch written before the format 2 tidies: one card look, Lift as a motion', async () => {
    const who = await author()
    const cards = await actions.patchDesignDraft({ style: { card: { base: { radius: 4 } } } }, who)
    expect(cards.ok).toBe(true)
    const lift = await actions.patchDesignDraft({ shape: { hover: 'lift' } }, who)
    expect(lift.ok).toBe(true)
    const { design } = await actions.readDesignForEditing()
    expect(design.style?.panel).toEqual({ base: { radius: 4 } })
    expect(design.style?.postCard).toMatchObject({ base: { radius: 4 }, hover: { lift: 2 } })
    expect(design.style?.button?.hover).toMatchObject({ lift: 2 })
    expect(design.style).not.toHaveProperty('card')
    expect(design.shape).not.toHaveProperty('hover')
  })

  it('refuses a patch that breaks the design', async () => {
    const who = await author()
    expect(await actions.patchDesignDraft({ layout: { density: 'roomy' } }, who)).toMatchObject({
      ok: false,
      code: 'INVALID_DESIGN',
    })
  })
})

describe('patchDesignDraft on arrays', () => {
  const ideas = (id: string, y = 0) => ({ ...newBlock('ideas', { x: 0, y }), id })

  it('refuses a patch that replaces Home blocks, overrides or the menu without replace', async () => {
    const who = await author()
    for (const patch of [
      { pages: { home: { blocks: [] } } },
      { overrides: [] },
      { nav: { items: null } },
    ]) {
      expect(await actions.patchDesignDraft(patch, who)).toMatchObject({
        ok: false,
        code: 'REPLACE_REQUIRED',
      })
    }
    expect((await actions.readDesignForEditing()).source).not.toBe('draft')
  })

  it('refuses Home blocks without their ids, even with replace', async () => {
    const who = await author()
    const { id: _id, ...noId } = ideas('blocka01')
    expect(
      await actions.patchDesignDraft({ pages: { home: { blocks: [noId] } } }, who, undefined, {
        replace: true,
      })
    ).toMatchObject({ ok: false, code: 'ID_REQUIRED' })
  })

  it('settles Home blocks a patch stacks on one another', async () => {
    const who = await author()
    const result = await actions.patchDesignDraft(
      { pages: { home: { blocks: [ideas('blockone1', 3), ideas('blocktwo1', 3)] } } },
      who,
      undefined,
      { replace: true }
    )
    expect(result.ok).toBe(true)
    const [one, two] = (await actions.readDesignForEditing()).design.pages.home.blocks
    expect(one.grid?.y).toBe(0)
    expect(two.grid?.y).toBe(one.grid!.y + one.grid!.h)
  })
})

describe('applyDraftOps', () => {
  const gates = {
    feedback: true,
    roadmap: true,
    changelog: true,
    help: true,
    support: true,
    status: true,
  }

  async function withTwoBlocks() {
    const who = await author()
    await actions.patchDesignDraft(
      {
        pages: {
          home: {
            blocks: [
              { ...newBlock('ideas', { x: 0, y: 0 }), id: 'blockone1' },
              { ...newBlock('updates', { x: 0, y: 20 }), id: 'blocktwo1' },
            ],
          },
        },
      },
      who,
      undefined,
      { replace: true }
    )
    return { who, revision: (await actions.readDesignForEditing()).revision }
  }

  it('changes one block and keeps the others, returning the new revision', async () => {
    const { who, revision } = await withTwoBlocks()
    const result = await applyDraftOps(
      [{ op: 'block.set', block: 'blockone1', key: 'count', value: 5 }],
      who,
      revision,
      gates
    )
    expect(result).toMatchObject({ ok: true, applied: [0], refused: [] })
    const after = await actions.readDesignForEditing()
    expect(after.revision).toBe((result as { revision: string }).revision)
    expect(after.revision).not.toBe(revision)
    const blocks = after.design.pages.home.blocks
    expect(blocks.map((b) => b.id)).toEqual(['blockone1', 'blocktwo1'])
    expect((blocks[0] as { count?: number }).count).toBe(5)
  })

  it('refuses one operation plainly and still applies the rest', async () => {
    const { who, revision } = await withTwoBlocks()
    const result = await applyDraftOps(
      [
        { op: 'block.set', block: 'gone', key: 'count', value: 5 },
        { op: 'block.set', block: 'blockone1', key: 'count', value: 999 },
        { op: 'block.remove', block: 'blocktwo1' },
      ],
      who,
      revision,
      gates
    )
    expect(result).toMatchObject({ ok: true, applied: [2] })
    const refused = (result as { refused: Array<{ index: number; reason: string }> }).refused
    expect(refused.map((r) => r.index)).toEqual([0, 1])
    expect(refused[0].reason).toBe('That block is no longer on Home')
    const blocks = (await actions.readDesignForEditing()).design.pages.home.blocks
    expect(blocks.map((b) => b.id)).toEqual(['blockone1'])
  })

  it('refuses a stale revision and saves nothing when every operation is refused', async () => {
    const { who, revision } = await withTwoBlocks()
    expect(
      await applyDraftOps([{ op: 'block.remove', block: 'blocktwo1' }], who, 'stale', gates)
    ).toMatchObject({ ok: false, code: 'REVISION_MISMATCH' })
    const none = await applyDraftOps([{ op: 'block.remove', block: 'x' }], who, revision, gates)
    expect(none).toMatchObject({ ok: true, applied: [], revision })
  })

  it('settles a Home grid the draft already holds overlapping', async () => {
    const who = await author()
    const stacked = defaultDesign()
    stacked.pages.home.blocks = [
      { ...newBlock('ideas', { x: 0, y: 2 }), id: 'blockone1' },
      { ...newBlock('updates', { x: 0, y: 2 }), id: 'blocktwo1' },
    ]
    // Saved as the builder saves, which leaves the grid as it is given.
    const saved = await actions.saveDesignDraft(stacked, who)
    expect(saved.ok).toBe(true)
    const revision = (saved as { revision: string }).revision
    const result = await applyDraftOps(
      [{ op: 'block.set', block: 'blockone1', key: 'count', value: 5 }],
      who,
      revision,
      gates
    )
    expect(result.ok).toBe(true)
    const [first, second] = (await actions.readDesignForEditing()).design.pages.home.blocks
    expect(first.grid!.y).toBe(0)
    expect(second.grid!.y).toBe(first.grid!.h)
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
    // The draft says it started before the version now live.
    await testDb.update(portalDesigns).set({ draftBaseRevisionId: null })
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
