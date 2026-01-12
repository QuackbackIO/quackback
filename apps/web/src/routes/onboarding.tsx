import { createFileRoute, redirect } from '@tanstack/react-router'
import { checkOnboardingState } from '@/lib/server-functions/admin'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'

export const Route = createFileRoute('/onboarding')({
  loader: async ({ context }) => {
    // Session and settings already available from root context
    const { session, settings } = context

    // Determine starting step based on state
    // Flow: create-account → setup-workspace → choose-boards → complete
    let initialStep: 'create-account' | 'setup-workspace' = 'create-account'

    if (session?.user) {
      // Check onboarding state via server function
      const state = await checkOnboardingState({ data: session.user.id })

      if (state.needsInvitation) {
        // Not first user - they need an invitation
        throw redirect({ to: '/auth/login' })
      }

      // User is authenticated with member record
      if (settings) {
        // Workspace is set up, onboarding complete - redirect to admin
        // (Users can create boards later from the admin dashboard)
        throw redirect({ to: '/admin' })
      } else {
        // Authenticated but no settings - need to set up workspace
        initialStep = 'setup-workspace'
      }
    }
    // else: Not authenticated - start with account creation

    return {
      initialStep,
      userName: session?.user?.name,
    }
  },
  component: OnboardingPage,
})

function OnboardingPage() {
  const { initialStep, userName } = Route.useLoaderData()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Subtle gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 pointer-events-none" />

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">
          <OnboardingWizard initialStep={initialStep} userName={userName} />
        </div>
      </main>
    </div>
  )
}
