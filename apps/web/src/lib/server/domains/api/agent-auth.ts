/**
 * Authentication for the workspace's own AI agent on the REST API.
 *
 * An agent presents its own `qba_` credential. It is a different kind of
 * credential from a teammate's API key: it reaches only the agent endpoints,
 * it carries no permissions, and what it may touch is decided per call by
 * which conversations it currently controls.
 */
import {
  verifyAgentCredential,
  type SupportAgent,
} from '@/lib/server/domains/support-agents/support-agents.service'
import { AGENT_CREDENTIAL_PREFIX } from '@/lib/shared/support-agents'
import { agentAttribution, setAuditAttribution } from '@/lib/server/audit/attribution'
import { ForbiddenError, RateLimitError, UnauthorizedError } from '@/lib/shared/errors'
import { checkRateLimit, getClientIp } from './rate-limit'

function bearerToken(request: Request): string | null {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

/** The agent behind the request's credential, or a thrown 401/403/429. */
export async function withAgentAuth(request: Request): Promise<SupportAgent> {
  const rateLimit = await checkRateLimit(getClientIp(request), false)
  if (!rateLimit.allowed) throw new RateLimitError(rateLimit.retryAfter ?? 60)

  const token = bearerToken(request)
  const agent = token ? await verifyAgentCredential(token) : null
  if (!agent) {
    throw new UnauthorizedError(
      `Invalid or missing agent credential. Provide it in the Authorization header: Bearer ${AGENT_CREDENTIAL_PREFIX}xxx`
    )
  }
  setAuditAttribution(agentAttribution(agent), {
    userId: null,
    email: null,
    role: 'member',
    type: 'service',
    authMethod: 'api_key',
  })
  if (agent.status !== 'active') {
    throw new ForbiddenError('AGENT_PAUSED', 'This agent is paused')
  }
  const { assertOwnAgentAvailable } =
    await import('@/lib/server/domains/support-agents/availability')
  await assertOwnAgentAvailable()
  return agent
}
