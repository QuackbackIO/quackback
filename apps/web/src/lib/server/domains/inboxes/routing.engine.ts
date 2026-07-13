/**
 * Routing engine — pure evaluator + DB-aware `route()` helper.
 * First-match-wins by `(priority asc, createdAt asc)`.
 */
import {
  db,
  eq,
  asc,
  isNull,
  inboxes as inboxesTable,
  routingRules as routingRulesTable,
  type RoutingRule,
} from '@/lib/server/db'
import {
  ruleSetSchema,
  routingActionsSchema,
  type RoutingAction,
  type RoutingCondition,
  type RoutingInput,
  type RoutingDecision,
  type RuleSet,
} from './routing.types'

function fieldValue(input: RoutingInput, field: RoutingCondition['field']): string | null {
  switch (field) {
    case 'subject':
      return input.subject ?? null
    case 'descriptionText':
      return input.descriptionText ?? null
    case 'channel':
      return input.channel ?? null
    case 'priority':
      return input.priority ?? null
    case 'organizationDomain':
      return input.organizationDomain ?? null
    case 'requesterEmail':
      return input.requesterEmail ?? null
    case 'inboxChannelKind':
      return input.inboxChannelKind ?? null
    default:
      return null
  }
}

function evalCondition(input: RoutingInput, c: RoutingCondition): boolean {
  const actual = fieldValue(input, c.field)
  if (actual == null) return false
  switch (c.op) {
    case 'eq':
      return typeof c.value === 'string' && actual.toLowerCase() === c.value.toLowerCase()
    case 'contains':
      return typeof c.value === 'string' && actual.toLowerCase().includes(c.value.toLowerCase())
    case 'matches':
      if (typeof c.value !== 'string') return false
      try {
        return new RegExp(c.value, 'i').test(actual)
      } catch {
        return false
      }
    case 'in':
      if (!Array.isArray(c.value)) return false
      return c.value.some((v) => v.toLowerCase() === actual.toLowerCase())
    default:
      return false
  }
}

export function evalRuleSet(input: RoutingInput, set: RuleSet): boolean {
  if (set.conditions.length === 0) return false
  if (set.match === 'all') return set.conditions.every((c) => evalCondition(input, c))
  return set.conditions.some((c) => evalCondition(input, c))
}

export function applyActions(
  actions: readonly RoutingAction[],
  matchedRuleId: string | null
): RoutingDecision {
  const decision: RoutingDecision = { matchedRuleId }
  for (const action of actions) {
    switch (action.type) {
      case 'assignToInbox':
        decision.inboxId = action.value
        break
      case 'assignToTeam':
        decision.primaryTeamId = action.value
        decision.assigneeTeamId = action.value
        break
      case 'assignToPrincipal':
        decision.assigneePrincipalId = action.value
        break
      case 'setPriority':
        decision.priority = action.value
        break
      case 'setVisibility':
        decision.visibilityScope = action.value
        break
      case 'addParticipant':
        decision.addParticipants ??= []
        decision.addParticipants.push(action.value)
        break
    }
  }
  return decision
}

/**
 * Pure evaluator: returns the first rule that matches plus a resolved
 * decision, or null if none matched.
 */
export function evaluateRules(
  rules: readonly RoutingRule[],
  input: RoutingInput
): RoutingDecision | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    const setParse = ruleSetSchema.safeParse(rule.conditions)
    if (!setParse.success) continue
    const actionsParse = routingActionsSchema.safeParse(rule.actions)
    if (!actionsParse.success) continue
    if (evalRuleSet(input, setParse.data)) {
      return applyActions(actionsParse.data, rule.id)
    }
  }
  return null
}

/**
 * DB-aware route(): loads enabled rules ordered by priority and createdAt,
 * evaluates them, and falls back to candidateInboxId or the first
 * non-archived inbox. Also resolves primaryTeamId from the chosen inbox if
 * the matching rule did not explicitly set it.
 */
export async function route(input: RoutingInput): Promise<RoutingDecision> {
  const rules = await db
    .select()
    .from(routingRulesTable)
    .where(eq(routingRulesTable.enabled, true))
    .orderBy(asc(routingRulesTable.priority), asc(routingRulesTable.createdAt))

  let decision: RoutingDecision = evaluateRules(rules, input) ?? { matchedRuleId: null }

  // Fallback inbox: caller-provided, then first active inbox (workspace default).
  if (!decision.inboxId) {
    if (input.candidateInboxId) {
      decision = { ...decision, inboxId: input.candidateInboxId }
    } else {
      const fallback = await db.query.inboxes.findFirst({
        where: isNull(inboxesTable.archivedAt),
        orderBy: asc(inboxesTable.createdAt),
      })
      if (fallback) decision = { ...decision, inboxId: fallback.id }
    }
  }

  // Derive primaryTeamId from the chosen inbox when not already set by an action.
  if (decision.inboxId && !decision.primaryTeamId) {
    const inboxIdValue = decision.inboxId
    const inbox = await db.query.inboxes.findFirst({
      where: eq(inboxesTable.id, inboxIdValue as never),
    })
    if (inbox?.primaryTeamId) decision.primaryTeamId = inbox.primaryTeamId
  }

  return decision
}
