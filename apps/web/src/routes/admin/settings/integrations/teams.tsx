import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { IntegrationHeader } from '@/components/admin/settings/integrations/integration-header'
import { TeamsConnectionActions } from '@/components/admin/settings/integrations/teams/teams-connection-actions'
import { TeamsConfig } from '@/components/admin/settings/integrations/teams/teams-config'
import { teamsCatalog } from '@/lib/server/integrations/teams/catalog'

function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.404 4.478c.516 0 .96.183 1.33.55.37.365.554.81.554 1.33v5.478a1.83 1.83 0 01-.554 1.34 1.81 1.81 0 01-1.33.55h-.837a5.74 5.74 0 01-.428 1.853 5.898 5.898 0 01-1.094 1.611 5.144 5.144 0 01-1.617 1.107 4.713 4.713 0 01-1.958.414h-.002a4.72 4.72 0 01-1.96-.414 5.151 5.151 0 01-1.616-1.107 5.897 5.897 0 01-1.094-1.61 5.742 5.742 0 01-.428-1.854H6.996v2.793a.99.99 0 00.293.715.976.976 0 00.715.298h5.33a.412.412 0 01.3.127.412.412 0 01.126.3v.83a.412.412 0 01-.127.3.412.412 0 01-.3.127H8.005a2.661 2.661 0 01-1.96-.812 2.661 2.661 0 01-.812-1.96V7.17c0-.773.271-1.432.812-1.974A2.677 2.677 0 018.004 4.38h7.465a4.716 4.716 0 011.959.414 5.143 5.143 0 011.616 1.107c.46.465.822.993 1.094 1.582.271.589.42 1.213.445 1.872h.002c.024-.008.067-.012.127-.012h-.308zm-5.934-2.65a3.38 3.38 0 00-1.406.297A3.69 3.69 0 0010.92 3.14a4.207 4.207 0 00-.784 1.143 4.103 4.103 0 00-.316 1.349h4.532V4.39a2.63 2.63 0 00-.108-.363 1.62 1.62 0 00-.393-.62 1.894 1.894 0 00-.607-.434 1.88 1.88 0 00-.774-.146zm4.96 2.65h-.002c-.024.66-.173 1.284-.445 1.872a5.867 5.867 0 01-1.094 1.583 5.143 5.143 0 01-1.616 1.106 4.716 4.716 0 01-1.96.414H8.372v4.27c0 .515.183.96.55 1.33.365.37.81.554 1.33.554h3.22c.515 0 .96-.183 1.33-.554.37-.37.554-.815.554-1.33V6.358c0-.515.184-.96.554-1.33a1.81 1.81 0 011.33-.55h1.17z" />
      <circle cx="17.5" cy="3.5" r="2.5" />
    </svg>
  )
}

export const Route = createFileRoute('/admin/settings/integrations/teams')({
  loader: async ({ context }) => {
    const { queryClient } = context
    await queryClient.ensureQueryData(adminQueries.integrationByType('teams'))
    return {}
  },
  component: TeamsIntegrationPage,
})

function TeamsIntegrationPage() {
  const integrationQuery = useSuspenseQuery(adminQueries.integrationByType('teams'))
  const integration = integrationQuery.data

  const isConnected = integration?.status === 'active'
  const isPaused = integration?.status === 'paused'

  return (
    <div className="space-y-6">
      <IntegrationHeader
        catalog={teamsCatalog}
        status={integration?.status as 'active' | 'paused' | 'pending' | null}
        workspaceName={integration?.workspaceName}
        icon={<TeamsIcon className="h-6 w-6 text-white" />}
        actions={
          <TeamsConnectionActions
            integrationId={integration?.id}
            isConnected={isConnected || isPaused}
          />
        }
      />

      {integration && (isConnected || isPaused) && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <TeamsConfig
            integrationId={integration.id}
            initialConfig={integration.config}
            initialEventMappings={integration.eventMappings}
            enabled={isConnected}
          />
        </div>
      )}

      {!integration && (
        <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 p-8 text-center">
          <TeamsIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <h3 className="mt-4 font-medium text-foreground">Connect Microsoft Teams</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Connect Microsoft Teams to receive notifications when users submit feedback, when
            statuses change, and when comments are added.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium text-foreground">Setup Instructions</h2>
        <div className="mt-4 space-y-4 text-sm text-muted-foreground">
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              1
            </span>
            <p>Register Quackback in your Azure AD tenant and add the Teams bot permissions.</p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              2
            </span>
            <p>
              Click <span className="font-medium text-foreground">Connect</span> to authorize
              Quackback to post to your Teams channels.
            </p>
          </div>
          <div className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              3
            </span>
            <p>
              Select a team and channel for notifications, then choose which events trigger
              messages.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
