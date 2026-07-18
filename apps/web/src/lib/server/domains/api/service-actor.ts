/**
 * Build the inline service actor a REST route hands to a domain service.
 *
 * API keys authenticate on a different plane than session cookies, so the
 * public routes never call the server fns (which do cookie-based `requireAuth`).
 * They call domain services directly with this actor — a team-role principal
 * of `principalType: 'service'` and no segment narrowing (a key is workspace-
 * wide). Mirrors the literal the existing GET routes already build inline
 * (`tickets/index.ts`, `conversations/$conversationId.ts`), centralized so it
 * isn't re-copied per file.
 */
import type { Actor } from '@/lib/server/policy/types'
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { SegmentId } from '@quackback/ids'

export function serviceActorFromApiAuth(auth: ApiAuthContext): Actor {
  return {
    principalId: auth.principalId,
    role: auth.role,
    principalType: 'service' as const,
    segmentIds: new Set<SegmentId>(),
  }
}
