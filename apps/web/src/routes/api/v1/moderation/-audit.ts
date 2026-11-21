/**
 * Build the machine audit actor for a moderation REST write. Pinned per D13:
 * `type: 'service'` + `authMethod: 'api_key'`, recording the acting API key id
 * in metadata (the GitHub audit-log `actor_is_bot` + `token_id` precedent). The
 * fn path keeps `actorFromAuth`'s shape (no authMethod) unchanged.
 */
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { ModerationAudit } from '@/lib/server/domains/moderation'
import type { PrincipalId } from '@quackback/ids'

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
    principalId: auth.principalId,
    // A personal key acts for its creator, so an author who moderates their
    // own post through their key is not told about it. A workspace key acts
    // for nobody (its createdById is only an audit record): an automation on
    // it moderating its creator's post still tells them.
    onBehalfOfPrincipalId:
      auth.apiKey.kind === 'personal'
        ? ((auth.apiKey.createdById as PrincipalId | null) ?? null)
        : null,
    headers,
    metadata: { apiKeyId: auth.apiKey.id },
  }
}
