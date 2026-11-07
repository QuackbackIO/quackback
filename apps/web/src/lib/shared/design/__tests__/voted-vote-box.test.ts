/**
 * The voted vote box writes its count in the voted colour on a 15% tint of
 * that colour, over a card or the page. The colour is solved against that
 * tint, so the count reads at 4.5:1 in light and dark, across the looks, the
 * reference designs and today's themes, and for an accent that once read at
 * 3.98:1 on its own tint.
 */
import { describe, expect, it } from 'vitest'
import { themePresets } from '@/lib/shared/theme/presets'
import { contrastRatio, overlay } from '../contrast'
import { convertLegacyBranding } from '../convert'
import { DESIGN_PRESETS } from '../presets'
import { withLook } from '../looks'
import { resolveDesign } from '../resolve'
import { VOTED_TINT } from '../voted'
import { defaultDesign, portalDesign, type PortalDesign } from '../schema'

const fixtures = import.meta.glob<unknown>('./fixtures/*.json', { eager: true, import: 'default' })

const both = (design: PortalDesign): PortalDesign => ({ ...design, mode: 'auto' })

function accented(accent: string): PortalDesign {
  const doc = both(defaultDesign())
  return { ...doc, brand: { ...doc.brand, light: { ...doc.brand.light, accent } } }
}

const designs: Array<{ name: string; doc: PortalDesign }> = [
  { name: 'a deep pink accent', doc: accented('#dc0061') },
  { name: 'a yellow accent', doc: accented('#facc15') },
  ...DESIGN_PRESETS.map((preset) => ({
    name: `look ${preset.id}`,
    doc: both(withLook(defaultDesign(), preset.look, { itsColours: true })),
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

describe('the voted vote box', () => {
  it('draws the browser’s own tint: the voted colour at 15% over what is under it', () => {
    expect(overlay('#dc0061', '#ffffff', VOTED_TINT)).toBe('#fad9e7')
  })

  it.each(designs)('reads at 4.5:1 on its own tint over cards and the page: $name', ({ doc }) => {
    const resolved = resolveDesign(doc)
    for (const mode of ['light', 'dark'] as const) {
      const vars = resolved[mode]
      if (!vars) continue
      const ink = resolved.tokens[mode]['--qb-vote-active']!
      for (const under of [vars.card!, vars.background!]) {
        const tint = overlay(ink, under, VOTED_TINT)
        expect(contrastRatio(ink, tint), `${mode} on ${under}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
