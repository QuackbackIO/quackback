import { createFileRoute, useBlocker } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { UserGroupIcon } from '@heroicons/react/24/solid'
import { z } from 'zod'
import { AssistantConfigChangelogCard } from '@/components/admin/automation/assistant-config-changelog-card'
import {
  AssistantDirtyStateProvider,
  useAssistantDirtyState,
} from '@/components/admin/automation/assistant-form'
import { CopilotDeploymentCard } from '@/components/admin/automation/copilot-deployment-card'
import { CopilotKnowledgeCard } from '@/components/admin/automation/assistant-knowledge-card'
import { GuidanceRulesCard } from '@/components/admin/automation/guidance-rules-card'
import { BuiltInActionsCard } from '@/components/admin/automation/builtin-actions-card'
import { CustomActionsCard } from '@/components/admin/automation/custom-actions-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { BackLink } from '@/components/ui/back-link'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { FeatureFlags } from '@/lib/shared/types/settings'

const COPILOT_TABS = ['knowledge', 'guidance', 'actions', 'history'] as const
type CopilotTab = (typeof COPILOT_TABS)[number]

const searchSchema = z.object({
  tab: z.enum(COPILOT_TABS).optional(),
})

export const Route = createFileRoute('/admin/automation/copilot')({
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
  component: AssistantCopilotPage,
})

function AssistantCopilotPage() {
  return (
    <AssistantDirtyStateProvider>
      <AssistantCopilotSettings />
    </AssistantDirtyStateProvider>
  )
}

function AssistantCopilotSettings() {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const { settings } = Route.useRouteContext()
  const { tab: requestedTab = 'knowledge' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { dirtyTabs, hasUnsavedChanges } = useAssistantDirtyState()
  const flags = settings?.featureFlags as FeatureFlags | undefined
  const tab: CopilotTab = requestedTab
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
    const next = value as CopilotTab
    void navigate({
      search: (previous) => ({ ...previous, tab: next === 'knowledge' ? undefined : next }),
      replace: true,
    })
  }

  function openTestAgent() {
    void navigate({ to: '/admin/automation/test', search: { agent: 'copilot' } })
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
              <UserGroupIcon className="size-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {intl.formatMessage({
                  id: 'automation.copilot.title',
                  defaultMessage: 'Quinn Copilot',
                })}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.copilot.pageDescription',
                  defaultMessage:
                    'The teammate-facing agent. Answers questions and drafts replies in the inbox.',
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
            <CopilotDeploymentCard available={Boolean(flags?.inboxAi)} />

            <Tabs value={tab} onValueChange={setTab} variant="line" className="space-y-6">
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <TabsList className="w-max min-w-full">
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
                value="knowledge"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <CopilotKnowledgeCard />
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
                      id: 'automation.copilot.guidanceLayers.description',
                      defaultMessage:
                        'Situational guidance follows each rule’s conditions and scope when Copilot answers a teammate.',
                    })}
                  </p>
                </div>
                <GuidanceRulesCard agent="copilot" />
              </TabsContent>

              <TabsContent
                value="actions"
                forceMount
                className="space-y-6 data-[state=inactive]:hidden"
              >
                <BuiltInActionsCard agent="copilot" />
                {flags?.assistantCustomActions && <CustomActionsCard agent="copilot" />}
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
