import { useMemo, useState } from 'react'
import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/shared/page-header'
import { WarningBox } from '@/components/shared/warning-box'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WidgetLastDetected } from '@/components/admin/settings/widget/widget-last-detected'
import { WidgetSigningSecret } from '@/components/admin/settings/widget/widget-signing-secret'
import { copyWithFallback } from '@/components/admin/activation-action-button'
import { CopyAgentPromptButton } from '@/components/admin/settings/widget/copy-agent-prompt-button'
import {
  WIDGET_SKILL_REPO,
  buildWidgetInstallPrompt,
  buildWidgetInstallSnippet,
} from '@/lib/shared/widget/install-prompt'
import { widgetInstallPresence, widgetOriginVerifiedLabel } from '@/lib/shared/widget/widget-origin'
import {
  widgetConnectedStatusLabel,
  widgetSdkUpdateDescription,
} from '@/lib/shared/widget/sdk-version'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'

export const Route = createFileRoute('/admin/settings/widget/install')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.widgetSecret()),
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      context.queryClient.ensureQueryData(adminQueries.onboardingStatus()),
    ])
  },
  component: WidgetInstallPage,
})

export function WidgetInstallPage() {
  const { baseUrl } = useRouteContext({ from: '__root__' })
  const secretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const widgetConfigQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const updateWidgetConfig = useUpdateWidgetConfig()
  const [enabled, setEnabled] = useState(Boolean(widgetConfigQuery.data.enabled))
  const statusQuery = useQuery({
    ...adminQueries.onboardingStatus(),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data?.hasWidgetInstalled) return 5_000
      if (data.widgetSdkNeedsUpdate) return 15_000
      return false
    },
  })
  const status = statusQuery.data!
  const mode = status.useCase === 'customer_support' ? 'messenger' : 'feedback'
  const presence = widgetInstallPresence({
    connected: Boolean(status.hasWidgetInstalled),
    enabled: Boolean(status.hasWidgetEnabled),
    originHost: status.widgetOriginHost,
  })
  const [copyingSnippet, setCopyingSnippet] = useState(false)
  const [identifyUsers, setIdentifyUsers] = useState(false)
  const snippet = useMemo(
    () =>
      buildWidgetInstallSnippet({
        instanceUrl: baseUrl ?? '',
        identify: identifyUsers,
      }),
    [baseUrl, identifyUsers]
  )
  const agentPrompt = useMemo(
    () =>
      buildWidgetInstallPrompt({
        instanceUrl: baseUrl ?? '',
        widgetSecret: secretQuery.data,
        identify: identifyUsers,
      }),
    [baseUrl, secretQuery.data, identifyUsers]
  )

  async function copySnippet() {
    setCopyingSnippet(true)
    try {
      await copyWithFallback(snippet)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.')
    } finally {
      setCopyingSnippet(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <Button asChild variant="ghost" size="sm">
        <Link to="/admin/settings/widget">
          <ArrowLeftIcon className="h-4 w-4" />
          Widget settings
        </Link>
      </Button>
      <PageHeader
        icon={CodeBracketIcon}
        title={mode === 'messenger' ? 'Add Messenger to your site' : 'Install feedback widget'}
        description="Get the launcher on your site. Identifying signed-in users is optional."
      />

      <SettingsCard
        title="1. Add the launcher"
        description="Paste this before the closing body tag. Visitors see the launcher only when Show on your website is on. No secret needed."
      >
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-border/50 p-4">
          <div className="min-w-0">
            <Label htmlFor="show-on-website" className="cursor-pointer text-sm font-medium">
              Show on your website
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Visitors cannot see the launcher until this is on, even after you paste the snippet.
            </p>
          </div>
          <Switch
            id="show-on-website"
            checked={enabled}
            disabled={updateWidgetConfig.isPending}
            onCheckedChange={(checked) => {
              const previous = enabled
              setEnabled(checked)
              void updateWidgetConfig
                .mutateAsync({ enabled: checked })
                .then(() => {
                  toast.success(
                    checked ? 'Widget is visible on your site' : 'Widget hidden from visitors'
                  )
                })
                .catch(() => {
                  setEnabled(previous)
                  toast.error('Could not update widget visibility')
                })
            }}
            aria-label="Show on your website"
          />
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
          <code>{snippet}</code>
        </pre>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void copySnippet()} disabled={copyingSnippet}>
            <ClipboardDocumentIcon className="h-4 w-4" />
            {copyingSnippet ? 'Copying…' : 'Copy snippet'}
          </Button>
          <CopyAgentPromptButton prompt={agentPrompt} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          If an agent asks for QUACKBACK_WIDGET_SECRET, that is the signing secret in step 2 — and
          you do not need it for the launcher.
          {identifyUsers
            ? ' The prompt includes your signing secret; paste it into a local agent only.'
            : ' The agent prompt is launcher-only until you turn identify on below.'}{' '}
          <a
            href={WIDGET_SKILL_REPO}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            install-widget skill
          </a>
        </p>
      </SettingsCard>

      <SettingsCard
        title="2. Identify signed-in users (optional)"
        description="Skip this to get the launcher up. Use it later so votes, chats, and posts attach to a person. Your server signs a short-lived token; the browser never sees this secret."
      >
        {secretQuery.data ? (
          <WidgetSigningSecret secret={secretQuery.data} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load the signing secret. Refresh this page.
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border/50 p-4">
          <div className="min-w-0">
            <Label htmlFor="identify-users" className="cursor-pointer text-sm font-medium">
              Add identify steps to the snippet and prompt
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Adds the identify comments and, for the agent prompt, the signing secret.
            </p>
          </div>
          <Switch
            id="identify-users"
            checked={identifyUsers}
            onCheckedChange={setIdentifyUsers}
            aria-label="Add identify steps to the snippet and prompt"
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Connection"
        description={
          presence.tone === 'idle'
            ? 'Open a page that includes the snippet. Localhost counts. This updates when we see a request.'
            : status.widgetSdkNeedsUpdate
              ? widgetSdkUpdateDescription(status.widgetSdkVersion, status.currentWidgetSdkVersion)
              : widgetOriginVerifiedLabel(status.widgetOriginHost)
        }
      >
        {presence.tone === 'live' && status.widgetSdkNeedsUpdate ? (
          <div className="space-y-2">
            <WarningBox
              variant="warning"
              title={widgetConnectedStatusLabel({
                hasWidgetInstalled: true,
                widgetSdkNeedsUpdate: true,
              })}
              description="Reinstall with the snippet above so the launcher picks up current features."
            />
            <WidgetLastDetected at={status.widgetLastDetectedAt} />
          </div>
        ) : presence.tone === 'live' ? (
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircleIcon className="h-5 w-5" /> Widget connection verified
            </p>
            <WidgetLastDetected at={status.widgetLastDetectedAt} />
          </div>
        ) : presence.tone === 'detected' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The SDK is installed. Turn on Show on your website above so visitors can see it.
            </p>
            <WidgetLastDetected at={status.widgetLastDetectedAt} />
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowPathIcon className="h-4 w-4 animate-spin" /> Waiting for a page load with the
            snippet…
          </p>
        )}
      </SettingsCard>
    </div>
  )
}
