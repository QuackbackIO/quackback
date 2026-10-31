import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../schema'
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
      written({ future: { on: true }, 'brand.logo.tagline': 'Hello', 'layout.bandShape': 'panel' })
    )
    expect(read?.design).toEqual(stored())
    expect(read?.dropped.sort()).toEqual(['brand.logo.tagline', 'future', 'layout.bandShape'])
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
