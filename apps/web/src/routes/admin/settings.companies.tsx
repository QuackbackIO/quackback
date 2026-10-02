import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminQueries } from '@/lib/client/queries/admin'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { CompanyAttributesList } from '@/components/admin/settings/company-attributes/company-attributes-list'

export const Route = createFileRoute('/admin/settings/companies')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.COMPANY_VIEW)
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.companyAttributes())
    return {}
  },
  component: CompaniesPage,
})

function CompaniesPage() {
  const companyAttrsQuery = useSuspenseQuery(adminQueries.companyAttributes())

  return (
    <SettingsPage page="/admin/settings/companies">
      <CompanyAttributesList initialAttributes={companyAttrsQuery.data} />
    </SettingsPage>
  )
}
