import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowPathIcon, ArrowRightIcon, CheckIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { checkOnboardingState, fetchOnboardingStatus } from '@/lib/server/functions/admin'
import {
  acknowledgeActivationHandoffFn,
  getActivationBridgeContextFn,
} from '@/lib/server/functions/activation'
import { pickOnboardingStep } from './-onboarding-step'
import { displayWorkspaceName } from './-ready-copy'
import {
  buildLaunchTasks,
  OUTCOME_TAB_LABEL,
  type LaunchStatus,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/onboarding/_layout/complete')({
  loader: async ({ context }) => {
    const { session } = context
    if (!session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    const target = pickOnboardingStep({ session: { userId: session.user.id }, state })
    if (target !== '/onboarding/complete') throw redirect({ to: target })
    const [bridge, status] = await Promise.all([
      getActivationBridgeContextFn(),
      fetchOnboardingStatus(),
    ])
    return { ...bridge, status }
  },
  component: ReadyStep,
})

function ReadyStep() {
  const intl = useIntl()
  const { workspaceName, startingPoint, status } = Route.useLoaderData()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const outcome = startingPoint.outcome
  const tasks = buildLaunchTasks(status as LaunchStatus, outcome)
    .filter((task) => task.classification !== 'polish')
    .slice(0, 4)
  const named = displayWorkspaceName(workspaceName)

  async function openWorkspace() {
    setIsLoading(true)
    setError('')
    try {
      await acknowledgeActivationHandoffFn()
      window.location.assign('/admin/getting-started')
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
    <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
      <span
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <CheckIcon className="h-6 w-6" />
      </span>

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
        <FormattedMessage id="onboarding.bridge.eyebrow" defaultMessage="Ready" />
      </p>
      <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-[2.15rem]">
        <FormattedMessage id="onboarding.bridge.title" defaultMessage="Your workspace is ready" />
      </h1>
      {named ? <p className="mt-2 text-sm font-medium text-foreground/80">{named}</p> : null}
      <p className="mt-2 max-w-sm text-balance text-sm text-muted-foreground">
        <FormattedMessage
          id="onboarding.bridge.description"
          defaultMessage="Here’s what we’ll help you do first for {goal}."
          values={{ goal: OUTCOME_TAB_LABEL[outcome] }}
        />
      </p>

      {tasks.length > 0 ? <LaunchPreview tasks={tasks} /> : null}

      <div aria-live="polite" className="mt-4 w-full">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <Button onClick={openWorkspace} disabled={isLoading} className="mt-6 h-11 w-full">
        {isLoading ? (
          <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <>
            <FormattedMessage
              id="onboarding.bridge.continue"
              defaultMessage="Open your workspace"
            />
            <ArrowRightIcon className="h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  )
}

function LaunchPreview({ tasks }: { tasks: LaunchTask[] }) {
  const firstOpen = tasks.findIndex((task) => !task.isCompleted)
  return (
    <ol className="mt-8 w-full divide-y divide-border/70 rounded-2xl border bg-card/60 px-1 text-left">
      {tasks.map((task, index) => {
        const status = task.isCompleted ? 'done' : index === firstOpen ? 'current' : 'pending'
        return (
          <li key={task.id} className="flex items-center gap-3 px-4 py-3.5">
            <PreviewMark status={status} />
            <span
              className={cn(
                'text-[15px] leading-snug',
                status === 'done' && 'text-muted-foreground',
                status === 'current' && 'font-medium text-foreground',
                status === 'pending' && 'text-muted-foreground/60'
              )}
            >
              {task.title}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function PreviewMark({ status }: { status: 'done' | 'current' | 'pending' }) {
  if (status === 'done') {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        aria-label="Done"
      >
        <CheckIcon className="h-3 w-3" />
      </span>
    )
  }
  if (status === 'current') {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary/10"
        aria-label="Up next"
      />
    )
  }
  return <span className="h-5 w-5 shrink-0 rounded-full border border-border" aria-label="Later" />
}
