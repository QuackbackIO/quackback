/**
 * The art director's critic for the verified loop: one vision call that
 * looks at the brand's screenshots beside the portal as drawn and scores how
 * well the portal carries the brand, dimension by dimension, each with its
 * evidence, plus concrete issues a revision can act on.
 *
 * The rubric (from the brand designer's perspective in the spec): being
 * recognisable as this brand at a glance; colour roles and amounts; type
 * voice; shape and density; the logo; and fit as a product surface. The
 * critic only scores and names issues; it never sets a value. Whether a
 * revision is kept is decided by measurement (brand-check.ts).
 *
 * Flat structured output (the grammar size limit), few-shot examples from
 * fictional brands only, synced to the schema by a test.
 */
import { z } from 'zod'
import {
  CRITIC_DIMENSIONS,
  criticScore,
  type CriticDimension,
} from '@/lib/shared/design/brand-check'
import type { Fingerprint } from '@/lib/shared/design/fingerprint'
import type { FamilyCaller } from './brand-brief'

export const CRITIC_VERSION = 'critic-v1'

const mark = z.number().int().min(0).max(10)
const said = (what: string) =>
  z.string().describe(`one short sentence (under 25 words): what you see about ${what}`)

export const criticSchema = z.object({
  glance_evidence: said('whether this reads as the brand at a glance'),
  glance: mark,
  colour_evidence: said('which colours play which roles, and how much of each'),
  colour: mark,
  type_evidence: said('the type voice: weight, size, case, spacing, face'),
  type: mark,
  shape_evidence: said('corners, edges, shadows and density'),
  shape: mark,
  logo_evidence: said('the logo: present, clean, the right one, the right size'),
  logo: mark,
  fit_evidence: said('fit as the brand’s product surface rather than a copy of its marketing page'),
  fit: mark,
  issues: z
    .array(z.string())
    .max(5)
    .describe('the most important differences, each concrete and fixable, worst first'),
})
export type CriticAnswer = z.infer<typeof criticSchema>

/** The critic's dimensions with their scores. */
export const criticDimensions = (a: CriticAnswer): Record<CriticDimension, number> =>
  Object.fromEntries(CRITIC_DIMENSIONS.map((d) => [d, a[d]])) as Record<CriticDimension, number>

export const scoreOfCritic = (a: CriticAnswer): number => criticScore(criticDimensions(a))!

const RUBRIC = `You are an art director checking a customer portal made to match a company's brand. The first images are screenshots of the company's own site; the last image is the portal as it is drawn now.
A portal is the brand's product surface (like its help centre or account area), not its marketing page: it should carry the identity, not copy the campaign.
Score each dimension from 0 to 10, with the evidence first:
glance: would someone who knows the brand recognise it at a glance? (10: unmistakably theirs; 5: same family of colours, generic otherwise; 0: another brand)
colour: are the brand's colours in the right roles (identity, main button, links and the current menu item, highlights) and in the right amounts? A brand that keeps buttons black or neutral should not get coloured buttons.
type: does the type keep the brand's voice: weight (light, regular, bold), size of the headline, case, letter-spacing, and the kind of face (serif, geometric, grotesque)?
shape: corners (square, slightly rounded, fully round), edges and shadows on cards, and density, as the site has them.
logo: is the brand's logo there, cleanly cut, readable, at a sensible size?
fit: does it feel like this brand's product (calm, usable, one signature moment), not a copy of a marketing page and not a generic template?
Be strict and specific; never reward what the screenshots do not show. Then list up to five issues, worst first, each a concrete difference a designer could fix ("buttons are fully round on the site but square here"), not advice in general.
Answer with the JSON object only.`

export interface CriticExample {
  brand: string
  /** What the screenshots and the portal showed, in words, standing in for the images. */
  seen: string[]
  answer: CriticAnswer
}

