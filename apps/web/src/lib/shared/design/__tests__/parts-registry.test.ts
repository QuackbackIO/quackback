/**
 * The parts registry: stable names, never DOM paths, each found by the
 * portal's own public marks, which stay drawn in the files the part names.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { partOf, partSelector, partsOf, partsOnPage } from '../parts-registry'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { PART_ID } from '../style-overrides'
import { STYLE_ELEMENTS } from '../style-tokens'

const SRC = join(import.meta.dirname, '..', '..', '..', '..')
const read = (file: string) => readFileSync(join(SRC, file), 'utf8')

const withBlocks = (): PortalDesign =>
  portalDesign.parse({
    ...defaultDesign(),
    nav: {
      home: { on: true, tab: true },
      items: [
        { type: 'feedback', shown: true },
        { type: 'roadmap', shown: false },
        { type: 'link', id: 'docs', label: 'Docs', url: 'https://example.com', newTab: true },
      ],
    },
    pages: {
      ...defaultDesign().pages,
      home: {
        headline: null,
        blocks: [
          { type: 'ideas', id: 'abcdefgh', sort: 'top', count: 3 },
          { type: 'welcome', id: 'ijklmnop', body: { type: 'doc', content: [] } },
        ],
      },
    },
  })

describe('the parts registry', () => {
  it('names each part once, with a name and never a DOM path', () => {
    const ids = partsOf(withBlocks()).map((part) => part.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id, id).toMatch(PART_ID)
  })

  it('lists the menu’s shown items, Home, links, and each block’s slots', () => {
    const ids = partsOf(withBlocks()).map((part) => part.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'header.login',
        'nav.home',
        'nav.feedback',
        'nav.link.docs',
        'hero.home.headline',
        'hero.home.cta',
        'title.changelog.action',
        'block.abcdefgh.heading',
        'block.abcdefgh.link',
        'block.ijklmnop.body',
        'feed.filters',
        'feed.submit',
        'post.vote',
        'footer',
      ])
    )
    expect(ids).not.toContain('nav.roadmap')
  })

  it('says each part’s element kinds, from the registry of elements', () => {
    for (const part of partsOf(withBlocks())) {
      expect(part.elements.length, part.id).toBeGreaterThan(0)
      for (const element of part.elements) expect(STYLE_ELEMENTS[element], part.id).toBeDefined()
    }
  })

  it('finds a part on its page, by its own marks and then the element', () => {
    const cta = partOf(withBlocks(), 'hero.home.cta')!
    expect(partSelector(cta, 'button')).toBe(
      `[data-qb-page=home] [data-qb-section=hero] [data-qb-action]:is(${STYLE_ELEMENTS.button.selector})`
    )
    const heading = partOf(withBlocks(), 'block.abcdefgh.heading')!
    expect(partSelector(heading, 'heading')).toBe(
      '[data-qb-section="block-abcdefgh"] [data-qb-part=section-heading]'
    )
    expect(partsOnPage(withBlocks(), 'post').map((p) => p.id)).toContain('post.vote')
    expect(partsOnPage(withBlocks(), 'post').map((p) => p.id)).not.toContain('hero.home.cta')
  })

  it('keeps each mark it is found by drawn in the files it names', () => {
    const DYNAMIC = /^data-qb-(page|menu|section=block-)/
    for (const part of partsOf(withBlocks())) {
      const marks = [...part.anchor.matchAll(/\[(data-qb-[a-z-]+)(?:=("?)([^\]"]+)\2)?\]/g)]
      const source = part.files.map(read).join('\n')
      for (const [, name, , value] of marks) {
        if (DYNAMIC.test(`${name}=${value ?? ''}`) || name === 'data-qb-page') continue
        const drawn = value
          ? source.includes(`${name}="${value}"`) || source.includes(`${name}=${value}`)
          : source.includes(`${name}=`)
        expect(drawn, `${part.id} ${name}=${value ?? ''} in ${part.files.join(', ')}`).toBe(true)
      }
    }
    // The page, the menu and the blocks are marked where they are drawn.
    expect(read('components/public/portal-shell.tsx')).toContain('data-qb-page=')
    expect(read('components/public/portal-header.tsx')).toContain('data-qb-menu={item.type}')
    expect(read('components/public/home/home-blocks.tsx')).toContain('data-qb-section={key}')
  })
})
