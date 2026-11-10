/**
 * Every pair of text and the colour behind it that a design draws, in each
 * mode it shows, with its contrast and the contrast it needs: 4.5:1 for
 * text, 3:1 for edges and the focus ring. Read from the resolved design, so
 * it is what visitors see after the solver's adjustments.
 */
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { mixOklch } from './color'
import { bandContrast, headlineBehind } from './components'
import { roleFill } from './colour-roles'
import { contrastRatio, solveContrast } from './contrast'
import { blockLookValue } from './defaults'
import { resolveDesignCached } from './resolve'
import type { PortalDesign } from './schema'
import { drawnSurfaces, type Drawn } from './surfaces'

export interface ColourPair {
  mode: 'light' | 'dark'
  /** What is drawn, such as "Secondary text". */
  text: string
  /** What it is drawn on, such as "cards". */
  on: string
  foreground: string
  background: string
  ratio: number
  target: number
  passes: boolean
  /** An exact colour moved so it reads: the colour that was set. */
  movedFrom?: string
  /** An exact colour no lightness of which reads, so it is not used. */
  unused?: boolean
}

type Token = keyof ThemeVariables

const PAIRS: Array<[string, Token, string, Token, number]> = [
  ['Text', 'foreground', 'the page', 'background', 4.5],
  ['Text', 'foreground', 'cards', 'card', 4.5],
  ['Text', 'foreground', 'raised surfaces', 'muted', 4.5],
  ['Secondary text', 'mutedForeground', 'the page', 'background', 4.5],
  ['Secondary text', 'mutedForeground', 'cards', 'card', 4.5],
  ['Button text', 'primaryForeground', 'buttons', 'primary', 4.5],
  ['Links', 'accentInk', 'the page', 'background', 4.5],
  ['Links', 'accentInk', 'cards', 'card', 4.5],
  ['Field edges', 'input', 'the page', 'background', 3],
  ['The focus ring', 'ring', 'the page', 'background', 3],
  ['The focus ring', 'ring', 'cards', 'card', 3],
]

function pair(
  mode: ColourPair['mode'],
  text: string,
  on: string,
  foreground: string,
  background: string,
  target: number
): ColourPair {
  const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100
  return { mode, text, on, foreground, background, ratio, target, passes: ratio >= target }
}

const ROLE_NAMES = {
  support: 'the second colour',
  extra1: 'the first extra colour',
  extra2: 'the second extra colour',
} as const

/** The site's own colour for each thing a surface draws. */
const DRAWN_IN: Record<Drawn, [Token, number]> = {
  Text: ['foreground', 4.5],
  'Secondary text': ['mutedForeground', 4.5],
  Links: ['accentInk', 4.5],
  'The focus ring': ['ring', 3],
}

/** The site's colours on the other surfaces it draws them on: tinted blocks, vote boxes, the footer. */
function surfacePairs(doc: PortalDesign, vars: ThemeVariables, mode: ColourPair['mode']) {
  const t = vars as Required<ThemeVariables>
  return drawnSurfaces(doc, t, mode).flatMap((surface) =>
    surface.draws.map((what) => {
      const [token, target] = DRAWN_IN[what]
      return pair(mode, what, surface.on, String(t[token]), surface.colour, target)
    })
  )
}

/**
 * The pairs Home blocks in a brand colour draw, for the colours in use: the
 * colour under its own text, and the raised parts on it, such as vote boxes.
 */
function tonePairs(doc: PortalDesign, vars: ThemeVariables, mode: ColourPair['mode']) {
  const roles = new Set(
    doc.pages.home.blocks
      .filter((block) => block.look?.tone === 'brand')
      .map((block) => blockLookValue(block.look, 'colour'))
  )
  const pairs: ColourPair[] = []
  for (const role of roles) {
    const { fill, ink } = roleFill(doc, vars as Required<ThemeVariables>, mode, role)
    if (!fill || !ink) continue
    const on = role === 'accent' ? 'brand colour blocks' : `blocks in ${ROLE_NAMES[role]}`
    pairs.push(pair(mode, 'Text', on, ink, fill, 4.5))
    const raised = mixOklch(ink, fill, 0.05)
    pairs.push(pair(mode, 'Text', `vote boxes in ${on}`, ink, raised, 4.5))
  }
  return pairs
}

