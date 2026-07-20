/**
 * The assistant's (Quinn's) service-principal id, memoized process-wide so
 * message loads can flag Quinn's turns (`isAssistant` on the DTO, via
 * `toMessageDTO`'s third arg) without a per-load lookup. Shared by every
 * thread loader that maps rows to DTOs — conversation.query.ts's
 * `listMessages` and the tickets domain's pair-thread union loader
 * (convergence Phase 2: the flag resolves identically whichever parent of the
 * pair a row hangs off).
 *
 * A resolved id is cached for the process; a null (Quinn not yet provisioned)
 * is re-checked periodically so enabling Quinn later heals without a restart.
 */
import type { PrincipalId } from '@quackback/ids'
import { getAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'

let cachedAssistantPrincipalId: PrincipalId | null = null
let assistantPrincipalCheckedAt = 0

export async function assistantPrincipalIdOnce(): Promise<PrincipalId | null> {
  if (cachedAssistantPrincipalId === null && Date.now() - assistantPrincipalCheckedAt > 60_000) {
    cachedAssistantPrincipalId = (await getAssistantPrincipal())?.id ?? null
    assistantPrincipalCheckedAt = Date.now()
  }
  return cachedAssistantPrincipalId
}
