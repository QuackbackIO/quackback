/**
 * The hero family, decided from screenshots: the hero's look (what is behind
 * the headline), its shape, art along it, whether the header shares its
 * colour, and where a picture sits.
 *
 * The brief asks for one bold signature moment, usually the hero, so rules
 * decide the look first wherever the evidence is clear (hero-rules.ts): a solid
 * colour measured behind the headline in one of the brand's colours is that
 * band, never plain; a brand colour filling a large section of the first
 * screen makes a coloured hero; a photo hero, which the portal cannot borrow,
 * becomes a band in the deeper brand colour, with a panel in the second when
 * the brand uses it as a field; a gradient is a blend; a genuinely plain page
 * stays plain. Only what the rules leave open goes to the model: one small
 * vision call, asked twice at once, given a crop of the hero and the measured
 * evidence. Its look counts only when both answers agree (else the measured
 * default), and its details (shape, art, the picture) only where both agree,
 * so a run does not flip the hero. The model never names a colour.
 */
import { z } from 'zod'
import type { HeroSurface } from '../extract/hero-surface'
import type { Behind } from '../extract/kinds'
import { ANSWER_RULES, DESIGNER_BRIEF, type FamilyCaller } from './brand-brief'

export const HERO_VERSION = 'hero-v3'

export const HERO_LOOKS = [
  'plain_page',
  'pale_tint',
  'soft_fade',
  'solid_brand_colour',
  'solid_second_colour',
  'bold_gradient',
  'soft_gradient_beside_words',
  'photo',
  'not_visible',
] as const
export const HERO_SHAPES = [
  'edge_to_edge',
  'rounded_card_inset',
  'words_on_a_panel',
  'not_visible',
] as const
export const HERO_ART = [
  'none',
  'hills',
  'waves',
  'dots',
  'grid',
  'lines',
  'petals',
  'confetti',
  'not_visible',
] as const
export const HEADER_ON_HERO = ['shares_colour', 'separate', 'not_visible'] as const
export const HERO_PICTURE = [
  'beside_words',
  'along_bottom',
  'behind_words',
  'none',
  'not_visible',
] as const

export const heroSchema = z.object({
  evidence: z
    .string()
    .describe('one or two sentences: what the hero shows, as a brand designer reads it'),
  look: z.enum(HERO_LOOKS),
  shape: z.enum(HERO_SHAPES),
  art: z.enum(HERO_ART),
  header_on_hero: z.enum(HEADER_ON_HERO),
  picture: z.enum(HERO_PICTURE),
  confidence: z.enum(['high', 'low']),
})
export type HeroAnswer = z.infer<typeof heroSchema>

/** What the hero classifier is told, all measured or observed before it. */
export interface HeroEvidence {
  /** The finder's observation of what is directly behind the headline, and its words for it. */
  behind: Behind | null
  behindWords: string
  /** What the colour tools measured behind the headline, and the colour's role. */
  measured: 'solid' | 'gradient' | 'photo' | 'plain' | 'none'
  measuredColour: string | null
  measuredRole: 'accent' | 'support' | 'extra1' | null
  brandColour: string
  secondColour: string | null
  page: string
  header: string | null
  /** How much of the interface the brand colour covers. */
  intensity: 'quiet' | 'medium' | 'bold'
  /** No brand colour anywhere but the product pictures. */
  monochrome: boolean
  /** A brand colour filling a large section of the first screen (a tenth or more), and which. */
  roleSurface: { role: 'accent' | 'support'; coverage: number } | null
  /** The second colour is used as a filled field (logo, badges, cards), well apart from the brand colour in lightness. */
  secondField: boolean
  /** The hero is set in from the page's edges. */
  heroInset: boolean
  /** The hero's surface, measured: how bold its colour is, and a vivid gradient's place and form. */
  surface?: HeroSurface | null
}

const OPTIONS = `Choose:
look: what fills the hero behind the headline.
- plain_page: the page's own plain background
- pale_tint: a pale wash of a brand colour
- soft_fade: a soft brand colour fading into the page
- solid_brand_colour: a solid area of the brand colour
- solid_second_colour: a solid area of another brand colour than the brand colour
- bold_gradient: a strong sweep of colours across the hero
- soft_gradient_beside_words: soft colour or a gradient beside the words on a light page
- photo: a photograph behind or beside the words
shape: edge_to_edge (the hero runs across the page), rounded_card_inset (a rounded card set in from the page's edges), words_on_a_panel (the words sit on a block of colour over another colour or a photo).
art: drawn shapes along or behind the hero (hills, waves, dots, grid, lines, petals, confetti), or none.
header_on_hero: shares_colour when the header above has the hero's colour, so the two read as one; separate otherwise.
picture: where a photo or product picture sits: beside_words, along_bottom, behind_words, or none.`

