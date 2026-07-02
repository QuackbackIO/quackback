import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BuildingOffice2Icon } from '@heroicons/react/24/outline'
import { getCompanyForPrincipalFn } from '@/lib/server/functions/companies'

/**
 * Company context for the conversation detail panel: the visitor's company with
 * its plan / MRR, so an agent sees account value inline. Renders nothing when
 * the visitor has no company.
 *
 * Company-scoped conversation LISTS and a dedicated company detail page are
 * deferred; the name links to the People directory (where companies are edited)
 * for now.
 */
export function CompanyCard({
  principalId,
  enabled = true,
}: {
  principalId: string
  enabled?: boolean
}) {
  const { data: company } = useQuery({
    queryKey: ['admin', 'company', 'for-principal', principalId],
    queryFn: () => getCompanyForPrincipalFn({ data: { principalId } }),
    enabled: enabled && !!principalId,
    staleTime: 60_000,
  })

  if (!company) return null

  const mrr =
    company.mrrCents != null
      ? (company.mrrCents / 100).toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        })
      : null

  return (
    <div className="space-y-2 border-t border-border/30 pt-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <BuildingOffice2Icon className="h-4 w-4" />
        <span>Company</span>
      </div>
      <Link
        to="/admin/users"
        className="block truncate text-sm font-medium text-foreground hover:underline"
      >
        {company.name}
      </Link>
      <div className="space-y-1 text-xs">
        {company.plan && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Plan</span>
            <span className="font-medium text-foreground">{company.plan}</span>
          </div>
        )}
        {mrr && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">MRR</span>
            <span className="font-medium text-foreground">{mrr}/mo</span>
          </div>
        )}
      </div>
    </div>
  )
}
