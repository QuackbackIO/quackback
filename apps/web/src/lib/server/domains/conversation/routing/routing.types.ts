import type { ConversationId, PrincipalId } from '@quackback/ids'

/**
 * Conversation routing decides which agent (if any) a new conversation should
 * be auto-assigned to. Strategies are pluggable; today there is exactly one
 * ("auto-assign to an active agent"). When a strategy can't pick anyone it
 * returns a null assignment and the conversation stays unassigned.
 */
export interface RoutingContext {
  conversationId: ConversationId
  visitorPrincipalId: PrincipalId
}

export interface RoutingResult {
  /** The agent to assign, or null to leave the conversation unassigned. */
  assignedPrincipalId: PrincipalId | null
  /** The strategy that made the decision (for logging/audit). */
  strategyId: string
}

export interface RoutingStrategy {
  readonly id: string
  route(ctx: RoutingContext): Promise<RoutingResult>
}
