/**
 * The server's side of the verified critic loop, asked by the builder after
 * a brand match, one step at a time:
 *
 * - score: the drawn preview's fingerprint against the measured target (the
 *   rig's score, 0 to 100), and the art director's critic on the picture of
 *   the preview beside the brand's screenshots (0 to 10 with issues);
 * - revise: from the critic's answer and the measured gaps (worked out here
 *   again, not taken from the builder), at most three changes to the fields
 *   the match set, applied to the draft as a candidate and returned unsaved;
 *   the builder shows it, reads it back and scores it, and keeps it only
 *   when it measures better.
 *
 * Both pass the checks every Appearance request passes (AI set up,
 * allowance left). The critic and the revision are each held to a time; a
 * critic out of time scores as measured alone.
 */
import { z } from 'zod'
import { applyDesignChanges } from '@/lib/shared/design/apply-changes'
import { combinedScore, type CheckScore } from '@/lib/shared/design/brand-check'
import {
  scoreFingerprint,
  type Fingerprint,
  type FingerprintGap,
} from '@/lib/shared/design/fingerprint'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { logger } from '@/lib/server/logger'
import type { FamilyCaller } from './brand-brief'
import { criticSchema, critique, scoreOfCritic, type CriticAnswer } from './brand-critic'
import { gapFields, proposeRevision, REVISABLE, type Revision } from './brand-revise'

const log = logger.child({ module: 'brand-check' })

/** Each model step's time, ms. */
export const CHECK_STEP_MS = { critic: 12_000, revise: 12_000 }

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i)
const cssColour = z.string().max(120)
const num = z.number().finite()

const typeStyle = z
  .object({
    family: z.string().max(400),
    size: num,
    weight: num,
    tracking: num,
    leading: num,
    transform: z.string().max(40),
    color: cssColour,
  })
  .partial()
const boxStyle = z
  .object({
    bg: cssColour,
    color: cssColour,
    radius: num,
    height: num,
    borderWidth: num,
    borderColor: cssColour,
    shadow: z.boolean(),
    size: num,
    weight: num,
    transform: z.string().max(40),
    family: z.string().max(400),
    padX: num,
  })
  .partial()

export const fingerprintSchema = z.object({
  page: cssColour.nullable().optional(),
  headline: typeStyle.nullable().optional(),
  heading: typeStyle.nullable().optional(),
  body: typeStyle.nullable().optional(),
  link: typeStyle.nullable().optional(),
  button: boxStyle.nullable().optional(),
  buttonText: z.string().max(60).nullable().optional(),
  card: boxStyle.nullable().optional(),
  field: boxStyle.nullable().optional(),
})

const jpegOrPng = (max: number) =>
  z
    .string()
    .max(max)
    .regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/)

const round = z.number().int().min(0).max(5)

export const brandCheckRequest = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('score'),
    round,
    target: fingerprintSchema,
    actual: fingerprintSchema,
    /** The preview as drawn; absent when it could not be captured. */
    picture: jpegOrPng(3_000_000).nullable().optional(),
    /** The brand's screenshots as the model saw them in the match. */
    shots: z.array(jpegOrPng(700_000)).min(1).max(3),
    brand: z.string().trim().min(1).max(60).optional(),
  }),
  z.object({
    op: z.literal('revise'),
    round,
    target: fingerprintSchema,
    actual: fingerprintSchema,
    critic: criticSchema.nullable(),
    /** The fields the brand match set. */
    paths: z.array(z.string().max(120)).max(300),
    /** The measured colours a colour field may take. */
    palette: z.array(hexColour).max(12),
  }),
])
export type BrandCheckRequest = z.infer<typeof brandCheckRequest>

export type BrandCheckScored = CheckScore & {
  ok: true
  /** The critic's whole answer, for the revision and the record. */
  answer: CriticAnswer | null
  gaps: FingerprintGap[]
}

export type BrandCheckRevised = {
  ok: true
  evidence: string
  changes: Array<{ path: string; value: unknown; why: string }>
  /** The draft with the changes, unsaved; null when nothing applied. */
  design: PortalDesign | null
}

type Refusal = { ok: false; code: string; message: string }

/** A data URL's bytes, for the model. */
function picture(url: string): { mime: 'image/jpeg' | 'image/png'; data: Uint8Array } {
  const [head, body] = url.split(',', 2) as [string, string]
  return {
    mime: head.includes('image/png') ? 'image/png' : 'image/jpeg',
    data: new Uint8Array(Buffer.from(body, 'base64')),
  }
}

