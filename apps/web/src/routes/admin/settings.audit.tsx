/**
 * Audit log admin — read-only paginated timeline. Gated server-side by
 * `AUDIT_VIEW`; server fns return 403 for unauthorized actors.
 */
import { useState, Suspense } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { auditQueries, defaultAuditFilters, type AuditFilters } from '@/lib/client/queries/audit'
import { AuditFilterBar } from '@/components/admin/settings/audit/audit-filter-bar'
import { AuditEventTable } from '@/components/admin/settings/audit/audit-event-table'

export const Route = createFileRoute('/admin/settings/audit')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    const filters = defaultAuditFilters()
    await Promise.all([
      queryClient.ensureInfiniteQueryData(auditQueries.list(filters)),
      queryClient.ensureQueryData(auditQueries.actions()),
    ])
  },
  errorComponent: createRouteErrorComponent('Failed to load audit log'),
  component: AuditPage,
})

function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>(() => defaultAuditFilters())

  return (
    <div className="space-y-4 max-w-7xl">
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-xs text-muted-foreground">
          Workspace-wide append-only record of operational, security, and admin-relevant events.
        </p>
      </div>

      <AuditFilterBar value={filters} onChange={setFilters} />

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <AuditEventTable filters={filters} />
      </Suspense>
    </div>
  )
}
