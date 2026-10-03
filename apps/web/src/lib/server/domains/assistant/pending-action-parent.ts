import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'
import { assertWorkspaceThreadOwned } from './workspace-threads.service'
import type { AssistantPendingAction } from './pending-actions.service'
import { WORKSPACE_THREAD_PREFIX } from './workspace-safety'

/** A verified server integration may authorize only its already-bound thread. */
export async function assertPendingWorkspaceParent(
  pending: AssistantPendingAction,
  actor: Actor,
  verifiedThreadKey?: string
): Promise<void> {
  const key = pending.workspaceThreadKey
  if (!key) return
  if (key.startsWith(WORKSPACE_THREAD_PREFIX)) {
    await assertWorkspaceThreadOwned(key, actor)
    return
  }
  if (!verifiedThreadKey || verifiedThreadKey !== key)
    throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
}
