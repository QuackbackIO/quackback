import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '../schema'
import { DESIGN_DEFAULTS, fontValue, layoutValue, logoValue, shapeValue } from '../defaults'

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
} as const satisfies Record<keyof typeof DESIGN_DEFAULTS, readonly string[]>

/**
 * The optional fields in these sections whose absence is not one value, so
 * they have no row: what they read as is worked out from other fields.
 */
const NO_SINGLE_DEFAULT: Record<string, string> = {
  'layout.bandAlign': 'follows the header: centred under a centred header, else left',
  'layout.bandGlowColour': 'a light of the band’s own colour',
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
      const rows = DESIGN_DEFAULTS[section as keyof typeof DESIGN_DEFAULTS]
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
      expect(DESIGN_DEFAULTS[section![0] as keyof typeof DESIGN_DEFAULTS]).not.toHaveProperty(key)
    }
  })

  it.each(
    Object.entries(SECTIONS).flatMap(([section, path]) =>
      Object.entries(DESIGN_DEFAULTS[section as keyof typeof DESIGN_DEFAULTS]).map(
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
    delete doc.layout.bandShape
    expect(layoutValue(doc.layout, 'bandShape')).toBe('full')
    doc.layout.bandShape = 'panel'
    expect(layoutValue(doc.layout, 'bandShape')).toBe('panel')
    delete doc.shape.fill
    expect(shapeValue(doc.shape, 'fill')).toBe('accent')
    delete doc.brand.fonts.scale
    expect(fontValue(doc.brand.fonts, 'scale')).toBe('standard')
    delete doc.brand.logo.height
    expect(logoValue(doc.brand.logo, 'height')).toBe(32)
  })
})

describe('defaults written out where a module must not load the table', () => {
  it('give the hero image the same place as DESIGN_DEFAULTS', async () => {
    const { IMAGE_PLACE_DEFAULT } = await import('../composer-width')
    expect(IMAGE_PLACE_DEFAULT).toBe(DESIGN_DEFAULTS.layout.imagePlace)
  })
})
