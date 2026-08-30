import { useMemo, useState, useTransition } from 'react'
import { createFileRoute, Link, useRouteContext, useRouter } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { copyWithFallback } from '@/components/admin/activation-action-button'
import { CopyAgentPromptButton } from '@/components/admin/settings/widget/copy-agent-prompt-button'
import {
  WIDGET_SKILL_REPO,
  buildWidgetInstallPrompt,
  buildWidgetInstallSnippet,
  maskWidgetSecretInPrompt,
} from '@/lib/shared/widget/install-prompt'
import { widgetInstallPresence, widgetOriginVerifiedLabel } from '@/lib/shared/widget/widget-origin'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { useEnableWidgetFromInstall, useUpdateWidgetConfig } from '@/lib/client/mutations/settings'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'

export const Route = createFileRoute('/admin/settings/widget/install')({
  loader: async ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.SETTINGS_MANAGE)
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQueries.widgetConfig()),
      context.queryClient.ensureQueryData(settingsQueries.widgetSecret()),
      context.queryClient.ensureQueryData(adminQueries.onboardingStatus()),
    ])
  },
  component: WidgetInstallPage,
})

function WidgetInstallPage() {
  const router = useRouter()
  const { baseUrl } = useRouteContext({ from: '__root__' })
  const configQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const secretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const statusQuery = useQuery({
    ...adminQueries.onboardingStatus(),
    refetchInterval: (query) => (query.state.data?.hasWidgetInstalled ? false : 5_000),
  })
  const status = statusQuery.data!
  const mode = status.useCase === 'customer_support' ? 'messenger' : 'feedback'
  const updateWidgetConfig = useUpdateWidgetConfig()
  const enableFromInstall = useEnableWidgetFromInstall()
  const [isPending, startTransition] = useTransition()
  const [savingEnabled, setSavingEnabled] = useState(false)
  const [enabled, setEnabled] = useState(Boolean(configQuery.data.enabled))
  const [messengerTab, setMessengerTab] = useState(configQuery.data.tabs?.messenger ?? true)
  const presence = widgetInstallPresence({
    connected: Boolean(status.hasWidgetInstalled),
    enabled,
    originHost: status.widgetOriginHost,
    requireMessengerTab: mode === 'messenger',
    messengerTab,
  })
  const [copying, setCopying] = useState<'snippet' | 'secret' | null>(null)
  const [identifyUsers, setIdentifyUsers] = useState(true)
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
      }),
    [baseUrl, secretQuery.data]
  )
  const previewPrompt = useMemo(
    () => maskWidgetSecretInPrompt(agentPrompt, secretQuery.data),
    [agentPrompt, secretQuery.data]
  )

  async function handleEnabled(checked: boolean) {
    const previousEnabled = enabled
    const previousMessengerTab = messengerTab
    setEnabled(checked)
    if (checked && mode === 'messenger') setMessengerTab(true)
    setSavingEnabled(true)
    try {
      if (checked) {
        await enableFromInstall.mutateAsync({ mode })
      } else {
        await updateWidgetConfig.mutateAsync({ enabled: false })
      }
      startTransition(() => router.invalidate())
    } catch {
      setEnabled(previousEnabled)
      setMessengerTab(previousMessengerTab)
    } finally {
      setSavingEnabled(false)
    }
  }

  async function copy(kind: 'snippet' | 'secret', text: string) {
    setCopying(kind)
    try {
      await copyWithFallback(text)
      toast.success('Copied')
    } catch {
      toast.error('Copy failed. Select the text and copy it manually.')
    } finally {
      setCopying(null)
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
        title={mode === 'messenger' ? 'Connect Messenger' : 'Install feedback widget'}
        description="Copy a prompt that installs the Quackback skill and wires the widget into your codebase."
      />

      <SettingsCard
        title="Ask your agent"
        description="Paste this into Claude, Cursor, Codex, or Copilot. It fetches the install-widget skill, detects your stack, and identifies signed-in users."
      >
        <CopyAgentPromptButton prompt={agentPrompt} />
        <p className="mt-3 text-xs text-muted-foreground">
          The prompt points your agent at the{' '}
          <a
            href={WIDGET_SKILL_REPO}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            install-widget skill
          </a>{' '}
          and includes your widget secret. Paste it into a local agent only.
        </p>
        <pre className="mt-4 max-h-72 overflow-auto rounded-lg border border-border/50 bg-muted/30 p-3 text-xs font-mono leading-relaxed text-foreground whitespace-pre-wrap">
          {previewPrompt}
        </pre>
      </SettingsCard>

      <SettingsCard
        title="Or add the snippet yourself"
        description="Paste this before the closing body tag if you would rather install it by hand."
      >
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-border/50 p-4">
          <div className="min-w-0">
            <Label htmlFor="identify-users" className="cursor-pointer text-sm font-medium">
              Identify signed-in users
              <Badge size="sm" shape="pill" variant="secondary">
                Recommended
              </Badge>
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Attach conversations to a person. Your server signs a short-lived token; the browser
              only sends that token, never raw id or email.
            </p>
          </div>
          <Switch
            id="identify-users"
            checked={identifyUsers}
            onCheckedChange={setIdentifyUsers}
            aria-label="Identify signed-in users"
          />
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
          <code>{snippet}</code>
        </pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => copy('snippet', snippet)}
            disabled={copying !== null}
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
            {copying === 'snippet' ? 'Copying…' : 'Copy installation snippet'}
          </Button>
          {identifyUsers && secretQuery.data && (
            <Button
              variant="outline"
              onClick={() => copy('secret', secretQuery.data!)}
              disabled={copying !== null}
            >
              <ClipboardDocumentIcon className="h-4 w-4" />
              {copying === 'secret' ? 'Copying…' : 'Copy widget signing secret'}
            </Button>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Verify the connection"
        description={
          presence.tone === 'idle'
            ? 'Waiting for the first request from your deployed site. Checking every five seconds.'
            : widgetOriginVerifiedLabel(status.widgetOriginHost)
        }
      >
        {presence.tone === 'live' ? (
          <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="h-5 w-5" /> Widget connection verified
          </p>
        ) : presence.tone === 'detected' ? (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-4">
            <div className="min-w-0">
              <Label htmlFor="install-widget-toggle" className="cursor-pointer text-sm font-medium">
                Show on your website
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The SDK is installed. Visitors will not see the widget until this is on.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <InlineSpinner visible={savingEnabled || isPending} />
              <Switch
                id="install-widget-toggle"
                checked={enabled}
                onCheckedChange={(checked) => void handleEnabled(checked)}
                disabled={savingEnabled || isPending}
                aria-label="Widget"
              />
            </div>
          </div>
        ) : presence.tone === 'channel-off' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              The widget is on. Conversations will not start until the Messages tab is on.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <InlineSpinner visible={savingEnabled || isPending} />
              <Button
                size="sm"
                onClick={() => void handleEnabled(true)}
                disabled={savingEnabled || isPending}
              >
                Turn on the Messages tab
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link to="/admin/settings/channels/messenger">Messenger settings</Link>
              </Button>
            </div>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowPathIcon className="h-4 w-4 animate-spin" /> Waiting for installation…
          </p>
        )}
      </SettingsCard>
    </div>
  )
}