export interface HeroExample {
  brand: string
  /** The evidence as the prompt lists it for any brand (heroEvidenceLines). */
  evidence: HeroEvidence
  answer: HeroAnswer
}

/**
 * Worked examples, from the fictional approved goal designs (Harbor, a coffee
 * roastery; Voltline, EV charging; Northwind, city bikes; Petalpost,
 * stationery) and two invented brands, written as the designer's reasoning.
 * Never a brand the matcher is evaluated on: an example's wording and choices
 * would be copied into that brand's portal.
 */
export const HERO_EXAMPLES: HeroExample[] = [
  {
    brand: 'Harbor',
    evidence: {
      behind: 'tinted',
      behindWords: 'warm cream band with drawn hills under the words',
      measured: 'solid',
      measuredColour: '#f6efe2',
      measuredRole: null,
      brandColour: '#1f4d3a',
      secondColour: '#a95632',
      page: '#fffaf1',
      header: '#fffaf1',
      intensity: 'medium',
      monochrome: false,
      roleSurface: null,
      secondField: false,
      heroInset: false,
    },
    answer: {
      evidence:
        'A pale cream wash behind the words with hand-drawn hills along it: a quiet tint, not a filled brand band. Deep green stays for the type and the logo.',
      look: 'pale_tint',
      shape: 'edge_to_edge',
      art: 'hills',
      header_on_hero: 'separate',
      picture: 'none',
      confidence: 'high',
    },
  },
  {
    brand: 'Petalpost',
    evidence: {
      behind: 'solid_colour',
      behindWords: 'deep plum band with pink petals scattered around a centred headline',
      measured: 'solid',
      measuredColour: '#4a1942',
      measuredRole: 'accent',
      brandColour: '#4a1942',
      secondColour: '#e58fae',
      page: '#fff7f9',
      header: '#ffffff',
      intensity: 'bold',
      monochrome: false,
      roleSurface: null,
      secondField: true,
      heroInset: false,
    },
    answer: {
      evidence:
        'Plum fills the hero under a white header, with petals drawn around the words: the one bold moment, in the brand colour.',
      look: 'solid_brand_colour',
      shape: 'edge_to_edge',
      art: 'petals',
      header_on_hero: 'separate',
      picture: 'none',
      confidence: 'high',
    },
  },
  {
    brand: 'Voltline',
    evidence: {
      behind: 'plain',
      behindWords: 'the dark page itself, lime words on near-black',
      measured: 'plain',
      measuredColour: null,
      measuredRole: null,
      brandColour: '#c5fe3d',
      secondColour: null,
      page: '#0b1020',
      header: '#0b1020',
      intensity: 'quiet',
      monochrome: false,
      roleSurface: null,
      secondField: false,
      heroInset: false,
    },
    answer: {
      evidence:
        'A dark page with nothing behind the headline; lime carries the brand in the words and the buttons. The hero stays the page.',
      look: 'plain_page',
      shape: 'edge_to_edge',
      art: 'none',
      header_on_hero: 'separate',
      picture: 'none',
      confidence: 'high',
    },
  },
  {
    brand: 'Lumen Labs',
    evidence: {
      behind: 'gradient',
      behindWords: 'a bright violet and orange ribbon sweeping in from the right on white',
      measured: 'gradient',
      measuredColour: null,
      measuredRole: null,
      brandColour: '#5b3df5',
      secondColour: '#ff8a3d',
      page: '#ffffff',
      header: '#ffffff',
      intensity: 'quiet',
      monochrome: false,
      roleSurface: null,
      secondField: false,
      heroInset: false,
    },
    answer: {
      evidence:
        'The ribbon beside the words is the signature, on a white page, not a filled band; the header stays white.',
      look: 'soft_gradient_beside_words',
      shape: 'edge_to_edge',
      art: 'none',
      header_on_hero: 'separate',
      picture: 'none',
      confidence: 'high',
    },
  },
  {
    brand: 'Fernway Travel',
    evidence: {
      behind: 'photo',
      behindWords: 'a full-width photo of a mountain lake, white words over it',
      measured: 'photo',
      measuredColour: null,
      measuredRole: null,
      brandColour: '#0f6e5c',
      secondColour: '#f2c14e',
      page: '#ffffff',
      header: '#ffffff',
      intensity: 'quiet',
      monochrome: false,
      roleSurface: null,
      secondField: false,
      heroInset: false,
    },
    answer: {
      evidence:
        'The page leads with a full-width travel photo, the words on the picture: a photo hero running edge to edge, the picture behind the words.',
      look: 'photo',
      shape: 'edge_to_edge',
      art: 'none',
      header_on_hero: 'separate',
      picture: 'behind_words',
      confidence: 'high',
    },
  },
  {
    brand: 'Kettleby Home',
    evidence: {
      behind: 'photo',
      behindWords: 'a rounded card of room photos set in from the page, words on a cream block',
      measured: 'photo',
      measuredColour: null,
      measuredRole: null,
      brandColour: '#24508f',
      secondColour: '#f7c948',
      page: '#ffffff',
      header: '#ffffff',
      intensity: 'quiet',
      monochrome: false,
      roleSurface: null,
      secondField: true,
      heroInset: true,
    },
    answer: {
      evidence:
        'Room photos fill a rounded card inset from the page, with the words on a block beside them: a photo hero, set in, the picture beside the words.',
      look: 'photo',
      shape: 'rounded_card_inset',
      art: 'none',
      header_on_hero: 'separate',
      picture: 'beside_words',
      confidence: 'high',
    },
  },
]