/** Every pair the design draws, the failing ones first. */
export function colourPairs(doc: PortalDesign): ColourPair[] {
  const resolved = resolveDesignCached(doc)
  const pairs: ColourPair[] = []
  for (const mode of ['light', 'dark'] as const) {
    const vars = resolved[mode]
    if (!vars) continue
    for (const [text, fg, on, bg, target] of PAIRS) {
      const foreground = vars[fg]
      const background = vars[bg]
      if (typeof foreground === 'string' && typeof background === 'string')
        pairs.push(pair(mode, text, on, foreground, background, target))
    }
    const tokens = resolved.tokens[mode]
    const edge = tokens['--qb-vote-edge']
    if (edge && vars.card) pairs.push(pair(mode, 'Vote box edges', 'cards', edge, vars.card, 3))
    const band = bandContrast(doc, vars, mode)
    if (band) pairs.push(pair(mode, 'Headline', 'the hero', band.ink, band.background, band.target))
    const subtitle = tokens['--qb-band-subtitle']
    if (band && subtitle) {
      // Set large where it needs to be, so it reads at 3:1 as large text does.
      const target = tokens['--qb-band-subtitle-size'] ? 3 : 4.5
      pairs.push(pair(mode, 'Subtitle', 'the hero', subtitle, band.background, target))
    }
    const bandRing = tokens['--qb-band-focus']
    if (doc.layout.hero !== 'none' && bandRing) {
      // Where it reads worst, such as the foot of a fade.
      const behind = headlineBehind(doc, vars, mode).reduce((worst, each) =>
        contrastRatio(bandRing, each) < contrastRatio(bandRing, worst) ? each : worst
      )
      pairs.push(pair(mode, 'The focus ring', 'the hero', bandRing, behind, 3))
    }
    const header = tokens['--qb-header-bg']
    if (doc.layout.headerOnHero && header && tokens['--qb-header-focus'])
      pairs.push(pair(mode, 'The focus ring', 'the header', tokens['--qb-header-focus'], header, 3))
    pairs.push(...surfacePairs(doc, vars, mode), ...tonePairs(doc, vars, mode))
  }
  for (const tuned of resolved.tuned) {
    const drawn = pair(
      'light',
      `${tuned.part} colour`,
      'the page',
      tuned.used ?? tuned.set,
      tuned.on,
      tuned.target
    )
    if (!tuned.used) pairs.push({ ...drawn, unused: true })
    else pairs.push(tuned.used === tuned.set ? drawn : { ...drawn, movedFrom: tuned.set })
  }
  return pairs.sort((a, b) => Number(a.passes) - Number(b.passes))
}

/** The colour rows whose own value a failing pair is drawn in. */
const ROW_OF: Record<string, 'ink' | 'muted'> = { Text: 'ink', 'Secondary text': 'muted' }

/** A colour row that is hard to read: what on, and the nearest colour that reads. */
export interface ColourRowIssue {
  on: string[]
  /** The nearest colour that reads on all of them, or null when none does. */
  fix: string | null
}

/**
 * The brand's text colours, as set, that are hard to read in light, by row:
 * what they are hard to read on, and a colour to fix them in one click.
 */
export function colourRowIssues(
  doc: PortalDesign
): Partial<Record<'ink' | 'muted', ColourRowIssue>> {
  const failing = colourPairs(doc).filter((each) => !each.passes && each.mode === 'light')
  const issues: Partial<Record<'ink' | 'muted', ColourRowIssue>> = {}
  for (const key of ['ink', 'muted'] as const) {
    const set = doc.brand.light[key]
    if (!set) continue
    const hits = failing.filter(
      (each) => ROW_OF[each.text] === key && each.foreground.toLowerCase() === set.toLowerCase()
    )
    if (!hits.length) continue
    const target = Math.max(...hits.map((each) => each.target))
    issues[key] = {
      on: [...new Set(hits.map((each) => each.on))],
      fix: solveContrast(set, [...new Set(hits.map((each) => each.background))], target),
    }
  }
  return issues
}
