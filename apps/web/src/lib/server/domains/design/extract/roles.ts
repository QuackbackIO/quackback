/**
 * Colour roles from screenshots: where each colour was seen, how much of the
 * page's own interface (photos and gradients left out) it covers, and the
 * five decisions a brand designer makes from that:
 *
 * 1. identity: the brand's colour (logo, brand surfaces, key moments);
 * 2. action: what fills the main button (the brand colour, the text colour,
 *    a second colour, or an exact neutral);
 * 3. links and the current menu item;
 * 4. highlight: the second colour, for badges, notices and bands;
 * 5. tints: what tints the vote box and the current menu item.
 *
 * Rules decide wherever the evidence settles it, each with its reason; what
 * stays open goes to a small classifier (roles-classifier.ts). When the
 * screenshots show no main button, links or current menu item, the result
 * asks for one more screenshot; when a monochrome site's product screenshot
 * shows an accent, it asks which to use and stays monochrome meanwhile.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import { deltaE00 } from './color'
import { chromaOf } from './colours'
import { contrast, hexRgb } from './roles-places'
import { vividOverPale } from './roles-pale'
import { placesOf } from './roles-words'
import { signatureAccent } from './roles-signature'

export { describeCandidate } from './roles-words'
import {
  hexLab,
  inkButton,
  isLightNeutralHex,
  sameColour,
  siteButtons,
  siteScheme,
} from './roles-scheme'
import { NEUTRAL, type Candidate, type ColourEvidence, type Source } from './roles-evidence'

export { contrast, hexRgb } from './roles-places'
export { sameColour, siteScheme } from './roles-scheme'
export {
  chromatic,
  colourEvidence,
  SOURCES,
  SOURCE_WORDS,
  type Candidate,
  type ColourEvidence,
  type ShotEvidence,
  type ShotInput,
  type Sighting,
  type Source,
} from './roles-evidence'

/** How much each place says "this is the brand's colour". Photos never count. */
export const IDENTITY_WEIGHT: Record<Source, number> = {
  logo_field: 3,
  logo: 3,
  button: 3,
  header_button: 2,
  second_button: 1,
  second_button_text: 0.7,
  link: 2,
  active_nav: 2,
  nav_text: 1,
  headline: 1,
  badge: 0.3,
  header_band: 2,
  hero_surface: 1.5,
  surface: 1,
  card: 0.5,
  hero_gradient: 0.3,
  gradient: 0.2,
  product: 0.4,
}

/** How much each place says "this is the second colour" (badges, notices, bands). */
const SECOND_WEIGHT: Record<Source, number> = {
  logo_field: 2,
  logo: 2,
  button: 2,
  header_button: 1.5,
  second_button: 1,
  second_button_text: 0.7,
  link: 1,
  active_nav: 1,
  nav_text: 0.5,
  headline: 0.5,
  badge: 1.5,
  header_band: 1.5,
  hero_surface: 2,
  surface: 1.5,
  card: 1,
  hero_gradient: 1.5,
  gradient: 0.5,
  product: 0.3,
}

/** Where a decision came from. */
export type DecidedBy = 'rule' | 'model' | 'default'

export const ACTION_ROLES = ['accent', 'ink', 'support', 'neutral'] as const
export type ActionRole = (typeof ACTION_ROLES)[number]

export interface Decision<T> {
  value: T
  why: string
  by: DecidedBy
}

export type Ask =
  | { kind: 'thin'; missing: string[]; message: string }
  | { kind: 'conflict'; app: string; message: string }

export interface ColourRoles {
  /** The brand colour. */
  identity: Decision<string>
  /** What fills the main button, and its exact colour. */
  action: Decision<{ role: ActionRole; hex: string }>
  /**
   * What fills the site's own main button, measured: the brand colour, the
   * dark text colour, another colour or grey; null when no main button was
   * seen (or only a light one on a dark or photo hero).
   */
  buttons: ActionRole | null
  /** Links and the current menu item: the brand colour, or the text colour. */
  links: Decision<{ role: 'accent' | 'ink'; hex: string }>
  /** The second colour: badges, notices, bands. */
  highlight: Decision<string | null>
  /** What tints the vote box and the current menu item. */
  tint: Decision<'neutral' | 'support'>
  /** Further brand colours (up to two), e.g. a multi-colour logo's. */
  extras: string[]
  logoColours: string[]
  /** No brand colour anywhere but the product pictures. */
  monochrome: boolean
  /** A black and white site's one vivid colour, used sparingly, is its identity (roles-signature.ts). */
  signature: boolean
  /** How much of the interface the brand colour covers (0 to 1), and the word for it. */
  coverage: number
  intensity: 'quiet' | 'medium' | 'bold'
  /** What the hero shows: a solid colour (which role), a gradient, a photo, or plain. */
  hero: {
    look: 'solid' | 'gradient' | 'photo' | 'plain' | 'none'
    role: 'accent' | 'support' | 'extra1' | null
  }
  /** A question for the person, when the screenshots cannot settle it. */
  ask: Ask | null
  /** Decisions left for the classifier (empty when rules settled everything). */
  open: OpenDecision[]
  text: string
  page: string
  /** The site's own scheme: a dark page with light text, or a light one. */
  scheme: 'light' | 'dark'
}

