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
import { db, supportAgents, and, eq, isNotNull } from '@/lib/server/db'
import { getAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'

/**
 * Per workspace: a principal id is a row in one workspace's database, so a shared
 * memo flags a foreign id as "this is the assistant" in every other workspace —
 * mislabelling human agents' turns as the assistant's and vice versa.
 */
const cachedAssistantPrincipalId = new WorkspaceKeyedCache<PrincipalId>(256)
const checkedAt = new WorkspaceKeyedCache<number>(256)
const MEMO_KEY = 'assistant-principal'

export async function assistantPrincipalIdOnce(): Promise<PrincipalId | null> {
  const cached = cachedAssistantPrincipalId.get(MEMO_KEY)
  if (cached) return cached
  if (Date.now() - (checkedAt.get(MEMO_KEY) ?? 0) > 60_000) {
    const resolved = (await getAssistantPrincipal())?.id ?? null
    checkedAt.set(MEMO_KEY, Date.now())
    if (resolved) {
      cachedAssistantPrincipalId.set(MEMO_KEY, resolved)
      return resolved
    }
  }
  return null
}

/**
 * Every principal whose messages read as AI: the built-in assistant plus the
 * workspace's own AI agent, when it has one. Memoized per workspace for a
 * short while, so an agent registered or removed shows up without a restart.
 */
const cachedAiPrincipalIds = new WorkspaceKeyedCache<ReadonlySet<PrincipalId>>(256)
const aiIdsCheckedAt = new WorkspaceKeyedCache<number>(256)
const AI_IDS_KEY = 'ai-principal-ids'
const AI_IDS_TTL_MS = 30_000

export async function aiPrincipalIdsOnce(): Promise<ReadonlySet<PrincipalId>> {
  const cached = cachedAiPrincipalIds.get(AI_IDS_KEY)
  if (cached && Date.now() - (aiIdsCheckedAt.get(AI_IDS_KEY) ?? 0) < AI_IDS_TTL_MS) return cached
  const ids = new Set<PrincipalId>()
  const assistant = await assistantPrincipalIdOnce()
  if (assistant) ids.add(assistant)
  const agents = await db
    .select({ principalId: supportAgents.principalId })
    .from(supportAgents)
    .where(and(eq(supportAgents.kind, 'external'), isNotNull(supportAgents.principalId)))
  for (const agent of agents) if (agent.principalId) ids.add(agent.principalId)
  cachedAiPrincipalIds.set(AI_IDS_KEY, ids)
  aiIdsCheckedAt.set(AI_IDS_KEY, Date.now())
  return ids
}

/** Forget the memo, so the next read sees a newly registered or removed agent. */
export function resetAiPrincipalIds(): void {
  cachedAiPrincipalIds.clear()
}
