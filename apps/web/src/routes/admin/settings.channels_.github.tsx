import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { ChannelSettingsCrumb } from '@/components/admin/settings/channel-settings-crumb'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { GitHubIcon } from '@/components/icons/integration-icons'
import { IntegrationHealthPanel } from '@/components/admin/settings/integrations/integration-health-panel'
import { GitHubConnectionActions } from '@/integrations/github/ui/github-connection-actions'
import {
  getGitHubChannelStatusFn,
  setGitHubInboxEnabledFn,
} from '@/integrations/github/server/functions'

export const Route = createFileRoute('/admin/settings/channels_/github')({
  beforeLoad: ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'support')) {
      throw redirect({ to: '/admin/settings/general' })
    }
  },
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)
    return {}
  },
  component: GitHubChannelPage,
})

function GitHubChannelPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['settings', 'github-channel-status'],
    queryFn: () => getGitHubChannelStatusFn(),
  })
  const status = query.data
  const [saving, setSaving] = useState(false)
  const connected = !!status?.connected
  const inboxEnabled = status?.inboxEnabled ?? false
  const attention =
    connected &&
    (!!status?.lastError || status?.status !== 'active' || (inboxEnabled && !status?.hasToken))

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-1.5">
        <ChannelSettingsCrumb page="GitHub" />
        <PageHeader icon={GitHubIcon} title="GitHub" description="Issues as conversations." />
      </div>

      {attention && status?.lastError && (
        <div className="flex items-start gap-2 rounded-[10px] border border-destructive/30 bg-destructive/5 p-3">
          <ExclamationTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-destructive">
              Comments may not be reaching the inbox
            </p>
            <p className="mt-0.5 text-xs text-destructive/90">
              {status.lastError}{' '}
              <Link
                to="/admin/settings/integrations/$type"
                params={{ type: 'github' }}
                className="font-medium underline"
              >
                Manage integration
              </Link>
            </p>
          </div>
        </div>
      )}

      {!connected ? (
        <SettingsCard>
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm">
              Connect a GitHub account to bring issues and comments into the inbox as conversations.
            </p>
            <GitHubConnectionActions
              isConnected={false}
              returnPath="/admin/settings/channels/github"
            />
            <p className="text-xs text-muted-foreground">
              One connection per workspace, shared with the Feedback tracker integration.
            </p>
          </div>
        </SettingsCard>
      ) : (
        <>
          <SettingsCard title="Connection">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <GitHubIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{status?.repo ?? 'No repository'}</p>
                  <p className="text-xs text-muted-foreground">
                    {status?.username
                      ? `Connected as @${status.username}, shared with the Feedback tracker`
                      : 'Shared with the Feedback tracker'}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/settings/integrations/$type" params={{ type: 'github' }}>
                  Manage integration
                  <ArrowTopRightOnSquareIcon className="size-3.5" />
                </Link>
              </Button>
            </div>
          </SettingsCard>

          <SettingsCard>
            <div className="flex items-center justify-between py-1">
              <div className="pr-4">
                <Label htmlFor="github-inbox" className="text-sm font-medium cursor-pointer">
                  Open issues and comments in the inbox
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  New issues start conversations, and public replies are posted as comments on the
                  issue. Internal notes never leave Quackback.
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Workflows that reply automatically will comment on public issues too.
                </p>
              </div>
              <Switch
                id="github-inbox"
                checked={inboxEnabled}
                disabled={saving || query.isLoading}
                onCheckedChange={async (checked) => {
                  setSaving(true)
                  try {
                    await setGitHubInboxEnabledFn({ data: { enabled: checked } })
                    await queryClient.invalidateQueries({
                      queryKey: ['settings', 'github-channel-status'],
                    })
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : 'Connect GitHub before enabling the inbox channel.'
                    )
                  } finally {
                    setSaving(false)
                  }
                }}
              />
            </div>
          </SettingsCard>

          <IntegrationHealthPanel
            health={{
              lastOutboundAt: status?.lastOutboundAt ?? null,
              lastInboundAt: status?.lastInboundAt ?? null,
              lastError: status?.lastError ?? null,
              lastErrorAt: status?.lastErrorAt ?? null,
            }}
          />
        </>
      )}
    </div>
  )
}
