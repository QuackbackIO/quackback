import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useBlocker } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { z } from 'zod'
import { AdditionalInstructionsCard } from '@/components/admin/automation/additional-instructions-card'
import {
  AgentPauseControl,
  useAgentStatusLine,
  type WidgetAssistantDeployment,
} from '@/components/admin/automation/assistant-deployment-card'
import {
  AssistantDirtyStateProvider,
  useAssistantDirtyState,
} from '@/components/admin/automation/assistant-form'
import { AssistantIdentityCard } from '@/components/admin/automation/assistant-identity-card'
import { AssistantVoiceCard } from '@/components/admin/automation/assistant-basics-card'
import { AgentKnowledgeCard } from '@/components/admin/automation/assistant-knowledge-card'
import { GuidanceRulesCard } from '@/components/admin/automation/guidance-rules-card'

import { SettingsPage } from '@/components/admin/settings/settings-page'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { warmQuery } from '@/lib/client/queries/warm-query'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import type { FeatureFlags } from '@/lib/shared/types'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

const AGENT_TABS = ['basics', 'knowledge', 'guidance'] as const
type AgentTab = (typeof AGENT_TABS)[number]

const searchSchema = z.object({
  tab: z.enum([...AGENT_TABS, 'actions']).optional(),
})

export const Route = createFileRoute('/admin/settings/agent')({
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    if (search.tab === 'actions') {
      throw redirect({ to: '/admin/settings/connectors' })
    }
    assertRoutePermission(context.permissions, PERMISSIONS.ASSISTANT_MANAGE)
  },
  // The page reads its settings, and the always-mounted Guidance tab reads the
  // rules and their stats. Warming them means the page finds all three loaded;
  // a failed warm is left to the page.
  loader: async ({ context }) => {
    const { queryClient } = context
    await Promise.all([
      queryClient.ensureQueryData(assistantQueries.settings()),
      warmQuery(queryClient, assistantQueries.guidanceRules()),
      warmQuery(queryClient, assistantQueries.guidanceRuleStats()),
    ])
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: AssistantAgentPage,
})

function AssistantAgentPage() {
  return (
    <AssistantDirtyStateProvider>
      <AssistantAgentSettings />
    </AssistantDirtyStateProvider>
  )
}

function AssistantAgentSettings() {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const settings = useWorkspaceSettings()
  const { tab: requestedTab = 'basics' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { dirtyTabs, hasUnsavedChanges } = useAssistantDirtyState()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const tab: AgentTab = requestedTab === 'actions' ? 'basics' : requestedTab
  const initialDeployment = settings?.publicWidgetConfig?.messenger?.assistant
  const [deployment, setDeployment] = useState<WidgetAssistantDeployment>({
    enabled: initialDeployment?.enabled ?? true,
    respond: initialDeployment?.respond ?? true,
  })
  // The Agent answers in Messenger, which needs the Support inbox; tickets alone do not give it one.
  const inboxOn = Boolean(flags?.supportInbox)
  const statusLine = useAgentStatusLine(deployment, inboxOn, Boolean(flags?.supportTickets))
  const unsavedLabel = intl.formatMessage({
    id: 'automation.agent.tabs.unsaved',
    defaultMessage: 'Unsaved changes',
  })
  const navigationBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) => hasUnsavedChanges && current.pathname !== next.pathname,
    enableBeforeUnload: false,
    withResolver: true,
  })

  function setTab(value: string) {
    const next = value as AgentTab
    void navigate({
      search: (previous) => ({ ...previous, tab: next === 'basics' ? undefined : next }),
      replace: true,
    })
  }

  return (
    <>
      <SettingsPage
        page="/admin/settings/agent"
        description={statusLine}
        actions={
          <AgentPauseControl
            deployment={deployment}
            available={inboxOn}
            ticketsOn={Boolean(flags?.supportTickets)}
            onChange={setDeployment}
          />
        }
      >
        {settingsQuery.isPending ? (
          <div className="rounded-xl border border-border/50 bg-card p-6" role="status">
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.agent.loading',
                defaultMessage: 'Loading AI agent settings…',
              })}
            </p>
          </div>
        ) : settingsQuery.isError ? (
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <p role="alert" className="text-sm text-destructive">
              {intl.formatMessage({
                id: 'automation.agent.loadError',
                defaultMessage: 'AI agent settings could not be loaded.',
              })}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void settingsQuery.refetch()}
            >
              {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
            </Button>
          </div>
        ) : (
          <>
            <Tabs value={tab} onValueChange={setTab} variant="line" className="space-y-6">
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max min-w-full">
                  <TabsTrigger value="basics">
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.basics',
                      defaultMessage: 'Basics',
                    })}
                  </TabsTrigger>
                  <TabsTrigger value="knowledge">
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.knowledge',
                      defaultMessage: 'Knowledge',
                    })}
                  </TabsTrigger>
                  <TabsTrigger
                    value="guidance"
                    dirty={dirtyTabs.has('guidance')}
                    dirtyLabel={unsavedLabel}
                  >
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.guidance',
                      defaultMessage: 'Guidance',
                    })}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="basics" keepMounted className="space-y-6">
                <AssistantIdentityCard />
                <AssistantVoiceCard />
                <AdditionalInstructionsCard />
              </TabsContent>

              <TabsContent value="knowledge" keepMounted className="space-y-6">
                <AgentKnowledgeCard />
              </TabsContent>

              <TabsContent value="guidance" keepMounted className="space-y-6">
                <GuidanceRulesCard agent="agent" />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SettingsPage>

      <ConfirmDialog
        open={navigationBlocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && navigationBlocker.status === 'blocked') navigationBlocker.reset()
        }}
        title={intl.formatMessage({
          id: 'automation.agent.navigationUnsaved.title',
          defaultMessage: 'Discard unsaved changes?',
        })}
        description={intl.formatMessage({
          id: 'automation.agent.navigationUnsaved.description',
          defaultMessage: 'Continuing will discard changes that have not been saved.',
        })}
        confirmLabel={intl.formatMessage({
          id: 'automation.agent.navigationUnsaved.confirm',
          defaultMessage: 'Discard changes',
        })}
        cancelLabel={intl.formatMessage({
          id: 'automation.agent.navigationUnsaved.cancel',
          defaultMessage: 'Keep editing',
        })}
        variant="destructive"
        onConfirm={() => {
          if (navigationBlocker.status === 'blocked') navigationBlocker.proceed()
        }}
      />
    </>
  )
}
