import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { CheckCircleIcon, ArrowRightIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { getSettings } from '@/lib/server/functions/workspace'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'
import { normalizeOutcome, OUTCOME_HOME } from '@/lib/shared/launch-checklist'

export const Route = createFileRoute('/onboarding/_layout/complete')({
  loader: async ({ context }) => {
    const { session } = context

    if (!session?.user) {
      throw redirect({ to: '/onboarding/account' })
    }

    const state = await checkOnboardingState()

    if (state.needsInvitation) {
      throw redirect(buildSigninRedirect('/admin'))
    }

    if (!state.isOnboardingComplete) {
      if (!state.setupState?.steps?.workspace) {
        throw redirect({ to: '/onboarding/workspace' })
      }
      throw redirect({ to: '/onboarding/boards' })
    }

    const settings = await getSettings()

    return {
      workspaceName: settings?.name ?? 'Your workspace',
      useCase: state.setupState?.useCase,
    }
  },
  component: CompleteStep,
})

function CompleteStep() {
  const navigate = useNavigate()
  const { workspaceName, useCase } = Route.useLoaderData()
  const outcomeHome = OUTCOME_HOME[normalizeOutcome(useCase)]

  return (
    <div className="w-full max-w-md mx-auto text-center">
      <div className="mb-6">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-green-500/10">
          <CheckCircleIcon className="h-10 w-10 text-green-500" />
        </div>
      </div>

      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Welcome to {workspaceName}</h1>
        <p className="text-muted-foreground">
          Your workspace is ready. Next: get your first customer response.
        </p>
      </div>

      <div className="space-y-3 max-w-xs mx-auto">
        <Button onClick={() => navigate({ to: '/admin/getting-started' })} className="w-full h-11">
          See your launch checklist
          <ArrowRightIcon className="ml-2 h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          onClick={() => navigate({ to: outcomeHome.href })}
          className="w-full h-11"
        >
          I&apos;ll explore on my own
        </Button>
      </div>
    </div>
  )
}
