/**
 * From what was measured and decided to changes to the draft, each with the
 * evidence it came from (its "why"): the colour roles (T1), the decision
 * table for type and geometry (T2), the logo's placement (T3), the faces
 * (T4), the hero family and the words. Then the rules that keep the changes
 * from contradicting each other, decided here rather than by another model
 * call. Contrast and the schema are checked as the changes are applied.
 */
import { FONT_PAIRS } from '@/lib/shared/design/curated'
import { BUNDLED_FONTS, type BundledFontId } from '@/lib/shared/design/fonts'
import {
  HOME_LAYOUTS,
  arrangeHome,
  keptHomeLayout,
  type HomeLayout,
} from '@/lib/shared/design/home-layouts'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { TRACKING_EM } from '@/lib/shared/design/effective-values'
import { headlineMarkup, oneLine } from '@/lib/shared/design/rich-words'
import { headlineWordsFrom, plainWords } from '@/lib/shared/design/words-markup'
import type { MeasuredDesign } from '../extract/measured-design'
import type { TypeMatch } from '../extract/fonts/type-match'
import type { TypeMatches } from '../extract/fonts/type-crops'
import type { HeadlineTone } from '../extract/headline-tone'
import type { PageFillDecision } from '../extract/page-fill-decide'
import { subtitleSize, type FoundLogo } from './brand-measure'
import { heroActionChange } from './hero-action'
import { heroColourChanges } from './hero-colours'
import type { HeroDecision } from './hero-rules'
import type { HeroLayout } from './hero-geometry'
import type { HomeArrangement, WordsAnswer } from './words-family'
import { lowerCaseChanges } from './words-case'
import { postsInWords } from './words-posts'

export interface BrandChange {
  path: string
  value: unknown
  /** The evidence it came from, as a reply says it. */
  why: string
}

type Change = BrandChange
const change = (path: string, value: unknown, why: string): Change => ({ path, value, why })

/** Text cut at a word boundary to fit a field. */
export function fit(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : max).trim()
}

export { colourChanges } from './colour-changes'

/** What a match sets behind the page: a tint or a gradient, in either mode. */
const MATCHED_KINDS = new Set(['tint', 'gradient'])

/**
 * T1: the page background measured (a tint, a drift or a glow), else none.
 * A match owns the look, so a tint or gradient a match set before goes when
 * this site shows none; an uploaded image or a pattern is the person's own
 * and stays.
 */
export function pageBackgroundChanges(
  decided: PageFillDecision | null,
  current: PortalDesign['layout']['background']
): Change[] {
  if (decided) return [change('layout.background', decided.background, decided.why)]
  const matched =
    !!current &&
    (MATCHED_KINDS.has(current.kind) ||
      (current.kind === 'solid' && !!current.dark && MATCHED_KINDS.has(current.dark.kind)))
  return matched
    ? [change('layout.background', { kind: 'solid' }, 'your site’s page is one plain colour')]
    : []
}

const nearestOf = (options: readonly number[], v: number) =>
  options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

/** A face the portal bundles, by id. */
const bundled = (id: string): id is BundledFontId => Object.hasOwn(BUNDLED_FONTS, id)

/**
 * T4: the faces. Inter and Inter Tight are one design: the headline's is
 * settled where its spacing is fitted (atDrawnWeight), and body text takes
 * Inter.
 */
export function faceIds(type: TypeMatches): { heading: string | null; body: string | null } {
  const body = type.body?.face.id ?? null
  return { heading: type.headline?.face.id ?? null, body: body === 'inter-tight' ? 'inter' : body }
}

const faceWhy = (m: TypeMatch & { why?: string }, what: string) =>
  `${what} drawn in each bundled face: ${m.close ? 'the closest match' : 'the closest available, as nothing bundled is close'}${m.why ? `; ${m.why}` : ''}`

