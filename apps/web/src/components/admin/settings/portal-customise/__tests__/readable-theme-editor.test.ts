/**
 * The Customise editor holds the expanded stylesheet and reads its palettes
 * back out of it on every edit, so what expansion moves to make text read
 * (a button fill darkened for white words, pale text, a main colour lightened
 * on a dark page) must come back unchanged on the next pass. Anything that
 * moved again would drift on each edit, or be kept as Advanced CSS.
 */
import { describe, expect, it } from 'vitest'
import { unbrandedTheme } from '@/lib/shared/theme'
import { applyColour, contrastRatio, type ColourRole } from '@/lib/shared/theme/colour-setters'
import { generateReadableCSS } from '@/lib/shared/theme/readable-css'
import { editPalettes, palettesOf } from '@/components/admin/settings/branding/theme-css'

const COLOURS = [
  '#6366f1',
  '#0d9488',
  '#059669',
  '#0284c7',
  '#facc15',
  '#d1f470',
  '#ff6600',
  '#e11d48',
  '#757575',
  '#7b7b7b',
  '#808080',
  '#5f8f3a',
  '#000000',
  '#171717',
  '#1e1f22',
  '#313338',
  '#113b92',
  '#3b0764',
  '#f5f7fb',
  '#ffffff',
]
/** A few of each kind for two roles at once. */
const PAIR_COLOURS = [
  '#6366f1',
  '#0d9488',
  '#facc15',
  '#ff6600',
  '#7b7b7b',
  '#5f8f3a',
  '#000000',
  '#313338',
  '#113b92',
  '#ffffff',
]
const MODES = ['light', 'dark'] as const
const PAIRS: Array<[ColourRole, ColourRole]> = [
  ['background', 'foreground'],
  ['background', 'primary'],
  ['header', 'primary'],
]

type Set = Partial<Record<ColourRole, string>>

function sets(): Set[] {
  const out: Set[] = []
  for (const role of ['primary', 'background', 'foreground', 'header'] as const)
    for (const hex of COLOURS) out.push({ [role]: hex })
  for (const [a, b] of PAIRS)
    for (const x of PAIR_COLOURS) for (const y of PAIR_COLOURS) out.push({ [a]: x, [b]: y })
  return out
}

/** The editor's stylesheet after setting each colour in turn, background first. */
function stylesheet(mode: 'light' | 'dark', set: Set): string {
  let css = generateReadableCSS(unbrandedTheme('light'), unbrandedTheme('dark'), 'user')
  for (const role of ['background', 'foreground', 'primary', 'header'] as const) {
    const hex = set[role]
    if (hex) css = editPalettes(css, (light, dark) => applyColour(light, dark, role, mode, hex))
  }
  return css
}

describe('the editor’s readable theme', () => {
  it('is stable: its stylesheet read back writes itself again', () => {
    const drifted = MODES.flatMap((mode) =>
      sets().flatMap((set) => {
        const css = stylesheet(mode, set)
        const back = palettesOf(css)
        return generateReadableCSS(back.light, back.dark, 'user') === css
          ? []
          : [`${mode} ${JSON.stringify(set)}`]
      })
    )
    expect(drifted.slice(0, 10)).toEqual([])
  })

  it('moves pale text rather than the surfaces under it, so they come back with it', () => {
    const start = palettesOf(stylesheet('light', {})).light
    const pale = palettesOf(stylesheet('light', { foreground: '#bbbbbb' })).light
    expect(contrastRatio(pale.foreground!, pale.muted!)).toBeGreaterThanOrEqual(4.5)
    expect([pale.card, pale.muted]).toEqual([start.card, start.muted])
  })
})
