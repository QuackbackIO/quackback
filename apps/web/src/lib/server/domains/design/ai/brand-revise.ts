/**
 * The revision family of the verified loop: from the critic's weakest
 * dimensions and the measured gaps, at most three changes to the fields the
 * brand match set, each within that field's options (a colour only from
 * the measured palette). The loop applies them as a candidate and keeps
 * them only when the measured score holds and the combined score rises.
 *
 * Flat structured output; few-shot examples from fictional brands only,
 * synced to the schema by a test.
 */
import { z } from 'zod'
import { CARD_SHADOWS } from '@/lib/shared/design/tune'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { FingerprintGap } from '@/lib/shared/design/fingerprint'
import { CRITIC_DIMENSIONS } from '@/lib/shared/design/brand-check'
import { DESIGNER_BRIEF, type FamilyCaller } from './brand-brief'
import type { CriticAnswer } from './brand-critic'

export const REVISE_VERSION = 'revise-v1'

type Field =
  | { kind: 'number'; min: number; max: number; unit?: string }
  | { kind: 'choice'; options: readonly (string | number)[] }
  | { kind: 'colour' }

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const

/** The fields a revision may change: those a brand match sets that shape how the brand reads. */
/**
 * The fields a revision may change. Never the brand and second colours or
 * the hero (band, its shape, art and tint): those come from measurement and
 * the hero rules, and a critic's taste undid them live (a furniture retailer's yellow second
 * colour swapped for blue, turning its hero light blue). See gapFields for
 * which of these a round is offered.
 */
export const REVISABLE: Record<string, Field> = {
  'tune.headline.size': { kind: 'number', min: 10, max: 200, unit: 'px' },
  'tune.headline.weight': { kind: 'choice', options: WEIGHTS },
  'tune.headline.tracking': { kind: 'number', min: -0.1, max: 0.3, unit: 'em' },
  'tune.headline.leading': { kind: 'number', min: 0.8, max: 2.2 },
  'brand.fonts.scale': { kind: 'choice', options: DESIGN_OPTIONS.typeScale },
  'brand.fonts.headingWeight': { kind: 'choice', options: DESIGN_OPTIONS.headingWeight },
  'brand.fonts.tracking': { kind: 'choice', options: DESIGN_OPTIONS.tracking },
  'brand.fonts.headlineCase': { kind: 'choice', options: DESIGN_OPTIONS.textCase },
  'shape.corners': { kind: 'choice', options: DESIGN_OPTIONS.corners },
  'shape.buttons': { kind: 'choice', options: DESIGN_OPTIONS.buttons },
  'shape.fill': { kind: 'choice', options: DESIGN_OPTIONS.fill },
  'layout.cards': { kind: 'choice', options: DESIGN_OPTIONS.cards },
  'layout.density': { kind: 'choice', options: DESIGN_OPTIONS.density },
  'layout.nav': { kind: 'choice', options: DESIGN_OPTIONS.nav },
  'tune.button.radius': { kind: 'number', min: 0, max: 999, unit: 'px (999 fully round)' },
  'tune.button.height': { kind: 'number', min: 24, max: 72, unit: 'px' },
  'tune.button.fill': { kind: 'colour' },
  'tune.card.radius': { kind: 'number', min: 0, max: 48, unit: 'px' },
  'tune.card.border': { kind: 'number', min: 0, max: 4, unit: 'px' },
  'tune.card.shadow': { kind: 'choice', options: CARD_SHADOWS },
  'layout.navText': { kind: 'choice', options: DESIGN_OPTIONS.navText },
  'tune.link.colour': { kind: 'colour' },
  'brand.light.ink': { kind: 'colour' },
}

/** Which fields move each measured property, so a gap names where to act. */
export const GAP_FIELDS: Record<string, string[]> = {
  'headline.size': ['tune.headline.size', 'brand.fonts.scale'],
  'headline.weight': ['tune.headline.weight', 'brand.fonts.headingWeight'],
  'headline.tracking': ['tune.headline.tracking', 'brand.fonts.tracking'],
  'headline.leading': ['tune.headline.leading'],
  'headline.transform': ['brand.fonts.headlineCase'],
  'headline.color': ['brand.light.ink'],
  'button.bg': ['tune.button.fill', 'shape.fill'],
  'button.radius': ['tune.button.radius', 'shape.buttons'],
  'button.height': ['tune.button.height'],
  'card.radius': ['tune.card.radius', 'shape.corners'],
  'card.borderWidth': ['tune.card.border', 'layout.cards'],
  'card.shadow': ['tune.card.shadow', 'layout.cards'],
}

/**
 * The fields a round is offered: those a measured gap points to. A revision
 * moves the portal towards what was measured on the site, never on the
 * critic's word alone, so it can be checked by the measured score.
 */
export function gapFields(gaps: ReadonlyArray<{ role: string; prop: string }>): Set<string> {
  return new Set(
    gaps.flatMap((g) => GAP_FIELDS[`${g.role}.${g.prop}`] ?? []).filter((f) => f in REVISABLE)
  )
}