/** T2 and T4: type, corners, cards, density, width, header and menu, and their exact values. */
export function typeAndShapeChanges(m: MeasuredDesign, type: TypeMatches | null): Change[] {
  const out: Change[] = []
  const { fields: f, why, tune } = m
  const faces = type ? faceIds(type) : { heading: null, body: null }
  const heading = faces.heading && bundled(faces.heading) ? faces.heading : null
  const body = faces.body && bundled(faces.body) ? faces.body : null
  if (heading && type?.headline)
    out.push(
      change(
        'brand.fonts.heading',
        { kind: 'bundled', id: heading },
        faceWhy(type.headline, 'the headline')
      )
    )
  if (body && type?.body)
    out.push(
      change(
        'brand.fonts.body',
        { kind: 'bundled', id: body },
        faceWhy(type.body, 'the text under the headline')
      )
    )
  const pair = FONT_PAIRS.find((p) => p.heading === heading && p.body === (body ?? heading))
  if (pair && out[0]) out[0].why += `; with the body face, the ${pair.label} pair`
  // A weight the heading face loads, so none is faked.
  const loads = heading ? BUNDLED_FONTS[heading].weights : DESIGN_OPTIONS.headingWeight
  const offered = DESIGN_OPTIONS.headingWeight.filter((w) => loads.includes(w))
  if (f.headingWeight && offered.length)
    out.push(
      change('brand.fonts.headingWeight', nearestOf(offered, f.headingWeight), why.headingWeight!)
    )
  const field = (key: keyof MeasuredDesign['fields'], path: string) => {
    if (f[key] !== undefined) out.push(change(path, f[key], why[key] ?? 'measured'))
  }
  field('typeScale', 'brand.fonts.scale')
  field('tracking', 'brand.fonts.tracking')
  field('textCase', 'brand.fonts.headlineCase')
  field('corners', 'shape.corners')
  field('buttons', 'shape.buttons')
  field('cards', 'layout.cards')
  field('density', 'layout.density')
  field('width', 'layout.width')
  field('header', 'layout.header')
  field('menuAlign', 'layout.menuAlign')
  field('nav', 'layout.nav')
  field('navText', 'layout.navText')
  // No current item showed: the default grey pill would be an invention; underline is the quietest.
  if (f.nav === undefined)
    out.push(change('layout.nav', 'underline', 'no current menu item showed; the quietest style'))
  if (tune.headline) {
    const t = tune.headline
    out.push(change('tune.headline.size', t.size, why.typeScale ?? 'headline size'))
    out.push(
      change(
        'tune.headline.weight',
        nearestOf(loads, t.weight),
        why.headingWeight ?? 'headline weight'
      )
    )
    // Without a clear reading, the house spacing: an earlier design's would otherwise stay.
    out.push(
      t.tracking !== undefined
        ? change('tune.headline.tracking', t.tracking, why.tracking ?? 'headline letter-spacing')
        : change(
            'tune.headline.tracking',
            TRACKING_EM.normal,
            'the house letter-spacing: no clear reading for this face'
          )
    )
    // One line (or a pitch not believed): the face's own line height, as an earlier design's would otherwise stay.
    out.push(
      t.leading !== undefined
        ? change('tune.headline.leading', t.leading, 'the headline’s line pitch')
        : change(
            'tune.headline.leading',
            null,
            'the headline’s own line height: one line, or no clear pitch'
          )
    )
  }
  if (tune.heading)
    out.push(change('tune.heading.size', tune.heading.size, why.heading ?? 'section heading size'))
  const sub = subtitleSize(type?.body ?? null)
  if (sub) out.push(change('tune.subtitle.size', sub, `the subtitle, ${sub}px in its face`))
  if (tune.button) {
    out.push(change('tune.button.radius', tune.button.radius, why.buttons ?? 'button corners'))
    if (tune.button.height)
      out.push(change('tune.button.height', tune.button.height, 'main button height'))
  }
  if (tune.card) {
    if (tune.card.radius !== undefined)
      out.push(change('tune.card.radius', tune.card.radius, why.corners ?? 'card corners'))
    if (tune.card.border !== undefined)
      out.push(change('tune.card.border', tune.card.border, why.cards ?? 'card edge'))
    if (tune.card.shadow)
      out.push(change('tune.card.shadow', tune.card.shadow, why.cards ?? 'card shadow'))
  }
  return out
}

/** The most a set-apart phrase holds. */
const ACCENT_MAX = 60

