import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useBlocker } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { z } from 'zod'
import { AdditionalInstructionsCard } from '@/components/admin/automation/additional-instructions-card'
import {
  AssistantDeploymentCard,
  type WidgetAssistantDeployment,
} from '@/components/admin/automation/assistant-deployment-card'
import { AssistantConfigChangelogCard } from '@/components/admin/automation/assistant-config-changelog-card'
import {
  AssistantDirtyStateProvider,
  useAssistantDirtyState,
} from '@/components/admin/automation/assistant-form'
import { AssistantIdentityCard } from '@/components/admin/automation/assistant-identity-card'
import { AssistantVoiceCard } from '@/components/admin/automation/assistant-basics-card'
import { AgentKnowledgeCard } from '@/components/admin/automation/assistant-knowledge-card'
import { GuidanceRulesCard } from '@/components/admin/automation/guidance-rules-card'
import { BuiltInActionsCard } from '@/components/admin/automation/builtin-actions-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { BackLink } from '@/components/ui/back-link'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'

const AGENT_TABS = ['basics', 'knowledge', 'guidance', 'actions', 'history'] as const
type AgentTab = (typeof AGENT_TABS)[number]

const searchSchema = z.object({
  tab: z.enum(AGENT_TABS).optional(),
})

export const Route = createFileRoute('/admin/automation/agent')({
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    const permissions = (context as { permissions?: PermissionKey[] }).permissions ?? []
    if (!permissions.includes(PERMISSIONS.ASSISTANT_MANAGE)) {
      throw new Error('Access denied: requires assistant.manage')
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(assistantQueries.settings())
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
  const { settings } = Route.useRouteContext()
  const { tab: requestedTab = 'basics' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { dirtyTabs, hasUnsavedChanges } = useAssistantDirtyState()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const tab: AgentTab = requestedTab
  const initialDeployment = settings?.publicWidgetConfig?.messenger?.assistant
  const [deployment, setDeployment] = useState<WidgetAssistantDeployment>({
    enabled: initialDeployment?.enabled ?? true,
    respond: initialDeployment?.respond ?? false,
  })
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

  function openTestAgent() {
    void navigate({ to: '/admin/automation/test' })
  }

  return (
    <>
      <div className="max-w-3xl space-y-6">
        <div className="lg:hidden">
          <BackLink to="/admin/automation">
            {intl.formatMessage({ id: 'automation.nav.label', defaultMessage: 'AI & Automation' })}
          </BackLink>
        </div>

        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <SparklesIcon className="size-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {intl.formatMessage({
                  id: 'automation.agent.title',
                  defaultMessage: 'Quinn Agent',
                })}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.agent.pageDescription',
                  defaultMessage:
                    'The customer-facing agent. Replies in Messenger and anywhere else Quinn speaks for you.',
                })}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:min-h-9 sm:w-auto"
            onClick={openTestAgent}
          >
            {intl.formatMessage({
              id: 'automation.agent.testSaved',
              defaultMessage: 'Test saved settings',
            })}
          </Button>
        </header>

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
            <AssistantDeploymentCard
              deployment={deployment}
              available={Boolean(flags?.supportInbox)}
              onChange={setDeployment}
            />

            <Tabs value={tab} onValueChange={setTab} variant="line" className="space-y-6">
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max min-w-full">
                  <TabsTrigger value="basics">
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.basics',
                      defaultMessage: 'Basics',
                    })}
                    {dirtyTabs.has('basics') && <UnsavedChangesIndicator label={unsavedLabel} />}
                  </TabsTrigger>
                  <TabsTrigger value="knowledge">
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.knowledge',
                      defaultMessage: 'Knowledge',
                    })}
                  </TabsTrigger>
                  <TabsTrigger value="guidance">
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.guidance',
                      defaultMessage: 'Guidance',
                    })}
                    {dirtyTabs.has('guidance') && <UnsavedChangesIndicator label={unsavedLabel} />}
                  </TabsTrigger>
                  <TabsTrigger value="actions">
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.actions',
                      defaultMessage: 'Actions',
                    })}
                    {dirtyTabs.has('actions') && <UnsavedChangesIndicator label={unsavedLabel} />}
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    {intl.formatMessage({
                      id: 'automation.agent.tabs.history',
                      defaultMessage: 'History',
                    })}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent
                value="basics"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <AssistantIdentityCard />
                <AssistantVoiceCard />
                <AdditionalInstructionsCard />
              </TabsContent>

              <TabsContent
                value="knowledge"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <AgentKnowledgeCard />
              </TabsContent>

              <TabsContent
                value="guidance"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <div className="max-w-2xl space-y-1">
                  <h2 className="text-sm font-medium">
                    {intl.formatMessage({
                      id: 'automation.agent.guidanceLayers.title',
                      defaultMessage: 'How guidance is applied',
                    })}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {intl.formatMessage({
                      id: 'automation.agent.guidanceLayers.description',
                      defaultMessage:
                        "Writing guidelines set the baseline. Situational guidance follows each rule's conditions and scope.",
                    })}
                  </p>
                </div>
                <GuidanceRulesCard agent="agent" />
              </TabsContent>

              <TabsContent
                value="actions"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <BuiltInActionsCard agent="agent" />
              </TabsContent>

              <TabsContent
                value="history"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <AssistantConfigChangelogCard />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

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

function UnsavedChangesIndicator({ label }: { label: string }) {
  return (
    <>
      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
      <span className="sr-only">{label}</span>
    </>
  )
}
