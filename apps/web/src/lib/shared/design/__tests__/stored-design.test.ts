import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '../schema'
import { newBlock } from '../home'
import { readStoredDesign, withoutRetiredKeys } from '../stored-design'

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
    const taken = withoutRetiredKeys(doc)
    expect(portalDesign.safeParse(taken).success).toBe(true)
    expect(taken).not.toHaveProperty('vocabulary')
    expect(doc).toHaveProperty('vocabulary')
    expect(withoutRetiredKeys(null)).toBeNull()
  })

  it('takes in a logo that still styles its name, without the retired name styles', () => {
    const doc = written({})
    Object.assign((doc.brand as Json).logo as Json, {
      nameColour: 'accent',
      nameCase: 'upper',
      nameAccent: 'Pine',
      name: 'Harbor & Pine',
    })
    const taken = withoutRetiredKeys(doc) as Json
    expect(portalDesign.safeParse(taken).success).toBe(true)
    expect((taken.brand as Json).logo).toMatchObject({ name: 'Harbor & Pine' })
    expect((taken.brand as Json).logo).not.toHaveProperty('nameColour')
    expect(readStoredDesign(doc)?.dropped).toEqual([])
    expect((doc.brand as Json).logo).toHaveProperty('nameAccent')
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
