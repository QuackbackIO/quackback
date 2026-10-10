import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Button, NewTabHint } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { WidgetConnectionRow } from '@/components/admin/settings/widget/widget-connection-row'
import { WidgetSigningSecret } from '@/components/admin/settings/widget/widget-signing-secret'
import { copyWithFallback } from '@/components/admin/activation-action-button'
import { CopyAgentPromptButton } from '@/components/admin/settings/widget/copy-agent-prompt-button'
import {
  WIDGET_SKILL_REPO,
  buildWidgetInstallPrompt,
  buildWidgetInstallSnippet,
} from '@/lib/shared/widget/install-prompt'
import { widgetInstallPresence } from '@/lib/shared/widget/widget-origin'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { useMintWidgetInstallCode } from '@/lib/client/mutations/settings'
import { useBaseUrl } from '@/lib/client/hooks/use-root-context'

export function WidgetInstallPage() {
  const baseUrl = useBaseUrl()
  const secretQuery = useSuspenseQuery(settingsQueries.widgetSecret())
  const mintInstallCode = useMintWidgetInstallCode()
  const statusQuery = useQuery({
    ...adminQueries.onboardingStatus(),
    // Fresh for one poll: the status the page was just delivered with is not
    // fetched again on mount, while one cached by an earlier visit is.
    staleTime: 5_000,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data?.hasWidgetInstalled) return 5_000
      if (data.widgetSdkNeedsUpdate) return 15_000
      return false
    },
  })
  const status = statusQuery.data!
  const presence = widgetInstallPresence({
    connected: Boolean(status.hasWidgetInstalled),
    enabled: Boolean(status.hasWidgetEnabled),
    originHost: status.widgetOriginHost,
  })
  const installed = presence.tone !== 'idle'
  const [copyingSnippet, setCopyingSnippet] = useState(false)
  const snippet = useMemo(() => buildWidgetInstallSnippet(baseUrl ?? ''), [baseUrl])

  async function agentPrompt(): Promise<string> {
    try {
      const minted = await mintInstallCode.mutateAsync()
      return buildWidgetInstallPrompt(baseUrl ?? '', minted.code)
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

  const agentCta = (
    <>
      <CopyAgentPromptButton getPrompt={agentPrompt} disabled={mintInstallCode.isPending} />
      <p className="mt-3 text-xs text-muted-foreground">
        The agent installs the widget and turns it on. You never paste the signing secret.{' '}
        <a
          href={WIDGET_SKILL_REPO}
          target="_blank"
          rel="noreferrer"
          className={`${INLINE_LINK} text-[13px]`}
        >
          What the agent does
          <NewTabHint />
        </a>
      </p>
    </>
  )

  const handInstall = (
    <InstallSection
      title="Install without an agent"
      description="Copy the snippet, or add the npm package."
    >
      <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
        <code>{snippet}</code>
      </pre>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => void copySnippet()} disabled={copyingSnippet}>
          <ClipboardDocumentIcon className="h-4 w-4" />
          {copyingSnippet ? 'Copying…' : 'Copy snippet'}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Or add <code className="rounded bg-muted px-1 py-0.5">@quackback/widget</code> and call{' '}
        <code className="rounded bg-muted px-1 py-0.5">Quackback.init</code> with this instance URL.
      </p>
    </InstallSection>
  )

  const secretBlock = secretQuery.data ? (
    <WidgetSigningSecret secret={secretQuery.data} />
  ) : (
    <p className="text-sm text-muted-foreground">
      Couldn&apos;t load the signing secret. Refresh this page.
    </p>
  )

  const connectionRows = (
    <SettingRows>
      <SettingRow
        label="Show on your website"
        description={
          status.hasWidgetEnabled
            ? 'On. Change it in Widget settings.'
            : 'Off. Change it in Widget settings.'
        }
        control={
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/settings/widget">Widget settings</Link>
          </Button>
        }
      />
      <WidgetConnectionRow
        label="Widget connection"
        status={status}
        enabled={Boolean(status.hasWidgetEnabled)}
        waiting={!installed}
      />
    </SettingRows>
  )

  return (
    <SettingsPage
      page="/admin/settings/widget/install"
      crumbs={[{ label: 'Widget', to: '/admin/settings/widget' }]}
    >
      {installed ? (
        <>
          <SettingsCard title="Status">{connectionRows}</SettingsCard>

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

          <SettingsCard flush>{handInstall}</SettingsCard>
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
            {connectionRows}
          </SettingsCard>

          <SettingsCard flush>
            {handInstall}
            <div className="border-t border-border/50">
              <InstallSection
                title="Signing secret"
                description="Skip this unless you are installing by hand."
              >
                {secretBlock}
              </InstallSection>
            </div>
          </SettingsCard>
        </>
      )}
    </SettingsPage>
  )
}

/** A disclosure row: title and description on the left, the chevron on the right. */
function InstallSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-6">
        <span>
          <span className="block text-sm font-medium">{title}</span>
          {description && (
            <span className="mt-0.5 block text-[13px] text-muted-foreground">{description}</span>
          )}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 pt-1 sm:px-6">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
