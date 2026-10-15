import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { WebhooksSettings } from '@/components/admin/settings/webhooks/webhooks-settings'
import { WebhookVerificationGuide } from '@/components/admin/settings/webhooks/webhook-verification-guide'
import { adminQueries } from '@/lib/client/queries/admin'
import { readBatch } from '@/lib/client/queries/read-batch'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/agents/webhooks')({
  head: adminPageHead('Webhooks settings'),
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.API_KEY_MANAGE)

    const { queryClient } = context
    const { hasEntitlementFn } = await import('@/lib/server/functions/entitlement-status')
    const { ensureBillingCatalogue } = await import('@/lib/client/queries/billing')
    const ensure = readBatch(queryClient)
    const [, webhooksEntitled] = await Promise.all([
      ensure(adminQueries.webhooks()),
      hasEntitlementFn({ data: { key: 'webhooks' } }),
      ensureBillingCatalogue(queryClient, context.billingEnabled),
    ])

    return { webhooksEntitled }
  },
  component: WebhooksPage,
})

function WebhooksPage() {
  const webhooksQuery = useSuspenseQuery(adminQueries.webhooks())
  const { webhooksEntitled } = Route.useLoaderData()

  return (
    <SettingsPage page="/admin/settings/agents/webhooks">
      <WebhooksSettings webhooks={webhooksQuery.data} entitled={webhooksEntitled} />
      <WebhookVerificationGuide />
    </SettingsPage>
  )
}
