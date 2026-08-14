import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  ArrowRightIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  LinkIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { ActivationActionButton } from '@/components/admin/activation-action-button'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import {
  acknowledgeActivationHandoffFn,
  getActivationBridgeContextFn,
} from '@/lib/server/functions/activation'
import { pickOnboardingStep } from './-onboarding-step'
import type { StartingPointState } from '@/lib/shared/db-types'
import { selectActivationAction } from '@/lib/shared/activation-action'

export const Route = createFileRoute('/onboarding/_layout/complete')({
  loader: async ({ context }) => {
    const { session } = context
    if (!session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    // One check for every reason this is not the caller's step: an earlier step
    // is still open, the handoff is already acknowledged, they have yet to claim
    // the workspace at all, or setup belongs to somebody else.
    const target = pickOnboardingStep({ session: { userId: session.user.id }, state })
    if (target !== '/onboarding/complete') throw redirect({ to: target })
    return getActivationBridgeContextFn()
  },
  component: ActivationBridge,
})

function ActivationBridge() {
  const intl = useIntl()
  const navigate = useNavigate()
  const { workspaceName, workspaceSlug, startingPoint, resourceLabel, starterBoard } =
    Route.useLoaderData()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const action = selectActivationAction({
    surface: 'onboarding_handoff',
    startingPoint,
    status: {
      hasBoards: Boolean(starterBoard),
      hasPublicBoard: Boolean(starterBoard),
      publicBoardId: starterBoard?.id,
      publicBoardSlug: starterBoard?.slug,
      publicBoardPath: starterBoard?.publicPath,
      memberCount: 1,
      hasBranding: false,
      hasWidgetEnabled: startingPoint.resourceType === 'messenger',
      useCase: startingPoint.outcome,
    },
  })

  async function continueToAction() {
    setIsLoading(true)
    setError('')
    try {
      await acknowledgeActivationHandoffFn()
      if (!action || action.kind === 'copy') return
      window.location.assign(action.destination)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : intl.formatMessage({
              id: 'onboarding.error.generic',
              defaultMessage: 'Something went wrong. Try again.',
            })
      )
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 text-center">
      <header>
        <p className="text-sm font-medium text-primary">
          <FormattedMessage id="onboarding.bridge.eyebrow" defaultMessage="Workspace ready" />
        </p>
        <h1 className="mt-2 text-3xl font-bold">
          <FormattedMessage
            id="onboarding.bridge.title"
            defaultMessage="{workspaceName} is ready for the next step"
            values={{ workspaceName }}
          />
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          {startingPoint.resolution === 'deferred' ? (
            <FormattedMessage
              id="onboarding.bridge.deferred"
              defaultMessage="No problem — we’ve saved this step for later. You’ll find it in your launch plan."
            />
          ) : startingPoint.resolution === 'unavailable' ? (
            <FormattedMessage
              id="onboarding.bridge.unavailable"
              defaultMessage="We couldn’t finish this step yet. Your launch plan will show what needs attention and who can help."
            />
          ) : (
            <FormattedMessage
              id="onboarding.bridge.description"
              defaultMessage="Your starting point is ready. Take one more step to begin seeing results."
            />
          )}
        </p>
      </header>

      <BridgeArtifact
        startingPoint={startingPoint}
        workspaceName={workspaceName}
        workspaceSlug={workspaceSlug}
        resourceLabel={resourceLabel}
      />

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      {action?.kind === 'copy' ? (
        <ActivationActionButton
          action={action}
          className="h-11 min-w-56"
          onCompleted={async () => {
            await acknowledgeActivationHandoffFn()
            await navigate({ to: '/admin/feedback' })
          }}
        />
      ) : action ? (
        <Button onClick={continueToAction} disabled={isLoading} className="h-11 min-w-56">
          {isLoading ? (
            <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <>
              {action.label}
              <ArrowRightIcon className="h-4 w-4" />
            </>
          )}
        </Button>
      ) : null}
    </div>
  )
}

function BridgeArtifact({
  startingPoint,
  workspaceName,
  workspaceSlug,
  resourceLabel,
}: {
  startingPoint: StartingPointState
  workspaceName: string
  workspaceSlug: string
  resourceLabel: string | null
}) {
  const outcome = startingPoint.outcome
  const Icon =
    outcome === 'customer_support'
      ? ChatBubbleLeftRightIcon
      : outcome === 'help_center'
        ? BookOpenIcon
        : outcome === 'internal'
          ? LockClosedIcon
          : LinkIcon
  const title =
    startingPoint.resolution === 'deferred'
      ? 'Ready when you are'
      : startingPoint.resolution === 'unavailable'
        ? 'Needs attention'
        : (resourceLabel ??
          (outcome === 'customer_support'
            ? `${workspaceName} Messenger`
            : outcome === 'help_center'
              ? 'Getting started article'
              : outcome === 'internal'
                ? 'Team feedback'
                : 'Product feedback'))
  const detail =
    startingPoint.resolution === 'deferred'
      ? 'Saved in your launch plan'
      : startingPoint.resolution === 'unavailable'
        ? 'Your launch plan shows what needs attention'
        : outcome === 'customer_support'
          ? 'Messenger is ready to install'
          : outcome === 'help_center'
            ? 'Ready to continue'
            : outcome === 'internal'
              ? 'Private board'
              : `/${workspaceSlug || 'workspace'}/feedback`
  return (
    <div className="mx-auto flex max-w-lg items-center gap-4 rounded-2xl border bg-card p-6 text-left">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold">
          {resourceLabel &&
          startingPoint.resolution !== 'deferred' &&
          startingPoint.resolution !== 'unavailable' ? (
            resourceLabel
          ) : (
            <FormattedMessage
              id={`onboarding.bridge.artifact.${
                startingPoint.resolution === 'deferred' ||
                startingPoint.resolution === 'unavailable'
                  ? startingPoint.resolution
                  : outcome
              }.title`}
              defaultMessage={title}
            />
          )}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <FormattedMessage
            id={`onboarding.bridge.artifact.${
              startingPoint.resolution === 'deferred' || startingPoint.resolution === 'unavailable'
                ? startingPoint.resolution
                : outcome
            }.detail`}
            defaultMessage={detail}
          />
        </p>
      </div>
    </div>
  )
}