export const MAX_REVISION_CHANGES = 3

/** A change slot left empty. */
export const NO_CHANGE = 'none'

/**
 * Flat: three change slots, each a field, its new value and why (a nested
 * list of changes left the model's answer missing about half the time).
 */
export const reviseSchemaFor = (fields: readonly [string, ...string[]]) => {
  const field = z.enum([...fields, NO_CHANGE] as [string, ...string[]])
  const value = z.string().describe('the new value, written as the options are; "" for none')
  const why = z.string().describe('the issue or gap it fixes, in a few words; "" for none')
  return z.object({
    evidence: z
      .string()
      .describe('one or two sentences: what most keeps the portal from reading as the brand'),
    change1_field: field,
    change1_value: value,
    change1_why: why,
    change2_field: field,
    change2_value: value,
    change2_why: why,
    change3_field: field,
    change3_value: value,
    change3_why: why,
  })
}

const ALL = Object.keys(REVISABLE) as [string, ...string[]]
/** The schema with every revisable field, as the examples are checked against. */
export const reviseSchema = reviseSchemaFor(ALL)
export type ReviseAnswer = z.infer<typeof reviseSchema>

/** The answer's filled slots, in order. */
export function answerChanges(
  a: ReviseAnswer
): Array<{ field: string; value: string; why: string }> {
  return ([1, 2, 3] as const).flatMap((n) => {
    const field = a[`change${n}_field`]
    return field === NO_CHANGE
      ? []
      : [{ field, value: a[`change${n}_value`], why: a[`change${n}_why`] }]
  })
}

export interface ReviseExample {
  brand: string
  evidence: string[]
  answer: ReviseAnswer
}

/** Fictional brands only. */
export const REVISE_EXAMPLES: ReviseExample[] = [
  {
    brand: 'Fernway',
    evidence: [
      'Weakest: type 4 (the site sets large type light and geometric; the portal’s headline is heavy), shape 4 (buttons fully round on the site, small corners here).',
      'Measured gaps: headline.weight measured 300, drawn 700 (fields tune.headline.weight, brand.fonts.headingWeight); button.radius measured fully round, drawn 4 (fields tune.button.radius, shape.buttons).',
      'Fields: tune.headline.weight: now 700; change to 100, 200, 300, 400, 500, 600, 800, 900; brand.fonts.headingWeight: now 700; change to 300, 400, 500, 600, 800; tune.button.radius: now 4; change to a number from 0 to 999 px (999 fully round); shape.buttons: now rounded; change to match, square, pill.',
    ],
    answer: {
      evidence: 'The heavy headline and small button corners break Fernway’s light, soft voice.',
      change1_field: 'tune.headline.weight',
      change1_value: '300',
      change1_why: 'headline measured light (300), drawn 700',
      change2_field: 'brand.fonts.headingWeight',
      change2_value: '300',
      change2_why: 'headings light, as the site',
      change3_field: 'tune.button.radius',
      change3_value: '999',
      change3_why: 'buttons measured fully round, drawn 4px',
    },
  },
  {
    brand: 'Quillstone',
    evidence: [
      'Weakest: colour 3 (crimson fills buttons and a band; on the site it only marks links), glance 4.',
      'Measured gaps: button.bg measured rgb(17, 17, 17), drawn rgb(176, 18, 58) (fields tune.button.fill, shape.fill).',
      'Fields: shape.fill: now accent; change to ink; tune.button.fill: now #b0123a; change to #111111.',
    ],
    answer: {
      evidence: 'Crimson is spent on buttons and a band where the site keeps it for links.',
      change1_field: 'tune.button.fill',
      change1_value: '#111111',
      change1_why: 'button fill measured #111111, drawn crimson',
      change2_field: 'shape.fill',
      change2_value: 'ink',
      change2_why: 'filled parts in ink, as the site’s buttons',
      change3_field: NO_CHANGE,
      change3_value: '',
      change3_why: '',
    },
  },
]

/** A field as the prompt offers it: its value now, and the other values it may take. */
const describeField = (path: string, field: Field, now: unknown, palette: string[]) => {
  const other = (values: readonly (string | number)[]) =>
    values.filter((v) => String(v).toLowerCase() !== String(now).toLowerCase()).join(', ')
  const options =
    field.kind === 'number'
      ? `a number from ${field.min} to ${field.max}${field.unit ? ` ${field.unit}` : ''}`
      : field.kind === 'choice'
        ? other(field.options)
        : other(palette)
  const was = now === undefined || now === null ? 'not set' : String(now)
  return `${path}: now ${was}; change to ${options}`
}

const sayValue = (prop: string, v: unknown) =>
  v === undefined || v === null
    ? 'nothing'
    : prop === 'radius' && Number(v) >= 999
      ? 'fully round'
      : typeof v === 'number'
        ? String(Math.round(v * 1000) / 1000)
        : String(v)

