/**
 * Every surface a design draws passes, measured from the resolved tokens:
 * each fixture as it is, and with its Home blocks tinted in each colour and
 * its vote boxes tinted with the second colour, in each mode it shows. Theme
 * > Colours lists these pairs, so its failing count is 0 for each of them.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mixOklch } from '../color'
import { colourPairs } from '../colour-pairs'
import { newBlock } from '../home'
import { resolveDesign } from '../resolve'
import { portalDesign, type PortalDesign } from '../schema'

const FIXTURES = [
  join(import.meta.dirname, 'fixtures'),
  join(import.meta.dirname, 'fixtures', 'no-overrides'),
]

const fixtures = FIXTURES.flatMap((dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => ({
      name: file.replace(/\.json$/, ''),
      doc: portalDesign.parse(JSON.parse(readFileSync(join(dir, file), 'utf8'))),
    }))
)

/** The fixture (given a block where it has none) with every Home block tinted in one colour, and vote boxes in a tint of the second. */
function tinted(doc: PortalDesign, colour: 'accent' | 'support' | 'extra1'): PortalDesign {
  const out = structuredClone(doc)
  if (!out.pages.home.blocks.length) out.pages.home.blocks.push(newBlock('links'))
  for (const block of out.pages.home.blocks) block.look = { ...block.look, tone: 'tint', colour }
  out.layout.tint = 'support'
  return out
}

const cases = fixtures.flatMap(({ name, doc }) => [
  { name, doc },
  ...(['accent', 'support', 'extra1'] as const).map((colour) => ({
    name: `${name}, blocks tinted ${colour}`,
    doc: tinted(doc, colour),
  })),
])

describe('every surface a design draws', () => {
  it('has fixtures', () => expect(fixtures.length).toBeGreaterThanOrEqual(12))

  it.each(cases)('$name: no pair fails', ({ doc }) => {
    const failing = colourPairs(doc)
      .filter((pair) => !pair.passes)
      .map((pair) => `${pair.mode}: ${pair.text} on ${pair.on} ${pair.ratio}:1 < ${pair.target}:1`)
    expect(failing).toEqual([])
    expect(resolveDesign(doc).errors).toEqual([])
  })

  it.each(fixtures)(
    '$name: checks text, links and the focus ring on tinted blocks and the footer',
    ({ doc }) => {
      const pairs = colourPairs(tinted(doc, 'accent')).map((pair) => `${pair.text} on ${pair.on}`)
      expect(pairs).toEqual(
        expect.arrayContaining([
          'Text on tinted blocks',
          'Secondary text on tinted blocks',
          'Links on tinted blocks',
          'The focus ring on tinted blocks',
          'Secondary text on the footer',
        ])
      )
    }
  )
})

describe('a tint, measured as Chromium paints color-mix in oklch', () => {
  // Read back from Chromium: getComputedStyle of color-mix(in oklch, a 10%, b), drawn to a canvas.
  it.each([
    ['#008127', '#ffffff', '#e9f2e9'],
    ['#16a34a', '#ffffff', '#ebf6ed'],
    ['#2563eb', '#fafaf9', '#e3ecfb'],
    ['oklch(0.6 0.2 30)', 'oklch(0.98 0.01 250)', '#e2ecff'],
  ])('%s into %s', (fill, card, painted) => {
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const ours = channels(mixOklch(fill, card, 0.1))
    channels(painted).forEach((channel, i) =>
      expect(Math.abs(channel - ours[i]!)).toBeLessThanOrEqual(1)
    )
  })
})
