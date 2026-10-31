/**
 * The hero, read on its own. A screenshot's hero decides a look more than
 * anything else on it, and a focused question about it answers more surely
 * than the same question folded into a whole look: its band's colour, a
 * panel of another colour within it, an inset card, where the words sit,
 * whether the header shares its colour, art along its foot, and capitals.
 * The faithful look takes what it reads, its colours only where the
 * screenshot's own colours bear them out.
 */
import { z } from 'zod'
import type { ContentPart } from '@tanstack/ai'
import { structuredChat } from '@/lib/server/domains/ai/structured-chat'
import { logger } from '@/lib/server/logger'
import { parseOklch } from '@/lib/shared/theme/expand'
import { hexToOklch } from '@/lib/shared/theme/colors'
import type { Look } from './design-looks'

const log = logger.child({ module: 'hero-read' })

export const heroSchema = z.object({
  /** Whether the image is a web page at all, rather than a logo. */
  page: z.boolean(),
  /** What fills the hero behind its headline. */
  fill: z.enum(['page', 'colour', 'gradient', 'image']),
  /** The hero's colour as hex, or "". */
  colour: z.string(),
  /** The headline sits on a block of another colour within the hero. */
  panel: z.boolean(),
  panelColour: z.string(),
  /** The hero is a rounded card inset from the page's edges. */
  card: z.boolean(),
  align: z.enum(['left', 'centre']),
  /** The header above shares the hero's colour. */
  headerOnHero: z.boolean(),
  art: z.enum(['none', 'hills', 'waves', 'dots', 'other']),
  upper: z.boolean(),
})
export type HeroRead = z.infer<typeof heroSchema>

const PROMPT = `You read one thing: the hero of a web page in a screenshot, the first section under the header with the main headline. Answer only about it.
- page: false if the image is a logo or not a web page; then the rest does not matter.
- fill: page when the hero is the page's own plain background, colour when it is filled with one colour, gradient for a gradient, image for a photo behind the words.
- colour: that fill colour as #rrggbb, read from the image, or "".
- panel: true when the headline sits on a block of a second colour within a differently coloured hero; panelColour: that block's colour, or "".
- card: true when the hero is a rounded card inset from the page's edges rather than running edge to edge.
- align: centre when the headline is centred, else left.
- headerOnHero: true when the header above shares the hero's colour, so the two read as one.
- art: hills or waves when such an illustration runs along the hero's foot, dots for a dotted texture, other for any other illustration, none otherwise.
- upper: true when the headline is in capitals.`

/** The hero in a screenshot, or null when it cannot be read. */
export async function readHero(model: string, image: string): Promise<HeroRead | null> {
  const picture: ContentPart = {
    type: 'image',
    source: {
      type: 'data',
      value: image.replace(/^data:image\/jpeg;base64,/, ''),
      mimeType: 'image/jpeg',
    },
  }
  try {
    const hero = await structuredChat({
      model,
      systemPrompts: [PROMPT],
      messages: [{ role: 'user', content: [{ type: 'text', content: 'Read the hero.' }, picture] }],
      schema: heroSchema,
      maxTokens: 600,
    })
    return hero.page ? hero : null
  } catch (err) {
    log.warn({ err }, 'design ai could not read the hero')
    return null
  }
}

const oklchOf = (colour: string) =>
  /^#[0-9a-f]{6}$/i.test(colour) ? parseOklch(hexToOklch(colour)) : null

/** Two colours a person would call the same. */
function same(a: string, b: string): boolean {
  const p = oklchOf(a)
  const q = oklchOf(b)
  if (!p || !q) return false
  const turn = Math.abs(p.h - q.h) % 360
  return (
    Math.abs(p.l - q.l) < 0.08 && (Math.min(turn, 360 - turn) <= 20 || (p.c < 0.04 && q.c < 0.04))
  )
}

/**
 * The faithful look with its hero as read: the band, its colour role, a panel
 * or an inset card, the words' side, the header on the band, its art and its
 * capitals. A colour the screenshot does not bear out is left to the look.
 */
export function withHero(
  look: Look,
  hero: HeroRead | null,
  confirm: (colour: string) => boolean
): Look {
  if (!hero) return look
  const next: Look = { ...look, bandAlign: hero.align }
  if (hero.upper) next.headlineCase = 'upper'
  if (hero.art === 'hills' || hero.art === 'waves' || hero.art === 'dots') next.bandArt = hero.art
  // A plain hero leaves the band to the look: a brand can carry colour in art or a
  // gradient beside the words, which the look can give the band. Only a hero with
  // a fill of its own says what the band is, and whether the header shares it.
  if (hero.fill === 'gradient') next.band = 'blend'
  if (hero.fill === 'colour' || hero.fill === 'gradient') next.headerOnBand = hero.headerOnHero
  const colour = hero.fill === 'colour' && confirm(hero.colour) ? hero.colour.toLowerCase() : null
  if (colour) {
    if (same(colour, next.accent)) next.band = 'brand'
    else {
      next.band = 'support'
      next.support = colour
    }
  }
  const panel = hero.panel && confirm(hero.panelColour) ? hero.panelColour.toLowerCase() : null
  // A panel takes the second colour, so it reads within a band of the brand colour.
  if (panel && colour && same(colour, next.accent)) {
    next.bandShape = 'panel'
    next.support = panel
  } else if (hero.card) next.bandShape = 'inset'
  else if (!panel) next.bandShape = 'full'
  return next
}
