/**
 * What a brand match says: one sentence on what was matched, the questions
 * the screenshots could not settle (thin evidence, a conflict) asked
 * quietly, notes that are specific to this match (a stage that failed, a
 * font or logo it could not use, a photo to replace) for Show changes, and
 * follow-ups the person can send next, each of which fills the request box.
 */
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import { BUNDLED_FONTS, type BundledFontId } from '@/lib/shared/design/fonts'
import { MATCH_BRAND } from '@/lib/shared/design/match-brand'
import { colourName, secondName } from '@/lib/shared/design/colour-names'
import type { ColourRoles } from '../extract/roles'
import { NEAR_WHITE, QUIET, type PageFillDecision } from '../extract/page-fill-decide'

export { colourName, secondName }

/**
 * A page colour as a person names it: a pale, quiet colour by its cast
 * (cream, sage, grey-blue, lavender, blush), white where it is white, and a
 * stronger or darker one by colourName.
 */
export function pageColourName(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'colour'
  const parsed = parseOklch(hexToOklch(hex))
  if (!parsed) return 'colour'
  const { l, c, h } = parsed
  if (Math.hypot(1 - l, c) < NEAR_WHITE) return 'white'
  if (l < 0.8 || c > QUIET) return colourName(hex)
  if (c < 0.003) return 'grey'
  if (h >= 30 && h < 110) return l >= 0.93 ? 'cream' : 'beige'
  if (h >= 110 && h < 180) return 'sage'
  if (h >= 180 && h < 290) return c < 0.025 ? 'grey-blue' : 'blue'
  if (h >= 290 && h < 345) return 'lavender'
  return 'blush'
}

/** The page background a match set, in plain words. */
export function pageBackgroundWords(decided: PageFillDecision): string {
  const [first = '', ...rest] = decided.colours
  if (decided.look === 'tint') return `a soft ${pageColourName(first)} page, as your site has`
  if (decided.look === 'glow')
    return `a soft ${colourName(first)} glow behind the page, as your site has`
  const from = pageColourName(first)
  const to = pageColourName(rest.at(-1) ?? first)
  const way = from === to ? from : `${from}-to-${to}`
  return `a soft ${way} gradient behind the page, as your site has`
}

export interface BrandReplyInput {
  shots: number
  roles: ColourRoles | null
  heading: string | null
  band: string | null
  /** The page background set from measurement, or null for the page's own colour. */
  pageBackground?: PageFillDecision | null
  /** Short notes on stages that failed or ran out of time, each saying what was kept. */
  failed: string[]
  logo: 'placed' | 'not_found' | 'not_stored' | null
  /** The headline face is only the closest available. */
  faceClose: boolean | null
  /** The site leads with a photo: a crop of it placed in the hero, or only offered (a chip to add one). */
  photo?: 'placed' | 'offered' | null
  /** Why a photo seen was not placed (too small, blurred), when it was not. */
  photoWhy?: string | null
}

export interface BrandReply {
  reply: string
  /** Questions the screenshots could not settle, asked quietly. */
  asks: string[]
  /** What was left as it was, and why. */
  notes: string[]
  /** Follow-up requests, each filling the request box. */
  chips: string[]
}

const fontLabel = (id: string) =>
  Object.hasOwn(BUNDLED_FONTS, id) ? BUNDLED_FONTS[id as BundledFontId].label : id

export function brandReply(input: BrandReplyInput): BrandReply {
  const { roles } = input
  const from = input.shots === 1 ? 'your screenshot' : 'your screenshots'
  const parts: string[] = []
  if (roles) {
    parts.push(
      roles.monochrome
        ? 'a monochrome palette'
        : `${colourName(roles.identity.value)} as the brand colour`
    )
    if (roles.highlight.value) {
      const name = secondName(roles.identity.value, roles.highlight.value)
      parts.push(
        `${name === colourName(roles.highlight.value) ? '' : 'a '}${name} as the second colour`
      )
    }
    if (roles.scheme === 'dark') parts.push('a dark page, as your site has')
  }
  if (input.pageBackground) parts.push(pageBackgroundWords(input.pageBackground))
  if (input.heading) parts.push(`${fontLabel(input.heading)} for the type`)
  if (input.band) parts.push(BAND_WORDS[input.band] ?? 'the hero as measured')
  const matched = parts.length
    ? `I matched your brand from ${from}: ${parts.join(', ')}.`
    : `I matched what I could from ${from}.`
  // One sentence: what was matched. Anything else is a row under Show changes.
  const reply = matched
  const ask = roles?.ask
  const asks = !ask
    ? []
    : ask.kind === 'conflict'
      ? [
          `Your site is black and white, but your app uses ${colourName(ask.app)}. Use ${colourName(ask.app)} for links and the current menu item?`,
        ]
      : [ask.message]
  const notes = [
    input.photo === 'placed'
      ? `The hero photo is cut from ${from}: replace it with the original for best quality.`
      : '',
    ...input.failed,
    input.faceClose === false
      ? 'Your headline font is not one we have, so I used the closest match. You can upload yours in Theme > Brand kit > Fonts.'
      : '',
    input.logo === 'not_found' ? 'I could not find your logo, so it is as it was.' : '',
    input.logo === 'not_stored' ? 'I could not store the logo, so it is as it was.' : '',
    input.photo === 'offered'
      ? `Your site leads with a photo${input.photoWhy ? `, but ${input.photoWhy.replace(/^the photo /, 'it ')}` : ''}. Add one to the hero for the same feel.`
      : '',
  ].filter(Boolean)
  const chips = followUps(roles, input.band)
  // A photo-led site is offered a hero photo first, whether or not one was cut.
  return {
    reply,
    asks,
    notes,
    chips: input.photo ? [MATCH_BRAND.addHeroPhoto, ...chips].slice(0, 4) : chips,
  }
}

const BAND_WORDS: Record<string, string> = {
  none: 'a plain hero',
  tint: 'a tinted hero',
  fade: 'a soft fade behind the hero',
  brand: 'a hero in the brand colour',
  support: 'a hero in the second colour',
  blend: 'a blend of the brand colours behind the hero',
}

/**
 * Follow-ups: more of each brand colour (while it is not already bold), the
 * hero calmer or bolder, the app's colour for links when the site is
 * monochrome, and the site's own button colour when the portal's buttons
 * were made otherwise (black on the site, brand colour here, or the other
 * way round); nothing about buttons when none was seen or they agree.
 */
export function followUps(roles: ColourRoles | null, band: string | null): string[] {
  const chips: string[] = []
  if (roles && !roles.monochrome && roles.intensity !== 'bold')
    chips.push(`Use more ${colourName(roles.identity.value)}`)
  if (roles?.highlight.value)
    chips.push(`Use more ${secondName(roles.identity.value, roles.highlight.value)}`)
  if (band === 'brand' || band === 'support' || band === 'blend') chips.push('Calmer hero')
  else chips.push('Bolder hero')
  if (roles?.ask?.kind === 'conflict') chips.push(`Use ${colourName(roles.ask.app)} for links`)
  if (roles && !roles.monochrome) {
    const chosen = roles.action.value.role
    if (chosen === 'accent' && roles.buttons === 'ink')
      chips.push(roles.scheme === 'dark' ? 'White buttons' : 'Black buttons')
    else if (chosen === 'ink' && roles.buttons === 'accent')
      chips.push(`${capital(colourName(roles.identity.value))} buttons`)
  }
  return [...new Set(chips)].slice(0, 4)
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
