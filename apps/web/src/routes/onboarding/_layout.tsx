import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router'
import {
  getSetupState,
  isOnboardingComplete,
  needsActivationHandoff,
  needsCloudOnboardingWizard,
} from '@/lib/shared/db-types'
import { CheckIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { ALL_ONBOARDING_STEPS } from './-onboarding-steps'
import { mayForwardCompletedSetup } from './-onboarding-step'
import { SignOutButton } from './-sign-out-button'

/**
 * Shared layout for all onboarding steps.
 * Redirects to root if setup is already complete (except for the complete page,
 * which is shown once after finishing onboarding).
 */
export const Route = createFileRoute('/onboarding/_layout')({
  beforeLoad: ({ context, location }) => {
    // A pre-stamped workspace still needs an authenticated owner. Redirecting
    // an anonymous visitor to the handoff would bounce between that route and
    // the account step forever.
    if (!context.session?.user) return
    if (!mayForwardCompletedSetup({ pathname: location.pathname, userRole: context.userRole })) {
      return
    }
    const setupState = getSetupState(context.settings?.settings?.setupState ?? null)
    if (isOnboardingComplete(setupState) && !needsCloudOnboardingWizard(setupState)) {
      if (needsActivationHandoff(setupState) && location.pathname !== '/onboarding/complete') {
        throw redirect({ to: '/onboarding/complete' })
      }
      if (setupState?.activationHandoffSeenAt) throw redirect({ to: '/admin/getting-started' })
    }
  },
  component: OnboardingLayout,
})

function OnboardingHeader() {
  const intl = useIntl()
  const location = useLocation()
  const currentPath = location.pathname

  const steps = ALL_ONBOARDING_STEPS
  const stepPath = currentPath === '/onboarding/usecase' ? '/onboarding/workspace' : currentPath
  const currentStepIndex = steps.findIndex((s) => s.path === stepPath)
  const showSteps = currentStepIndex !== -1

  return (
    <div className="flex flex-col items-center">
      {/* Logo */}
      <div className="flex items-center justify-center gap-2 mb-8">
        <img src="/logo.png" alt="Quackback" width={32} height={32} />
        <span className="text-xl font-bold">Quackback</span>
      </div>

      {/* Stepper */}
      {showSteps && (
        <nav
          aria-label={intl.formatMessage({
            id: 'onboarding.progress.label',
            defaultMessage: 'Setup progress',
          })}
          className="relative mb-2 w-full max-w-lg"
        >
          {/* Background line */}
          <div className="absolute top-3.5 left-0 right-0 h-px bg-border" />

          {/* Progress line (filled portion) */}
          {currentStepIndex > 0 && steps.length > 1 && (
            <div
              className="absolute top-3.5 left-0 h-px bg-primary transition-all duration-500 motion-reduce:transition-none"
              style={{
                width: `${(currentStepIndex / (steps.length - 1)) * 100}%`,
              }}
            />
          )}

          {/* Step circles + labels */}
          <ol className="relative flex w-full justify-between">
            {steps.map((step, index) => {
              const isCompleted = index < currentStepIndex
              const isCurrent = index === currentStepIndex

              return (
                <li
                  key={step.path}
                  className="flex flex-col items-center gap-2"
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <div
                    className={`
                      flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold
                      transition-all duration-300 motion-reduce:transition-none
                      ${isCompleted ? 'bg-primary text-primary-foreground' : ''}
                      ${isCurrent ? 'bg-primary text-primary-foreground ring-[3px] ring-primary/20' : ''}
                      ${!isCompleted && !isCurrent ? 'border border-border bg-background text-muted-foreground' : ''}
                    `}
                  >
                    {isCompleted ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
                  </div>
                  <span
                    className={`text-xs transition-colors duration-300 ${
                      isCurrent
                        ? 'text-foreground font-medium'
                        : isCompleted
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/60'
                    }`}
                  >
                    <FormattedMessage
                      id={`onboarding.step.${index + 1}`}
                      defaultMessage={step.label}
                    />
                  </span>
                </li>
              )
            })}
          </ol>
        </nav>
      )}
    </div>
  )
}

function OnboardingLayout() {
  // Which step the wizard shows is decided by whoever the browser is signed in
  // as, so every signed-in step carries the one control that changes that
  // answer. Without it a visitor signed in as the wrong account has nothing to
  // press anywhere in the flow.
  const { session } = Route.useRouteContext()

  return (
    <div className="min-h-screen bg-background">
      <main className="relative flex min-h-screen flex-col px-4 sm:px-6">
        {/* Zone 1: Header — pinned near top */}
        <div className="shrink-0 pt-10 sm:pt-16">
          <OnboardingHeader />
        </div>

        {/* Zone 2: Content — flows below header, top-aligned */}
        <div className="flex flex-1 items-start justify-center pb-16 pt-10">
          <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none">
            <Outlet />
          </div>
        </div>

        {session?.user && (
          <div className="shrink-0 pb-8 text-center">
            <SignOutButton size="sm" />
          </div>
        )}
      </main>
    </div>
  )
}
