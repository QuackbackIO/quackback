/** Situational-guidance persistence and deterministic role prefiltering. */
import { db, eq, and, inArray, asc, assistantGuidanceRules } from '@/lib/server/db'
import type { AssistantGuidanceRuleId, PrincipalId } from '@quackback/ids'
import { positionCaseSql } from '@/lib/server/utils'
import { ValidationError } from '@/lib/shared/errors'
import {
  ASSISTANT_GUIDANCE_CHAR_BUDGET,
  ASSISTANT_GUIDANCE_MAX_ENABLED_CANDIDATES,
  assistantGuidanceAgentSchema,
  assistantGuidanceRuleInputSchema,
  assistantGuidanceRulePatchSchema,
  type AssistantGuidanceAgent,
  type AssistantGuidanceRuleInput,
  type AssistantGuidanceRulePatch,
} from '@/lib/shared/assistant/guidance'

export type AssistantGuidanceRule = typeof assistantGuidanceRules.$inferSelect
export type GuidanceRuleInput = AssistantGuidanceRuleInput

export const GUIDANCE_MAX_ENABLED_PER_ROLE_CHANNEL = ASSISTANT_GUIDANCE_MAX_ENABLED_CANDIDATES
export const GUIDANCE_CHAR_BUDGET = ASSISTANT_GUIDANCE_CHAR_BUDGET

function validationError(error: unknown): never {
  const issueMessage =
    typeof error === 'object' && error !== null && 'issues' in error
      ? (error as { issues?: Array<{ message?: string }> }).issues?.[0]?.message
      : undefined
  throw new ValidationError('VALIDATION_ERROR', issueMessage ?? 'Invalid guidance rule')
}

export async function createGuidanceRule(
  input: GuidanceRuleInput & { createdById?: PrincipalId }
): Promise<AssistantGuidanceRule> {
  const parsed = assistantGuidanceRuleInputSchema.safeParse(input)
  if (!parsed.success) validationError(parsed.error)
  const [row] = await db
    .insert(assistantGuidanceRules)
    .values({
      ...parsed.data,
      createdById: input.createdById ?? null,
    })
    .returning()
  return row
}

export async function listGuidanceRules(
  opts: { enabledOnly?: boolean } = {}
): Promise<AssistantGuidanceRule[]> {
  const conditions = []
  if (opts.enabledOnly) conditions.push(eq(assistantGuidanceRules.enabled, true))
  return db
    .select()
    .from(assistantGuidanceRules)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(assistantGuidanceRules.priority), asc(assistantGuidanceRules.createdAt))
}

/** Enabled candidates owned by one resolved agent, in application priority order. */
export async function listEnabledGuidanceCandidates(opts: {
  agent: AssistantGuidanceAgent
}): Promise<AssistantGuidanceRule[]> {
  const agent = assistantGuidanceAgentSchema.safeParse(opts.agent)
  if (!agent.success) validationError(agent.error)

  return db
    .select()
    .from(assistantGuidanceRules)
    .where(
      and(eq(assistantGuidanceRules.enabled, true), eq(assistantGuidanceRules.agent, agent.data))
    )
    .orderBy(asc(assistantGuidanceRules.priority), asc(assistantGuidanceRules.createdAt))
    .limit(ASSISTANT_GUIDANCE_MAX_ENABLED_CANDIDATES)
}

export async function updateGuidanceRule(
  id: AssistantGuidanceRuleId,
  patch: AssistantGuidanceRulePatch
): Promise<AssistantGuidanceRule | null> {
  const parsed = assistantGuidanceRulePatchSchema.safeParse(patch)
  if (!parsed.success) validationError(parsed.error)
  const values: Partial<typeof assistantGuidanceRules.$inferInsert> = { updatedAt: new Date() }
  if (parsed.data.name !== undefined) values.name = parsed.data.name
  if (parsed.data.appliesWhen !== undefined) values.appliesWhen = parsed.data.appliesWhen
  if (parsed.data.instruction !== undefined) values.instruction = parsed.data.instruction
  if (parsed.data.agent !== undefined) values.agent = parsed.data.agent
  if (parsed.data.enabled !== undefined) values.enabled = parsed.data.enabled
  if (parsed.data.priority !== undefined) values.priority = parsed.data.priority
  const [row] = await db
    .update(assistantGuidanceRules)
    .set(values)
    .where(eq(assistantGuidanceRules.id, id))
    .returning()
  return row ?? null
}

/** Rewrite `priority` to match the given order (single batch UPDATE). */
export async function reorderGuidanceRules(ids: AssistantGuidanceRuleId[]): Promise<void> {
  if (!ids || ids.length === 0) return
  await db
    .update(assistantGuidanceRules)
    .set({ priority: positionCaseSql(assistantGuidanceRules.id, ids), updatedAt: new Date() })
    .where(inArray(assistantGuidanceRules.id, ids))
}

export async function deleteGuidanceRule(id: AssistantGuidanceRuleId): Promise<void> {
  await db.delete(assistantGuidanceRules).where(eq(assistantGuidanceRules.id, id))
}
