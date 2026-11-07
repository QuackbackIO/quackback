/**
 * Golden contrast for the design engine: every preset and the accent sweep,
 * converted from today's settings and resolved in light and dark, pass every
 * pair the portal paints. Unlike today's theming (contrast.golden.test.ts),
 * nothing is allowed to fall short.
 */
import { describe, expect, it } from 'vitest'
import { themePresets } from '@/lib/shared/theme/presets'
import { contrastRatio } from '../contrast'
import { convertLegacyBranding } from '../convert'
import { resolveDesign } from '../resolve'
import { ACCENT_SWEEP, PAIRS } from './contrast-golden'

const designs = [
  ...Object.entries(themePresets).map(([id, preset]) => ({
    name: `preset ${id}`,
    doc: convertLegacyBranding({
      brandingConfig: { preset: id, themeMode: 'user', light: preset.light, dark: preset.dark },
    }),
  })),
  ...ACCENT_SWEEP.map((accent) => ({
    name: `accent ${accent}`,
    doc: convertLegacyBranding({
      brandingConfig: { themeMode: 'user', light: { primary: accent }, dark: { primary: accent } },
    }),
  })),
]

describe('golden contrast for the design engine', () => {
  it.each(designs)('$name passes every pair in light and dark', ({ doc }) => {
    const resolved = resolveDesign(doc)
    expect(resolved.errors).toEqual([])
    const failures: string[] = []
    for (const mode of ['light', 'dark'] as const) {
      const vars = resolved[mode]!
      for (const { pair, fg, bg, min } of PAIRS) {
        const ratio = contrastRatio(String(vars[fg]), String(vars[bg]))
        if (ratio < min) failures.push(`${mode}: ${pair} ${ratio.toFixed(2)} < ${min}`)
      }
    }
    expect(failures).toEqual([])
  })
})
