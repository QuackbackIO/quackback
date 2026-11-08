import { describe, expect, it, vi } from 'vitest'
import { defaultDesign, portalDesign } from '../schema'
import { DESIGN_OPTIONS } from '../options'
import { newBlock } from '../home'
import { migrateDesign } from '../migrations'
import { readStoredDesign } from '../stored-design'

type Json = Record<string, unknown>

const stored = () => {
  const doc = defaultDesign()
  doc.brand.light.accent = '#0f766e'
  return doc
}

/** A stored design with values set at dotted paths, as a newer build might write it. */
function written(changes: Record<string, unknown>): Json {
  const doc = structuredClone(stored()) as unknown as Json
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split('.')
    const parent = keys.slice(0, -1).reduce((node, key) => node[key] as Json, doc)
    parent[keys.at(-1)!] = value
  }
  return doc
}

describe('reading a stored design', () => {
  it('reads a design this build wrote, unchanged', () => {
    expect(readStoredDesign(stored())).toEqual({ design: stored(), dropped: [] })
  })

  it('drops fields a newer build added, keeping the brand', () => {
    const read = readStoredDesign(
      written({
        future: { on: true },
        'brand.logo.tagline': 'Hello',
        'layout.bandTexture': 'paper',
      })
    )
    expect(read?.design).toEqual(stored())
    expect(read?.dropped.sort()).toEqual(['brand.logo.tagline', 'future', 'layout.bandTexture'])
  })

  it('reads an option value a newer build added as the default', () => {
    const read = readStoredDesign(
      written({ 'layout.band': 'panel', 'brand.logo.display': 'banner' })
    )
    expect(read?.design.layout.band).toBe(defaultDesign().layout.band)
    expect(read?.design.brand.logo.display).toBe(defaultDesign().brand.logo.display)
    expect(read?.design.brand.light.accent).toBe('#0f766e')
    expect(read?.dropped.sort()).toEqual(['brand.logo.display', 'layout.band'])
  })

  it('drops a menu item of a kind this build does not know', () => {
    const items = stored().nav.items
    const read = readStoredDesign(
      written({ 'nav.items': [items[0], { type: 'gallery', shown: true }, ...items.slice(1)] })
    )
    expect(read?.design.nav.items).toEqual(items)
    expect(read?.dropped).toEqual(['nav.items.1'])
  })

  it('drops a block option a newer build added, keeping the block', () => {
    const blocks = [newBlock('welcome'), newBlock('links')]
    const doc = written({ 'pages.home.blocks': structuredClone(blocks) })
    ;(((doc.pages as Json).home as Json).blocks as Json[])[0]!.look = {
      tone: 'glass',
      align: 'start',
    }
    const read = readStoredDesign(doc)
    expect(read?.design.pages.home.blocks).toHaveLength(blocks.length)
    expect(read?.design.pages.home.blocks[0]).not.toHaveProperty('look')
    expect(read?.dropped).toEqual(['pages.home.blocks.0.look'])
  })

  it('drops the words a design once chose, without counting them as unknown', () => {
    const doc = written({ vocabulary: { post: 'suggestion', board: 'category' } })
    const read = readStoredDesign(doc)
    expect(read).toEqual({ design: stored(), dropped: [] })
    expect(read?.design).not.toHaveProperty('vocabulary')
    expect(doc.vocabulary).toEqual({ post: 'suggestion', board: 'category' })
  })

  it('takes in a design that still has its words, without them', () => {
    const doc = written({ vocabulary: { post: 'idea', board: 'board' } })
    const taken = migrateDesign(doc)
    expect(portalDesign.safeParse(taken).success).toBe(true)
    expect(taken).not.toHaveProperty('vocabulary')
    expect(doc).toHaveProperty('vocabulary')
    expect(migrateDesign(null)).toBeNull()
  })

  it('takes in a logo that still styles its name, without the retired name styles', () => {
    const doc = written({})
    Object.assign((doc.brand as Json).logo as Json, {
      nameColour: 'accent',
      nameCase: 'upper',
      nameAccent: 'Pine',
      name: 'Harbor & Pine',
    })
    const taken = migrateDesign(doc) as Json
    expect(portalDesign.safeParse(taken).success).toBe(true)
    expect((taken.brand as Json).logo).toMatchObject({ name: 'Harbor & Pine' })
    expect((taken.brand as Json).logo).not.toHaveProperty('nameColour')
    expect(readStoredDesign(doc)?.dropped).toEqual([])
    expect((doc.brand as Json).logo).toHaveProperty('nameAccent')
  })

  it('takes in a focus ring colour, gone since focus rings stay neutral, keeping its width', () => {
    const doc = written({
      style: {
        button: { focus: { ring: 'accent', ringWidth: 3 } },
        link: { focus: { ring: '#ff0000' } },
      },
      styleDark: { button: { focus: { ring: '#ffffff' } } },
      overrides: [
        {
          id: 'abcdefgh',
          target: { scope: 'page', page: 'home', element: 'input' },
          style: { focus: { ring: 'support' } },
        },
      ],
    }) as Json
    const read = readStoredDesign(doc)
    expect(read?.dropped).toEqual([])
    expect(read?.design.style).toEqual({ button: { focus: { ringWidth: 3 } } })
    expect(read?.design.styleDark).toBeUndefined()
    expect(read?.design.overrides).toBeUndefined()
    expect(portalDesign.safeParse(migrateDesign(doc)).success).toBe(true)
  })

  it('does not change the document it was given', () => {
    const doc = written({ future: 1 })
    readStoredDesign(doc)
    expect(doc.future).toBe(1)
  })

  it('refuses what is not a design at all', () => {
    expect(readStoredDesign(null)).toBeNull()
    expect(readStoredDesign({ version: 1 })).toBeNull()
    expect(readStoredDesign('design')).toBeNull()
  })
})

