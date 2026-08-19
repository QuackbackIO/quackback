import type { RoutingStrategy } from './routing.types'
import { autoAssignActiveStrategy } from './strategies/auto-assign-active'

/**
 * Registry of routing strategies, keyed by id. New strategies (round-robin,
 * load-balanced, skill-based, …) register here and become selectable in the
 * Conversation Routing settings without touching the call site.
 */
const STRATEGIES = new Map<string, RoutingStrategy>()

export function registerStrategy(strategy: RoutingStrategy): void {
  STRATEGIES.set(strategy.id, strategy)
}

export function getStrategy(id: string): RoutingStrategy | undefined {
  return STRATEGIES.get(id)
}

registerStrategy(autoAssignActiveStrategy)
