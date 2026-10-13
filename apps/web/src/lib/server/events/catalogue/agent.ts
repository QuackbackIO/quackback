/**
 * Agent turn events: a customer message needs an answer from the workspace's
 * own AI agent, and the agent did not answer in time. The turn request goes to
 * that agent only, signed, and never to the general webhook subscriptions, so
 * neither event is webhook-exposed. The subject is the conversation.
 */
import { decl } from './helpers'

const S = 'conversation'

export const agentTurnRequested = decl('agent.turn_requested', 'conversation', {}, S)
export const agentTurnExpired = decl('agent.turn_expired', 'conversation', {}, S)
