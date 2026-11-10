/**
 * The colour roles classifier: for what the rules leave open (which of two
 * colours is the brand's, what fills the main button when its colour is not
 * the brand's, which colour is the second), one small structured call given
 * the measured candidates, where each was seen and a crop of the logo. It
 * never sees values it could misread: it picks candidates by id.
 *
 * Prompt: a brand designer's brief (a portal is the brand's product surface,
 * one bold moment and restraint elsewhere, actions as the brand does them),
 * options described by what you would see, evidence first in the answer,
 * and few-shot examples from the fictional approved goal designs written as
 * the designer's reasoning, kept in step with the schema by a test.
 *
 * Pure: the model is reached through a `RolesCaller`, so the product calls it
 * through structuredChat (roles-call.ts) and the offline harness through its
 * own client and cache.
 */
import { z } from 'zod'
import type { Image } from './png'
import { encodePng } from './png'
import { clampBox } from './colours'
import {
  decideRoles,
  describeCandidate,
  type ActionRole,
  type ColourEvidence,
  type ColourRoles,
  type FixedRoles,
} from './roles'

export const ROLES_VERSION = 'roles-v3'

/** What fills the main buttons, described by what you would see. */
export const ACTION_CHOICES = ['brand_colour', 'dark_text_colour', 'second_colour', 'grey'] as const
const ACTION_ROLE: Record<(typeof ACTION_CHOICES)[number], ActionRole> = {
  brand_colour: 'accent',
  dark_text_colour: 'ink',
  second_colour: 'support',
  grey: 'neutral',
}

export const rolesSchema = z.object({
  evidence: z
    .string()
    .describe(
      'one or two sentences: what each colour does on the page, as a brand designer reads it'
    ),
  identity: z.string().describe('the id of the brand colour, such as "c1"'),
  action: z.enum(ACTION_CHOICES),
  highlight: z.string().describe('the id of the second colour, or "none"'),
  confidence: z.enum(['high', 'low']),
})
export type RolesAnswer = z.infer<typeof rolesSchema>

/** The JSON schema a strict structured answer is held to (for callers outside TanStack AI). */
export function rolesJsonSchema(): Record<string, unknown> {
  const js = z.toJSONSchema(rolesSchema) as Record<string, unknown>
  delete js.$schema
  return js
}

export interface RolesRequest {
  prompt: string
  /** Crops the prompt refers to (the logo), as PNG. */
  images: { mime: 'image/png'; data: Uint8Array }[]
  jsonSchema: Record<string, unknown>
  version: string
}

/** Asks the model and returns its answer as parsed JSON (validated here). */
export type RolesCaller = (request: RolesRequest) => Promise<unknown>

/** A worked example: the evidence as the prompt lists it, and the designer's answer. */
export interface RolesExample {
  brand: string
  evidence: string[]
  answer: RolesAnswer
}

/**
 * Worked examples, from the fictional approved goal designs (Harbor, a coffee
 * roastery; Voltline, EV charging; Northwind, city bikes; Petalpost,
 * stationery), written as the designer's reasoning, each candidate line in
 * the words the prompt uses for a real brand (a test holds them to it).
 * Never a brand the matcher is evaluated on.
 */
export const ROLES_EXAMPLES: RolesExample[] = [
  {
    brand: 'Petalpost',
    evidence: [
      'c1 #4a1942 (in the logo, 70% of its ink; a solid background behind the headline; covers 24.0% of the interface)',
      'c2 #e58fae (in the logo, 30% of its ink; fills the main button; covers 1.4% of the interface)',
      'Main button: #e58fae. Text colour: #2b1428. Page: #fff7f9.',
      'Behind the headline: a solid colour (#4a1942).',
    ],
    answer: {
      evidence:
        'Plum draws the logo and fills the hero, so it is the identity; the buttons are pink, the logo’s second colour, so actions take the second colour and pink is the highlight.',
      identity: 'c1',
      action: 'second_colour',
      highlight: 'c2',
      confidence: 'high',
    },
  },
  {
    brand: 'Northwind',
    evidence: [
      'c1 #d7261e (in the logo; a small badge or label; covers 0.3% of the interface)',
      'Main button: #111111. Text colour: #111111. Page: #ffffff.',
      'Behind the headline: the plain page.',
    ],
    answer: {
      evidence:
        'Red is the logo and the sale badges, the identity; the buttons are black like the text, so actions use the dark text colour and red marks the current menu item and links. No second colour.',
      identity: 'c1',
      action: 'dark_text_colour',
      highlight: 'none',
      confidence: 'high',
    },
  },
  {
    brand: 'Voltline',
    evidence: [
      'c1 #c5fe3d (in the logo; fills the main button; headline text; covers 6.2% of the interface)',
      'c2 #6b7aa6 (menu text; covers 0.9% of the interface)',
      'Main button: #c5fe3d. Text colour: #e8ecf8. Page: #0b1020.',
      'Behind the headline: the plain page.',
    ],
    answer: {
      evidence:
        'Lime draws the logo, the buttons and the headline on a dark page, so it is the identity and fills the actions; the slate blue is quiet menu text, not a brand colour.',
      identity: 'c1',
      action: 'brand_colour',
      highlight: 'none',
      confidence: 'high',
    },
  },
  {
    brand: 'Harbor',
    evidence: [
      'c1 #1f4d3a (in the logo, 60% of its ink; fills the main button; headline text; covers 3.8% of the interface)',
      'c2 #a95632 (in the logo, 25% of its ink; link text; covers 0.6% of the interface)',
      'c3 #8fa98a (in the logo, 15% of its ink; part of a gradient; covers 1.2% of the interface)',
      'Main button: #1f4d3a. Text colour: #1f2a24. Page: #fffaf1.',
      'Behind the headline: a solid colour (#f6efe2).',
    ],
    answer: {
      evidence:
        'Deep green fills every call to action and the headline, so it is the identity and the actions; terracotta marks the links, the warm highlight; sage is only in the drawings.',
      identity: 'c1',
      action: 'brand_colour',
      highlight: 'c2',
      confidence: 'high',
    },
  },
]

