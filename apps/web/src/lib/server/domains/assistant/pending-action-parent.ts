import type { Actor } from '@/lib/server/policy/types'
import { NotFoundError } from '@/lib/shared/errors'
import { assertWorkspaceThreadOwned } from './workspace-threads.service'
import type { AssistantPendingAction } from './pending-actions.service'
import { isHomeThreadKey } from './workspace-safety'

/** A verified server integration may authorize only its already-bound thread. */
export async function assertPendingWorkspaceParent(
  pending: AssistantPendingAction,
  actor: Actor,
  verifiedThreadKey?: string
): Promise<void> {
  const key = pending.workspaceThreadKey
  if (!key) return
  if (isHomeThreadKey(key)) {
    await assertWorkspaceThreadOwned(key, actor)
    return
  }
  if (!verifiedThreadKey || verifiedThreadKey !== key)
    throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
}
