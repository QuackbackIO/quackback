import { createFileRoute, redirect } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { useState } from 'react'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { NewButton } from '@/components/shared/new-button'
import { MacrosSettingsBody } from '@/components/admin/settings/macros-settings-body'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/macros')({
  head: adminPageHead('Macros settings'),
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
  const [creating, setCreating] = useState(false)
  return (
    <SettingsPage
      page="/admin/settings/macros"
      description="Reusable replies with variables and bundled actions."
      actions={
        macrosEntitled ? <NewButton noun="macro" onClick={() => setCreating(true)} /> : undefined
      }
    >
      <MacrosSettingsBody
        entitled={macrosEntitled}
        creating={creating}
        onCreatingChange={setCreating}
      />
    </SettingsPage>
  )
}
