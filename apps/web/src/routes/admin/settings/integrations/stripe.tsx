import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { IntegrationSetupCard } from '@/components/admin/settings/integrations/integration-setup-card'
import { StripeConnectionActions } from '@/components/admin/settings/integrations/stripe/stripe-connection-actions'
import { StripeConfig } from '@/components/admin/settings/integrations/stripe/stripe-config'
import { StripeIcon } from '@/components/icons/integration-icons'
import { stripeCatalog } from '@/lib/server/integrations/stripe/catalog'

export const Route = createFileRoute('/admin/settings/integrations/stripe')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('stripe'))
    return {}
  },
  component: StripeIntegrationPage,
})

function StripeIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('stripe'))
  const { integration } = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={stripeCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<StripeIcon className="h-6 w-6 text-white" />}
        actions={
          isConnected || isPaused ? (
            <StripeConnectionActions integrationId={integration?.id} isConnected={true} />
          ) : undefined
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <StripeConfig
            integrationId={integration.id}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <IntegrationSetupCard
          icon={<StripeIcon className="h-6 w-6 text-muted-foreground" />}
          title="Connect Stripe"
          description="Connect Stripe to enrich feedback with customer revenue data. See MRR, plan tier, and billing status alongside each feedback submission."
          steps={[
            <p key="1">
              Create a <span className="font-medium text-foreground">restricted API key</span> in
              your Stripe dashboard with read access to Customers.
            </p>,
            <p key="2">
              Paste the API key below and click{' '}
              <span className="font-medium text-foreground">Save</span>. Quackback will verify the
              connection.
            </p>,
            <p key="3">
              Customer data will be automatically looked up by email when new feedback is submitted.
            </p>,
          ]}
          connectionForm={<StripeConnectionActions integrationId={undefined} isConnected={false} />}
        />
      )}
    </div>
  )
}
