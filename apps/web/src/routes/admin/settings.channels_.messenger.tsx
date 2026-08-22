import { useState, useTransition } from 'react'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { createFileRoute, useRouter, Navigate, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { settingsQueries } from '@/lib/client/queries/settings'
import { useUpdatePortalConfig, useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/admin/settings/channels_/messenger')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      context.queryClient.ensureQueryData(settingsQueries.portalConfig()),
    ])
    return {}
  },
  component: MessengerChannelRoute,
})

function MessengerChannelRoute() {
  const { settings } = Route.useRouteContext()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  if (!flags?.supportInbox) return <Navigate to="/admin/settings" />
  return <MessengerChannelPage />
}

function MessengerChannelPage() {
  const router = useRouter()
  const updateWidgetConfig = useUpdateWidgetConfig()
  const updatePortalConfig = useUpdatePortalConfig()
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const config = widgetConfigQuery.data
  const messengerConfig = config.messenger
  const [isPending, startTransition] = useTransition()
  const [savingField, setSavingField] = useState<string | null>(null)
  const [portalSupportEnabled, setPortalSupportEnabled] = useState(
    portalConfigQuery.data?.support?.enabled ?? false
  )
  const [preventRepliesWhenClosed, setPreventRepliesWhenClosed] = useState(
    messengerConfig?.preventRepliesWhenClosed ?? false
  )
  const [welcomeMessage, setWelcomeMessage] = useState(messengerConfig?.welcomeMessage ?? '')
  const [offlineMessage, setOfflineMessage] = useState(messengerConfig?.offlineMessage ?? '')
  const [teamName, setTeamName] = useState(messengerConfig?.teamName ?? '')

  async function persist(
    field: string,
    data: Parameters<typeof updateWidgetConfig.mutateAsync>[0],
    revert?: () => void
  ) {
    setSavingField(field)
    try {
      await updateWidgetConfig.mutateAsync(data)
      startTransition(() => router.invalidate())
    } catch {
      revert?.()
    } finally {
      setSavingField(null)
    }
  }

  const isBusy = savingField !== null || isPending

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings/channels">Channels</BackLink>
      </div>
      <PageHeader
        icon={ChatBubbleLeftRightIcon}
        title="Messenger"
        description="Live chat in the widget and on the portal."
      />

      <SettingsCard title="Surfaces" description="Where customers see their conversations.">
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <p className="text-sm font-medium">Widget</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Show the Messages tab from Widget settings.
            </p>
          </div>
          <Link to="/admin/settings/widget" className="text-sm font-medium text-primary">
            Widget settings
          </Link>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border/40 py-1 pt-4">
          <div className="pr-4">
            <Label htmlFor="portal-support-enabled" className="text-sm font-medium cursor-pointer">
              Portal Support
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Show a Support tab on the public portal for signed-in users.
            </p>
          </div>
          <Switch
            id="portal-support-enabled"
            checked={portalSupportEnabled}
            onCheckedChange={async (checked) => {
              setPortalSupportEnabled(checked)
              setSavingField('portalSupport')
              try {
                await updatePortalConfig.mutateAsync({ support: { enabled: checked } })
                startTransition(() => router.invalidate())
              } catch {
                setPortalSupportEnabled(!checked)
              } finally {
                setSavingField(null)
              }
            }}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Messaging" description="Greeting and team name shown to visitors.">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="messenger-team-name">Team name</Label>
            <Input
              id="messenger-team-name"
              value={teamName}
              maxLength={80}
              placeholder="Support"
              onChange={(e) => setTeamName(e.target.value)}
              onBlur={() => persist('teamName', { messenger: { teamName: teamName.trim() } })}
              disabled={isBusy}
            />
            <p className="text-xs text-muted-foreground">
              Shown in the messenger header. Falls back to the workspace name.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="messenger-welcome">Welcome message</Label>
            <Textarea
              id="messenger-welcome"
              value={welcomeMessage}
              maxLength={500}
              rows={2}
              placeholder="Hi! How can we help you today?"
              onChange={(e) => setWelcomeMessage(e.target.value)}
              onBlur={() =>
                persist('welcomeMessage', { messenger: { welcomeMessage: welcomeMessage.trim() } })
              }
              disabled={isBusy}
            />
            <p className="text-xs text-muted-foreground">
              Greets a customer opening a new conversation.{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{first_name}}'}</code>{' '}
              inserts their name.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="messenger-offline">Offline message</Label>
            <Textarea
              id="messenger-offline"
              value={offlineMessage}
              maxLength={500}
              rows={2}
              placeholder="We're away right now. Leave a message and we'll get back to you by email."
              onChange={(e) => setOfflineMessage(e.target.value)}
              onBlur={() =>
                persist('offlineMessage', { messenger: { offlineMessage: offlineMessage.trim() } })
              }
              disabled={isBusy}
            />
            <p className="text-xs text-muted-foreground">
              Shown outside{' '}
              <Link to="/admin/settings/office-hours" className="font-medium text-primary">
                office hours
              </Link>{' '}
              or when nobody is online.
            </p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Reopen on reply"
        description="When a visitor replies to a closed Messenger conversation."
      >
        <div className="flex items-center justify-between py-1">
          <div className="pr-4">
            <Label htmlFor="prevent-replies-closed" className="text-sm font-medium cursor-pointer">
              Prevent replies to closed conversations
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Visitors start a new conversation instead of reopening. Email replies always reopen.
            </p>
          </div>
          <Switch
            id="prevent-replies-closed"
            checked={preventRepliesWhenClosed}
            onCheckedChange={(checked) => {
              setPreventRepliesWhenClosed(checked)
              persist('preventClosed', { messenger: { preventRepliesWhenClosed: checked } }, () =>
                setPreventRepliesWhenClosed(!checked)
              )
            }}
            disabled={isBusy}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Quinn" description="Assistant identity is configured in Automation.">
        <div className="flex items-center justify-between py-1">
          <p className="text-sm text-muted-foreground">
            {messengerConfig?.assistant?.enabled === false
              ? 'Off'
              : messengerConfig?.assistant?.respond
                ? 'Fronting conversations · answering on'
                : 'Fronting conversations · answering off'}
          </p>
          <Link to="/admin/automation/assistant" className="text-sm font-medium text-primary">
            Configure in Automation
          </Link>
        </div>
      </SettingsCard>
    </div>
  )
}
