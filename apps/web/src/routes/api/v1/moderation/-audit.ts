/**
 * Build the machine audit actor for a moderation REST write. Pinned per D13:
 * `type: 'service'` + `authMethod: 'api_key'`, recording the acting API key id
 * in metadata (the GitHub audit-log `actor_is_bot` + `token_id` precedent). The
 * fn path keeps `actorFromAuth`'s shape (no authMethod) unchanged.
 */
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { ModerationAudit } from '@/lib/server/domains/moderation'

export function moderationAuditFromApiAuth(
  auth: ApiAuthContext,
  headers: Headers
): ModerationAudit {
  return {
    actor: {
      userId: auth.principal?.user?.id ?? null,
      role: auth.role,
      type: 'service',
      authMethod: 'api_key',
    },
    headers,
    metadata: { apiKeyId: auth.apiKey.id },
  }
}
