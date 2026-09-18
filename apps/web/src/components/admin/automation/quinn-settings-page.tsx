import type { ReactNode } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { BackLink } from '@/components/ui/back-link'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { AssistantDirtyStateProvider, useAssistantDirtyState } from './assistant-form'

export function QuinnSettingsPage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <AssistantDirtyStateProvider>
      <SettingsContent title={title} description={description}>
        {children}
      </SettingsContent>
    </AssistantDirtyStateProvider>
  )
}
function SettingsContent({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  const { hasUnsavedChanges } = useAssistantDirtyState()
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => hasUnsavedChanges && current.pathname !== next.pathname,
    enableBeforeUnload: false,
    withResolver: true,
  })
  return (
    <>
      <div className="max-w-4xl space-y-6">
        <div className="lg:hidden">
          <BackLink to="/admin/automation">AI &amp; Automation</BackLink>
        </div>
        <header>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </header>
        {children}
      </div>
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title="Discard unsaved changes?"
        description="Continuing will discard changes that have not been saved."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => {
          if (blocker.status === 'blocked') blocker.proceed()
        }}
      />
    </>
  )
}
