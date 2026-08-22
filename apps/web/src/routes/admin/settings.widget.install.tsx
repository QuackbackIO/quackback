import { useMemo, useState } from 'react'
import { createFileRoute, Link, useRouteContext } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
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
import { widgetOriginVerifiedLabel } from '@/lib/shared/widget/widget-origin'
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
      ? Boolean(config.tabs?.messenger)
      : Boolean(config.tabs?.feedback && config.defaultBoard))
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

  const configure = useMutation({
    mutationFn: () => configureWidgetForActivationFn({ data: { mode } }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings', 'widgetConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] }),
      ])
      toast.success(mode === 'messenger' ? 'Messages tab turned on' : 'Feedback widget enabled')
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Couldn’t configure the widget'),
  })

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
        title={mode === 'messenger' ? '1. Messages tab' : '1. Enable the channel'}
        description={
          mode === 'messenger'
            ? 'Turns on the widget and the Messages tab together.'
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
            {mode === 'messenger' ? 'Turn on the Messages tab' : 'Enable feedback widget'}
          </Button>
        )}
      </SettingsCard>

      {configured && (
        <SettingsCard
          title="2. Ask your agent"
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
      )}

      {configured && (
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
      )}

      {configured && (
        <SettingsCard
          title="3. Verify the connection"
          description={
            status.hasWidgetInstalled
              ? widgetOriginVerifiedLabel(status.widgetOriginHost)
              : 'Waiting for the first request from your deployed site. Checking every five seconds.'
          }
        >
          {status.hasWidgetInstalled ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircleIcon className="h-5 w-5" /> Widget connection verified
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowPathIcon className="h-4 w-4 animate-spin" /> Waiting for installation…
            </p>
          )}
        </SettingsCard>
      )}
    </div>
  )
}
