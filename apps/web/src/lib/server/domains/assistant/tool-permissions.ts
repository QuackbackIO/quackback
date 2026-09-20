import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

export function toolPermissions(
  spec: { name: string; risk: 'read' | 'write' | 'control'; permissions: readonly PermissionKey[] },
  workspace: boolean
): readonly PermissionKey[] {
  if (workspace && spec.name === 'capture_feedback') return [PERMISSIONS.POST_CREATE]
  // Discovered connector and MCP contracts cannot grant permissionless writes.
  if (spec.risk === 'write' && spec.permissions.length === 0)
    return [PERMISSIONS.CONVERSATION_REPLY]
  return spec.permissions
}
