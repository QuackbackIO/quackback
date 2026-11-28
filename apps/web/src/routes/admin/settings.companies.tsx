import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { adminQueries } from '@/lib/client/queries/admin'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { CompanyAttributesList } from '@/components/admin/settings/company-attributes/company-attributes-list'
import { adminPageHead } from '@/lib/client/admin-head'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/companies')({
  head: adminPageHead('Companies settings'),
  loader: async ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/companies')
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.companyAttributes())
    return { seededAreas: await seedAdminAreas(context.personLocale, 'adminIntegrationSettings') }
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
