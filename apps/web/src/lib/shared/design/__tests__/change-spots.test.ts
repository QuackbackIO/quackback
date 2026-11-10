/**
 * Where an AI change shows on the canvas, from the real operations (no
 * model): a hero look in the hero on any page with one, a hover style on
 * its element in its hover state, a Home block's setting in that block, a
 * page's own section on that page, and nothing for what the whole portal takes.
 */
import { describe, expect, it } from 'vitest'
import { applyOps, type OpWorld } from '../design-ops'
import { applyStep } from '../agent/style-ops'
import { STYLE_REGISTRY } from '../agent/style-registry'
import { changeSpots, pageForSpot, spotsBetween, spotsOfChanges } from '../change-spots'
import { blockOf } from '../blocks'
import { defaultDesign, type PortalDesign } from '../schema'

const world: OpWorld = {
  gates: {
    feedback: true,
    roadmap: true,
    changelog: true,
    help: true,
    support: true,
    status: true,
  },
  places: { boards: [], roadmaps: [], categories: [] },
}

function design(): PortalDesign {
  const d = defaultDesign()
  d.brand.light.accent = '#16a34a'
  d.nav.home.on = true
  d.pages.home.blocks = [
    { type: 'updates', id: 'updates1', count: 3, grid: { x: 0, y: 0, w: 6, h: 2 } },
    { type: 'status', id: 'statusbk', grid: { x: 6, y: 0, w: 6, h: 1 } },
  ] as PortalDesign['pages']['home']['blocks']
  return d
}

const spotsOf = (d: PortalDesign, applied: ReturnType<typeof applyOps>['applied']) =>
  spotsOfChanges(d, applied)

describe('changeSpots', () => {
  it('puts a hero look in the hero, on whichever page shows one', () => {
    const d = design()
    const { applied, design: after } = applyOps(d, world, [
      { op: 'set', target: 'hero', key: 'look', value: 'brand-waves' },
    ])
    expect(spotsOf(after, applied)).toEqual([{ page: null, section: 'hero' }])
  })

  it('puts a hover style on its element, in its hover state', () => {
    const d = design()
    const { applied, design: after } = applyStep(
      d,
      world,
      STYLE_REGISTRY,
      [],
      [
        { element: 'button', state: 'hover', property: 'background', value: 'darker', block: '' },
        { element: 'button', state: 'hover', property: 'color', value: 'page', block: '' },
      ]
    )
    expect(spotsOf(after, applied)).toEqual([{ page: null, element: 'button', state: 'hover' }])
  })

  it('puts a Home block’s setting in that block only', () => {
    const d = design()
    const { applied, design: after } = applyOps(d, world, [
      { op: 'set', target: 'updates1', key: 'count', value: '2' },
    ])
    expect(spotsOf(after, applied)).toEqual([{ page: 'home', section: 'block-updates1' }])
  })

  it('puts a page’s own section on that page', () => {
    const d = design()
    const { applied, design: after } = applyOps(
      d,
      world,
      blockOf('changelog.entries')!.examples[0]!.ops
    )
    expect(applied.length).toBeGreaterThan(0)
    expect(spotsOf(after, applied)).toEqual([{ page: 'changelog', section: 'entries' }])
  })

  it('has no spot for what the whole portal takes at once', () => {
    const d = design()
    const { applied, design: after } = applyOps(d, world, [
      { op: 'theme', key: 'corners', value: 'pill' },
    ])
    expect(applied.length).toBe(1)
    expect(spotsOf(after, applied)).toEqual([])
    expect(
      changeSpots(d, { path: 'brand.light.accent', before: '#000000', after: '#16a34a' })
    ).toEqual([])
  })

  it('reads a patch’s path into Home’s blocks by the block at that place', () => {
    const d = design()
    expect(
      changeSpots(d, { path: 'pages.home.blocks.1.showIncidents', before: false, after: true })
    ).toEqual([{ page: 'home', section: 'block-statusbk' }])
  })
})

describe('pageForSpot', () => {
  const pages = ['home', 'feedback', 'roadmap', 'status'] as const
  it('keeps to the page shown when it draws the part, else the first that does', () => {
    expect(pageForSpot({ page: null, section: 'hero' }, 'roadmap', pages)).toBe('roadmap')
    expect(pageForSpot({ page: null, section: 'hero' }, 'status', pages)).toBe('home')
    expect(pageForSpot({ page: null, element: 'button' }, 'status', pages)).toBe('status')
    expect(pageForSpot({ page: 'roadmap', section: 'board' }, 'home', pages)).toBe('roadmap')
    expect(pageForSpot({ page: 'help', section: 'topics' }, 'home', pages)).toBeNull()
  })
})

describe('spotsBetween', () => {
  it('finds where an AI step’s draft differs from the one before', () => {
    const d = design()
    const step = applyStep(
      d,
      world,
      STYLE_REGISTRY,
      [
        { op: 'set', target: 'hero', key: 'art', value: 'dots' },
        { op: 'set', target: 'statusbk', key: 'showIncidents', value: 'true' },
        { op: 'theme', key: 'corners', value: 'pill' },
      ],
      [{ element: 'link', state: 'hover', property: 'underline', value: 'always', block: '' }]
    )
    expect(step.refused).toEqual([])
    expect(spotsBetween(d, step.design)).toEqual(
      expect.arrayContaining([
        { page: null, section: 'hero' },
        { page: 'home', section: 'block-statusbk' },
        { page: null, element: 'link', state: 'hover' },
      ])
    )
    expect(spotsBetween(d, step.design)).toHaveLength(3)
    expect(spotsBetween(d, d)).toEqual([])
  })

  it('sees a page’s, a part’s and a block’s own look, where each is drawn', () => {
    const d = design()
    const step = applyOps(d, world, [
      { op: 'set', target: 'part:hero.home.cta', key: 'style.hover.background', value: '#ff0000' },
      {
        op: 'set',
        target: '',
        key: 'overrides.page:roadmap:button.style.base.background',
        value: '#ff0000',
      },
    ])
    expect(step.refused).toEqual([])
    expect(spotsBetween(d, step.design)).toEqual([
      { page: 'home', section: 'hero', element: 'button', state: 'hover' },
      { page: 'roadmap', element: 'button' },
    ])
    // Taken back, each still points where it was.
    expect(spotsBetween(step.design, d)).toEqual([
      { page: 'home', section: 'hero', element: 'button', state: 'hover' },
      { page: 'roadmap', element: 'button' },
    ])
    expect(spotsOfChanges(step.design, step.applied)).toHaveLength(2)
    // An override as the AI names it, and a Home block's.
    expect(
      spotsOfChanges(d, [
        {
          path: 'overrides.part:block.updates1.heading:heading.phone.base.fontSize',
          before: null,
          after: '20px',
        },
        { path: 'overrides.block:statusbk.style.base.color', before: null, after: '#000' },
      ])
    ).toEqual([
      { page: 'home', section: 'block-updates1', element: 'heading' },
      { page: 'home', section: 'block-statusbk' },
    ])
  })
})
