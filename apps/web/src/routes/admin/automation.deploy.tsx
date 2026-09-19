import { Badge } from '@/components/ui/badge'
import { useQuery } from '@tanstack/react-query'
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
import { QuinnReleaseCard } from '@/components/admin/automation/quinn-release-card'
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
    await Promise.all([
      context.queryClient.ensureQueryData(assistantQueries.settings()),
      context.queryClient.ensureQueryData(assistantQueries.releaseState()),
    ])
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: DeployPage,
})
function DeployPage() {
  const { settings, permissions } = Route.useRouteContext()
  const assistant = useQuery(assistantQueries.settings())
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
      {assistant.data?.configured === false && (
        <p role="status" className="rounded-xl border p-4 text-sm text-muted-foreground">
          Setup required: configure an AI model before Quinn can answer. You can still prepare
          knowledge, guidance and deployment settings.
        </p>
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Customer conversations</h2>
        <AssistantDeploymentCard
          deployment={deployment}
          onChange={setDeployment}
          available={Boolean(flags?.supportInbox)}
          availabilityStatus={
            assistant.isError
              ? 'Unavailable'
              : assistant.isPending
                ? 'Loading…'
                : !assistant.data.configured
                  ? 'Setup required'
                  : null
          }
        />
        <div className="rounded-xl border border-border/50 bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Email</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Team replies stay in the same conversation. Automatic Quinn replies need their own
              rollout.
            </p>
          </div>
          <Badge variant="outline">Not available yet</Badge>
        </div>
        <WhoRepliesFirstCard />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Support teammates</h2>
        <CopilotDeploymentCard />
        <div className="rounded-xl border border-border/50 bg-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">Workspace &amp; Slack</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses the linked teammate’s permissions and managed defaults, independently of inbox
              settings.
            </p>
          </div>
          <Badge variant="outline">Managed</Badge>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Changes</h2>
        <QuinnReleaseCard />
      </section>
      <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium">Identity and voice</summary>
        <AssistantIdentityCard />
        <AssistantVoiceCard />
      </details>
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
