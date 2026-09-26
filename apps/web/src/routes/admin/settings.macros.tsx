import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { DocumentDuplicateIcon } from '@heroicons/react/24/solid'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { MacrosSettingsBody } from '@/components/admin/settings/macros-settings-body'
import { warmQuery } from '@/lib/client/queries/warm-query'

export const Route = createFileRoute('/admin/settings/macros')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CONVERSATION_MANAGE)
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const [macrosEntitled] = await Promise.all([
      // The library renders only on a plan that includes macros; warm it then
      // so the page renders complete from the document.
      hasEntitlementFn({ data: { key: 'aiDrafts' } }).then(async (entitled) => {
        if (entitled) {
          const { macrosQuery } = await import('@/lib/client/queries/macros')
          await warmQuery(context.queryClient, macrosQuery())
        }
        return entitled
      }),
      ensureBillingCatalogue(context.queryClient, context.billingEnabled),
    ])
    return { macrosEntitled }
  },
  component: MacrosSettingsPage,
})

function MacrosSettingsPage() {
  const { macrosEntitled } = Route.useLoaderData()
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings/support">Support</BackLink>
      </div>
      <PageHeader
        icon={DocumentDuplicateIcon}
        title="Macros"
        description="Reusable replies with variables and bundled actions"
      />
      <MacrosSettingsBody entitled={macrosEntitled} />
    </div>
  )
}
