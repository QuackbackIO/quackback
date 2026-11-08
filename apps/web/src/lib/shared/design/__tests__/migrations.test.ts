import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '../schema'
import { DESIGN_MIGRATIONS, DESIGN_VERSION, migrateDesign, stepApplies } from '../migrations'

type Json = Record<string, unknown>

const stored = (): Json => structuredClone(defaultDesign()) as unknown as Json

/** One document per step, each holding only what that step rewrites. */
const BEFORE: Record<string, () => Json> = {
  'split-cards': () => ({
    ...stored(),
    style: { card: { base: { radius: 4 }, hover: { lift: 2 } } },
  }),
  'hover-lift': () => {
    const doc = stored()
    ;(doc.shape as Json).hover = 'lift'
    return doc
  },
  'drop-ring-colours': () => ({
    ...stored(),
    style: { button: { focus: { ring: 'accent', ringWidth: 3 } } },
    overrides: [
      {
        id: 'abcdefgh',
        target: { scope: 'page', page: 'home', element: 'input' },
        style: { focus: { ring: 'support' } },
      },
    ],
  }),
  'drop-retired-keys': () => ({
    ...stored(),
    vocabulary: { post: 'idea', board: 'board' },
    footer: { links: [] },
  }),
  'drop-logo-name-styles': () => {
    const doc = stored()
    Object.assign((doc.brand as Json).logo as Json, { nameColour: 'accent', nameCase: 'upper' })
    return doc
  },
}

/** What each step leaves, for the document above. */
const AFTER: Record<string, (doc: Json) => void> = {
  'split-cards': (doc) =>
    expect(doc.style).toEqual({
      postCard: { base: { radius: 4 }, hover: { lift: 2 } },
      panel: { base: { radius: 4 } },
    }),
  'hover-lift': (doc) => {
    expect(doc.shape).not.toHaveProperty('hover')
    expect((doc.style as Json).postCard).toEqual({ hover: { lift: 2, shadow: 'floating' } })
  },
  'drop-ring-colours': (doc) => {
    expect(doc.style).toEqual({ button: { focus: { ringWidth: 3 } } })
    expect(doc).not.toHaveProperty('overrides')
  },
  'drop-retired-keys': (doc) => {
    expect(doc).not.toHaveProperty('vocabulary')
    expect(doc).not.toHaveProperty('footer')
  },
  'drop-logo-name-styles': (doc) => {
    expect((doc.brand as Json).logo).not.toHaveProperty('nameColour')
    expect((doc.brand as Json).logo).not.toHaveProperty('nameCase')
  },
}

describe('design migrations', () => {
  it('names every step once, each with its own case here', () => {
    const names = DESIGN_MIGRATIONS.map((step) => step.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.sort()).toEqual(Object.keys(BEFORE).sort())
  })

  it('ends at the version the schema reads', () => {
    expect(defaultDesign().version).toBe(DESIGN_VERSION)
    const last = DESIGN_MIGRATIONS.reduce((at, step) => Math.max(at, step.to ?? step.version), 0)
    expect(last).toBe(DESIGN_VERSION)
  })

  describe.each(DESIGN_MIGRATIONS.map((step) => [step.name, step] as const))('%s', (name, step) => {
    it('rewrites what it is for into a design that parses', () => {
      const before = BEFORE[name]!()
      expect(portalDesign.safeParse(before).success).toBe(false)
      const after = step.up(before)
      AFTER[name]!(after)
      expect(portalDesign.safeParse(after).success).toBe(true)
    })

    it('never changes the document it is given', () => {
      const before = BEFORE[name]!()
      const copy = structuredClone(before)
      step.up(before)
      expect(before).toEqual(copy)
    })

    it('is the same once run twice', () => {
      const once = step.up(BEFORE[name]!())
      expect(step.up(once)).toEqual(once)
    })

    it('hands back the same document when it has nothing to do', () => {
      const doc = stored()
      expect(step.up(doc)).toBe(doc)
    })

    it('runs only on the versions it reads', () => {
      expect(stepApplies(step, step.version)).toBe(true)
      expect(stepApplies(step, step.version + 1)).toBe(false)
      const later = { ...BEFORE[name]!(), version: DESIGN_VERSION + 1 }
      expect(migrateDesign(later)).toBe(later)
    })
  })

  it('runs every step in order, once', () => {
    const doc: Json = { ...BEFORE['split-cards']!(), vocabulary: {} }
    ;(doc.shape as Json).hover = 'lift'
    const migrated = migrateDesign(doc) as Json
    // Lift lands on post cards the split made, keeping the card look's own hover.
    expect((migrated.style as Json).postCard).toEqual({
      base: { radius: 4 },
      hover: { lift: 2, shadow: 'floating' },
    })
    expect(migrated).not.toHaveProperty('vocabulary')
    expect(portalDesign.safeParse(migrated).success).toBe(true)
    expect(migrateDesign(migrated)).toBe(migrated)
  })

  it('passes through what is not a document', () => {
    expect(migrateDesign(null)).toBeNull()
    expect(migrateDesign('design')).toBe('design')
    expect(migrateDesign([1])).toEqual([1])
  })

  describe('a step that changes the format', () => {
    const rename = {
      name: 'test-rename',
      version: DESIGN_VERSION,
      to: DESIGN_VERSION + 1,
      up: (doc: Json) => ({ ...doc, renamed: true }),
    }

    it('runs only on the exact version it reads, and moves the document on', () => {
      expect(stepApplies(rename, DESIGN_VERSION)).toBe(true)
      expect(stepApplies(rename, DESIGN_VERSION - 1)).toBe(false)
      expect(stepApplies(rename, undefined)).toBe(false)
      const out = migrateDesign(stored(), [...DESIGN_MIGRATIONS, rename]) as Json
      expect(out).toMatchObject({ version: DESIGN_VERSION + 1, renamed: true })
      // The steps before it never run on what it made.
      expect(migrateDesign(out, [...DESIGN_MIGRATIONS, rename])).toBe(out)
    })
  })
})
