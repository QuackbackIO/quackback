/**
 * The visitor's focus ring and the vote box's edge are solved, not warned
 * about. The ring reads at 3:1 on the page and cards, on the top band and on
 * a header in the band's colour, and on brand-colour buttons wherever one
 * colour can do all of that. A vote box's edge, its only visible boundary,
 * reads at 3:1 on cards and the page. Held across every preset, the reference
 * designs and today's themes, in light and dark.
 */
import { describe, expect, it } from 'vitest'
import { themePresets } from '@/lib/shared/theme/presets'
import { contrastRatio, solveContrast } from '../contrast'
import { convertLegacyBranding } from '../convert'
import { DESIGN_PRESETS } from '../presets'
import { withLook } from '../looks'
import { renderDesignCss, resolveDesign } from '../resolve'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'
import { headlineBehind } from '../components'

const fixtures = import.meta.glob<unknown>('./fixtures/*.json', { eager: true, import: 'default' })

/** Shown in both modes, so each mode is measured. */
const both = (design: PortalDesign): PortalDesign => ({ ...design, mode: 'auto' })

const designs: Array<{ name: string; doc: PortalDesign }> = [
  ...DESIGN_PRESETS.map((preset) => ({
    name: `look ${preset.id}`,
    doc: both(withLook(defaultDesign(), preset.look)),
  })),
  ...Object.entries(fixtures).map(([path, doc]) => ({
    name: `reference ${path.replace(/^.*\//, '')}`,
    doc: both(portalDesign.parse(doc)),
  })),
  ...Object.entries(themePresets).map(([id, preset]) => ({
    name: `theme ${id}`,
    doc: convertLegacyBranding({
      brandingConfig: { preset: id, themeMode: 'user', light: preset.light, dark: preset.dark },
    }),
  })),
]

/** Each design once more with the header on a band in the brand colour and on a soft blend. */
const banded = designs.flatMap(({ name, doc }) =>
  (['brand', 'blend', 'tint'] as const).map((band) => ({
    name: `${name}, ${band} band with the header on it`,
    doc: { ...doc, layout: { ...doc.layout, band, headerOnBand: true } } as PortalDesign,
  }))
)

const ratio = (a: string | undefined, b: string | undefined) => contrastRatio(String(a), String(b))

describe('the visitor’s focus ring', () => {
  it.each([...designs, ...banded])('$name: reads at 3:1 wherever it is drawn', ({ doc }) => {
    const resolved = resolveDesign(doc)
    const failures: string[] = []
    for (const mode of ['light', 'dark'] as const) {
      const vars = resolved[mode]
      if (!vars) continue
      const tokens = resolved.tokens[mode]
      const need = (what: string, fg: string | undefined, bg: string | undefined) => {
        const r = ratio(fg, bg)
        if (r < 3) failures.push(`${mode}: ${what} ${r.toFixed(2)}`)
      }
      need('ring on the page', vars.ring, vars.background)
      need('ring on cards', vars.ring, vars.card)
      for (const behind of headlineBehind(doc, vars, mode))
        need('ring on the band', tokens['--qb-band-focus'], behind)
      need('ring on the header', tokens['--qb-header-focus'], tokens['--qb-header-bg'])
      // On brand-colour buttons too, wherever one colour reads on the page, cards and the button.
      if (solveContrast(String(vars.ring), [vars.background!, vars.card!, vars.primary!], 3))
        need('ring on buttons', vars.ring, vars.primary)
    }
    expect(failures).toEqual([])
  })

  it('moves a ring that reads on the page but vanishes into a dark band', () => {
    const design = defaultDesign()
    design.mode = 'light'
    design.brand.light.accent = '#14532d'
    design.layout.band = 'brand'
    const resolved = resolveDesign(design)
    const band = headlineBehind(design, resolved.light!, 'light')[0]!
    expect(ratio(resolved.light!.ring, band)).toBeLessThan(3)
    expect(ratio(resolved.tokens.light['--qb-band-focus'], band)).toBeGreaterThanOrEqual(3)
  })

  it('draws the band’s and header’s own ring in the portal’s CSS, cards in the band keeping the page’s', () => {
    const css = renderDesignCss(resolveDesign(defaultDesign()))
    expect(css).toContain('[data-qb-part=band] { --ring: var(--qb-band-focus); }')
    expect(css).toContain('.portal-header { --ring: var(--qb-header-focus); }')
    expect(css).toMatch(
      /\[data-qb-part=band\] :is\([^)]*\[data-qb-surface=card\][^)]*\) \{ --ring: var\(--qb-focus\); \}/
    )
  })
})

describe('the vote box’s edge', () => {
  it.each(designs)('$name: reads at 3:1 on cards and the page', ({ doc }) => {
    for (const tint of ['neutral', 'support'] as const) {
      const resolved = resolveDesign({ ...doc, layout: { ...doc.layout, tint } })
      for (const mode of ['light', 'dark'] as const) {
        const vars = resolved[mode]
        if (!vars) continue
        const tokens = resolved.tokens[mode]
        expect(ratio(tokens['--qb-vote-edge'], vars.card)).toBeGreaterThanOrEqual(3)
        expect(ratio(tokens['--qb-vote-edge'], vars.background)).toBeGreaterThanOrEqual(3)
        if (tokens['--qb-support-edge'])
          expect(ratio(tokens['--qb-support-edge'], vars.card)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('draws every unvoted vote box with the solved edge', () => {
    expect(renderDesignCss(resolveDesign(defaultDesign()))).toContain(
      '[data-portal-theme] [data-qb-part=vote-button]:not([data-state=voted]) { border-color: var(--qb-vote-edge); }'
    )
  })
})
