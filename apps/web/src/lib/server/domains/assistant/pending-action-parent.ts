import { NotFoundError } from '@/lib/shared/errors'
import type { AssistantPendingAction } from './pending-actions.service'

/** A verified server integration may authorize only its already-bound thread. */
export function assertPendingWorkspaceParent(
  pending: AssistantPendingAction,
  verifiedThreadKey?: string
): void {
  const key = pending.workspaceThreadKey
  if (!key) return
  if (!verifiedThreadKey || verifiedThreadKey !== key)
    throw new NotFoundError('PENDING_ACTION_NOT_FOUND', 'Pending action not found')
}
