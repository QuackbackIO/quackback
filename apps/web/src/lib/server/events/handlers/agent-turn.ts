/**
 * Agent-turn delivery hook. Sends one signed turn request to the workspace's
 * own AI agent, the same way a webhook is sent: HMAC-SHA256 over
 * `${timestamp}.${payload}`, the X-Quackback-* headers, the SSRF-guarded fetch
 * and per-delivery idempotency.
 *
 * Unlike a webhook it is addressed to one agent, and its body is built at
 * delivery from the live conversation rather than read from the outbox, so
 * customer text never sits in the event log. The customer's words travel with
 * an `untrusted` descriptor naming the paths that hold them.
 */
import crypto from 'crypto'
import type { HookHandler, HookResult, HookRunContext } from '../hook-types'
import type { EventData } from '../types'
import type { ConversationId, SupportAgentId, SupportAgentTurnId } from '@quackback/ids'
import { safeFetch, SsrfError, TimeoutError } from '@/lib/server/content/ssrf-guard'
import { isRetryableError } from '../hook-utils'
import {
  claimHookDelivery,
  completeHookDelivery,
  failHookDelivery,
  releaseHookDelivery,
} from '../hook-idempotency'
import { getBaseUrl } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import {
  decryptAgentSigningSecret,
  getSupportAgent,
  recordDeliveryResult,
} from '@/lib/server/domains/support-agents/support-agents.service'
import { expireTurn, getTurn } from '@/lib/server/domains/support-agents/turns.service'
import { loadRequestedAgentTurnContext } from '@/lib/server/domains/support-agents/agent-context'
import { assertOwnAgentAvailable } from '@/lib/server/domains/support-agents/availability'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/shared/errors'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

const log = logger.child({ component: 'agent-turn' })

const TIMEOUT_MS = 5_000
const USER_AGENT = 'Quackback-Agent/1.0 (+https://quackback.io)'

interface AgentTurnConfig {
  turnId: SupportAgentTurnId
  agentId: SupportAgentId
  conversationId: ConversationId
}

/** The URLs an agent calls back, all under the one conversation. */
function callbackUrls(conversationId: string): Record<string, string> {
  const base = `${getBaseUrl()}/api/v1/agent/conversations/${conversationId}`
  return {
    context: base,
    activity: `${base}/activity`,
    stream: `${base}/stream`,
    reply: `${base}/reply`,
    handoff: `${base}/handoff`,
    resolve: `${base}/resolve`,
  }
}

export const agentTurnHook: HookHandler = {
  async run(
    event: EventData,
    _target: unknown,
    config: unknown,
    ctx?: HookRunContext
  ): Promise<HookResult> {
    const { turnId, agentId, conversationId } = config as AgentTurnConfig

    const claimed = await claimHookDelivery(ctx?.jobId, 'agent_turn')
    if (!claimed) return { success: true }

    // Delivery-time re-validation: the live turn and agent supersede whatever
    // was true when the event was written.
    const [turn, agent] = await Promise.all([getTurn(turnId), getSupportAgent(agentId)])
    if (!turn || turn.status !== 'requested') {
      await completeHookDelivery(ctx?.jobId)
      return { success: true }
    }
    if (!agent || agent.status !== 'active' || !agent.endpointUrl || !agent.signingSecretEnc) {
      await failHookDelivery(ctx?.jobId)
      await expireTurn(turnId, { force: true })
      return { success: false, error: 'Agent not deliverable', shouldRetry: false }
    }

    let secret: string
    let body: string
    try {
      await assertOwnAgentAvailable()
      secret = decryptAgentSigningSecret(agent)
      const context = await loadRequestedAgentTurnContext(agent, { id: turnId, conversationId })
      body = JSON.stringify({
        id: event.id,
        type: 'agent.turn_requested',
        createdAt: event.timestamp,
        data: {
          turnId,
          deadlineAt: turn.deadlineAt.toISOString(),
          agent: { id: agent.id, name: agent.name },
          ...context,
          links: callbackUrls(conversationId),
        },
      })
    } catch (error) {
      if (error instanceof ConflictError || error instanceof NotFoundError) {
        await completeHookDelivery(ctx?.jobId)
        return { success: true }
      }
      if (error instanceof ForbiddenError || error instanceof EntitlementRequiredError) {
        await failHookDelivery(ctx?.jobId)
        await expireTurn(turnId, { force: true })
        return { success: false, error: 'Agent access disabled', shouldRetry: false }
      }
      log.error({ err: error, turn_id: turnId }, 'failed to build the agent turn request')
      await releaseHookDelivery(ctx?.jobId)
      return { success: false, error: 'Failed to build the turn request', shouldRetry: true }
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    const giveUp = async (error: string): Promise<HookResult> => {
      await failHookDelivery(ctx?.jobId)
      await recordDeliveryResult(agent.id, { ok: false, error })
      // Waiting out the deadline cannot help a delivery that will never arrive.
      await expireTurn(turnId, { force: true })
      return { success: false, error, shouldRetry: false }
    }

    try {
      const response = await safeFetch(agent.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-Quackback-Signature': `sha256=${signature}`,
          'X-Quackback-Timestamp': String(timestamp),
          'X-Quackback-Event': 'agent.turn_requested',
          'X-Quackback-Delivery': String(event.id),
        },
        body,
        timeoutMs: TIMEOUT_MS,
      })
      if (response.ok) {
        await completeHookDelivery(ctx?.jobId)
        await recordDeliveryResult(agent.id, { ok: true })
        return { success: true }
      }
      const retryable = response.status >= 500 || response.status === 429
      if (retryable && !ctx?.finalAttempt) {
        await releaseHookDelivery(ctx?.jobId)
        return { success: false, error: `HTTP ${response.status}`, shouldRetry: true }
      }
      return giveUp(`HTTP ${response.status}`)
    } catch (error) {
      if (error instanceof SsrfError) return giveUp(error.message)
      if (error instanceof TimeoutError || isRetryableError(error)) {
        if (!ctx?.finalAttempt) {
          await releaseHookDelivery(ctx?.jobId)
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Request failed',
            shouldRetry: true,
          }
        }
      }
      return giveUp(error instanceof Error ? error.message : 'Unknown error')
    }
  },
}