export interface ReviseEvidence {
  critic: CriticAnswer | null
  gaps: FingerprintGap[]
  /** The revisable fields this match set, with their values now. */
  fields: Array<{ path: string; now: unknown }>
  /** The measured colours a colour field may take. */
  palette: string[]
}

export function reviseEvidenceLines(ev: ReviseEvidence): string[] {
  const weakest = ev.critic
    ? [...CRITIC_DIMENSIONS]
        .sort((a, b) => ev.critic![a] - ev.critic![b])
        .slice(0, 3)
        .map((d) => `${d} ${ev.critic![d]} (${ev.critic![`${d}_evidence`]})`)
    : []
  const allowed = new Set(ev.fields.map((f) => f.path))
  const gaps = ev.gaps.flatMap((g) => {
    const key = `${g.role}.${g.prop}`
    const fields = (GAP_FIELDS[key] ?? []).filter((f) => allowed.has(f))
    return fields.length
      ? [
          `${key} measured ${sayValue(g.prop, g.target)}, drawn ${sayValue(g.prop, g.actual)} (fields ${fields.join(', ')})`,
        ]
      : []
  })
  return [
    weakest.length ? `Weakest: ${weakest.join('; ')}.` : 'The critic could not be asked.',
    ev.critic?.issues.length ? `Issues: ${ev.critic.issues.join('; ')}.` : '',
    gaps.length ? `Measured gaps: ${gaps.join('; ')}.` : 'Measured gaps: none.',
    `Fields:\n${ev.fields.map((f) => describeField(f.path, REVISABLE[f.path]!, f.now, ev.palette)).join('\n')}`,
  ].filter(Boolean)
}

const exampleBlock = (e: ReviseExample) =>
  `Example (${e.brand}):\n${e.evidence.join('\n')}\nAnswer: ${JSON.stringify(e.answer)}`

export function revisePrompt(ev: ReviseEvidence): string {
  return [
    DESIGNER_BRIEF,
    `The portal was made from the brand's screenshots, then drawn, measured against what the screenshots measured, and scored by an art director. Propose at most ${MAX_REVISION_CHANGES} changes that fix the biggest differences.
Rules: change only the fields listed, to a value from their options that differs from the value now (a change to the same value does nothing); a measured gap is fixed by moving toward the value measured, never further from it; a colour only from the palette listed; never undo what already matches; fewer changes are better than many; leave a slot "none" when you have nothing better. Each change is kept only if the portal then measures closer to the screenshots.`,
    'Put your reading of the evidence first, then the changes; no changes when nothing listed would help. Answer with the JSON object only.',
    REVISE_EXAMPLES.map(exampleBlock).join('\n\n'),
    `Now this brand:\n${reviseEvidenceLines(ev).join('\n')}`,
  ].join('\n\n')
}

/** A value as the field takes it, or null when it is not one of its options. */
export function parseRevisionValue(path: string, raw: string, palette: readonly string[]): unknown {
  const field = REVISABLE[path]
  if (!field) return null
  const text = raw.trim()
  if (field.kind === 'colour') {
    const hex = text.toLowerCase()
    return palette.some((p) => p.toLowerCase() === hex) ? hex : null
  }
  if (field.kind === 'number') {
    const n = /^fully round$|^pill$/i.test(text) ? 999 : Number.parseFloat(text)
    if (!Number.isFinite(n)) return null
    return Math.min(field.max, Math.max(field.min, n))
  }
  const option = field.options.find((o) => String(o) === text)
  return option ?? null
}

export interface Revision {
  evidence: string
  changes: Array<{ path: string; value: unknown; why: string }>
}

export async function proposeRevision(ev: ReviseEvidence, call: FamilyCaller): Promise<Revision> {
  const fields = ev.fields.map((f) => f.path).filter((p) => p in REVISABLE)
  if (!fields.length) return { evidence: 'nothing the match set can be revised', changes: [] }
  const request = {
    family: 'revise' as const,
    version: REVISE_VERSION,
    prompt: revisePrompt({ ...ev, fields: ev.fields.filter((f) => f.path in REVISABLE) }),
    images: [],
    schema: reviseSchemaFor(fields as [string, ...string[]]),
    // Room for the model's thinking as well as its answer: 500 cut answers off mid-word.
    maxTokens: 2000,
  }
  // An answer that does not come back is asked for once more.
  const answer = await call(request).catch(() => call(request))
  const seen = new Set<string>()
  const changes = answerChanges(answer).flatMap((c) => {
    if (seen.has(c.field) || !fields.includes(c.field)) return []
    seen.add(c.field)
    const value = parseRevisionValue(c.field, c.value, ev.palette)
    const now = ev.fields.find((f) => f.path === c.field)?.now
    return value === null || value === now ? [] : [{ path: c.field, value, why: c.why }]
  })
  return { evidence: answer.evidence, changes: changes.slice(0, MAX_REVISION_CHANGES) }
}
