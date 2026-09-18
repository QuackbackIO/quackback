import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  AssistantDeploymentCard,
  type WidgetAssistantDeployment,
} from '@/components/admin/automation/assistant-deployment-card'
import { CopilotDeploymentCard } from '@/components/admin/automation/copilot-deployment-card'
import { AssistantIdentityCard } from '@/components/admin/automation/assistant-identity-card'
import { AssistantVoiceCard } from '@/components/admin/automation/assistant-basics-card'
import { WhoRepliesFirstCard } from '@/components/admin/automation/who-replies-first-card'
import { QuinnSettingsPage } from '@/components/admin/automation/quinn-settings-page'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/automation/deploy')({
  beforeLoad: ({ context }) => {
    if (!(context.permissions ?? []).includes(PERMISSIONS.ASSISTANT_MANAGE))
      throw new Error('Access denied: requires assistant.manage')
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.settings())
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: DeployPage,
})
function DeployPage() {
  const { settings, permissions } = Route.useRouteContext()
  const initial = settings?.publicWidgetConfig?.messenger?.assistant
  const [deployment, setDeployment] = useState<WidgetAssistantDeployment>({
    enabled: initial?.enabled ?? true,
    respond: initial?.respond ?? true,
  })
  const flags = settings?.featureFlags as FeatureFlags | undefined
  return (
    <QuinnSettingsPage
      title="Deploy"
      description="Choose where Quinn helps customers and teammates."
    >
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Customer conversations</h2>
        <AssistantDeploymentCard
          deployment={deployment}
          onChange={setDeployment}
          available={Boolean(flags?.supportInbox)}
        />
        <WhoRepliesFirstCard />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Support teammates</h2>
        <CopilotDeploymentCard />
      </section>
      <AssistantIdentityCard />
      <AssistantVoiceCard />
      <section className="rounded-xl border border-border/50 bg-card p-4 space-y-2">
        <h2 className="text-sm font-medium">Channels and appearance</h2>
        <p className="text-xs text-muted-foreground">
          Contact capture, follow-up and closure are configured in channel settings. Automatic
          customer replies currently run in Messenger.
        </p>
        <div className="flex flex-wrap gap-4 text-sm text-primary">
          {(permissions ?? []).includes(PERMISSIONS.SETTINGS_MANAGE) && (
            <>
              <Link to="/admin/settings/widget">Widget appearance</Link>
              <Link to="/admin/settings/channels/messenger">Messenger</Link>
            </>
          )}
          {(permissions ?? []).includes(PERMISSIONS.CHANNEL_ACCOUNT_MANAGE) && (
            <Link to="/admin/settings/channels/email">Email</Link>
          )}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        Workspace and Slack instructions and permissions are managed by your deployment. Slack
        availability is configured with its integration.
      </p>
    </QuinnSettingsPage>
  )
}