const BEHIND_WORDS: Record<Behind, string> = {
  plain: 'plain',
  tinted: 'a tint',
  solid_colour: 'a solid colour',
  gradient: 'a gradient',
  photo: 'a photo',
  illustration: 'an illustration',
}

const MEASURED_WORDS: Record<HeroEvidence['measured'], string> = {
  solid: 'a solid colour',
  gradient: 'a gradient',
  photo: 'a photo',
  plain: 'the plain page',
  none: 'nothing measured',
}

export const ROLE_WORDS = {
  accent: 'the brand colour',
  support: 'the second colour',
  extra1: 'a third colour',
}

export function heroEvidenceLines(ev: HeroEvidence): string[] {
  const seen = ev.behind ? BEHIND_WORDS[ev.behind] : 'not observed'
  const measured =
    ev.measured === 'solid' && ev.measuredColour
      ? `a solid colour behind the headline, ${ev.measuredColour}${ev.measuredRole ? `, ${ROLE_WORDS[ev.measuredRole]}` : ''}`
      : `${MEASURED_WORDS[ev.measured]} behind the headline`
  const moment = [
    ev.roleSurface
      ? `${ROLE_WORDS[ev.roleSurface.role]} fills a large section of the page (${Math.round(ev.roleSurface.coverage * 100)}% of the interface)`
      : 'no brand colour fills a large section of the page',
    ev.secondField ? 'the second colour is used as a filled field (logo, badges or cards)' : '',
    ev.heroInset ? 'the hero is set in from the page’s edges' : '',
    ev.monochrome ? 'the site is monochrome' : '',
  ].filter(Boolean)
  return [
    `Seen behind the headline: ${seen}${ev.behindWords ? ` ("${ev.behindWords}")` : ''}.`,
    `Measured: ${measured}. Brand colour ${ev.brandColour} (the interface is ${ev.intensity} with it); second colour ${ev.secondColour ?? 'none'}. Page ${ev.page}; header ${ev.header ?? 'not measured'}.`,
    `Brand moment: ${moment.join('; ')}.`,
  ]
}

const exampleBlock = (e: HeroExample) =>
  `Example (${e.brand}):\n${heroEvidenceLines(e.evidence).join('\n')}\nAnswer: ${JSON.stringify(e.answer)}`

/** What the rules settled, as the prompt tells the model, so its details fit the look. */
const SETTLED: Record<HeroBand, string> = {
  none: 'the hero is the plain page',
  tint: 'a pale wash of a brand colour',
  fade: 'a soft brand colour fading into the page',
  brand: 'a band of the brand colour',
  support: 'a band of the second colour',
  blend: 'a gradient',
}

export function heroPrompt(ev: HeroEvidence, crop: boolean, settled?: HeroBand): string {
  return [
    DESIGNER_BRIEF,
    'You decide the hero only: the first section under the header, with the main headline.',
    crop ? 'The image is a crop of the screenshot around the hero.' : '',
    OPTIONS,
    'Answer look with what the screenshot shows behind the headline, even where the portal will draw it otherwise; describe shape, art and picture as the site has them.',
    ANSWER_RULES,
    HERO_EXAMPLES.map(exampleBlock).join('\n\n'),
    `Now this brand:\n${heroEvidenceLines(ev).join('\n')}`,
    settled
      ? `Already settled by the measures: the portal's hero will be ${SETTLED[settled]}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The hero family's answer (one sample); throws when the call fails. */
export async function classifyHero(
  ev: HeroEvidence,
  call: FamilyCaller,
  crop: Uint8Array | null,
  options: { settled?: HeroBand; sample?: number } = {}
): Promise<HeroAnswer> {
  return call({
    family: 'hero',
    version: HERO_VERSION,
    prompt: heroPrompt(ev, !!crop, options.settled),
    images: crop ? [{ mime: 'image/png', data: crop }] : [],
    schema: heroSchema,
    // Haiku's reasoning counts towards the limit; a low one cuts the answer mid-JSON.
    maxTokens: 2000,
    sample: options.sample,
  })
}

export type HeroBand = 'none' | 'tint' | 'fade' | 'brand' | 'support' | 'blend'
