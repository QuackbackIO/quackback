/**
 * Agent-turn resolver: a turn request goes to the one agent it names, through
 * the 'agent_turn' delivery hook. Nothing else subscribes to these events.
 */
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

export const agentTurnResolver: SinkResolver = {
  sink: 'agent_turn',
  interestedIn(type: string): boolean {
    return type === 'agent.turn_requested'
  },
  async resolve(event: DomainEvent): Promise<HookTarget[]> {
    const p = event.payload as { turnId: string; agentId: string; conversationId: string }
    const { getSupportAgent } =
      await import('@/lib/server/domains/support-agents/support-agents.service')
    const agent = await getSupportAgent(p.agentId as import('@quackback/ids').SupportAgentId)
    // A local agent polls its turn feed instead of receiving a webhook.
    if (agent && !agent.endpointUrl) return []
    return [
      {
        type: 'agent_turn',
        target: { agentId: p.agentId },
        config: { turnId: p.turnId, agentId: p.agentId, conversationId: p.conversationId },
        deliveryKey: p.turnId,
      },
    ]
  },
}