export type OpenDecision = 'identity' | 'action' | 'highlight'

const score = (c: Candidate, w: Record<Source, number>) => {
  // One count per place and screenshot; a logo colour counts by its share of the logo.
  const seen = new Map<string, number>()
  for (const s of c.sightings) {
    const k = `${s.source}:${s.shot}`
    const v =
      w[s.source] *
      (s.source === 'logo' || s.source === 'product'
        ? Math.max(0.35, Math.min(1, s.share * 1.6))
        : 1)
    seen.set(k, Math.max(seen.get(k) ?? 0, v))
  }
  let total = 0
  for (const v of seen.values()) total += v
  // A very dark colour seen only as type or in a logo reads as ink (navy or aubergine text), not as the brand's colour.
  if (
    c.lightness < 0.25 &&
    !has(c, 'button', 'header_button', 'second_button', 'header_band', 'hero_surface', 'surface')
  )
    total *= 0.5
  // A little for covering the interface, never enough on its own.
  return total + Math.min(1, c.coverage * 10)
}

const has = (c: Candidate, ...sources: Source[]) =>
  c.sightings.some((s) => sources.includes(s.source))
const siteSources = (c: Candidate) =>
  c.sightings.filter((s) => s.source !== 'product' && s.source !== 'gradient')
const de = (a: string, b: string) => deltaE00(hexRgb(a), hexRgb(b))

/** Chromatic candidates, strongest identity evidence first. */
export function ranked(ev: ColourEvidence): { c: Candidate; score: number }[] {
  return ev.candidates
    .filter((c) => !c.neutral && siteSources(c).length)
    .map((c) => ({ c, score: score(c, IDENTITY_WEIGHT) }))
    .sort((a, b) => b.score - a.score)
}

/** The five decisions by rule, with what stays open for the classifier. */
/** Choices made elsewhere (the classifier) that the rules build on. */
export interface FixedRoles {
  identity?: string
  action?: ActionRole
  highlight?: string | null
}

