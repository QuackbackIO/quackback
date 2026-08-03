/**
 * Build the chat-domain Actor + author input from a REST API-key auth context.
 *
 * Colocated route helper (the `-` prefix keeps it out of the generated route
 * tree). Mirrors how the MCP chat tools construct their actor: an API key is a
 * service principal with no segment memberships; the chat service's own
 * `canActAsAgent` role check still applies on top of the route's scope gate.
 */
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { Actor } from '@/lib/server/policy/types'
import type { ChatAuthorInput } from '@/lib/server/domains/chat/chat.types'
import type { PrincipalId, SegmentId } from '@quackback/ids'

export function buildChatActor(auth: ApiAuthContext): Actor {
  return {
    principalId: auth.principalId as PrincipalId,
    role: auth.role,
    // API keys authenticate as their service principal.
    principalType: 'service',
    segmentIds: new Set<SegmentId>(),
  }
}

export function buildChatAgent(auth: ApiAuthContext): ChatAuthorInput {
  return {
    principalId: auth.principalId as PrincipalId,
    displayName: auth.key.name,
  }
}
