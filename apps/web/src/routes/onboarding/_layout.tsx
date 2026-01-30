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

  // Show step indicator on main setup steps (usecase, workspace, boards)
  const showSteps = currentStepIndex !== -1

  return (
    <div className="mb-10">
      {/* Logo - always visible */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <img src="/logo.png" alt="Quackback" width={32} height={32} />
        <span className="text-xl font-bold">Quackback</span>
      </div>

      {/* Step indicator container - fixed height to prevent layout jumps */}
      <div className="h-7">
        {showSteps && (
          <div className="flex items-center justify-center gap-3">
            {ONBOARDING_STEPS.map((step, index) => {
              const isCompleted = index < currentStepIndex
              const isCurrent = index === currentStepIndex

              return (
                <div key={step.path} className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div
                      className={`
                        flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium transition-colors
                        ${isCompleted ? 'bg-primary text-primary-foreground' : ''}
                        ${isCurrent ? 'bg-primary text-primary-foreground' : ''}
                        ${!isCompleted && !isCurrent ? 'bg-muted text-muted-foreground' : ''}
                      `}
                    >
                      {isCompleted ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
                    </div>
                    <span
                      className={`text-sm ${isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {index < ONBOARDING_STEPS.length - 1 && (
                    <div
                      className={`h-px w-8 ${index < currentStepIndex ? 'bg-primary' : 'bg-border'}`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
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

      <main className="relative flex min-h-screen items-center justify-center px-4 py-16">
        <div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          <OnboardingHeader />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
