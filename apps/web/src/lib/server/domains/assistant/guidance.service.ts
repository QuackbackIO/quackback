/**
 * Guidance rules — short admin-authored directives Quinn's prompt assembly
 * folds in alongside its system prompt (e.g. "always mention the refund
 * policy on billing questions"). Pure CRUD plus the surface-scoped list query
 * prompt assembly reads from; `GUIDANCE_MAX_ENABLED_PER_SURFACE` and
 * `GUIDANCE_CHAR_BUDGET` bound how much of it that later step folds in.
 */
import {
  db,
  eq,
  and,
  or,
  isNull,
  inArray,
  asc,
  sql,
  assistantGuidanceRules,
} from '@/lib/server/db'
import type { AssistantGuidanceRuleId, PrincipalId } from '@quackback/ids'
import { positionCaseSql } from '@/lib/server/utils'
import { ValidationError } from '@/lib/shared/errors'
import { ASSISTANT_SURFACES, type AssistantSurface } from '@/lib/shared/assistant/surfaces'
import {
  ASSISTANT_GUIDANCE_CATEGORIES,
  type AssistantGuidanceCategory,
} from '@/lib/shared/assistant/guidance-categories'

export type AssistantGuidanceRule = typeof assistantGuidanceRules.$inferSelect

const TITLE_MAX_LENGTH = 80
const BODY_MAX_LENGTH = 1000

/** Enabled rules folded into one surface's prompt are capped so guidance never crowds out the system prompt. */
export const GUIDANCE_MAX_ENABLED_PER_SURFACE = 20

/** Total character budget prompt assembly gives to the guidance rule bodies it folds in. */
export const GUIDANCE_CHAR_BUDGET = 4000

export interface GuidanceRuleInput {
  title: string
  body: string
  enabled?: boolean
  /** NULL/omitted = every surface; otherwise an allowlist of AssistantSurface values. */
  surfaces?: AssistantSurface[] | null
  position?: number
  /** Groups the rule in the admin list; defaults to 'other'. */
  category?: AssistantGuidanceCategory
}

function validateGuidanceRuleInput(input: Partial<GuidanceRuleInput>): void {
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) throw new ValidationError('VALIDATION_ERROR', 'Title is required')
    if (title.length > TITLE_MAX_LENGTH) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        `Title must be ${TITLE_MAX_LENGTH} characters or fewer`
      )
    }
  }
  if (input.body !== undefined) {
    const body = input.body.trim()
    if (!body) throw new ValidationError('VALIDATION_ERROR', 'Body is required')
    if (body.length > BODY_MAX_LENGTH) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        `Body must be ${BODY_MAX_LENGTH} characters or fewer`
      )
    }
  }
  if (input.surfaces) {
    for (const surface of input.surfaces) {
      if (!ASSISTANT_SURFACES.includes(surface)) {
        throw new ValidationError('VALIDATION_ERROR', `Unknown surface: ${surface}`)
      }
    }
  }
  if (input.category !== undefined && !ASSISTANT_GUIDANCE_CATEGORIES.includes(input.category)) {
    throw new ValidationError('VALIDATION_ERROR', `Unknown category: ${input.category}`)
  }
}

export async function createGuidanceRule(
  input: GuidanceRuleInput & { createdById?: PrincipalId }
): Promise<AssistantGuidanceRule> {
  validateGuidanceRuleInput(input)
  const [row] = await db
    .insert(assistantGuidanceRules)
    .values({
      title: input.title.trim(),
      body: input.body.trim(),
      enabled: input.enabled ?? true,
      surfaces: input.surfaces ?? null,
      position: input.position ?? 0,
      category: input.category ?? 'other',
      createdById: input.createdById ?? null,
    })
    .returning()
  return row
}

export async function listGuidanceRules(
  opts: { enabledOnly?: boolean; surface?: AssistantSurface } = {}
): Promise<AssistantGuidanceRule[]> {
  const conditions = []
  if (opts.enabledOnly) conditions.push(eq(assistantGuidanceRules.enabled, true))
  if (opts.surface) {
    // NULL surfaces = applies to every surface, so it always matches too.
    conditions.push(
      or(
        isNull(assistantGuidanceRules.surfaces),
        sql`${opts.surface} = ANY(${assistantGuidanceRules.surfaces})`
      )
    )
  }
  return db
    .select()
    .from(assistantGuidanceRules)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(assistantGuidanceRules.position), asc(assistantGuidanceRules.createdAt))
}

export async function updateGuidanceRule(
  id: AssistantGuidanceRuleId,
  patch: Partial<GuidanceRuleInput>
): Promise<AssistantGuidanceRule | null> {
  validateGuidanceRuleInput(patch)
  const values: Partial<typeof assistantGuidanceRules.$inferInsert> = { updatedAt: new Date() }
  if (patch.title !== undefined) values.title = patch.title.trim()
  if (patch.body !== undefined) values.body = patch.body.trim()
  if (patch.enabled !== undefined) values.enabled = patch.enabled
  if (patch.surfaces !== undefined) values.surfaces = patch.surfaces
  if (patch.position !== undefined) values.position = patch.position
  if (patch.category !== undefined) values.category = patch.category
  const [row] = await db
    .update(assistantGuidanceRules)
    .set(values)
    .where(eq(assistantGuidanceRules.id, id))
    .returning()
  return row ?? null
}

/** Rewrite `position` to match the given order (single batch UPDATE). */
export async function reorderGuidanceRules(ids: AssistantGuidanceRuleId[]): Promise<void> {
  if (!ids || ids.length === 0) return
  await db
    .update(assistantGuidanceRules)
    .set({ position: positionCaseSql(assistantGuidanceRules.id, ids), updatedAt: new Date() })
    .where(inArray(assistantGuidanceRules.id, ids))
}

export async function deleteGuidanceRule(id: AssistantGuidanceRuleId): Promise<void> {
  await db.delete(assistantGuidanceRules).where(eq(assistantGuidanceRules.id, id))
}
