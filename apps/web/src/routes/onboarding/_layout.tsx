import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import {
  getSetupState,
  isOnboardingComplete,
  needsCloudOnboardingWizard,
} from '@/lib/shared/db-types'
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
      throw redirect({ to: '/admin' })
    }
  },
  component: OnboardingLayout,
})

function OnboardingHeader() {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 flex items-center justify-center gap-2">
        <img src="/logo.png" alt="Quackback" width={32} height={32} />
        <span className="text-xl font-bold">Quackback</span>
      </div>
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
