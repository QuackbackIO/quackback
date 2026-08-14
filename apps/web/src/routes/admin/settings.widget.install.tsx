import { useMemo, useState } from 'react'
import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { copyWithFallback } from '@/components/admin/activation-action-button'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { configureWidgetForActivationFn } from '@/lib/server/functions/settings'
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
  const queryClient = useQueryClient()
  const { baseUrl } = useRouteContext({ from: '__root__' })
  const configQuery = useSuspenseQuery(settingsQueries.widgetConfig())
  const secretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const statusQuery = useQuery({
    ...adminQueries.onboardingStatus(),
    refetchInterval: (query) => (query.state.data?.hasWidgetInstalled ? false : 5_000),
  })
  const status = statusQuery.data!
  const mode = status.useCase === 'customer_support' ? 'messenger' : 'feedback'
  const config = configQuery.data
  const configured =
    config.enabled &&
    (mode === 'messenger'
      ? Boolean(config.tabs?.messenger && config.messenger?.enabled)
      : Boolean(config.tabs?.feedback && config.defaultBoard))
  const [copying, setCopying] = useState<'snippet' | 'developer' | 'secret' | null>(null)
  const snippet = useMemo(
    () => `<script>
  (function(w,d){if(w.Quackback)return;w.Quackback=function(){
  (w.Quackback.q=w.Quackback.q||[]).push(arguments)};
  var s=d.createElement("script");s.async=true;
  s.src="${baseUrl ?? ''}/api/widget/sdk.js";
  d.head.appendChild(s)})(window,document);
  Quackback("init");
</script>`,
    [baseUrl]
  )
  const developerInstructions = `${
    mode === 'messenger' ? 'Connect Quackback Messenger' : 'Connect Quackback feedback'
  }

1. Paste this snippet before the closing </body> tag on every page:

${snippet}

2. Deploy the change.
3. Open the deployed site once. Quackback checks for the installation automatically.

Identifying signed-in users is optional; anonymous visitors can use the widget immediately.`

  const configure = useMutation({
    mutationFn: () => configureWidgetForActivationFn({ data: { mode } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', 'widgetConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] }),
      ])
      toast.success(mode === 'messenger' ? 'Messenger enabled' : 'Feedback widget enabled')
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Couldn’t configure the widget'),
  })

  async function copy(kind: 'snippet' | 'developer' | 'secret', text: string) {
    setCopying(kind)
    try {
      await copyWithFallback(text)
      toast.success(kind === 'developer' ? 'Developer instructions copied' : 'Copied')
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
        description="Enable the right channel, add one snippet, and verify the site connection."
      />

      <SettingsCard
        title="1. Enable the channel"
        description={
          mode === 'messenger'
            ? 'Turns on the widget, Messenger, and the Messages tab together.'
            : 'Turns on the widget and Feedback tab with your public board selected.'
        }
      >
        {configured ? (
          <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="h-5 w-5" /> Channel enabled
          </p>
        ) : (
          <Button onClick={() => configure.mutate()} disabled={configure.isPending}>
            {configure.isPending && <ArrowPathIcon className="h-4 w-4 animate-spin" />}
            {mode === 'messenger' ? 'Enable Messenger' : 'Enable feedback widget'}
          </Button>
        )}
      </SettingsCard>

      {configured && (
        <SettingsCard
          title="2. Add the SDK"
          description="Paste this minimal snippet before the closing body tag on your site."
        >
          <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
            <code>{snippet}</code>
          </pre>
          <div className="mt-4 flex flex-wrap gap-2">
            {!status.hasWidgetInstalled && (
              <Button onClick={() => copy('snippet', snippet)} disabled={copying !== null}>
                <ClipboardDocumentIcon className="h-4 w-4" />
                {copying === 'snippet' ? 'Copying…' : 'Copy installation snippet'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => copy('developer', developerInstructions)}
              disabled={copying !== null}
            >
              Copy instructions for a developer
            </Button>
          </div>
        </SettingsCard>
      )}

      {configured && (
        <SettingsCard
          title="3. Verify the connection"
          description={
            status.hasWidgetInstalled
              ? `Verified on ${status.widgetOriginHost ?? 'your site'}`
              : 'Waiting for the first request from your deployed site. Checking every five seconds.'
          }
        >
          {status.hasWidgetInstalled ? (
            <div className="space-y-4">
              <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                <CheckCircleIcon className="h-5 w-5" /> Widget connection verified
              </p>
              {status.widgetOriginHost && (
                <Button asChild>
                  <a href={`https://${status.widgetOriginHost}`} target="_blank" rel="noreferrer">
                    {mode === 'messenger' ? 'Open your site and send a message' : 'Open your site'}
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowPathIcon className="h-4 w-4 animate-spin" /> Waiting for installation…
            </p>
          )}
        </SettingsCard>
      )}

      {configured && (
        <details className="rounded-xl border bg-card">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
            Advanced: identify signed-in users (optional)
          </summary>
          <div className="space-y-3 border-t px-5 py-4 text-sm text-muted-foreground">
            <p>
              Anonymous visitors can already use the widget. To attach conversations and feedback to
              signed-in customers, mint a short-lived signed SSO token on your backend and call
              <code className="mx-1 rounded bg-muted px-1 py-0.5">
                Quackback(&quot;identify&quot;)
              </code>
              .
            </p>
            {secretQuery.data && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => copy('secret', secretQuery.data!)}
                disabled={copying !== null}
              >
                <ClipboardDocumentIcon className="h-4 w-4" />
                {copying === 'secret' ? 'Copying…' : 'Copy widget signing secret'}
              </Button>
            )}
          </div>
        </details>
      )}
    </div>
  )
}
