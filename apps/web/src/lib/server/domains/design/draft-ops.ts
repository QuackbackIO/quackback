/**
 * The builder's operations on the draft, for the API and agents: the same
 * vocabulary the builder's panels and Quackback AI dispatch (dispatch.ts),
 * applied on the server with the same refusals. Each operation is applied in
 * turn; a refused one changes nothing and the rest still apply. Operations
 * that need the pages the portal has take them from the workspace, and the
 * builder's drag state (a drop from Add, a drag's starting blocks) is not
 * offered. Publishing stays with a person.
 */
import { z } from 'zod'
import { applyDesignOp, type DesignOp } from '@/lib/shared/design/dispatch'
import { blockOf, SECTION_TYPES } from '@/lib/shared/design/blocks'
import { HOME_LAYOUTS } from '@/lib/shared/design/home-layouts'
import { PAGE_CHOICE_DEFAULTS } from '@/lib/shared/design/page-choices'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { STYLE_ELEMENT_NAMES } from '@/lib/shared/design/style-tokens'
import { idRefusal, settledForSave } from './api-writes'
import { readDraftForChange, saveDesignDraft, type DesignRefusal } from './design.actions'
import type { DesignAuthor } from './design.service'
import { validateDesign } from './validate-design'

/** The most operations one request makes. */
export const MAX_OPS = 50

const id = z.string().min(1).max(40)
const blockRef = z.union([id, z.number().int().min(0)])
const key = z.string().min(1).max(60)
const locale = z.string().min(2).max(20).optional()
const nonEmpty = (keys: readonly string[]) => keys as [string, ...string[]]

/** One operation as the API takes it. */
export const apiDesignOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('block.set'), block: blockRef, key, value: z.unknown(), locale }),
  z.object({
    op: z.literal('block.setEach'),
    block: blockRef,
    settings: z.record(z.string(), z.unknown()),
    locale,
  }),
  z.object({
    op: z.literal('block.add'),
    type: z.string().min(1).max(40),
    after: id.nullable().optional(),
    turnOnHome: z.boolean().optional(),
  }),
  z.object({ op: z.literal('block.duplicate'), id }),
  z.object({ op: z.literal('block.remove'), block: blockRef }),
  z.object({ op: z.literal('block.step'), id, by: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ op: z.literal('block.place'), id, place: z.number().int().min(0) }),
  z.object({
    op: z.literal('block.grid'),
    id,
    change: z.union([
      z.object({
        nudge: z.enum(['left', 'right', 'up', 'down', 'wider', 'narrower', 'taller', 'shorter']),
      }),
      z.object({ move: z.object({ x: z.number().int(), y: z.number().int() }) }),
      z.object({ size: z.object({ w: z.number().int(), h: z.number().int() }) }),
    ]),
  }),
  z.object({
    op: z.literal('block.look'),
    id,
    scope: z.enum(['every', 'one']),
    prop: z.enum(['tone', 'align', 'colour']),
    value: z.string().max(40).optional(),
  }),
  z.object({
    op: z.literal('block.lookReset'),
    id,
    scope: z.enum(['every', 'one']),
    prop: z.enum(['tone', 'align', 'colour']),
  }),
  z.object({ op: z.literal('block.matchLook'), id, to: id }),
  z.object({
    op: z.literal('block.styleReset'),
    id,
    element: z.enum(nonEmpty(STYLE_ELEMENT_NAMES)),
  }),
  z.object({ op: z.literal('block.phoneHidden'), id, hidden: z.boolean() }),
  z.object({
    op: z.literal('home.layout'),
    layout: z.enum(nonEmpty(HOME_LAYOUTS.map((l) => l.id))),
  }),
  z.object({
    op: z.literal('section.set'),
    type: z.enum(SECTION_TYPES),
    key,
    value: z.unknown(),
    locale,
  }),
  z.object({
    op: z.literal('page.choice'),
    page: z.enum(nonEmpty(Object.keys(PAGE_CHOICE_DEFAULTS))),
    key,
    value: z.unknown(),
  }),
  z.object({ op: z.literal('part.shown'), key: z.string().min(1).max(80), shown: z.boolean() }),
  z.object({
    op: z.literal('words.set'),
    field: z.object({ kind: z.enum(['page', 'block', 'welcome']) }).passthrough(),
    locale: z.string().min(2).max(20),
    doc: z.unknown(),
  }),
  z.object({ op: z.literal('hero.set'), key, value: z.unknown(), locale }),
])
export type ApiDesignOp = z.infer<typeof apiDesignOp>

export const apiDesignOps = z.array(apiDesignOp).min(1).max(MAX_OPS)

/** The builder's operation for an API one, or why it is refused before it runs. */
function toDesignOp(op: ApiDesignOp, gates: PortalPageGates): DesignOp | string {
  switch (op.op) {
    case 'block.add':
      if (!blockOf(op.type)) return `There is no Home block called ${op.type}`
      return {
        op: 'block.add',
        type: op.type as Extract<DesignOp, { op: 'block.add' }>['type'],
        after: op.after,
        ...(op.turnOnHome ? { turnOnHome: { gates } } : {}),
      }
    case 'block.grid':
      return { ...op, gates }
    case 'home.layout':
      return { op: 'home.layout', layout: HOME_LAYOUTS.find((l) => l.id === op.layout)!, gates }
    case 'page.choice': {
      const usual = PAGE_CHOICE_DEFAULTS[op.page as keyof typeof PAGE_CHOICE_DEFAULTS]
      if (!(op.key in usual)) return `The ${op.page} page has no choice called ${op.key}`
      return op as DesignOp
    }
    default:
      return op as DesignOp
  }
}

export interface OpsOutcome {
  ok: true
  /** The operations made, by their place in the request. */
  applied: number[]
  /** The operations refused, by their place in the request, and why. */
  refused: Array<{ index: number; reason: string }>
  /** The draft's revision after the operations, unchanged when none applied. */
  revision: string
}

/**
 * Applies the operations to the design being edited, in order, and saves the
 * result as the draft against `expectedRevision`. Each operation must leave a
 * design that validates, or it is refused and changes nothing.
 */
export async function applyDraftOps(
  ops: readonly ApiDesignOp[],
  author: DesignAuthor,
  expectedRevision: string,
  gates: PortalPageGates
): Promise<OpsOutcome | DesignRefusal> {
  const current = await readDraftForChange()
  if (current.revision !== expectedRevision)
    return {
      ok: false,
      code: 'REVISION_MISMATCH',
      message: 'The draft changed since you opened it.',
    }
  let draft: PortalDesign = structuredClone(current.design)
  const applied: number[] = []
  const refused: OpsOutcome['refused'] = []
  ops.forEach((given, index) => {
    const op = toDesignOp(given, gates)
    if (typeof op === 'string') return refused.push({ index, reason: op })
    const next = structuredClone(draft)
    try {
      const result = applyDesignOp(next, op)
      if (!result.ok) return refused.push({ index, reason: result.refusal })
      const missing = idRefusal(next.pages.home.blocks)
      if (missing) return refused.push({ index, reason: missing.message })
      draft = validateDesign(next)
      applied.push(index)
    } catch (error) {
      refused.push({ index, reason: error instanceof Error ? error.message : 'Not applied' })
    }
  })
  if (applied.length === 0) return { ok: true, applied, refused, revision: current.revision }
  const saved = await saveDesignDraft(settledForSave(draft), author, expectedRevision, 'agent')
  if (!saved.ok) return saved
  return { ok: true, applied, refused, revision: saved.revision }
}