type Node = {
  _zod: {
    def: {
      type: string
      shape?: Record<string, Node>
      innerType?: Node
      entries?: Record<string, string | number>
    }
  }
}

/**
 * Every optional enum field of the design schema reachable through plain
 * objects, as a dotted path with the option list that enum is made from.
 */
function optionalEnumPaths(): { path: string[]; options: unknown[] }[] {
  const found: { path: string[]; options: unknown[] }[] = []
  const visit = (node: Node, path: string[], optional: boolean) => {
    const def = node._zod.def
    if (def.type === 'optional' && def.innerType) return visit(def.innerType, path, true)
    if (def.type === 'enum' && optional) {
      found.push({ path, options: Object.values(def.entries ?? {}) })
    }
    if (def.type === 'object' && def.shape) {
      for (const [key, child] of Object.entries(def.shape)) visit(child, [...path, key], false)
    }
  }
  visit(portalDesign as unknown as Node, [], false)
  return found
}

describe('reading a stored design with a value this build does not offer', () => {
  const fields = optionalEnumPaths()

  it('finds the optional options, including every DESIGN_OPTIONS list one is made from', () => {
    expect(fields.length).toBeGreaterThan(15)
    const paths = fields.map((field) => field.path.join('.'))
    expect(paths).toEqual(
      expect.arrayContaining(['layout.bandGlow', 'layout.bandShape', 'shape.hover'])
    )
    const used = (list: readonly unknown[]) =>
      fields.some((field) => JSON.stringify(field.options) === JSON.stringify([...list]))
    expect(used(DESIGN_OPTIONS.bandGlow)).toBe(true)
    expect(used(DESIGN_OPTIONS.hover)).toBe(true)
  })

  it.each(fields.map((field) => [field.path.join('.'), field.path] as const))(
    'drops only %s, keeping the rest of the design',
    (_name, path) => {
      const doc = structuredClone(stored()) as unknown as Json
      const parent = path.slice(0, -1).reduce((node, key) => (node[key] ??= {}) as Json, doc)
      // The key is present with a known value first, so the rest is the same design.
      parent[path.at(-1)!] = 'from-a-newer-build'
      const read = readStoredDesign(doc)
      expect(read, 'the design still reads').not.toBeNull()
      expect(read!.dropped).toEqual([path.join('.')])
      const keep = structuredClone(doc)
      const keepParent = path.slice(0, -1).reduce((node, key) => node[key] as Json, keep)
      delete keepParent[path.at(-1)!]
      expect(read!.design).toEqual(portalDesign.parse(keep))
    }
  )

  it('drops an optional field holding the wrong kind of value, keeping the design', () => {
    const read = readStoredDesign(written({ 'layout.bandGlow': 7, 'shape.hover': { on: true } }))
    expect(read?.dropped.sort()).toEqual(['layout.bandGlow', 'shape.hover'])
    expect(read?.design.brand.light.accent).toBe('#0f766e')
    expect(read?.design.layout).not.toHaveProperty('bandGlow')
  })

  it('still sets a required option back to the default design value', () => {
    const read = readStoredDesign(written({ 'layout.nav': 'sidebar' }))
    expect(read?.design.layout.nav).toBe(defaultDesign().layout.nav)
    expect(read?.dropped).toEqual(['layout.nav'])
  })

  it('still refuses a design whose required field is the wrong kind of value', () => {
    expect(readStoredDesign(written({ 'layout.nav': 7 }))).toBeNull()
  })
})

