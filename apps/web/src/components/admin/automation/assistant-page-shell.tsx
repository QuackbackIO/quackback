import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useBlocker } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import type { AiPagePath } from '@/components/admin/settings/settings-pages'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { AssistantDirtyStateProvider, useAssistantDirtyState } from './assistant-form'

interface AssistantPageShellProps {
  page: AiPagePath
  actions?: ReactNode
  description?: string
  children: ReactNode
}

/**
 * The frame of a Quackback AI page that edits assistant settings: it provides
 * the unsaved-changes state its cards report to, shows the loading and error
 * states of the settings, and asks before leaving a page with unsaved edits.
 */
export function AssistantPageShell(props: AssistantPageShellProps) {
  return (
    <AssistantDirtyStateProvider>
      <AssistantPageFrame {...props} />
    </AssistantDirtyStateProvider>
  )
}

function AssistantPageFrame({ page, description, actions, children }: AssistantPageShellProps) {
  const intl = useIntl()
  const settingsQuery = useQuery(assistantQueries.settings())
  const { hasUnsavedChanges } = useAssistantDirtyState()
  const navigationBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) => hasUnsavedChanges && current.pathname !== next.pathname,
    enableBeforeUnload: false,
    withResolver: true,
  })

  return (
    <>
      <SettingsPage page={page} description={description} actions={actions}>
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
          children
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