/** Words from the head or the tail of a list, as many as fit the phrase's limit. */
function fitWords(words: string[], place: 'head' | 'tail'): string {
  const list = place === 'tail' ? [...words] : [...words]
  while (list.length > 1 && list.join(' ').length > ACCENT_MAX)
    if (place === 'tail') list.shift()
    else list.pop()
  return list.join(' ').slice(0, ACCENT_MAX)
}

/**
 * The part of a portal headline to set apart where the site's headline is
 * two-tone: its later or first sentence, else the part after or before its
 * first clause break, else its later or first half of words. Null for a
 * title too short to split.
 */
export function accentPhrase(title: string, place: 'head' | 'tail'): string | null {
  const t = title.trim()
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean)
  let phrase: string | null = null
  if (sentences.length >= 2)
    phrase = place === 'tail' ? sentences.slice(1).join(' ') : sentences[0]!
  else {
    const clause = /,\s+|\s+[–—-]\s+|:\s+/.exec(t)
    if (clause)
      phrase =
        place === 'tail' ? t.slice(clause.index + clause[0].length) : t.slice(0, clause.index)
    else {
      const words = t.split(/\s+/)
      if (words.length < 3) return null
      const half = Math.ceil(words.length / 2)
      phrase = (place === 'tail' ? words.slice(-half) : words.slice(0, words.length - half)).join(
        ' '
      )
    }
  }
  const fitted = fitWords(phrase.split(/\s+/), place).trim()
  return fitted && fitted !== t ? fitted : null
}

/**
 * The site's two-tone headline carried to the portal's headlines: the same
 * part (its start or its end) set apart in the same way (in colour, or
 * lighter), on each headline the match wrote, through the words markup as
 * the AI writes it, so the builder's editor finds the phrase in the title.
 */
export function headlineAccentChanges(
  tone: HeadlineTone | null,
  changes: readonly Change[],
  language: string
): Change[] {
  if (!tone) return []
  const why = `your headline's ${tone.place === 'tail' ? 'later' : 'first'} part is set in a second, ${tone.style === 'muted' ? 'lighter' : 'coloured'} ink`
  return (['home', 'feedback'] as const).flatMap((page) => {
    const title = changes.find((c) => c.path === `pages.${page}.headline.title`)?.value
    const phrase = typeof title === 'string' ? accentPhrase(title, tone.place) : null
    if (typeof title !== 'string' || !phrase) return []
    const words = headlineWordsFrom(
      headlineMarkup({ title: oneLine(title), accent: { text: phrase, style: tone.style } })
    )
    if (!words.accent) return []
    return [
      ...(words.title !== title ? [change(`pages.${page}.headline.title`, words.title, why)] : []),
      change(
        `pages.${page}.headline.accent`,
        { style: words.accent.style, text: { [language]: words.accent.text } },
        why
      ),
    ]
  })
}

/**
 * The hero as decided (decideHero: rules first, the model where they leave it
 * open) as fields, with its layout measured from the boxes (heroLayout): the
 * words' alignment, the band's height and a picture's place. Art and a shared
 * header only with a band that has colour; a picture's place only when the
 * design has a band image to place.
 */