describe('reading a design stored before cards split into post cards and panels', () => {
  /** A stored design whose one look was every card's, as the builder wrote it before. */
  const before = () => {
    const doc = structuredClone(stored()) as unknown as Json
    doc.style = {
      card: { base: { radius: 4, borderColor: 'accent', shadow: 'soft' }, hover: { lift: 2 } },
    }
    doc.styleDark = { card: { base: { borderColor: '#93c5fd' } } }
    doc.stylePhone = { card: { base: { radius: 2 }, hover: { lift: 1 } } }
    return doc
  }

  it('keeps the look: post cards take all of it, panels its normal look', () => {
    const read = readStoredDesign(before())!
    expect(read.dropped).toEqual([])
    expect(read.design.style).toEqual({
      postCard: { base: { radius: 4, borderColor: 'accent', shadow: 'soft' }, hover: { lift: 2 } },
      panel: { base: { radius: 4, borderColor: 'accent', shadow: 'soft' } },
    })
    expect(read.design.styleDark).toEqual({
      postCard: { base: { borderColor: '#93c5fd' } },
      panel: { base: { borderColor: '#93c5fd' } },
    })
    expect(read.design.stylePhone).toEqual({
      postCard: { base: { radius: 2 }, hover: { lift: 1 } },
      panel: { base: { radius: 2 } },
    })
  })

  it('splits a page’s card look in two, and gives the filters’ own look to panels', () => {
    const doc = before()
    doc.overrides = [
      {
        id: 'page:feedback:card',
        target: { scope: 'page', page: 'feedback', element: 'card' },
        style: { base: { background: 'raised' }, hover: { lift: 3 } },
      },
      {
        id: 'part:feed.filters:card',
        target: { scope: 'part', part: 'feed.filters', element: 'card' },
        style: { base: { radius: 0 } },
      },
    ]
    const read = readStoredDesign(doc)!
    expect(read.dropped).toEqual([])
    expect(read.design.overrides).toEqual([
      {
        id: 'page:feedback:postCard',
        target: { scope: 'page', page: 'feedback', element: 'postCard' },
        style: { base: { background: 'raised' }, hover: { lift: 3 } },
      },
      {
        id: 'part:feed.filters:panel',
        target: { scope: 'part', part: 'feed.filters', element: 'panel' },
        style: { base: { radius: 0 } },
      },
      {
        id: 'page:feedback:panel',
        target: { scope: 'page', page: 'feedback', element: 'panel' },
        style: { base: { background: 'raised' } },
      },
    ])
  })

  it('splits a Home block’s own card look the same way', () => {
    const doc = before()
    const block = newBlock('ideas')
    ;(block as unknown as Json).look = {
      style: { card: { base: { radius: 8 }, hover: { lift: 2 } } },
    }
    ;((doc.pages as Json).home as Json).blocks = [block]
    const read = readStoredDesign(doc)!
    expect(read.design.pages.home.blocks[0]!.look?.style).toEqual({
      postCard: { base: { radius: 8 }, hover: { lift: 2 } },
      panel: { base: { radius: 8 } },
    })
  })

  it('leaves a design that has post cards and panels already as it is', () => {
    const doc = structuredClone(stored()) as unknown as Json
    doc.style = { postCard: { hover: { lift: 2 } } }
    expect(migrateDesign(doc)).toBe(doc)
    expect(readStoredDesign(doc)!.design.style).toEqual({ postCard: { hover: { lift: 2 } } })
  })

  it('migrates a card look sent by an older builder or the AI, never changing what was sent', () => {
    const sent = before()
    const copy = structuredClone(sent)
    const migrated = migrateDesign(sent) as Json
    expect(sent).toEqual(copy)
    expect(portalDesign.safeParse(migrated).success).toBe(true)
  })
})

