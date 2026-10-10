import { createFileRoute, redirect, useBlocker } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { z } from 'zod'
import {
  AssistantDirtyStateProvider,
  useAssistantDirtyState,
} from '@/components/admin/automation/assistant-form'
import {
  CopilotPauseControl,
  useCopilotStatusLine,
} from '@/components/admin/automation/copilot-deployment-card'
import { CopilotKnowledgeCard } from '@/components/admin/automation/assistant-knowledge-card'
import { GuidanceRulesCard } from '@/components/admin/automation/guidance-rules-card'

import { SettingsPage } from '@/components/admin/settings/settings-page'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

const COPILOT_TABS = ['knowledge', 'guidance'] as const
type CopilotTab = (typeof COPILOT_TABS)[number]

const searchSchema = z.object({
  tab: z.enum([...COPILOT_TABS, 'actions']).optional(),
})

export const Route = createFileRoute('/admin/settings/copilot')({
  head: adminPageHead('Copilot settings'),
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    if (search.tab === 'actions') {
      throw redirect({ to: '/admin/settings/connectors' })
    }
    assertRoutePermission(context.permissions, PERMISSIONS.ASSISTANT_MANAGE)
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
  const { tab: requestedTab = 'knowledge' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { dirtyTabs, hasUnsavedChanges } = useAssistantDirtyState()
  const tab: CopilotTab = requestedTab === 'actions' ? 'knowledge' : requestedTab
  const statusLine = useCopilotStatusLine()
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

  return (
    <>
      <SettingsPage
        page="/admin/settings/copilot"
        description={statusLine}
        actions={<CopilotPauseControl />}
      >
        {settingsQuery.isPending ? (
          <div className="rounded-xl border bg-card p-6" role="status">
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.agent.loading',
                defaultMessage: 'Loading AI agent settings...',
              })}
            </p>
          </div>
        ) : settingsQuery.isError ? (
          <div className="rounded-xl border bg-card p-6">
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

              <TabsContent value="knowledge" keepMounted className="space-y-6">
                <CopilotKnowledgeCard />
              </TabsContent>

              <TabsContent value="guidance" keepMounted className="space-y-6">
                <GuidanceRulesCard agent="copilot" />
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