export function heroChanges(input: {
  hero: HeroDecision
  layout: HeroLayout
  hasBandImage: boolean
  /** The design's extra colours as the colour roles set them (the logo's further colours). */
  extras?: readonly string[] | null
}): Change[] {
  const { hero, layout } = input
  const why = hero.why
  const out: Change[] = []
  if (hero.blend) out.push(change('layout.blend', hero.blend, why))
  out.push(change('layout.hero', hero.band, why))
  out.push(...heroColourChanges(hero, input.extras))
  const coloured = hero.band === 'brand' || hero.band === 'support' || hero.band === 'blend'
  if (coloured) out.push(change('layout.heroShape', hero.shape, why))
  out.push(change('layout.heroArt', hero.band === 'none' ? 'none' : hero.art, why))
  out.push(change('layout.headerOnHero', coloured && hero.headerOnHero, why))
  // A panel beside a picture the design lacks would leave half the band empty: centre it.
  const lone = coloured && hero.shape === 'panel' && !input.hasBandImage
  const centre = lone && (hero.picture !== null || layout.picture !== null)
  const align = centre ? 'centre' : layout.align
  const alignWhy = centre
    ? 'the site’s picture is not in the design, so the panel is centred'
    : null
  if (align) out.push(change('layout.heroAlign', align, alignWhy ?? layout.why.align ?? 'measured'))
  if (layout.height && hero.band !== 'none')
    out.push(change('layout.heroHeight', layout.height, layout.why.height ?? 'measured'))
  // A picture's place only matters for a hero that has one; none is taken from screenshots.
  // Where the site's picture sits is measured; a set-in band keeps it beside the words.
  const measured = layout.picture
  const place =
    hero.shape === 'inset' || hero.shape === 'panel'
      ? hero.picture || measured
        ? 'side'
        : null
      : (measured ?? hero.picture)
  if (input.hasBandImage && coloured && place)
    out.push(
      change(
        'layout.imagePlace',
        place,
        measured ? (layout.why.picture ?? why) : `the hero's picture: ${why}`
      )
    )
  return out
}

/** Home arrangements: the approved goal designs' one, and the house layouts by what leads. */
const ARRANGEMENTS: Record<HomeArrangement, HomeLayout> = {
  portal: {
    id: 'portal',
    label: 'Portal',
    description: 'Asking, contact, ideas beside updates, the roadmap and help.',
    blocks: [
      ['composer', 12],
      ['contact', 12],
      ['ideas', 6],
      ['updates', 6],
      ['roadmap', 12],
      ['help_search', 12],
      ['help_topics', 12],
    ],
  },
  feedback_first: HOME_LAYOUTS.find((l) => l.id === 'feedback')!,
  help_first: HOME_LAYOUTS.find((l) => l.id === 'help')!,
  roadmap_first: HOME_LAYOUTS.find((l) => l.id === 'roadmap')!,
}

/**
 * A headline as the words model holds it: its words, and a phrase marked in
 * them (`[words]{accent}`) as its accent, in the language written.
 */
function headlineChanges(
  page: 'home' | 'feedback',
  text: string,
  language: string,
  why: string
): Change[] {
  const words = headlineWordsFrom(text)
  const title = fit(words.title, 80)
  const accent = words.accent && title.includes(words.accent.text) ? words.accent : null
  const set = accent && { style: accent.style, text: { [language]: accent.text } }
  return [
    change(`pages.${page}.headline.title`, title, why),
    ...(set ? [change(`pages.${page}.headline.accent`, set, why)] : []),
  ]
}

/** Plain words cut to a field, with any marks taken off. */
const plainFit = (text: string, max: number) => fit(plainWords(text), max)

/** Composition and wording, last: Home's blocks, its headline in the band with the composer, and the words. */
export function wordsChanges(
  written: WordsAnswer,
  design: PortalDesign,
  gates: PortalPageGates,
  language = 'en'
): Change[] {
  // The portal is a feedback board: English words that still say "idea" say "post".
  const words = postsInWords(written, language)
  const why = `in the brand's voice: ${words.evidence}`
  const out: Change[] = [
    ...headlineChanges('feedback', words.feedback_headline, language, why),
    change('pages.feedback.headline.subtitle', plainFit(words.feedback_subtitle, 140), why),
    ...lowerCaseChanges(words),
  ]
  if (words.prompt.trim())
    out.push(change('pages.feedback.copy.prompt', plainFit(words.prompt, 60), why))
  if (words.submit.trim())
    out.push(change('pages.feedback.copy.submit', plainFit(words.submit, 24), why))
  // A Home already arranged keeps its order: the words do not move blocks about.
  const layout = keptHomeLayout(design.pages.home.blocks) ?? ARRANGEMENTS[words.home_layout]
  // With a headline, the composer moves into the band under it, so Home is
  // arranged without it on the grid: its place there would be a hole.
  const band = !!words.home_headline.trim()
  out.push(
    change(
      'pages.home.blocks',
      arrangeHome(design.pages.home.blocks, layout, gates, { band }),
      `Home: ${layout.description.toLowerCase()}`
    )
  )
  if (band) {
    out.push(...headlineChanges('home', words.home_headline, language, why))
    out.push(change('pages.home.headline.subtitle', plainFit(words.home_subtitle, 140), why))
    out.push(
      change('pages.home.composer', 'band', 'the composer under Home’s headline, as the hero')
    )
    // Only a Home that was off is turned on, so the reply says it added a Home page only then.
    if (!design.nav.home.on) out.push(change('nav.home.on', true, 'Home leads the portal'))
    if (!design.nav.home.tab) out.push(change('nav.home.tab', true, 'Home leads the portal'))
  }
  return out
}

