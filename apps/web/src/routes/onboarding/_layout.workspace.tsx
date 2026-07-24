import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { saveWorkspaceAndGoalFn } from '@/lib/server/functions/onboarding'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { UseCaseSelector } from '@/components/onboarding/use-case-selector'
import { pickOnboardingStep } from './-onboarding-step'
import { isPathManagedFromBootstrap, MANAGED_PATHS } from '@/lib/client/config-file'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'
import { normalizeOnboardingOutcome, type OnboardingOutcome } from '@/lib/shared/db-types'

const DRAFT_KEY = 'quackback:onboarding:workspace-goal'

export const Route = createFileRoute('/onboarding/_layout/workspace')({
  loader: async ({ context }) => {
    const { session } = context
    if (!session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    if (state.needsInvitation) throw redirect(buildSigninRedirect('/admin'))
    const target = pickOnboardingStep({
      session: { userId: session.user.id },
      state: {
        needsInvitation: state.needsInvitation,
        setupState: state.setupState,
        principalRecord: state.principalRecord,
      },
    })
    // Back navigation remains available until the starting point is resolved;
    // this lets admins correct either field without creating a duplicate artifact.
    if (state.setupState?.steps.startingPoint) throw redirect({ to: target })
    return {
      existingWorkspaceName: context.settings?.name ?? '',
      existingSlug: context.settings?.slug ?? '',
      existingUseCase: state.setupState?.useCase,
    }
  },
  component: WorkspaceAndGoalStep,
})

function WorkspaceAndGoalStep() {
  const intl = useIntl()
  const navigate = useNavigate()
  const { existingWorkspaceName, existingSlug, existingUseCase } = Route.useLoaderData()
  const { managedFieldPaths } = Route.useRouteContext()
  const nameManaged = isPathManagedFromBootstrap(
    MANAGED_PATHS.WORKSPACE_NAME,
    managedFieldPaths ?? []
  )
  const slugManaged = isPathManagedFromBootstrap(
    MANAGED_PATHS.WORKSPACE_SLUG,
    managedFieldPaths ?? []
  )
  const goalManaged = isPathManagedFromBootstrap(
    MANAGED_PATHS.WORKSPACE_USE_CASE,
    managedFieldPaths ?? []
  )

  const [workspaceName, setWorkspaceName] = useState(existingWorkspaceName)
  const [useCase, setUseCase] = useState<OnboardingOutcome | undefined>(existingUseCase)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const nameValid = workspaceName.trim().length >= 2
  const derivedSlug = useMemo(
    () =>
      workspaceName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    [workspaceName]
  )

  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as {
        workspaceName?: string
        useCase?: OnboardingOutcome
      } | null
      if (!nameManaged && typeof draft?.workspaceName === 'string') {
        setWorkspaceName(draft.workspaceName)
      }
      const draftGoal = normalizeOnboardingOutcome(draft?.useCase)
      if (!goalManaged && draftGoal) setUseCase(draftGoal)
    } catch {
      localStorage.removeItem(DRAFT_KEY)
    }
  }, [goalManaged, nameManaged])

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ workspaceName, useCase }))
  }, [workspaceName, useCase])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!nameValid) {
      setError(
        intl.formatMessage({
          id: 'onboarding.workspace.error.name',
          defaultMessage: 'Enter a workspace name with at least 2 characters.',
        })
      )
      return
    }
    if (!useCase) {
      setError(
        intl.formatMessage({
          id: 'onboarding.workspace.error.goal',
          defaultMessage: 'Choose the first outcome you want to reach.',
        })
      )
      return
    }
    setIsLoading(true)
    setError('')
    try {
      await saveWorkspaceAndGoalFn({
        data: { workspaceName: workspaceName.trim(), useCase },
      })
      localStorage.removeItem(DRAFT_KEY)
      await navigate({ to: '/onboarding/boards' })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'onboarding.error.generic',
              defaultMessage: 'Something went wrong. Try again.',
            })
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 pb-24 sm:pb-0"
    >
      <header className="text-center">
        <h1 className="text-2xl font-bold">
          <FormattedMessage
            id="onboarding.workspace.title"
            defaultMessage="Create your workspace"
          />
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          <FormattedMessage
            id="onboarding.workspace.description"
            defaultMessage="Give your team a home in Quackback, then choose what you want to accomplish first."
          />
        </p>
      </header>

      <div className="space-y-3">
        <label htmlFor="workspaceName" className="text-sm font-medium">
          <FormattedMessage id="onboarding.workspace.name" defaultMessage="Workspace name" />
        </label>
        <Input
          id="workspaceName"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          placeholder="Acme"
          autoFocus
          autoComplete="organization"
          disabled={isLoading || nameManaged}
          className="h-11"
          aria-describedby="workspace-url-hint"
        />
        <p id="workspace-url-hint" className="text-xs text-muted-foreground">
          {nameManaged ? (
            <FormattedMessage
              id="onboarding.workspace.nameManaged"
              defaultMessage="Your workspace admin manages this name."
            />
          ) : slugManaged ? (
            <FormattedMessage
              id="onboarding.workspace.slugManaged"
              defaultMessage="You can edit the name. Your workspace admin has set the portal URL to /{slug}."
              values={{ slug: existingSlug }}
            />
          ) : (
            <FormattedMessage
              id="onboarding.workspace.urlPreview"
              defaultMessage="Portal URL: /{slug}"
              values={{ slug: derivedSlug || 'workspace' }}
            />
          )}
        </p>
      </div>

      {nameValid && (
        <fieldset className="space-y-4 animate-in fade-in duration-200 motion-reduce:animate-none">
          <legend className="text-base font-semibold">
            <FormattedMessage
              id="onboarding.workspace.goalLegend"
              defaultMessage="What would you like to accomplish first?"
            />
          </legend>
          <UseCaseSelector
            value={useCase}
            onChange={(value) => setUseCase(value as OnboardingOutcome)}
            disabled={isLoading || goalManaged}
          />
          {goalManaged && (
            <p className="text-center text-xs text-muted-foreground">
              <FormattedMessage
                id="onboarding.workspace.goalManaged"
                defaultMessage="Your workspace admin selected this goal."
              />
            </p>
          )}
        </fieldset>
      )}

      <div aria-live="polite" aria-atomic="true">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 sm:static sm:border-0 sm:bg-transparent sm:p-0">
        <Button
          type="submit"
          disabled={isLoading || !nameValid || !useCase}
          className="mx-auto h-11 w-full max-w-sm"
        >
          {isLoading ? (
            <>
              <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              <FormattedMessage id="onboarding.workspace.saving" defaultMessage="Saving…" />
            </>
          ) : (
            <FormattedMessage id="onboarding.continue" defaultMessage="Continue" />
          )}
        </Button>
      </div>
    </form>
  )
}
