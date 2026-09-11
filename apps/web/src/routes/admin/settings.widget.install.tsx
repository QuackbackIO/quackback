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
import { CollapsibleSection } from '@/components/ui/collapsible'
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
import { useMintWidgetInstallCode, useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
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
  const mintInstallCode = useMintWidgetInstallCode()
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
  const installed = presence.tone !== 'idle'
  const [copyingSnippet, setCopyingSnippet] = useState(false)
  const snippet = useMemo(
    () => buildWidgetInstallSnippet({ instanceUrl: baseUrl ?? '' }),
    [baseUrl]
  )

  async function agentPrompt(): Promise<string> {
    const instanceUrl = baseUrl ?? ''
    try {
      const minted = await mintInstallCode.mutateAsync()
      return buildWidgetInstallPrompt({
        instanceUrl,
        pairingCode: minted.code,
      })
    } catch {
      toast.error('Could not copy the install prompt. Try again.')
      return ''
    }
  }

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

  const visibilityToggle = (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-4">
      <div className="min-w-0">
        <Label htmlFor="show-on-website" className="cursor-pointer text-sm font-medium">
          Show on your website
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          When this is off, visitors won&apos;t see the launcher.
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
  )

  const agentCta = (
    <>
      <CopyAgentPromptButton getPrompt={agentPrompt} disabled={mintInstallCode.isPending} />
      <p className="mt-3 text-xs text-muted-foreground">
        The agent installs the widget and turns it on. You never paste the signing secret.{' '}
        <a
          href={WIDGET_SKILL_REPO}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          What the agent does
        </a>
      </p>
    </>
  )

  const handInstall = (
    <CollapsibleSection
      title="Install without an agent"
      description="Copy the snippet, or add the npm package."
    >
      <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
        <code>{snippet}</code>
      </pre>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => void copySnippet()} disabled={copyingSnippet}>
          <ClipboardDocumentIcon className="h-4 w-4" />
          {copyingSnippet ? 'Copying…' : 'Copy snippet'}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Or add <code className="rounded bg-muted px-1 py-0.5">@quackback/widget</code> and call{' '}
        <code className="rounded bg-muted px-1 py-0.5">Quackback.init</code> with this instance URL.
      </p>
    </CollapsibleSection>
  )

  const secretBlock = secretQuery.data ? (
    <WidgetSigningSecret secret={secretQuery.data} />
  ) : (
    <p className="text-sm text-muted-foreground">
      Couldn&apos;t load the signing secret. Refresh this page.
    </p>
  )

  const connectionBody =
    presence.tone === 'live' && status.widgetSdkNeedsUpdate ? (
      <div className="space-y-2">
        <WarningBox
          variant="warning"
          title={widgetConnectedStatusLabel({
            hasWidgetInstalled: true,
            widgetSdkNeedsUpdate: true,
          })}
          description="Copy a fresh prompt so your site picks up the latest widget."
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
          The widget is installed but hidden. Turn on Show on your website so visitors can see it.
        </p>
        <WidgetLastDetected at={status.widgetLastDetectedAt} />
      </div>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowPathIcon className="h-4 w-4 animate-spin" /> Waiting for the widget to load…
      </p>
    )

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
        title={
          installed
            ? mode === 'messenger'
              ? 'Messenger on your site'
              : 'Widget on your site'
            : mode === 'messenger'
              ? 'Add Messenger to your site'
              : 'Add the widget to your site'
        }
        description={
          installed
            ? 'Change who can see it, or copy a new prompt for another site.'
            : 'Paste a prompt into the coding agent in your app. Then open a page to confirm it loaded.'
        }
      />

      {installed ? (
        <>
          <SettingsCard
            title="Status"
            description={
              status.widgetSdkNeedsUpdate
                ? widgetSdkUpdateDescription(
                    status.widgetSdkVersion,
                    status.currentWidgetSdkVersion
                  )
                : widgetOriginVerifiedLabel(status.widgetOriginHost)
            }
          >
            <div className="space-y-4">
              {connectionBody}
              {visibilityToggle}
            </div>
          </SettingsCard>

          <SettingsCard
            title="Add to another site"
            description="Or copy a fresh prompt to update the widget."
          >
            {agentCta}
          </SettingsCard>

          <SettingsCard
            title="Signing secret"
            description="Only if you install by hand or need to rotate it."
          >
            {secretBlock}
          </SettingsCard>

          <SettingsCard contentClassName="p-0 sm:p-0">{handInstall}</SettingsCard>
        </>
      ) : (
        <>
          <SettingsCard
            title="1. Copy the prompt for your agent"
            description="Paste it into the coding agent in your app."
          >
            {agentCta}
          </SettingsCard>

          <SettingsCard
            title="2. Open a page on your site"
            description="After the agent finishes. Localhost is fine."
          >
            <div className="space-y-4">
              {connectionBody}
              {visibilityToggle}
            </div>
          </SettingsCard>

          <SettingsCard contentClassName="p-0 sm:p-0">
            {handInstall}
            <div className="border-t border-border/50">
              <CollapsibleSection
                title="Signing secret"
                description="Skip this unless you are installing by hand."
              >
                {secretBlock}
              </CollapsibleSection>
            </div>
          </SettingsCard>
        </>
      )}
    </div>
  )
}