/** T3: the logo cut, as the full logo for a wordmark, or the icon beside the title. */
export function logoChanges(logo: FoundLogo, key: string, title: string | null): Change[] {
  const why = `cut from your screenshot (${logo.placement.kind.replace(/_/g, ' ')})`
  const tone = change(
    'brand.logo.tone',
    logo.tone,
    'the logo’s ink, so it is redrawn where the header would swallow it'
  )
  const oneInk = change(
    'brand.logo.oneInk',
    logo.oneInk ? true : null,
    logo.oneInk
      ? 'the logo is one ink, so it is drawn reversed where the header would swallow it'
      : 'the logo has several colours, so it keeps them and only its vanishing ink is turned over'
  )
  const ink = change('brand.logo.ink', logo.ink, 'drawn in the header’s text on its own colour')
  const inks = [tone, oneInk, ink]
  if (logo.placement.use === 'full_logo')
    return [
      change('brand.logo.wordmark.light', { key }, why),
      change('brand.logo.display', 'wordmark', 'the logo shows the name itself'),
      ...inks,
    ]
  return [
    change('brand.logo.mark.light', { key }, why),
    change('brand.logo.display', 'mark_and_name', 'a symbol, shown beside the name'),
    ...inks,
    ...(title ? [change('brand.logo.name', title, 'the name the logo shows')] : []),
  ]
}

/**
 * Rules that keep the changes from contradicting each other: a later change
 * to the same field wins; a second-colour hero or action needs the second
 * colour; art and a shared header only with a coloured hero; the other
 * pages' titles follow Home's hero.
 */
export function reconcile(changes: readonly Change[]): Change[] {
  const last = new Map<string, Change>()
  for (const c of changes) last.set(c.path, c)
  const value = (path: string) => last.get(path)?.value
  const support = value('brand.light.support')
  if (!support) {
    if (value('layout.hero') === 'support')
      last.set('layout.hero', { ...last.get('layout.hero')!, value: 'brand' })
    if (value('shape.action') === 'support') last.delete('shape.action')
    if (value('layout.tint') === 'support')
      last.set('layout.tint', { ...last.get('layout.tint')!, value: 'neutral' })
  }
  const band = value('layout.hero')
  // The other pages open as Home does: on the band when Home has a coloured
  // hero, on a plain title when it has none (as every approved goal design).
  if (typeof band === 'string')
    last.set('layout.pageTitles', {
      path: 'layout.pageTitles',
      value: band === 'none' ? 'plain' : 'band',
      why:
        band === 'none'
          ? 'the other pages open on a plain title, as Home does'
          : 'the other pages open on the band, as Home does',
    })
  if (band === 'none' || band === 'tint' || band === 'fade') {
    if (last.has('layout.headerOnHero'))
      last.set('layout.headerOnHero', { ...last.get('layout.headerOnHero')!, value: false })
    if (last.has('layout.heroArt') && band === 'none')
      last.set('layout.heroArt', { ...last.get('layout.heroArt')!, value: 'none' })
  }
  const action = heroActionChange([...last.values()])
  if (action) last.set('shape.action', action)
  // In the order given, so a colour lands before what is drawn in it; a
  // field only a rule set comes last.
  const kept = changes.flatMap((c, i) =>
    last.has(c.path) && changes.findLastIndex((x) => x.path === c.path) === i
      ? [last.get(c.path)!]
      : []
  )
  const added = [...last.values()].filter((c) => !changes.some((x) => x.path === c.path))
  return [...kept, ...added]
}