/** Fictional brands only. */
export const CRITIC_EXAMPLES: CriticExample[] = [
  {
    brand: 'Fernway, an outdoor gear shop',
    seen: [
      'Site: off-white page, deep forest green buttons with fully round corners, a light geometric sans at large sizes, a pine-tree logo.',
      'Portal: off-white page, forest green buttons with 4px corners, headline in a heavy grotesque, the logo cleanly placed.',
    ],
    answer: {
      glance_evidence:
        'The green and the logo say Fernway, but the heavy headline feels like another brand.',
      glance: 6,
      colour_evidence: 'Green fills buttons and the logo as on the site; amounts are right.',
      colour: 8,
      type_evidence:
        'The site sets large type light and geometric; the portal’s headline is heavy and condensed.',
      type: 4,
      shape_evidence: 'Buttons are fully round on the site but have small square-ish corners here.',
      shape: 4,
      logo_evidence: 'The pine-tree logo is clean and well sized.',
      logo: 9,
      fit_evidence: 'Calm and usable, a believable product page.',
      fit: 7,
      issues: [
        'Headline is heavy; the site uses a light weight at large sizes',
        'Buttons have small corners; the site’s are fully round',
      ],
    },
  },
  {
    brand: 'Quillstone, a publishing house',
    seen: [
      'Site: white page, black text, an elegant serif headline, black square buttons, a single crimson accent in links.',
      'Portal: white page, crimson filled buttons, a crimson hero band across the page, sans-serif headline, logo present.',
    ],
    answer: {
      glance_evidence:
        'The crimson band shouts; the site is quiet black and white with one crimson thread.',
      glance: 4,
      colour_evidence: 'Crimson fills buttons and a whole band; on the site it only marks links.',
      colour: 3,
      type_evidence: 'The site’s voice is a serif headline; the portal’s sans loses it.',
      type: 3,
      shape_evidence: 'Square buttons and flat cards match the site.',
      shape: 8,
      logo_evidence: 'The wordmark is present and crisp.',
      logo: 8,
      fit_evidence: 'A loud marketing band where the brand would be restrained.',
      fit: 5,
      issues: [
        'Buttons are crimson; the site’s are black',
        'A crimson band fills the hero; the site has a plain white hero',
        'Headline is sans-serif; the site’s is a serif',
      ],
    },
  },
]

const exampleBlock = (e: CriticExample) =>
  `Example (${e.brand}, described in words):\n${e.seen.join('\n')}\nAnswer: ${JSON.stringify(e.answer)}`

/** The drawn portal in words, from its fingerprint, for when no picture could be taken. */
export function describeDrawn(fp: Fingerprint): string {
  const lines: string[] = []
  if (fp.page) lines.push(`page background ${fp.page}`)
  const h = fp.headline
  if (h)
    lines.push(
      `headline ${h.size ? `${Math.round(h.size)}px` : ''} weight ${h.weight ?? '?'}, ${h.transform === 'uppercase' ? 'upper case' : 'sentence case'}, colour ${h.color ?? '?'}, face ${h.family ?? '?'}`
    )
  const b = fp.button
  if (b)
    lines.push(
      `main button fill ${b.bg ?? '?'}, label ${b.color ?? '?'}, corners ${b.radius === 999 ? 'fully round' : `${b.radius ?? '?'}px`}, ${b.height ? `${Math.round(b.height)}px tall` : ''}`
    )
  const c = fp.card
  if (c)
    lines.push(
      `cards: corners ${c.radius === 999 ? 'fully round' : `${c.radius ?? '?'}px`}, ${c.borderWidth ? `${c.borderWidth}px edge` : 'no edge'}, ${c.shadow ? 'shadow' : 'no shadow'}`
    )
  if (fp.link) lines.push(`menu links colour ${fp.link.color ?? '?'}`)
  return lines.join('; ')
}

export function criticPrompt({
  shots,
  picture,
  drawn,
  brand,
}: {
  shots: number
  /** Whether the last image is the portal; without one, the portal is described. */
  picture: boolean
  drawn: Fingerprint
  brand: string | null
}): string {
  return [
    RUBRIC,
    CRITIC_EXAMPLES.map(exampleBlock).join('\n\n'),
    [
      `Now${brand ? ` ${brand}` : ' this brand'}: images 1${shots > 1 ? ` to ${shots}` : ''} are the brand's site.`,
      picture
        ? `Image ${shots + 1} is the portal as drawn now.`
        : `No picture of the portal could be taken; it is drawn with: ${describeDrawn(drawn)}. Score from that, and say so in the evidence.`,
    ].join(' '),
  ].join('\n\n')
}

export interface CriticInput {
  /** The brand's screenshots, as the model sees them. */
  shots: Array<{ mime: 'image/jpeg' | 'image/png'; data: Uint8Array }>
  /** The portal as drawn, or null. */
  picture: { mime: 'image/jpeg' | 'image/png'; data: Uint8Array } | null
  drawn: Fingerprint
  brand: string | null
}

/** The critic's answer; one that does not parse is asked for once more (the caller holds the time). */
export function critique(input: CriticInput, call: FamilyCaller): Promise<CriticAnswer> {
  const request = {
    family: 'critic' as const,
    version: CRITIC_VERSION,
    prompt: criticPrompt({
      shots: input.shots.length,
      picture: !!input.picture,
      drawn: input.drawn,
      brand: input.brand,
    }),
    images: [...input.shots, ...(input.picture ? [input.picture] : [])],
    schema: criticSchema,
    // Room for the model's thinking as well as its answer.
    maxTokens: 2500,
  }
  return call(request).catch(() => call(request))
}
