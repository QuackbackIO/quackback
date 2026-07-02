/**
 * Routing rule CRUD + reorder + match-stats bookkeeping.
 */
import { db, eq, and, asc, sql, routingRules, type RoutingRule } from '@/lib/server/db'
import type { InboxId, RoutingRuleId } from '@quackback/ids'
import { NotFoundError, ValidationError } from '@/lib/shared/errors'
import {
  ruleSetSchema,
  routingActionsSchema,
  type RoutingAction,
  type RuleSet,
} from './routing.types'
import {
  dispatchRoutingRuleCreated,
  dispatchRoutingRuleUpdated,
  dispatchRoutingRuleDeleted,
  type EventActor,
} from '@/lib/server/events/dispatch'
import type { EventRoutingRuleRef } from '@/lib/server/events/types'

const routingRuleActor: EventActor = { type: 'service', displayName: 'routing-system' }

function routingRuleRef(r: RoutingRule): EventRoutingRuleRef {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    inboxIdScope: r.inboxIdScope ?? null,
  }
}

export interface CreateRoutingRuleInput {
  name: string
  description?: string | null
  priority?: number
  enabled?: boolean
  conditions: RuleSet
  actions: RoutingAction[]
  inboxIdScope?: InboxId | null
}

function validateConditionsActions(conditions: unknown, actions: unknown): void {
  const cParse = ruleSetSchema.safeParse(conditions)
  if (!cParse.success)
    throw new ValidationError(
      'ROUTING_CONDITIONS_INVALID',
      cParse.error.issues[0]?.message || 'Invalid conditions'
    )
  const aParse = routingActionsSchema.safeParse(actions)
  if (!aParse.success)
    throw new ValidationError(
      'ROUTING_ACTIONS_INVALID',
      aParse.error.issues[0]?.message || 'Invalid actions'
    )
}

export async function createRoutingRule(input: CreateRoutingRuleInput): Promise<RoutingRule> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('ROUTING_NAME_REQUIRED', 'name required')
  validateConditionsActions(input.conditions, input.actions)

  const [created] = await db
    .insert(routingRules)
    .values({
      name,
      description: input.description ?? null,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
      conditions: input.conditions,
      actions: input.actions,
      inboxIdScope: input.inboxIdScope ?? null,
    })
    .returning()
  void dispatchRoutingRuleCreated(routingRuleActor, routingRuleRef(created)).catch(() => {})
  return created
}

export interface UpdateRoutingRuleInput {
  name?: string
  description?: string | null
  priority?: number
  enabled?: boolean
  conditions?: RuleSet
  actions?: RoutingAction[]
  inboxIdScope?: InboxId | null
}

export async function updateRoutingRule(
  ruleId: RoutingRuleId,
  input: UpdateRoutingRuleInput
): Promise<RoutingRule> {
  const existing = await getRoutingRule(ruleId)
  if (!existing) throw new NotFoundError('ROUTING_RULE_NOT_FOUND', 'Rule not found')

  const patch: Partial<typeof routingRules.$inferInsert> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new ValidationError('ROUTING_NAME_REQUIRED', 'name required')
    patch.name = name
  }
  if (input.description !== undefined) patch.description = input.description
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.enabled !== undefined) patch.enabled = input.enabled
  if (input.conditions !== undefined) {
    validateConditionsActions(input.conditions, input.actions ?? existing.actions)
    patch.conditions = input.conditions
  }
  if (input.actions !== undefined) {
    validateConditionsActions(input.conditions ?? existing.conditions, input.actions)
    patch.actions = input.actions
  }
  if (input.inboxIdScope !== undefined) patch.inboxIdScope = input.inboxIdScope

  if (Object.keys(patch).length === 0) return existing

  const [updated] = await db
    .update(routingRules)
    .set(patch)
    .where(eq(routingRules.id, ruleId))
    .returning()
  void dispatchRoutingRuleUpdated(
    routingRuleActor,
    routingRuleRef(updated),
    Object.keys(patch)
  ).catch(() => {})
  return updated
}

export async function deleteRoutingRule(ruleId: RoutingRuleId): Promise<void> {
  const snapshot = await getRoutingRule(ruleId)
  await db.delete(routingRules).where(eq(routingRules.id, ruleId))
  if (snapshot) {
    void dispatchRoutingRuleDeleted(routingRuleActor, routingRuleRef(snapshot)).catch(() => {})
  }
}

export async function getRoutingRule(ruleId: RoutingRuleId): Promise<RoutingRule | undefined> {
  return db.query.routingRules.findFirst({ where: eq(routingRules.id, ruleId) })
}

export interface ListRoutingRulesParams {
  inboxIdScope?: InboxId | 'workspace'
  enabledOnly?: boolean
}

export async function listRoutingRules(
  params: ListRoutingRulesParams = {}
): Promise<RoutingRule[]> {
  const filters = []
  if (params.enabledOnly) filters.push(eq(routingRules.enabled, true))
  if (params.inboxIdScope === 'workspace') {
    filters.push(sql`${routingRules.inboxIdScope} IS NULL`)
  } else if (params.inboxIdScope) {
    filters.push(eq(routingRules.inboxIdScope, params.inboxIdScope))
  }
  return db
    .select()
    .from(routingRules)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(routingRules.priority), asc(routingRules.createdAt))
}

/**
 * Reorders rules by setting their priority to the position in the input list.
 * Lower index = lower priority value = higher precedence.
 */
export async function reorderRoutingRules(orderedIds: RoutingRuleId[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(routingRules)
      .set({ priority: (i + 1) * 10 })
      .where(eq(routingRules.id, orderedIds[i]))
  }
}

export async function bumpMatchStats(ruleId: RoutingRuleId): Promise<void> {
  await db
    .update(routingRules)
    .set({
      matchCount: sql`${routingRules.matchCount} + 1`,
      lastMatchedAt: new Date(),
    })
    .where(eq(routingRules.id, ruleId))
}