describe('reading a design stored when Lift was a motion of its own', () => {
  it('writes Lift as post cards’ and main buttons’ hover, keeping their own values', () => {
    const doc = structuredClone(stored()) as unknown as Json
    ;(doc.shape as Json).hover = 'lift'
    doc.style = { button: { hover: { shadow: 'deep' } } }
    const read = readStoredDesign(doc)!
    expect(read.dropped).toEqual([])
    expect(read.design.shape).not.toHaveProperty('hover')
    expect(read.design.style).toEqual({
      button: { hover: { lift: 2, shadow: 'deep' } },
      postCard: { hover: { lift: 2, shadow: 'floating' } },
    })
  })

  it('keeps Arrow as the links’ own', () => {
    const doc = structuredClone(stored()) as unknown as Json
    ;(doc.shape as Json).hover = 'arrow'
    expect(readStoredDesign(doc)!.design.shape.hover).toBe('arrow')
  })
})

describe('reading a design with many fields this build does not know', () => {
  /** A design where a newer build changed everything it could: every optional option, keys, menu items and block looks. */
  function manyBad(): { doc: Json; expected: string[] } {
    const doc = structuredClone(stored()) as unknown as Json
    const expected: string[] = []
    for (const { path } of optionalEnumPaths()) {
      const parent = path.slice(0, -1).reduce((node, key) => (node[key] ??= {}) as Json, doc)
      parent[path.at(-1)!] = 'from-a-newer-build'
      expected.push(path.join('.'))
    }
    for (const key of ['future', 'later', 'newer']) {
      doc[key] = true
      expected.push(key)
    }
    ;((doc.layout as Json).bandTexture as unknown) = 'paper'
    expected.push('layout.bandTexture')
    const items = (doc.nav as Json).items as unknown[]
    ;(doc.nav as Json).items = [
      { type: 'gallery', shown: true },
      ...items,
      { type: 'shop', shown: true },
    ]
    expected.push('nav.items.0', `nav.items.${items.length + 1}`)
    const blocks = [newBlock('welcome'), newBlock('links'), newBlock('welcome')]
    for (const block of blocks) (block as unknown as Json).look = { tone: 'glass' }
    ;((doc.pages as Json).home as Json).blocks = blocks
    expected.push(...blocks.map((_, i) => `pages.home.blocks.${i}.look`))
    return { doc, expected }
  }

  it('reads it with every one dropped, parsing a few times however many there are', () => {
    const { doc, expected } = manyBad()
    expect(expected.length).toBeGreaterThan(30)
    const parse = vi.spyOn(portalDesign, 'safeParse')
    try {
      const read = readStoredDesign(doc)
      expect(read, 'the design still reads').not.toBeNull()
      expect([...read!.dropped].sort()).toEqual([...expected].sort())
      expect(read!.design.brand.light.accent).toBe('#0f766e')
      expect(read!.design.nav.items).toEqual(stored().nav.items)
      expect(parse.mock.calls.length).toBeLessThanOrEqual(4)
    } finally {
      parse.mockRestore()
    }
  })
})
