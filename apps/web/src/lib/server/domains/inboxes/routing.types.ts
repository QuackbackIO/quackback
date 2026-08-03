/**
 * Routing rule grammar (v1) — single-level conditions, simple actions.
 * Conditions are evaluated as `match: 'all' | 'any'` over the array.
 */
import { z } from 'zod'
import { TICKET_PRIORITIES, TICKET_VISIBILITY_SCOPES, INBOX_CHANNEL_KINDS } from '@/lib/server/db'
import type { TicketChannel } from '@/lib/server/db'

export const ROUTING_CONDITION_FIELDS = [
  'subject',
  'descriptionText',
  'channel',
  'priority',
  'organizationDomain',
  'requesterEmail',
  'inboxChannelKind',
] as const

export type RoutingConditionField = (typeof ROUTING_CONDITION_FIELDS)[number]

export const ROUTING_CONDITION_OPS = ['eq', 'contains', 'matches', 'in'] as const

export type RoutingConditionOp = (typeof ROUTING_CONDITION_OPS)[number]

export const routingConditionSchema = z.object({
  field: z.enum(ROUTING_CONDITION_FIELDS),
  op: z.enum(ROUTING_CONDITION_OPS),
  value: z.union([z.string(), z.array(z.string())]),
})
export type RoutingCondition = z.infer<typeof routingConditionSchema>

export const ROUTING_ACTION_TYPES = [
  'assignToInbox',
  'assignToTeam',
  'assignToPrincipal',
  'setPriority',
  'setVisibility',
  'addParticipant',
] as const

export type RoutingActionType = (typeof ROUTING_ACTION_TYPES)[number]

export const routingActionSchema = z.object({
  type: z.enum(ROUTING_ACTION_TYPES),
  /** Action-specific payload (an id, an enum value, etc.). */
  value: z.string().min(1),
})
export type RoutingAction = z.infer<typeof routingActionSchema>

export const ruleSetSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(routingConditionSchema).min(1),
})
export type RuleSet = z.infer<typeof ruleSetSchema>

export const routingActionsSchema = z.array(routingActionSchema).min(1)

/** Input passed into the routing engine. */
export interface RoutingInput {
  subject: string
  descriptionText?: string | null
  channel: TicketChannel
  priority?: string
  organizationDomain?: string | null
  requesterEmail?: string | null
  inboxChannelKind?: (typeof INBOX_CHANNEL_KINDS)[number] | null
  /** Pre-bound inbox if the caller already chose one. Acts as a fallback. */
  candidateInboxId?: string | null
}

export interface RoutingDecision {
  inboxId?: string | null
  primaryTeamId?: string | null
  assigneePrincipalId?: string | null
  assigneeTeamId?: string | null
  priority?: string
  visibilityScope?: string
  addParticipants?: string[]
  matchedRuleId?: string | null
}

/** Lightweight runtime priority/visibility constants re-exported for matching. */
export const VALID_PRIORITY_VALUES = TICKET_PRIORITIES
export const VALID_VISIBILITY_VALUES = TICKET_VISIBILITY_SCOPES
