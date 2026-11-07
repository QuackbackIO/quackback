/**
 * Show changes says one row per operation, in words. Built from the real
 * operations applied to a design (no model): a hero look that sets its fill
 * and its art is one row, never a field per row named after the look, and a
 * swatch shows only beside an actual colour.
 */
import { describe, expect, it } from 'vitest'
import { applyOps, type OpWorld } from '@/lib/shared/design/design-ops'
import { applyStep } from '@/lib/shared/design/agent/style-ops'
import { STYLE_REGISTRY } from '@/lib/shared/design/agent/style-registry'
import type { AppliedDesignChange } from '@/lib/shared/design/apply-changes'
import { defaultDesign } from '@/lib/shared/design/schema'
import { changeRows, type ChangeRow } from '../change-rows'

const world: OpWorld = {
  gates: { feedback: true, roadmap: true, changelog: true, help: true, support: true, status: true },
  places: { boards: [], roadmaps: [], categories: [] },
}

function green() {
  const design = defaultDesign()
  design.brand.light.accent = '#16a34a'
  return design
}

/** A row as it reads, with [swatch] where one shows. */
const read = (row: ChangeRow) =>
  'text' in row
    ? `${row.text}${row.swatch ? ' [swatch]' : ''}`
    : `${row.label}: ${row.before.words}${row.before.swatch ? ' [swatch]' : ''} → ${row.after.words}${row.after.swatch ? ' [swatch]' : ''}`

describe('changeRows', () => {
  it('says a hero look that sets several fields as one row', () => {
    const result = applyOps(green(), world, [
      { op: 'set', target: 'hero', key: 'look', value: 'brand-waves' },
    ])
    expect(result.applied.map((change) => change.path)).toEqual(['layout.band', 'layout.bandArt'])
    expect(changeRows(result.applied).map(read)).toEqual(['Hero look: Brand colour with waves'])
  })

  it('never repeats an operation’s name over each field it touched (the critique’s “Tint” rows)', () => {
    // As the critique saw it: one look, two fields, both carrying the look's label.
    const changes: AppliedDesignChange[] = [
      { path: 'layout.band', before: 'none', after: 'tint', label: 'Hero look: Tint' },
      { path: 'layout.bandColour', before: null, after: 'auto', label: 'Hero look: Tint' },
    ]
    const rows = changeRows(changes).map(read)
    expect(rows).toEqual(['Hero look: Tint'])
    expect(rows.join(' ')).not.toMatch(/Automatic|None/)
  })

  it('says each of several operations once, in the order they were made', () => {
    const result = applyStep(
      green(),
      world,
      STYLE_REGISTRY,
      [
        { op: 'theme', key: 'corners', value: 'pill' },
        { op: 'set', target: 'hero', key: 'art', value: 'dots' },
      ],
      [
        { element: 'button', state: 'hover', property: 'background', value: 'darker', block: '' },
        { element: 'button', state: 'hover', property: 'color', value: 'page', block: '' },
      ]
    )
    expect(changeRows(result.applied).map(read)).toEqual([
      'Corners to pill',
      'Hero art: Dots',
      // The darker shade is an actual colour: a swatch, and no codes in the words.
      'Main buttons on hover: background darker [swatch]',
      // The page colour is a role, worked out from the theme: no swatch.
      'Main buttons on hover: text the page colour',
    ])
  })

  it('shows no swatch for a colour the design works out from another', () => {
    const changes: AppliedDesignChange[] = [
      {
        path: 'style',
        before: null,
        after: { button: { hover: { background: 'oklch(from var(--primary) calc(l - 0.1) c h)' } } },
      },
      { path: 'style.link.hover.color', before: null, after: 'accent' },
    ]
    expect(changeRows(changes).map(read)).toEqual([
      'Main buttons, hover background: Automatic → Worked out from the brand',
      'Links, hover text: Automatic → Brand',
    ])
  })

  it('reads changes no operation names field by field, a colour by its name with its swatch', () => {
    const changes: AppliedDesignChange[] = [
      { path: 'brand.light.accent', before: '#ffffff', after: '#0f766e' },
      { path: 'layout.density', before: 'comfortable', after: 'compact' },
      { path: 'brand.fonts.heading', before: { kind: 'bundled', id: 'inter' }, after: null },
    ]
    const rows = changeRows(changes).map(read)
    expect(rows.slice(0, 2)).toEqual([
      'Brand colour: White [swatch] → Teal [swatch]',
      'Density: Comfortable → Compact',
    ])
  })

  it('says an operation on Home’s blocks by its own words, as its list reads as no change', () => {
    const design = green()
    design.nav.home.on = true
    design.pages.home.blocks = [
      { type: 'updates', id: 'updates1', count: 3, grid: { x: 0, y: 0, w: 6, h: 2 } },
    ] as typeof design.pages.home.blocks
    const result = applyOps(design, world, [
      { op: 'set', target: 'updates1', key: 'count', value: '2' },
    ])
    expect(result.applied).toHaveLength(1)
    const rows = changeRows(result.applied)
    expect(rows).toHaveLength(1)
    expect(read(rows[0]!)).toBe(result.applied[0]!.label)
    expect(rows[0]!.path).toBe('pages.home.blocks')
  })
})
