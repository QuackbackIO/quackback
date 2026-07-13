import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import {
  completeStartingPointFn,
  getStartingPointContextFn,
} from '@/lib/server/functions/activation'
import { pickOnboardingStep } from './-onboarding-step'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'
import type { OnboardingOutcome } from '@/lib/shared/db-types'

const OUTCOME_COPY: Record<
  OnboardingOutcome,
  { title: string; description: string; action: string; artifact: string }
> = {
  product_feedback: {
    title: 'Create a home for customer feedback',
    description: 'Start with a public board where customers can share ideas and vote.',
    action: 'Create feedback board',
    artifact: 'Product feedback',
  },
  customer_support: {
    title: 'Set up Messenger',
    description:
      'Choose how customers can contact you. We’ll confirm installation once Messenger appears on your website.',
    action: 'Set up Messenger',
    artifact: 'Customer support',
  },
  help_center: {
    title: 'Write your first help article',
    description: 'We’ll prepare a Getting started draft for you to shape into a useful answer.',
    action: 'Create article draft',
    artifact: 'Help Center',
  },
  internal: {
    title: 'Create a private space for team ideas',
    description: 'Give your team one place to share, discuss, and prioritize internal feedback.',
    action: 'Create private board',
    artifact: 'Internal feedback',
  },
}

export const Route = createFileRoute('/onboarding/_layout/boards')({
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
    if (target !== '/onboarding/boards') throw redirect({ to: target })
    const startingPoint = await getStartingPointContextFn()
    return {
      ...startingPoint,
      workspaceName: context.settings?.name ?? context.settings?.settings?.name ?? 'Your workspace',
      workspaceSlug: context.settings?.slug ?? context.settings?.settings?.slug ?? '',
    }
  },
  component: StartingPointStep,
})

function StartingPointStep() {
  const intl = useIntl()
  const navigate = useNavigate()
  const data = Route.useLoaderData()
  const copy = OUTCOME_COPY[data.outcome]
  const [pendingAction, setPendingAction] = useState<'complete' | 'defer' | null>(null)
  const [error, setError] = useState('')

  async function submit(action: 'complete' | 'defer') {
    setPendingAction(action)
    setError('')
    try {
      await completeStartingPointFn({ data: { action } })
      await navigate({ to: '/onboarding/complete' })
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
      setPendingAction(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <header className="text-center">
        <p className="text-sm font-medium text-primary">
          <FormattedMessage
            id={`onboarding.startingPoint.${data.outcome}.artifact`}
            defaultMessage={copy.artifact}
          />
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          <FormattedMessage
            id={`onboarding.startingPoint.${data.outcome}.title`}
            defaultMessage={copy.title}
          />
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
          <FormattedMessage
            id={`onboarding.startingPoint.${data.outcome}.description`}
            defaultMessage={copy.description}
          />
        </p>
      </header>

      <ArtifactPreview
        outcome={data.outcome}
        workspaceName={data.workspaceName}
        workspaceSlug={data.workspaceSlug}
        available={data.available}
        existingBoardName={data.existingBoardName}
      />

      {!data.available && (
        <div role="status" className="rounded-xl border bg-muted/40 px-5 py-4">
          <p className="font-medium">
            <FormattedMessage
              id="onboarding.startingPoint.unavailable"
              defaultMessage="We can’t create this yet"
            />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            <FormattedMessage
              id={`onboarding.startingPoint.${data.outcome}.blocked`}
              defaultMessage={data.blockedReason ?? ''}
            />
          </p>
          {data.goalManaged && (
            <p className="mt-2 text-xs text-muted-foreground">
              <FormattedMessage
                id="onboarding.startingPoint.managedUnavailable"
                defaultMessage="This goal is managed for your workspace. We’ll keep your selection and show you what needs attention next."
              />
            </p>
          )}
        </div>
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

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          onClick={() => navigate({ to: '/onboarding/workspace' })}
          disabled={pendingAction !== null}
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <FormattedMessage id="onboarding.back" defaultMessage="Back" />
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => submit('defer')}
            disabled={pendingAction !== null}
          >
            {pendingAction === 'defer' && (
              <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            )}
            <FormattedMessage id="onboarding.startingPoint.later" defaultMessage="Do this later" />
          </Button>
          <Button
            type="button"
            className="h-11"
            onClick={() => submit('complete')}
            disabled={pendingAction !== null}
          >
            {pendingAction === 'complete' && (
              <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            )}
            {data.available ? (
              <FormattedMessage
                id={
                  data.existingBoardName
                    ? `onboarding.startingPoint.${data.outcome}.existingAction`
                    : `onboarding.startingPoint.${data.outcome}.action`
                }
                defaultMessage={data.existingBoardName ? 'Use existing board' : copy.action}
              />
            ) : (
              <FormattedMessage
                id="onboarding.startingPoint.continueUnavailable"
                defaultMessage="View next steps"
              />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ArtifactPreview({
  outcome,
  workspaceName,
  workspaceSlug,
  available,
  existingBoardName,
}: {
  outcome: OnboardingOutcome
  workspaceName: string
  workspaceSlug: string
  available: boolean
  existingBoardName: string | null
}) {
  const Icon =
    outcome === 'customer_support'
      ? ChatBubbleLeftRightIcon
      : outcome === 'help_center'
        ? BookOpenIcon
        : outcome === 'internal'
          ? LockClosedIcon
          : LinkIcon
  return (
    <div className="mx-auto max-w-xl rounded-2xl border bg-card p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold">
            {existingBoardName ? (
              existingBoardName
            ) : (
              <FormattedMessage
                id={`onboarding.startingPoint.${outcome}.previewTitle`}
                defaultMessage={
                  outcome === 'help_center'
                    ? 'Getting started'
                    : outcome === 'customer_support'
                      ? '{workspaceName} Support'
                      : outcome === 'internal'
                        ? 'Team feedback'
                        : 'Product feedback'
                }
                values={{ workspaceName }}
              />
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {available ? (
              <FormattedMessage
                id={`onboarding.startingPoint.${outcome}.previewDetail`}
                defaultMessage={
                  outcome === 'customer_support'
                    ? 'Messenger for your website'
                    : outcome === 'help_center'
                      ? 'Draft article'
                      : outcome === 'internal'
                        ? 'Private to your team'
                        : '/{workspaceSlug}/feedback'
                }
                values={{ workspaceSlug: workspaceSlug || 'workspace' }}
              />
            ) : (
              <FormattedMessage
                id="onboarding.startingPoint.previewUnavailable"
                defaultMessage="Not available yet"
              />
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
