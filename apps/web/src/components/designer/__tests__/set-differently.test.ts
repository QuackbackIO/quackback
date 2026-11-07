/**
 * The one list of places an element's look is set differently: page and
 * part overrides and Home blocks' own looks, each saying what it sets with
 * its value, and which values are phones' or dark mode's own. Theme lists
 * them all; an element's panel lists its own, from the same words.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { alsoSetAt } from '@/lib/shared/design/override-cascade'
import { lookDetail, placeDetail, setDifferently } from '../set-differently'

function design(): PortalDesign {
  return portalDesign.parse({
    ...defaultDesign(),
    pages: {
      ...defaultDesign().pages,
      home: {
        headline: null,
        blocks: [
          {
            type: 'ideas',
            id: 'abcdefgh',
            sort: 'top',
            count: 3,
            grid: { x: 0, y: 0, w: 6, h: 2 },
            look: {
              style: { link: { base: { color: 'ink' } } },
              phone: { link: { base: { size: 13 } } },
            },
          },
        ],
      },
    },
    overrides: [
      {
        id: 'o1',
        target: { scope: 'page', page: 'changelog', element: 'button' },
        style: { base: { radius: 4 } },
      },
      {
        id: 'o2',
        target: { scope: 'part', part: 'hero.home.cta', element: 'button' },
        style: { hover: { background: 'support' } },
        styleDark: { base: { background: 'black' } },
        phone: { base: { size: 18 } },
      },
      {
        id: 'o3',
        target: { scope: 'part', part: 'block.gone1234.link', element: 'link' },
        style: { base: { weight: 700 } },
      },
    ],
  })
}

describe('what a place sets differently', () => {
  it('says each value, and which are a state’s, phones’ or dark mode’s', () => {
    expect(
      lookDetail('button', {
        style: { base: { radius: 4 }, hover: { background: 'support' } },
        phone: { base: { size: 18 } },
        dark: { base: { background: 'black' } },
      })
    ).toBe(
      'corners 4 px, background Second colour (hover), size 18 px (phone), background Black (dark)'
    )
  })
})

describe('every place set differently', () => {
  it('lists overrides and Home blocks’ own looks alike, and flags a part that is gone', () => {
    const list = setDifferently(design())
    expect(list.map((p) => [p.group, p.name, p.detail, p.orphan])).toEqual([
      ['Changelog', 'Main buttons on Changelog', 'corners 4 px', false],
      [
        'Hero · Home',
        'Call to action · Hero',
        'background Second colour (hover), size 18 px (phone), background Black (dark)',
        false,
      ],
      ['Gone from the portal', 'Links in a block that is gone', 'weight 700', true],
      ['Top posts', 'Links in Top posts', 'text Text, size 13 px (phone)', false],
    ])
  })

  it('agrees with an element panel’s own list, word for word', () => {
    const d = design()
    const ctx = { element: 'button' as const, part: null, page: 'home' as const, block: null }
    const panel = alsoSetAt(d, ctx, 'everywhere').map(
      (place) => `${place.label}: ${placeDetail(d, 'button', place)}`
    )
    const theme = setDifferently(d)
      .filter((p) => p.element === 'button')
      .map((p) => `${p.place.label}: ${p.detail}`)
    expect(panel.sort()).toEqual(theme.sort())
  })
})
