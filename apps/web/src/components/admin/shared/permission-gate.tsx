/**
 * `<PermissionGate />` — render children only if the actor holds `permission`.
 *
 * Renders nothing while the underlying permission query is loading unless
 * `loadingFallback` is provided. Use the `fallback` prop to render an
 * alternate UI (e.g. an explanatory tooltip) when the actor is denied.
 */
import type { ReactNode } from 'react'
import type { TeamId } from '@quackback/ids'
import { useHasPermission } from '@/lib/client/hooks/use-authz-queries'
import type { PermissionKey } from '@/lib/server/domains/authz'

interface PermissionGateProps {
  permission: PermissionKey
  /** Optional team scope — passes `teamId` through to `useHasPermission`. */
  teamId?: TeamId | null
  children: ReactNode
  fallback?: ReactNode
  /** When true, treat loading state as "allowed" so the UI renders optimistically. */
  loadingFallback?: boolean
}

export function PermissionGate({
  permission,
  teamId,
  children,
  fallback = null,
  loadingFallback,
}: PermissionGateProps) {
  const allowed = useHasPermission(permission, { teamId, loadingFallback })
  if (!allowed) return <>{fallback}</>
  return <>{children}</>
}
