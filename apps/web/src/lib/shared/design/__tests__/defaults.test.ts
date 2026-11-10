import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '../schema'
import {
  DESIGN_DEFAULTS,
  blockLookValue,
  fillValue,
  fontValue,
  layoutValue,
  logoValue,
  shapeValue,
} from '../defaults'

type Json = Record<string, unknown>

type Node = {
  _zod: { def: { type: string; shape?: Record<string, Node>; innerType?: Node } }
}

/** Where each section of the table lives in a design. */
const SECTIONS = {
  layout: ['layout'],
  shape: ['shape'],
  fonts: ['brand', 'fonts'],
  logo: ['brand', 'logo'],
} as const satisfies Partial<Record<keyof typeof DESIGN_DEFAULTS, readonly string[]>>

/**
 * The optional fields in these sections whose absence is not one value, so
 * they have no row: what they read as is worked out from other fields.
 */
const NO_SINGLE_DEFAULT: Record<string, string> = {
  'layout.heroAlign': 'follows the header: centred under a centred header, else left',
  'layout.heroGlowColour': 'a light of the band’s own colour',
  'layout.background': 'the page colour, as designs always had',
  'brand.logo.tone': 'unknown: the logo image is not one ink',
  'brand.logo.ink': 'a colour, only with oneInk',
  'brand.logo.name': 'the workspace’s name',
  'brand.fonts.display': 'the heading font',
}

const sectionNode = (path: readonly string[]): Node =>
  path.reduce(
    (node, key) => {
      let at = node
      while (at._zod.def.type === 'optional') at = at._zod.def.innerType!
      return at._zod.def.shape![key]!
    },
    portalDesign as unknown as Node
  )

/** A section's optional fields holding a single option, a flag or a number. */
function optionalScalars(path: readonly string[]): string[] {
  const shape = sectionNode(path)._zod.def.shape!
  return Object.entries(shape)
    .filter(([, node]) => {
      if (node._zod.def.type !== 'optional') return false
      const inner = node._zod.def.innerType!._zod.def.type
      return ['enum', 'boolean', 'number', 'union', 'string'].includes(inner)
    })
    .map(([key]) => key)
}

describe('DESIGN_DEFAULTS', () => {
  it.each(Object.entries(SECTIONS))(
    'has a row for every optional %s field whose absence is one value',
    (section, path) => {
      const rows = DESIGN_DEFAULTS[section as keyof typeof SECTIONS]
      const missing = optionalScalars(path).filter(
        (key) => !(key in rows) && !([...path, key].join('.') in NO_SINGLE_DEFAULT)
      )
      expect(missing).toEqual([])
    }
  )

  it('keeps no row for a field it says has none', () => {
    for (const dotted of Object.keys(NO_SINGLE_DEFAULT)) {
      const key = dotted.split('.').at(-1)!
      const section = Object.entries(SECTIONS).find(
        ([, path]) => [...path, key].join('.') === dotted
      )
      expect(section, dotted).toBeDefined()
      expect(DESIGN_DEFAULTS[section![0] as keyof typeof SECTIONS]).not.toHaveProperty(key)
    }
  })

  it.each(
    Object.entries(SECTIONS).flatMap(([section, path]) =>
      Object.entries(DESIGN_DEFAULTS[section as keyof typeof SECTIONS]).map(
        ([key, value]) => [[...path, key].join('.'), path, key, value] as const
      )
    )
  )('%s: its default is a value the design can hold', (_name, path, key, value) => {
    const doc = structuredClone(defaultDesign()) as unknown as Json
    const parent = path.reduce((node, part) => node[part] as Json, doc)
    parent[key] = value
    expect(portalDesign.safeParse(doc).success).toBe(true)
  })

  it('reads a field from the design, or its default when absent', () => {
    const doc = defaultDesign()
    delete doc.layout.heroShape
    expect(layoutValue(doc.layout, 'heroShape')).toBe('full')
    doc.layout.heroShape = 'panel'
    expect(layoutValue(doc.layout, 'heroShape')).toBe('panel')
    delete doc.shape.fill
    expect(shapeValue(doc.shape, 'fill')).toBe('accent')
    delete doc.brand.fonts.scale
    expect(fontValue(doc.brand.fonts, 'scale')).toBe('standard')
    delete doc.brand.logo.height
    expect(logoValue(doc.brand.logo, 'height')).toBe(32)
  })
})

