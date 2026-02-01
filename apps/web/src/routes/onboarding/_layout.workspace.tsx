import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { setupWorkspaceFn } from '@/lib/server/functions/onboarding'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { getSettings } from '@/lib/server/functions/workspace'

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

    // If use case not selected yet, redirect to use case step
    if (!state.setupState?.useCase) {
      throw redirect({ to: '/onboarding/usecase' })
    }

    const settings = await getSettings()

    return {
      existingWorkspaceName: settings?.name ?? '',
      useCase: state.setupState.useCase,
    }
  },
  component: WorkspaceStep,
})

function WorkspaceStep() {
  const navigate = useNavigate()
  const { existingWorkspaceName, useCase } = Route.useLoaderData()

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
              disabled={isLoading}
              className="h-11"
            />
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
