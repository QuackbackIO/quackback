import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { DocumentDuplicateIcon } from '@heroicons/react/24/solid'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { MacrosManager } from '@/components/admin/conversation/macros-manager'
import { UpgradeScreen } from '@/components/admin/upgrade'

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
      hasEntitlementFn({ data: { key: 'aiDrafts' } }),
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
        <BackLink to="/admin/settings">Settings</BackLink>
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

export function MacrosSettingsBody({ entitled }: { entitled: boolean }) {
  return entitled ? <MacrosManager /> : <UpgradeScreen entitlement="aiDrafts" />
}