const BRIEF = `You are a brand designer choosing colour roles for a customer portal: the brand's product surface (like its help centre or account area), not its marketing page. Carry the identity, not the campaign.
Principles: one bold signature moment (usually the hero) and restraint elsewhere; identity colours where they carry meaning (logo, the current menu item, key moments); main buttons as the brand fills them, or with its most recognisable colour when no button is visible; never invent a colour the screenshots do not show; fidelity over taste.
The colours below were measured from the screenshots; each says where it was seen and how much of the interface it covers (photos and product pictures left out).`

const ACTION_WORDS = `action: what fills the main buttons in the portal.
- brand_colour: filled with the brand colour you chose
- dark_text_colour: filled with the dark text colour (black, near-black or dark navy buttons)
- second_colour: filled with another brand colour than the one you chose
- grey: filled with a light or mid grey`

function evidenceLines(ev: ColourEvidence, roles: ColourRoles): string[] {
  const lines = ev.candidates
    .filter((c) => !c.neutral)
    .map((c) => `${c.id} ${describeCandidate(c)}`)
  const main = ev.shots.map((s) => s.mainButton).find(Boolean)
  lines.push(
    `Main button: ${main ? `${main.hex}${main.inverted ? ', a light button on a dark or photo background' : ''}` : 'none seen'}. Text colour: ${ev.ink}. Page: ${ev.page}.`
  )
  const hero = ev.shots[0]?.hero
  if (hero && hero !== 'none')
    lines.push(
      `Behind the headline: ${hero === 'solid' ? `a solid colour (${ev.shots[0]!.heroColour})` : hero === 'plain' ? 'the plain page' : `a ${hero}`}.`
    )
  if (roles.monochrome) lines.push('No colour outside product pictures is clearly the brand’s.')
  return lines
}

const exampleBlock = (e: RolesExample) =>
  `Example (${e.brand}):\n${e.evidence.join('\n')}\nAnswer: ${JSON.stringify(e.answer)}`

/** The whole instruction for one decision family. */
export function rolesPrompt(ev: ColourEvidence, roles: ColourRoles, logoCrop: boolean): string {
  return [
    BRIEF,
    logoCrop ? 'The image is a crop of the logo.' : '',
    `Choose:\nidentity: the brand colour, by id.\n${ACTION_WORDS}\nhighlight: the second colour for badges, notices and bands, by id, or "none".\nPut your reading of the evidence first. Say "low" confidence when the screenshots do not settle it.`,
    ROLES_EXAMPLES.map(exampleBlock).join('\n\n'),
    `Now this brand:\n${evidenceLines(ev, roles).join('\n')}`,
    'Answer with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** A box of an image as PNG, padded a little. */
export function cropPng(img: Image, box: readonly number[]): Uint8Array {
  const pad = Math.round((box[3]! - box[1]!) * 0.2)
  const b = clampBox([box[0]! - pad, box[1]! - pad, box[2]! + pad, box[3]! + pad], img)
  const w = b[2] - b[0]
  const h = b[3] - b[1]
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    data.set(
      img.data.subarray(((b[1] + y) * img.width + b[0]) * 4, ((b[1] + y) * img.width + b[2]) * 4),
      y * w * 4
    )
  return encodePng({ width: w, height: h, data })
}

/**
 * Decide what the rules left open. The classifier's brand colour is fixed
 * first and the rules re-run on it; its action and highlight are taken only
 * where the rules still leave them open, and only when it is confident.
 * A failed or low-confidence answer keeps the rules' defaults.
 */
export async function classifyRoles(
  ev: ColourEvidence,
  roles: ColourRoles,
  call: RolesCaller,
  shots: { img: Image }[] = []
): Promise<ColourRoles> {
  if (!roles.open.length) return roles
  const shot = ev.shots.findIndex((s) => s.logoBox)
  const images =
    shot >= 0 && shots[shot]
      ? [{ mime: 'image/png' as const, data: cropPng(shots[shot]!.img, ev.shots[shot]!.logoBox!) }]
      : []
  const answer = rolesSchema.parse(
    await call({
      prompt: rolesPrompt(ev, roles, images.length > 0),
      images,
      jsonSchema: rolesJsonSchema(),
      version: ROLES_VERSION,
    })
  )
  // Low confidence keeps the rules' defaults.
  if (answer.confidence === 'low') return { ...roles, open: [] }
  const byId = (id: string) => ev.candidates.find((c) => c.id === id.trim())
  const fixed: FixedRoles = {}
  if (roles.open.includes('identity')) {
    const c = byId(answer.identity)
    if (c && !c.neutral) fixed.identity = c.hex
  }
  let out = decideRoles(ev, fixed)
  const extra: FixedRoles = { ...fixed }
  if (out.open.includes('action')) extra.action = ACTION_ROLE[answer.action]
  if (out.open.includes('highlight') || roles.open.includes('identity')) {
    const h = answer.highlight.trim().toLowerCase() === 'none' ? null : byId(answer.highlight)
    // A gradient hero keeps its second colour: the blend behind the headline is drawn from it.
    if (h === null && !(out.hero.look === 'gradient' && out.highlight.value)) extra.highlight = null
    else if (h && h.hex !== out.identity.value) extra.highlight = h.hex
  }
  if (extra.action || extra.highlight !== undefined) out = decideRoles(ev, extra)
  return { ...out, open: [] }
}
