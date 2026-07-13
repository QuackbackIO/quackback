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
import { checkOnboardingState } from '@/lib/server/functions/admin'
import {
  acknowledgeActivationHandoffFn,
  getActivationBridgeContextFn,
} from '@/lib/server/functions/activation'
import { pickOnboardingStep } from './-onboarding-step'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'
import type { OnboardingOutcome, StartingPointState } from '@/lib/shared/db-types'

export const Route = createFileRoute('/onboarding/_layout/complete')({
  loader: async ({ context }) => {
    const { session } = context
    if (!session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    if (state.needsInvitation) throw redirect(buildSigninRedirect('/admin'))
    if (!state.setupState?.steps.startingPoint) {
      const target = pickOnboardingStep({
        session: { userId: session.user.id },
        state: {
          needsInvitation: state.needsInvitation,
          setupState: state.setupState,
          principalRecord: state.principalRecord,
        },
      })
      throw redirect({ to: target })
    }
    if (state.setupState.activationHandoffSeenAt) throw redirect({ to: '/admin' })
    return getActivationBridgeContextFn()
  },
  component: ActivationBridge,
})

function ActivationBridge() {
  const intl = useIntl()
  const navigate = useNavigate()
  const { workspaceName, workspaceSlug, startingPoint, resourceLabel } = Route.useLoaderData()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const action = bridgeAction(startingPoint)

  async function continueToAction() {
    setIsLoading(true)
    setError('')
    try {
      await acknowledgeActivationHandoffFn()
      if (action.params) await navigate({ to: action.href, params: action.params })
      else await navigate({ to: action.href })
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

      <Button onClick={continueToAction} disabled={isLoading} className="h-11 min-w-56">
        {isLoading ? (
          <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <>
            <FormattedMessage id={action.messageId} defaultMessage={action.label} />
            <ArrowRightIcon className="h-4 w-4" />
          </>
        )}
      </Button>
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

function bridgeAction(startingPoint: StartingPointState): {
  href:
    | '/admin/getting-started'
    | '/admin/settings/widget'
    | '/admin/help-center/articles/$articleId'
    | '/admin/settings/members'
  params?: { articleId: string }
  label: string
  messageId: string
} {
  if (startingPoint.resolution === 'deferred' || startingPoint.resolution === 'unavailable') {
    return {
      href: '/admin/getting-started',
      label: 'View your launch plan',
      messageId: 'onboarding.bridge.action.launchPlan',
    }
  }
  switch (startingPoint.outcome as OnboardingOutcome) {
    case 'customer_support':
      return {
        href: '/admin/settings/widget',
        label: 'Install or delegate Messenger',
        messageId: 'onboarding.bridge.action.messenger',
      }
    case 'help_center':
      return startingPoint.resourceId
        ? {
            href: '/admin/help-center/articles/$articleId',
            params: { articleId: startingPoint.resourceId },
            label: 'Continue the article',
            messageId: 'onboarding.bridge.action.article',
          }
        : {
            href: '/admin/getting-started',
            label: 'View your launch plan',
            messageId: 'onboarding.bridge.action.launchPlan',
          }
    case 'internal':
      return {
        href: '/admin/settings/members',
        label: 'Invite teammates',
        messageId: 'onboarding.bridge.action.invite',
      }
    case 'product_feedback':
    default:
      return {
        href: '/admin/settings/widget',
        label: 'Share or install feedback',
        messageId: 'onboarding.bridge.action.feedback',
      }
  }
}
