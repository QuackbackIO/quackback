/**
 * Build the service actor a REST route hands to a domain service.
 *
 * API keys authenticate on a different plane than session cookies, so the
 * public routes never call the server fns (which do cookie-based `requireAuth`).
 * They call domain services directly with this actor: a team-role principal of
 * `principalType: 'service'` with no segment narrowing. It carries the key's
 * resolved permission set, so policy checks see the key's creator's current
 * access rather than a preset expanded from the role, and `scopePrincipalId`,
 * so the ticket and conversation filters show a personal key only the rows its
 * creator can see. Every REST route builds its actor here; a guard test
 * forbids inline service literals under `routes/api/v1`.
 */
import type { Actor } from '@/lib/server/policy/types'
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { SegmentId } from '@quackback/ids'

export function serviceActorFromApiAuth(
  auth: Pick<ApiAuthContext, 'principalId' | 'role' | 'permissions' | 'scopePrincipalId'>
): Actor {
  return {
    principalId: auth.principalId,
    role: auth.role,
    principalType: 'service' as const,
    segmentIds: new Set<SegmentId>(),
    permissions: auth.permissions,
    ...(auth.scopePrincipalId ? { scopePrincipalId: auth.scopePrincipalId } : {}),
  }
}
