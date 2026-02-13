import { createFileRoute, Outlet, redirect, useLocation } from '@tanstack/react-router'
import { getSetupState, isOnboardingComplete } from '@quackback/db/types'
import { CheckIcon } from '@heroicons/react/24/solid'

const ONBOARDING_STEPS = [
  { path: '/onboarding/account', label: 'Account' },
  { path: '/onboarding/usecase', label: 'Use case' },
  { path: '/onboarding/workspace', label: 'Workspace' },
  { path: '/onboarding/boards', label: 'Boards' },
] as const

/**
 * Shared layout for all onboarding steps.
 * Dark theme with amber accents matching website design.
 *
 * Redirects to root if setup is already complete (except for the complete page,
 * which is shown once after finishing onboarding).
 */
export const Route = createFileRoute('/onboarding/_layout')({
  beforeLoad: ({ context, location }) => {
    // Allow the complete page through - it's shown after finishing onboarding
    if (location.pathname === '/onboarding/complete') {
      return
    }

    // If setup is complete, redirect to root - onboarding is not needed
    const setupState = getSetupState(context.settings?.settings?.setupState ?? null)
    if (isOnboardingComplete(setupState)) {
      throw redirect({ to: '/' })
    }
  },
  component: OnboardingLayout,
})

function OnboardingHeader() {
  const location = useLocation()
  const currentPath = location.pathname
  const currentStepIndex = ONBOARDING_STEPS.findIndex((s) => s.path === currentPath)

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
        <div className="relative flex items-center w-full max-w-md mb-2">
          {/* Background line */}
          <div className="absolute top-3.5 left-0 right-0 h-px bg-border" />

          {/* Progress line (filled portion) */}
          {currentStepIndex > 0 && (
            <div
              className="absolute top-3.5 left-0 h-px bg-primary transition-all duration-500"
              style={{
                width: `${(currentStepIndex / (ONBOARDING_STEPS.length - 1)) * 100}%`,
              }}
            />
          )}

          {/* Step circles + labels */}
          <div className="relative flex w-full justify-between">
            {ONBOARDING_STEPS.map((step, index) => {
              const isCompleted = index < currentStepIndex
              const isCurrent = index === currentStepIndex

              return (
                <div key={step.path} className="flex flex-col items-center gap-2">
                  <div
                    className={`
                      flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold
                      transition-all duration-300
                      ${isCompleted ? 'bg-primary text-primary-foreground' : ''}
                      ${isCurrent ? 'bg-primary text-primary-foreground ring-[3px] ring-primary/25 shadow-[0_0_12px_rgba(255,212,59,0.3)]' : ''}
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
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function OnboardingLayout() {
  return (
    <div className="min-h-screen bg-background">
      {/* Background effects - matching website */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_50%_50%_at_50%_30%,rgba(255,212,59,0.06),transparent)]" />
      <div
        className="fixed inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      <main className="relative flex min-h-screen flex-col px-4">
        {/* Zone 1: Header — pinned near top */}
        <div className="shrink-0 pt-20">
          <OnboardingHeader />
        </div>

        {/* Zone 2: Content — flows below header, top-aligned */}
        <div className="flex flex-1 items-start justify-center pb-16 pt-10">
          <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  )
}
