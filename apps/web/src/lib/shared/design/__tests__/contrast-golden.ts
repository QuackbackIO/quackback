/**
 * Measures today's theming for the golden contrast test: every preset and
 * the accent sweep, in light and dark, on the pairs the portal paints.
 *
 *   bun src/lib/shared/design/__tests__/contrast-golden.ts --write
 *
 * rewrites contrast.golden.known.json from the current code. Do that only to
 * remove pairs a change has fixed; the diff shows reviewers what moved.
 */
import { expandTheme } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { themePresets } from '@/lib/shared/theme/presets'
import { contrastRatio } from '../contrast'

/** Accents that have broken readability, from yellow on white to navy on black. */
export const ACCENT_SWEEP = [
  '#F5D90A',
  '#FFFF00',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
  '#8B5CF6',
  '#EF4444',
  '#0A0A0A',
  '#1E3A8A',
  '#777777',
  '#6B8E23',
]

type Token = keyof ReturnType<typeof expandTheme>

/** Text and edge pairs on the portal, by the tokens that paint them. */
export const PAIRS: Array<{ pair: string; fg: Token; bg: Token; min: number }> = [
  { pair: 'ink on background', fg: 'foreground', bg: 'background', min: 4.5 },
  { pair: 'ink on card', fg: 'cardForeground', bg: 'card', min: 4.5 },
  { pair: 'ink on muted', fg: 'foreground', bg: 'muted', min: 4.5 },
  { pair: 'secondary text on background', fg: 'mutedForeground', bg: 'background', min: 4.5 },
  { pair: 'secondary text on card', fg: 'mutedForeground', bg: 'card', min: 4.5 },
  { pair: 'secondary text on muted', fg: 'mutedForeground', bg: 'muted', min: 4.5 },
  { pair: 'button text on accent', fg: 'primaryForeground', bg: 'primary', min: 4.5 },
  { pair: 'links on background', fg: 'accentInk', bg: 'background', min: 4.5 },
  { pair: 'links on card', fg: 'accentInk', bg: 'card', min: 4.5 },
  { pair: 'error text on background', fg: 'destructive', bg: 'background', min: 4.5 },
  { pair: 'field edges on background', fg: 'input', bg: 'background', min: 3 },
  { pair: 'focus ring on background', fg: 'ring', bg: 'background', min: 3 },
  { pair: 'focus ring on card', fg: 'ring', bg: 'card', min: 3 },
]

export const MODES = ['light', 'dark'] as const

export function goldenThemes() {
  const out: Array<{
    theme: string
    mode: (typeof MODES)[number]
    vars: ReturnType<typeof expandTheme>
  }> = []
  for (const mode of MODES) {
    for (const [id, preset] of Object.entries(themePresets))
      out.push({ theme: `preset ${id}`, mode, vars: expandTheme(preset[mode], { mode }) })
    for (const accent of ACCENT_SWEEP)
      out.push({
        theme: `accent ${accent}`,
        mode,
        vars: expandTheme({ primary: hexToOklch(accent) }, { mode }),
      })
  }
  return out
}

/** Every failing pair, as "theme mode: pair ratio < min". */
export function goldenFailures(): string[] {
  const found: string[] = []
  for (const { theme, mode, vars } of goldenThemes()) {
    for (const { pair, fg, bg, min } of PAIRS) {
      const ratio = contrastRatio(String(vars[fg]), String(vars[bg]))
      if (ratio < min) found.push(`${theme} ${mode}: ${pair} ${ratio.toFixed(2)} < ${min}`)
    }
  }
  return found.sort()
}

if (import.meta.main && process.argv.includes('--write')) {
  const path = new URL('./contrast.golden.known.json', import.meta.url).pathname
  await Bun.write(path, `${JSON.stringify(goldenFailures(), null, 2)}\n`)
  console.log(`wrote ${goldenFailures().length} known failures to ${path}`)
}
