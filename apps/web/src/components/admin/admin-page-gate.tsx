import type { ReactNode } from 'react'
import { PermissionDeniedPage } from '@/components/shared/error-page'
import { usePermissions } from '@/lib/client/hooks/use-root-context'
import { canOpenAdminPage, type GatedAdminPage } from '@/lib/shared/admin-page-access'

/**
 * Renders an admin page only for a viewer who can open it, and the
 * no-access state otherwise, so none of the page's reads run for a viewer the
 * server would refuse.
 */
export function AdminPageGate({ page, children }: { page: GatedAdminPage; children: ReactNode }) {
  const permissions = usePermissions()
  if (!canOpenAdminPage(permissions, page)) return <PermissionDeniedPage fullPage={false} />
  return children
}
