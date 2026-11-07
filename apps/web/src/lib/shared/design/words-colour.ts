/**
 * Words drawn in one of the brand's colour roles, made to read where they
 * sit, as the rest of the design's text is: a rich words colour is moved in
 * lightness until it reads at 4.5:1 on the cards and page a Welcome message
 * sits on, or on a tinted or brand colour block's own colour; a headline
 * accent's at 3:1 (large type) on the band, its panel, a veiled photo and a
 * plain page title. The tokens, and the rules that point the words at them,
 * exist only for the roles a design uses, so a design without them draws
 * exactly as before.
 */
import type { ThemeVariables } from '@/lib/shared/theme/types'
import { mixColor } from './color'
import { contrastRatio, solveContrast } from './contrast'
import { designRoles, roleFill, type ColourRole } from './colour-roles'
import { isColourRole, type WordsNode } from './rich-words'
import type { PortalDesign } from './schema'

type Mode = 'light' | 'dark'
type TokenMap = Record<`--${string}`, string>

/** The roles a document's words are coloured in. */
export function rolesIn(doc: WordsNode | null | undefined): Set<ColourRole> {
  const roles = new Set<ColourRole>()
  const walk = (node: WordsNode) => {
    for (const mark of node.marks ?? [])
      if (mark.type === 'colour' && isColourRole(mark.attrs?.role)) roles.add(mark.attrs.role)
    node.content?.forEach(walk)
  }
  if (doc) walk(doc)
  return roles
}

/** A Welcome message's words and what they sit on: its section on the page, and a block's look. */
interface Body {
  section: string
  doc: WordsNode
  tone?: 'card' | 'plain' | 'tint' | 'brand'
  colour?: ColourRole
}

function richBodies(doc: PortalDesign): Body[] {
  const bodies: Body[] = [
    { section: 'welcome', doc: doc.pages.feedback.welcome.body as unknown as WordsNode },
  ]
  doc.pages.home.blocks.forEach((block, index) => {
    if (block.type !== 'welcome') return
    bodies.push({
      section: `block-${block.id ?? index}`,
      doc: block.body as unknown as WordsNode,
      tone: block.look?.tone,
      colour: block.look?.colour,
    })
  })
  return bodies
}

/** Each rich words colour a design uses, moved until it reads where the words sit. */
export function wordsColourTokens(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode
): TokenMap {
  const out: TokenMap = {}
  for (const body of richBodies(doc)) {
    for (const role of rolesIn(body.doc)) {
      const { fill } = roleFill(doc, t, mode, role)
      if (body.tone === 'tint' || body.tone === 'brand') {
        const own = roleFill(doc, t, mode, body.colour)
        const under = body.tone === 'tint' ? mixColor(own.fill, t.card, 0.1) : own.fill
        const ink = body.tone === 'tint' ? t.foreground : own.ink
        out[`--qb-words-${body.section}-${role}`] = solveContrast(fill, [under], 4.5) ?? ink
      } else
        out[`--qb-words-${role}`] = solveContrast(fill, [t.card, t.background], 4.5) ?? t.foreground
    }
  }
  return out
}

/** The colour roles, other than the brand colour, that the design's headline accents are drawn in. */
export function accentRoles(doc: PortalDesign): Array<Exclude<ColourRole, 'accent'>> {
  const has = designRoles(doc)
  const headlines = [
    doc.pages.home.headline,
    doc.pages.feedback.headline,
    ...Object.values(doc.pages.titles ?? {}),
  ]
  const roles = new Set<Exclude<ColourRole, 'accent'>>()
  for (const headline of headlines) {
    const role = headline?.accent?.colour
    if (role && role !== 'accent' && has.includes(role)) roles.add(role)
  }
  return [...roles]
}

/** Where a headline accent sits, as the band's tokens describe it. */
export interface AccentGround {
  /** What the band's headline sits on, and its words' colour there. */
  behind: string[]
  ink: string
  /** The panel the band's words sit on, and its words' colour. */
  panel: { bg: string; ink: string }
  /** The worst colour of a veiled photo behind the words, and the words' colour on it. */
  photo: { under: string; ink: string } | null
}

/** A headline accent's colour in each role the design uses, read at 3:1 where it may sit. */
export function accentRoleTokens(
  doc: PortalDesign,
  t: Required<ThemeVariables>,
  mode: Mode,
  ground: AccentGround
): TokenMap {
  const out: TokenMap = {}
  for (const role of accentRoles(doc)) {
    const { fill } = roleFill(doc, t, mode, role)
    out[`--qb-band-accent-${role}`] = solveContrast(fill, ground.behind, 3) ?? ground.ink
    out[`--qb-band-highlight-${role}`] = highlightOf(fill, ground.behind[0]!, ground.ink)
    out[`--qb-band-panel-accent-${role}`] =
      solveContrast(fill, [ground.panel.bg], 3) ?? ground.panel.ink
    if (ground.photo)
      out[`--qb-photo-accent-${role}`] =
        solveContrast(fill, [ground.photo.under], 3) ?? ground.photo.ink
    out[`--qb-page-accent-${role}`] = solveContrast(fill, [t.background], 3) ?? t.foreground
    out[`--qb-page-highlight-${role}`] = mixColor(fill, t.background, 0.25)
  }
  return out
}

/** A highlighter in a colour: as it is where it is pale behind the words, else softened. */
function highlightOf(fill: string, behind: string, ink: string): string {
  return contrastRatio(ink, fill) >= 10 ? fill : mixColor(fill, behind, 0.35)
}

const ROLE = '(accent|support|extra1|extra2)'
const SECTION_TOKEN = new RegExp(`^--qb-words-(block-[a-z0-9]+)-${ROLE}$`)
const ACCENT_TOKEN = new RegExp(`^--qb-band-accent-${ROLE}$`)

/**
 * The rules that point coloured words at their tokens: a block's words at
 * the colour read on the block, and an accent at the colour read where it sits.
 * Empty when the design colours no words.
 */
export function wordsColourCss(tokens: TokenMap): string {
  const rules: string[] = []
  for (const name of Object.keys(tokens)) {
    const section = SECTION_TOKEN.exec(name)
    if (section)
      rules.push(
        `[data-portal-theme] [data-qb-section=${section[1]}] { --qb-words-${section[2]}: var(${name}); }`
      )
    const accent = ACCENT_TOKEN.exec(name)
    if (!accent) continue
    const role = accent[1]
    const at = `[data-qb-accent-colour=${role}]`
    rules.push(
      `[data-portal-theme] ${at} { --qb-band-accent: var(--qb-band-accent-${role}); --qb-band-highlight: var(--qb-band-highlight-${role}); }`,
      `[data-qb-band-shape=panel] [data-qb-part=band] ${at} { --qb-band-accent: var(--qb-band-panel-accent-${role}); }`
    )
    if (tokens[`--qb-photo-accent-${role}`])
      rules.push(
        `[data-portal-theme] [data-qb-photo-shade] ${at} { --qb-band-accent: var(--qb-photo-accent-${role}); }`
      )
    rules.push(
      `[data-portal-theme] [data-qb-section=hero]:not([data-qb-part=band]) ${at} { --qb-band-accent: var(--qb-page-accent-${role}); --qb-band-highlight: var(--qb-page-highlight-${role}); }`
    )
  }
  return rules.length ? `@layer design { ${rules.join(' ')} }` : ''
}
