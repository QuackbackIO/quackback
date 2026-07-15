import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { BuildingOfficeIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { CompanyAttributesList } from '@/components/admin/settings/company-attributes/company-attributes-list'

export const Route = createFileRoute('/admin/settings/companies')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.companyAttributes())
    return {}
  },
  component: CompaniesPage,
})

function CompaniesPage() {
  const companyAttrsQuery = useSuspenseQuery(adminQueries.companyAttributes())

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={BuildingOfficeIcon}
        title="Companies"
        description="Custom attributes for the companies your users belong to."
      />

      {/* The list renders its own SettingsCard internally so the
       *  header action (New attribute) lives in the card header. */}
      <CompanyAttributesList initialAttributes={companyAttrsQuery.data} />
    </div>
  )
}
