import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '../schema'
import { readStoredDesign } from '../stored-design'
import { asFormat2 } from './format2'
import {
  DESIGN_MIGRATIONS,
  DESIGN_VERSION,
  HERO_KEYS,
  heroPathAsBefore,
  migrateDesign,
  stepApplies,
  withHeroKeys,
  withHeroPath,
} from '../migrations'

type Json = Record<string, unknown>

const current = (): Json => structuredClone(defaultDesign()) as unknown as Json

/** Today's portal, as format 2 stored it. */
const stored = (): Json => asFormat2(current())

/** A format 2 design that sets every hero key, and the same design in format 3. */
function everyHeroKey(): { v2: Json; v3: Json } {
  const doc = current()
  Object.assign(doc.layout as Json, {
    hero: 'brand',
    heroAlign: 'centre',
    heroShape: 'panel',
    heroHeight: 'tall',
    heroColour: 'extra1',
    heroGlow: 'corner',
    heroGlowColour: 'support',
    heroArt: 'waves',
    headerOnHero: true,
    blend: 'mesh',
    imagePlace: 'cover',
  })
  const brand = doc.brand as Json
  brand.light = { ...(brand.light as Json), support: '#e58fae', extra: ['#1d4ed8'] }
  brand.heroImage = { key: 'portal-images/room.jpg', alt: 'Our room', homeOnly: true }
  return { v2: asFormat2(doc), v3: doc }
}

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
  'hero-keys': () => everyHeroKey().v2,
  'neutral-focus': () => {
    const doc = current()
    doc.style = { button: { focus: { borderColor: 'accent', shadow: 'glow', ringWidth: 3 } } }
    doc.styleDark = { input: { focus: { borderColor: '#2563eb' } } }
    doc.overrides = [
      {
        id: 'abcdefgh',
        target: { scope: 'page', page: 'home', element: 'input' },
        style: { focus: { shadow: 'glow' }, hover: { borderColor: 'accent' } },
      },
    ]
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
  'neutral-focus': (doc) => {
    // The ring's width stays; a colour or glow on focus goes, and hover keeps its own.
    expect(doc.style).toEqual({ button: { focus: { ringWidth: 3 } } })
    expect(doc).not.toHaveProperty('styleDark')
    expect(doc.overrides).toEqual([
      {
        id: 'abcdefgh',
        target: { scope: 'page', page: 'home', element: 'input' },
        style: { hover: { borderColor: 'accent' } },
      },
    ])
  },
  'hero-keys': (doc) => {
    const { v3 } = everyHeroKey()
    expect(doc.layout).toEqual(v3.layout)
    expect(doc.brand).toEqual(v3.brand)
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
      const others = DESIGN_MIGRATIONS.filter((each) => each !== step)
      // Every other step run, it is this one the document needs.
      expect(portalDesign.safeParse(migrateDesign(before, others)).success).toBe(false)
      const after = step.up(before)
      AFTER[name]!(after)
      expect(portalDesign.safeParse(migrateDesign(after)).success).toBe(true)
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
      const doc = current()
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

  describe('format 3', () => {
    it('moves every hero key of a format 2 design to its new name, losing nothing', () => {
      const { v2, v3 } = everyHeroKey()
      const migrated = migrateDesign(v2) as Json
      expect(migrated).toEqual({ ...v3, version: 3 })
      for (const [holder, names] of Object.entries(HERO_KEYS))
        for (const old of Object.keys(names)) expect(migrated[holder]).not.toHaveProperty(old)
      // Every key the format 2 document held is there, by one name or the other.
      const count = (doc: Json) =>
        Object.keys(doc.layout as Json).length + Object.keys(doc.brand as Json).length
      expect(count(migrated)).toBe(count(v2))
      expect(portalDesign.parse(migrated)).toEqual(portalDesign.parse({ ...v3, version: 3 }))
    })

    it('is the same once run twice, and leaves a format 3 design alone', () => {
      const once = migrateDesign(everyHeroKey().v2)
      expect(migrateDesign(once)).toBe(once)
      const v3 = current()
      expect(migrateDesign(v3)).toBe(v3)
    })

    it('reads a format 2 design stored before as the same design', () => {
      const { v2, v3 } = everyHeroKey()
      expect(readStoredDesign(v2)).toEqual(readStoredDesign({ ...v3, version: 3 }))
      expect(readStoredDesign(v2)?.dropped).toEqual([])
    })

    it('keeps a new name over an old one in a mixed patch, and never changes what it is given', () => {
      const patch = { layout: { bandShape: 'panel', heroShape: 'inset', density: 'compact' } }
      const copy = structuredClone(patch)
      expect(withHeroKeys(patch)).toEqual({ layout: { heroShape: 'inset', density: 'compact' } })
      expect(withHeroKeys({ brand: { bandImage: null } })).toEqual({ brand: { heroImage: null } })
      expect(patch).toEqual(copy)
      const plain = { layout: { density: 'compact' } }
      expect(withHeroKeys(plain)).toBe(plain)
    })

    it('names a path either way', () => {
      expect(withHeroPath('layout.band')).toBe('layout.hero')
      expect(withHeroPath('brand.bandImage.alt')).toBe('brand.heroImage.alt')
      expect(withHeroPath('layout.blend')).toBe('layout.blend')
      expect(withHeroPath('pages.home.composer')).toBe('pages.home.composer')
      expect(heroPathAsBefore('layout.headerOnHero')).toBe('layout.headerOnBand')
      expect(heroPathAsBefore('brand.heroImage')).toBe('brand.bandImage')
      expect(heroPathAsBefore('layout.density')).toBe('layout.density')
    })
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