export function decideRoles(ev: ColourEvidence, fixed: FixedRoles = {}): ColourRoles {
  const open: OpenDecision[] = []
  const rank = ranked(ev)
  const main =
    ev.shots.map((s) => s.mainButton).find((b) => b && !b.inverted) ??
    ev.shots.map((s) => s.mainButton).find(Boolean) ??
    null
  const linksSeen = ev.shots.some((s) => s.link) || ev.shots.some((s) => s.activeNav)
  const chromaticLink = ev.candidates.some((c) => !c.neutral && has(c, 'link', 'active_nav'))
  const logoColours = [...new Set(ev.shots.flatMap((s) => s.logoColours))]
  const scheme = siteScheme(ev)
  /** A light button on a dark site is its normal fill; on a light site, a pale one is not a fill. */
  const fillable = (hex: string) => scheme === 'dark' || !isLightNeutralHex(hex)

  // Identity.
  const top = rank[0]
  const second = rank[1]
  const strong = (x?: { score: number }) => !!x && x.score >= 1.5
  // A black and white site with one vivid colour used sparingly: that colour is its accent,
  // while its buttons stay as the site fills them.
  const signature = !strong(top) && !fixed.identity ? signatureAccent(ev.shots) : null
  const monochrome = !strong(top) && !signature
  let identity: Decision<string>
  if (fixed.identity) {
    identity = { value: fixed.identity, why: `chosen from where each colour was seen`, by: 'model' }
  } else if (signature) {
    identity = { value: signature.hex, why: signature.why, by: 'rule' }
  } else if (monochrome) {
    // The brand's own fill (its main button), else its text colour.
    let black = main && !main.inverted && fillable(main.hex) ? main.hex : ev.ink
    // On a light site, white type over a photo is not its ink: the white button's label is.
    if (scheme === 'light' && hexLab(black)[0]! > 0.6)
      black = main?.ink && hexLab(main.ink)[0]! < 0.4 ? main.ink : '#111111'
    identity = {
      value: black,
      why: 'no brand colour outside photos and product pictures: monochrome',
      by: 'rule',
    }
  } else if (!strong(second) || top!.score >= 1.8 * second!.score) {
    identity = { value: top!.c.hex, why: `seen ${placesOf(top!.c)}`, by: 'rule' }
  } else {
    identity = {
      value: top!.c.hex,
      why: `${top!.c.hex} and ${second!.c.hex} both carry the brand`,
      by: 'default',
    }
    open.push('identity')
  }

  // A pale tint (a hero's peach, a gradient's light stop) is not the identity where the logo,
  // a button or a link carries a saturated colour: that colour is the brand's.
  const vivid = monochrome ? null : vividOverPale(rank, identity.value)
  if (vivid) {
    const at = open.indexOf('identity')
    if (at >= 0) open.splice(at, 1)
    identity = {
      value: vivid.hex,
      why: `seen ${placesOf(vivid)}; ${identity.value} is only a tint or a gradient stop`,
      by: 'rule',
    }
  }

  // Action: the main button's fill.
  let action: ColourRoles['action']
  if (fixed.action) {
    const role = fixed.action
    const hex =
      role === 'accent'
        ? identity.value
        : role === 'ink'
          ? main && !main.inverted && inkButton(hexLab(main.hex), scheme)
            ? main.hex
            : ev.ink
          : (main?.hex ?? identity.value)
    action = { value: { role, hex }, why: 'chosen from what the buttons show', by: 'model' }
  } else if (!main && signature)
    action = {
      value: { role: 'ink', hex: ev.ink },
      why: 'no main button seen: the text colour, as the rest of a black and white site',
      by: 'default',
    }
  else if (!main)
    action = {
      value: { role: monochrome ? 'ink' : 'accent', hex: identity.value },
      why: 'no main button seen: the brand colour, as most recognisable',
      by: 'default',
    }
  else {
    const fill = main.hex
    const lab = hexLab(fill)
    if (monochrome && !main.inverted && fill === identity.value)
      action = {
        value: { role: 'ink', hex: fill },
        why: `the main button is the text colour (${fill}), as the rest of a monochrome site`,
        by: 'rule',
      }
    else if (sameColour(fill, identity.value))
      action = {
        value: { role: monochrome ? 'ink' : 'accent', hex: fill },
        why: `the main button is the brand colour (${fill})`,
        by: 'rule',
      }
    else if (!main.inverted && inkButton(lab, scheme))
      action = {
        value: { role: 'ink', hex: fill },
        why: `the main button is ${scheme === 'dark' ? 'light' : 'dark'} (${fill}), as the text`,
        by: 'rule',
      }
    else if (main.inverted || isLightNeutralHex(fill))
      action = {
        value: { role: monochrome || signature ? 'ink' : 'accent', hex: identity.value },
        why: `the only main button is light on a dark or photo hero (${fill})`,
        by: 'default',
      }
    else if (chromaOf(lab) < NEUTRAL)
      action = {
        value: { role: 'neutral', hex: fill },
        why: `the main button is grey (${fill})`,
        by: 'rule',
      }
    else {
      action = {
        value: { role: 'support', hex: fill },
        why: `the main button (${fill}) is not the brand colour`,
        by: 'default',
      }
      if (!open.includes('identity')) open.push('action')
    }
  }

  // The site's own buttons, whatever the portal's do.
  const isIdentity = !!main && sameColour(main.hex, identity.value)
  const buttons = siteButtons(main?.hex ?? null, !!main?.inverted, isIdentity, scheme, monochrome)

  // Highlight: the second colour.
  const seconds = ev.candidates
    .filter((c) => !c.neutral && siteSources(c).length && !sameColour(c.hex, identity.value))
    .map((c) => ({
      c,
      score: score(c, SECOND_WEIGHT) + (logoColours.includes(c.hex) && has(c, 'badge') ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
  let highlight: Decision<string | null>
  if (fixed.highlight !== undefined)
    highlight = {
      value: fixed.highlight,
      why: 'chosen from where each colour was seen',
      by: 'model',
    }
  else if (action.value.role === 'support')
    highlight = {
      value: action.value.hex,
      why: 'the main button is the second colour',
      by: action.by,
    }
  else if (seconds[0] && seconds[0].score >= 1.5) {
    highlight = { value: seconds[0].c.hex, why: `seen ${placesOf(seconds[0].c)}`, by: 'rule' }
    if (seconds[1] && seconds[1].score >= 0.8 * seconds[0].score && !open.includes('identity'))
      open.push('highlight')
  } else if (
    action.value.role === 'ink' &&
    !monochrome &&
    chromaOf(hexLab(action.value.hex)) >= 0.015
  )
    highlight = {
      value: action.value.hex,
      why: `the dark of the buttons (${action.value.hex}) is tinted: a second colour`,
      by: 'rule',
    }
  else highlight = { value: null, why: 'no second colour seen', by: 'rule' }

  // Links and the current menu item.
  const readable = contrast(identity.value, ev.page) >= 3
  const links: ColourRoles['links'] = monochrome
    ? {
        value: { role: 'ink', hex: ev.ink },
        why: 'a monochrome site: links in the text colour',
        by: 'rule',
      }
    : readable
      ? {
          value: { role: 'accent', hex: identity.value },
          why: chromaticLink
            ? 'the site marks links or the current menu item in colour'
            : 'identity carried in links and the current menu item',
          by: 'rule',
        }
      : {
          value: { role: 'ink', hex: ev.ink },
          why: `the brand colour (${identity.value}) is too light for text`,
          by: 'rule',
        }

  // Tints: a pale second colour on cards or the current item, else neutral.
  const paleSupport =
    highlight.value &&
    hexLab(highlight.value)[0] > 0.85 &&
    ev.candidates.some((c) => c.hex === highlight.value && has(c, 'card', 'active_nav'))
  const tint: Decision<'neutral' | 'support'> = paleSupport
    ? {
        value: 'support',
        why: 'cards or the current item are tinted with the second colour',
        by: 'rule',
      }
    : { value: 'neutral', why: 'restraint: tints stay neutral', by: 'rule' }

  // Extras: further logo colours (a multi-colour logo).
  const extras = ev.candidates
    .filter(
      (c) =>
        !c.neutral &&
        has(c, 'logo', 'logo_field') &&
        !sameColour(c.hex, identity.value) &&
        (!highlight.value || !sameColour(c.hex, highlight.value))
    )
    .slice(0, 2)
    .map((c) => c.hex)

  // Coverage and the hero.
  const idc = ev.candidates.find((c) => de(c.hex, identity.value) < 7)
  const coverage = idc?.coverage ?? 0
  const intensity = coverage < 0.015 ? 'quiet' : coverage < 0.12 ? 'medium' : 'bold'
  const hs = ev.shots[0]
  const heroRole = (h: string | null): ColourRoles['hero']['role'] => {
    if (!h) return null
    if (de(h, identity.value) < 10) return 'accent'
    if (highlight.value && de(h, highlight.value) < 10) return 'support'
    if (extras[0] && de(h, extras[0]) < 10) return 'extra1'
    return null
  }
  const hero: ColourRoles['hero'] = {
    look: hs?.hero ?? 'none',
    role: hs?.hero === 'solid' ? heroRole(hs.heroColour) : null,
  }

  // Asks: thin evidence, or a monochrome site whose app shows an accent.
  let ask: Ask | null = null
  const missing: string[] = []
  // Only what the roles lack: a main button the action was read from is not missing.
  const buttonSeen = !!main && !main.inverted
  if (!buttonSeen && action.by !== 'rule') missing.push('main button')
  if (!chromaticLink && !ev.shots.some((s) => s.activeNav))
    missing.push(linksSeen ? 'coloured links' : 'links')
  if (!ev.shots.some((s) => s.activeNav)) missing.push('current menu item')
  if (missing.length === 3 || (missing.includes('main button') && !chromaticLink)) {
    ask = {
      kind: 'thin',
      missing,
      message: `Your screenshot shows no ${listWords(missing)}, so I used ${monochrome || signature ? 'your text colour' : identity.value} for them. Add a screenshot of a page from your product and I'll match them exactly.`,
    }
  }
  const appAccent = ev.candidates
    .filter(
      (c) => !c.neutral && has(c, 'product') && !siteSources(c).length && c.productCoverage >= 0.01
    )
    .sort((a, b) => b.productCoverage - a.productCoverage)[0]
  if (monochrome && appAccent)
    ask = {
      kind: 'conflict',
      app: appAccent.hex,
      // Said with the code; the chat says a colour code by its name.
      message: `Your site is black and white, but your app uses ${appAccent.hex}. Use it for links and the current menu item?`,
    }

  return {
    identity,
    action,
    buttons,
    links,
    highlight,
    tint,
    extras,
    logoColours,
    monochrome,
    signature: !!signature,
    coverage,
    intensity,
    hero,
    ask,
    open,
    text: ev.ink,
    page: ev.page,
    scheme,
  }
}

function listWords(w: string[]): string {
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`
}
