import type { Conversation } from '@/lib/server/db'
import { getStrategy } from './routing.registry'
import type { RoutingResult } from './routing.types'

/** The routing config lives on the live-chat config (widget JSON); null = off. */
async function getRoutingConfig() {
  const { getLiveChatConfig } = await import('@/lib/server/domains/settings/settings.widget')
  return (await getLiveChatConfig()).routing ?? null
}

/**
 * Decide who (if anyone) a newly-created conversation should be auto-assigned
 * to. Fails soft: routing is a best-effort enhancement, so any error (bad
 * config, Redis down, missing strategy) yields a null assignment and the
 * conversation is simply left unassigned.
 */
export async function routeConversation(conversation: Conversation): Promise<RoutingResult> {
  const unassigned = (strategyId: string): RoutingResult => ({
    assignedPrincipalId: null,
    strategyId,
  })
  try {
    const config = await getRoutingConfig()
    if (!config?.enabled) return unassigned('disabled')
    const strategy = getStrategy(config.strategy)
    if (!strategy) return unassigned(config.strategy)
    return await strategy.route({
      conversationId: conversation.id,
      visitorPrincipalId: conversation.visitorPrincipalId,
    })
  } catch (err) {
    console.warn('[chat:routing] routeConversation failed:', (err as Error).message)
    return unassigned('error')
  }
}
