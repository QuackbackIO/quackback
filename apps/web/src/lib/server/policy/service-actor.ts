/**
 * Bounded service actors. Automation identities (workflows, the AI assistant)
 * act under an explicit permission set rather than a resolved role: can()
 * reads actor.permissions before falling back to the role, so the set is the
 * effective ceiling and can't silently widen as role presets grow.
 */
import type { PermissionKey } from '@/lib/shared/permissions'
import type { PrincipalId } from '@quackback/ids'
import type { Actor } from './types'

export function boundedServiceActor(
  permissions: ReadonlySet<PermissionKey>,
  principalId: PrincipalId | null = null
): Actor {
  return {
    principalId,
    role: 'admin',
    principalType: 'service',
    segmentIds: new Set(),
    permissions,
  }
}
