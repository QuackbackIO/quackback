import { createFileRoute } from '@tanstack/react-router'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { adminQueries } from '@/lib/client/queries/admin'
import { AuditLogPage, rangeToFromIso } from '@/components/admin/settings/security/audit-log-page'

export const Route = createFileRoute('/admin/settings/security/audit-log')({
  loader: async ({ context }) => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    // Prefetch the default-filter view so the table renders without a
    // suspended flash. Match the default in <AuditLogPage>: last 30
    // days, all event types, limit 200. The shared rangeToFromIso
    // helper floors `from` to the current minute so the loader and the
    // mount call agree on the same React Query cache key.
    const defaultFilters = {
      from: rangeToFromIso('30d'),
      limit: 200,
    }
    await context.queryClient.ensureQueryData(adminQueries.auditEvents(defaultFilters))

    return {}
  },
  component: AuditLogRoute,
})

function AuditLogRoute() {
  return (
    <div className="max-w-5xl space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={ShieldCheckIcon}
        title="Audit log"
        description="Security-sensitive changes made by admins. Used for compliance review."
      />
      <AuditLogPage />
    </div>
  )
}