async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((done) => {
        timer = setTimeout(() => {
          log.warn({ ms }, `brand check: ${what} out of time`)
          done(null)
        }, ms)
      }),
    ])
  } catch (err) {
    log.warn({ err }, `brand check: ${what} failed`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** A value at a dotted path of the design. */
const at = (doc: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      doc
    )

export interface CheckDeps {
  family: FamilyCaller
  /** The draft as saved now. */
  draft: () => Promise<PortalDesign>
  allows: () => Promise<Parameters<typeof applyDesignChanges>[3]>
}

export async function scoreCheck(
  data: Extract<BrandCheckRequest, { op: 'score' }>,
  deps: Pick<CheckDeps, 'family'>
): Promise<BrandCheckScored> {
  const started = Date.now()
  const measured = scoreFingerprint(data.target as Fingerprint, data.actual as Fingerprint)
  const answer = await within(
    critique(
      {
        shots: data.shots.map(picture),
        picture: data.picture ? picture(data.picture) : null,
        drawn: data.actual as Fingerprint,
        brand: data.brand ?? null,
      },
      deps.family
    ),
    CHECK_STEP_MS.critic,
    'critic'
  )
  const critic = answer ? scoreOfCritic(answer) : null
  const combined = combinedScore(measured.score, critic)
  log.info(
    {
      round: data.round,
      measured: measured.score,
      critic,
      combined,
      picture: !!data.picture,
      ms: Date.now() - started,
    },
    'brand check scored'
  )
  return { ok: true, measured: measured.score, critic, combined, answer, gaps: measured.gaps }
}

export async function reviseCheck(
  data: Extract<BrandCheckRequest, { op: 'revise' }>,
  deps: CheckDeps
): Promise<BrandCheckRevised> {
  const started = Date.now()
  const set = new Set(data.paths)
  const { gaps } = scoreFingerprint(data.target as Fingerprint, data.actual as Fingerprint)
  // Only fields the match set and a measured gap points to (gapFields).
  const pointed = gapFields(gaps)
  const paths = Object.keys(REVISABLE).filter((path) => set.has(path) && pointed.has(path))
  if (!paths.length)
    return { ok: true, evidence: 'no measured gap to act on', changes: [], design: null }
  const design = await deps.draft()
  const fields = paths.map((path) => ({ path, now: at(design, path) }))
  const revision: Revision | null = await within(
    proposeRevision({ critic: data.critic, gaps, fields, palette: data.palette }, deps.family),
    CHECK_STEP_MS.revise,
    'revision'
  )
  if (!revision?.changes.length)
    return { ok: true, evidence: revision?.evidence ?? 'no revision', changes: [], design: null }
  const applied = applyDesignChanges(
    design,
    revision.changes.map(({ path, value }) => ({ path, value })),
    'site',
    await deps.allows()
  )
  const why = new Map(revision.changes.map((c) => [c.path, c.why]))
  const changes = applied.applied.map((c) => ({
    path: c.path,
    value: c.after,
    why: why.get(c.path) ?? '',
  }))
  log.info(
    {
      round: data.round,
      proposed: revision.changes,
      applied: changes.length,
      ms: Date.now() - started,
    },
    'brand check revised'
  )
  return {
    ok: true,
    evidence: revision.evidence,
    changes,
    design: changes.length ? applied.design : null,
  }
}

/** Runs a step of the loop for the person signed in. */
export async function runBrandCheckRequest(
  data: BrandCheckRequest
): Promise<BrandCheckScored | BrandCheckRevised | Refusal> {
  const [{ designAiModel, allowanceRefusal }, { structuredFamilyCaller }] = await Promise.all([
    import('./design-ai'),
    import('./brand-calls'),
  ])
  const model = designAiModel()
  if (!model)
    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Quackback AI is not set up for this workspace.',
    }
  const limited = await allowanceRefusal()
  if (limited) return limited
  const family = structuredFamilyCaller(model)
  if (data.op === 'score') return scoreCheck(data, { family })
  const [actions, { designAllowances }] = await Promise.all([
    import('../design.actions'),
    import('../design-allowances'),
  ])
  return reviseCheck(data, {
    family,
    draft: async () => (await actions.readDraftForChange()).design,
    allows: async () => ({
      ...(await designAllowances()),
      links: new Set<string>(),
      files: new Set<string>(),
    }),
  })
}
