import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { setupWorkspaceFn } from '@/lib/server/functions/onboarding'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { pickOnboardingStep } from './-onboarding-step'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '@/lib/client/config-file'

export const Route = createFileRoute('/onboarding/_layout/workspace')({
  loader: async ({ context }) => {
    const { session } = context

    if (!session?.user) {
      throw redirect({ to: '/onboarding/account' })
    }

    const state = await checkOnboardingState({ data: session.user.id })

    if (state.needsInvitation) {
      throw redirect({ to: '/auth/login' })
    }

    // Delegate to pickOnboardingStep when this step doesn't apply: useCase
    // not chosen yet (skip backwards) OR workspace already configured (skip
    // forwards). One source of truth for wizard order.
    if (!state.setupState?.useCase || state.setupState?.steps?.workspace) {
      throw redirect({
        to: pickOnboardingStep({
          session: { userId: session.user.id },
          state: {
            needsInvitation: state.needsInvitation,
            setupState: state.setupState,
            principalRecord: state.principalRecord,
          },
        }),
      })
    }

    return {
      existingWorkspaceName: context.settings?.settings?.name ?? '',
      useCase: state.setupState.useCase,
    }
  },
  component: WorkspaceStep,
})

function WorkspaceStep() {
  const navigate = useNavigate()
  const { existingWorkspaceName, useCase } = Route.useLoaderData()
  const { managedFieldPaths } = Route.useRouteContext()
  // workspace.name and workspace.slug are written together by this
  // mutator; if either is locked we disable the field and surface a
  // single hint. The slug is auto-derived from the name post-onboarding,
  // so a slug-only lock still implies the name field is effectively
  // locked too.
  const workspaceLocked =
    isPathManagedFromBootstrap(MANAGED_PATHS.WORKSPACE_NAME, managedFieldPaths ?? []) ||
    isPathManagedFromBootstrap(MANAGED_PATHS.WORKSPACE_SLUG, managedFieldPaths ?? [])

  const [workspaceName, setWorkspaceName] = useState(existingWorkspaceName)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!workspaceName.trim() || workspaceName.trim().length < 2) {
      setError('Please enter a workspace name')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      await setupWorkspaceFn({
        data: {
          workspaceName: workspaceName.trim(),
          useCase,
        },
      })

      navigate({ to: '/onboarding/boards' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">Name your workspace</h1>
        <p className="text-muted-foreground">This will be shown on your public feedback portal.</p>
      </div>

      {/* Form card */}
      <div className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card/90 to-card/70 backdrop-blur-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
          className="p-6 space-y-4"
        >
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="workspaceName" className="text-sm font-medium">
              Workspace name
            </label>
            <Input
              id="workspaceName"
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="Acme Corp"
              autoFocus
              disabled={isLoading || workspaceLocked}
              className="h-11"
            />
            {workspaceLocked && (
              <p className="text-xs text-muted-foreground">
                Managed by your administrator&apos;s config — edit there.
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={isLoading || !workspaceName.trim()}
            className="w-full h-11"
          >
            {isLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : 'Continue'}
          </Button>
        </form>
      </div>
    </div>
  )
}