describe('a Home block’s look and a page background', () => {
  it('has a row for every optional field of each fill kind', async () => {
    const { backgroundFillSchema } = await import('../page-background')
    const kinds = (backgroundFillSchema as unknown as { options: Node[] }).options
    const rows = DESIGN_DEFAULTS.backgroundFill as Record<string, Record<string, unknown>>
    for (const node of kinds) {
      const shape = node._zod.def.shape!
      const kind = (shape.kind as unknown as { _zod: { def: { values: string[] } } })._zod.def
        .values[0]!
      const optional = Object.entries(shape)
        .filter(([, n]) => n._zod.def.type === 'optional')
        .filter(([, n]) =>
          ['enum', 'boolean', 'number', 'union', 'string'].includes(
            n._zod.def.innerType!._zod.def.type
          )
        )
        .map(([key]) => key)
      expect(
        optional.filter((key) => !(key in (rows[kind] ?? {}))),
        kind
      ).toEqual([])
    }
  })

  it('each default is a value the design can hold', () => {
    const doc = structuredClone(defaultDesign())
    doc.pages.home.blocks = [
      {
        type: 'status',
        id: 'statusaaaa',
        grid: { x: 0, y: 0, w: 12, h: 1 },
        look: { tone: 'tint', ...DESIGN_DEFAULTS.blockLook },
      },
    ] as never
    expect(portalDesign.safeParse(doc).success).toBe(true)
    const fills = {
      tint: { kind: 'tint', colour: 'accent', ...DESIGN_DEFAULTS.backgroundFill.tint },
      gradient: {
        kind: 'gradient',
        stops: ['accent', 'page'],
        ...DESIGN_DEFAULTS.backgroundFill.gradient,
      },
      pattern: { kind: 'pattern', pattern: 'dots', ...DESIGN_DEFAULTS.backgroundFill.pattern },
      image: {
        kind: 'image',
        image: { key: 'portal-images/room.jpg' },
        ...DESIGN_DEFAULTS.backgroundFill.image,
      },
    }
    for (const [kind, fill] of Object.entries(fills)) {
      const d = structuredClone(defaultDesign()) as unknown as Json
      ;(d.layout as Json).background = fill
      expect(portalDesign.safeParse(d).success, kind).toBe(true)
    }
  })

  it('reads a look’s colour and a fill’s settings, or their defaults when absent', () => {
    expect(blockLookValue(undefined, 'colour')).toBe('accent')
    expect(blockLookValue({ colour: 'support' }, 'colour')).toBe('support')
    expect(fillValue({ kind: 'tint', colour: 'accent' }, 'strength')).toBe('soft')
    expect(fillValue({ kind: 'gradient', stops: ['accent', 'page'] }, 'strength')).toBe('faint')
    expect(fillValue({ kind: 'gradient', stops: ['accent', 'page'] }, 'direction')).toBe('down')
    expect(fillValue({ kind: 'image', image: { key: 'portal-images/a.jpg' } }, 'strength')).toBe(35)
    expect(fillValue({ kind: 'pattern', pattern: 'dots', scale: 'large' }, 'scale')).toBe('large')
  })
})

describe('defaults written out where a module must not load the table', () => {
  it('give the hero image the same place as DESIGN_DEFAULTS', async () => {
    const { IMAGE_PLACE_DEFAULT } = await import('../composer-width')
    expect(IMAGE_PLACE_DEFAULT).toBe(DESIGN_DEFAULTS.layout.imagePlace)
  })

  it('give a page background the same settings as DESIGN_DEFAULTS', async () => {
    const { BACKGROUND_FILL_DEFAULTS } = await import('../page-background')
    expect(BACKGROUND_FILL_DEFAULTS).toEqual(DESIGN_DEFAULTS.backgroundFill)
  })
})
