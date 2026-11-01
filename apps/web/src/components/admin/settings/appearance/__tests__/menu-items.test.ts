/**
 * The menu editor works on the portal's navigation rows; the design stores
 * its own menu. Rows become the design's menu only when every link in them is
 * whole, so a half-typed link is never saved.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '@/lib/shared/design/schema'
import { designNavItems, navEditorItems } from '../menu-items'

describe('the menu editor’s rows', () => {
  it('round-trips the design’s menu', () => {
    const doc = defaultDesign()
    doc.nav.items = [
      { type: 'roadmap', shown: true, label: 'Plans' },
      { type: 'feedback', shown: false },
      { type: 'link', id: 'docs', label: 'Docs', url: 'https://example.com/docs', newTab: false },
    ]
    expect(designNavItems(navEditorItems(doc.nav))).toEqual(doc.nav.items)
  })

  it('reads a hidden row as not shown and trims a name, dropping an empty one', () => {
    expect(
      designNavItems([
        { id: 'feedback', type: 'feedback', enabled: false, label: '  ' },
        { id: 'help', type: 'help', label: ' Guides ' },
      ])
    ).toEqual([
      { type: 'feedback', shown: false },
      { type: 'help', shown: true, label: 'Guides' },
    ])
  })

  it('opens a link in a new tab unless told otherwise', () => {
    expect(
      designNavItems([{ id: 'x', type: 'link', label: 'Shop', url: 'https://example.com' }])
    ).toEqual([{ type: 'link', id: 'x', label: 'Shop', url: 'https://example.com', newTab: true }])
  })

  it('makes no menu while a link is half typed', () => {
    for (const link of [
      { label: '', url: 'https://example.com' },
      { label: 'Shop', url: '' },
      { label: 'Shop', url: 'example.com' },
      { label: 'x'.repeat(41), url: 'https://example.com' },
    ])
      expect(designNavItems([{ id: 'x', type: 'link', ...link }])).toBeNull()
  })

  it('makes menus the schema accepts', () => {
    const doc = defaultDesign()
    const items = designNavItems([
      { id: 'roadmap', type: 'roadmap' },
      { id: 'y', type: 'link', label: 'Status', url: 'http://status.example.com', newTab: false },
    ])!
    doc.nav.items = items
    expect(portalDesign.safeParse(doc).success).toBe(true)
  })
})
