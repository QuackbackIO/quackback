import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
export function toolPermissions(
  spec: { name: string; permissions: readonly PermissionKey[] },
  workspace: boolean
): readonly PermissionKey[] {
  return workspace && spec.name === 'capture_feedback'
    ? [PERMISSIONS.POST_CREATE]
    : spec.permissions
}
