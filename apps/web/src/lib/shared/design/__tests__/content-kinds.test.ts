// @vitest-environment happy-dom
/**
 * The three kinds of content: every part and element kind has one, the
 * canvas draws each in colours that read on light and dark portals alike,
 * and live values say where they come from and where they are changed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONTENT_KINDS,
  ELEMENT_KINDS,
  ITEM_NAMES,
  ITEMS_OF,
  KIND_LOOK,
  destinationName,
} from '../content-kinds'
import { contrastRatio } from '../contrast'
import { itemPartsOf, partsOf } from '../parts-registry'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { STYLE_ELEMENTS } from '../style-tokens'
import { BLOCK_NAMES } from '../names'

const SRC = join(import.meta.dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(SRC, file), 'utf8')

const design: PortalDesign = portalDesign.parse({
  ...defaultDesign(),
  pages: {
    ...defaultDesign().pages,
    home: {
      headline: null,
      blocks: [
        { type: 'ideas', id: 'abcdefgh', sort: 'top', count: 3 },
        { type: 'composer', id: 'composer' },
        { type: 'status', id: 'statusbk' },
        { type: 'updates', id: 'updatesb', count: 3 },
      ],
    },
  },
})

/** Relative luminance, for comparing how light two colours are. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

describe('content kinds', () => {
  it('gives every part a kind', () => {
    const parts = [...partsOf(design), ...itemPartsOf(design)]
    expect(parts.length).toBeGreaterThan(10)
    for (const part of parts) expect(CONTENT_KINDS, part.id).toContain(part.kind)
  })

  it('gives every element kind a kind of its own', () => {
    for (const element of Object.keys(STYLE_ELEMENTS))
      expect(CONTENT_KINDS, element).toContain(ELEMENT_KINDS[element as keyof typeof ELEMENT_KINDS])
  })

  it('says what owns the words of the common parts', () => {
    const kind = (id: string) =>
      [...partsOf(design), ...itemPartsOf(design)].find((p) => p.id === id)?.kind
    expect(kind('hero.home.headline')).toBe('static')
    expect(kind('block.abcdefgh.heading')).toBe('static')
    expect(kind('block.abcdefgh.post-title')).toBe('dynamic')
    expect(kind('header.login')).toBe('system')
    expect(kind('post.vote')).toBe('system')
    expect(kind('block.composer.input')).toBe('system')
  })

  it('lists each data block’s items as one part each, styling every item in the block', () => {
    const items = itemPartsOf(design)
    expect(items.map((p) => p.id)).toEqual([
      'block.abcdefgh.post-title',
      'block.statusbk.incident-title',
      'block.updatesb.entry-title',
      // A list page's items, picked as themselves as a block's are.
      'feed.post-title',
      'feed.post-excerpt',
      'board.post-title',
    ])
    expect(items[0]).toMatchObject({
      label: 'Post title',
      anchor: '[data-qb-section="block-abcdefgh"] [data-qb-item="post-title"]',
      exact: true,
      block: 'abcdefgh',
    })
  })

  it('keeps the parts the AI is told of as they were: items are named on the canvas only', () => {
    expect(partsOf(design).some((p) => p.kind === 'dynamic' && p.id.endsWith('-title'))).toBe(false)
  })

  it('marks each list page item where its cards draw it', () => {
    for (const part of itemPartsOf(design).filter((p) => !p.block)) {
      const mark = /data-qb-part=([a-z-]+)/.exec(part.anchor)![1]
      expect(read(part.files[0]!), part.id).toContain(`data-qb-part="${mark}"`)
    }
  })

  it('marks each item where the blocks draw it, and only for real data', () => {
    const source = read('components/public/home/home-blocks.tsx')
    for (const mark of Object.keys(ITEM_NAMES))
      expect(source, mark).toContain(`data-qb-item="${mark}"`)
    for (const type of Object.keys(ITEMS_OF)) expect(Object.keys(BLOCK_NAMES), type).toContain(type)
    expect(source).toContain('data-qb-live={draw ? undefined : ')
  })

  it('draws each kind in an outline that reads on white and on black, lighter or darker than the others', () => {
    const looks = CONTENT_KINDS.map((kind) => KIND_LOOK[kind])
    for (const look of looks) {
      expect(contrastRatio(look.outline, '#ffffff'), look.name).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(look.outline, '#0b0b0e'), look.name).toBeGreaterThanOrEqual(3)
      expect(contrastRatio('#ffffff', look.chip), look.name).toBeGreaterThanOrEqual(4.5)
    }
    const light = looks.map((look) => luminance(look.outline)).sort((a, b) => a - b)
    for (let i = 1; i < light.length; i++)
      expect(light[i]! - light[i - 1]!).toBeGreaterThanOrEqual(0.04)
    expect(new Set(looks.map((look) => look.dash)).size).toBe(3)
  })

  it('names where a link goes, by the page and the item there', () => {
    expect(destinationName({ page: 'status', item: null })).toBe('status page')
    expect(destinationName({ page: 'post', item: '/b/x/posts/1' })).toBe('post')
    expect(destinationName({ page: 'changelog', item: '/changelog/1' })).toBe('update')
  })
})
