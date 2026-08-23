import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowPathIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { UseCaseSelector } from '@/components/onboarding/use-case-selector'
import { checkOnboardingState } from '@/lib/server/functions/admin'
import { getCloudIdentityFn } from '@/lib/server/functions/cloud-identity'
import { saveCloudOnboardingGoalFn } from '@/lib/server/functions/onboarding'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { pickOnboardingStep } from './-onboarding-step'

export const Route = createFileRoute('/onboarding/_layout/usecase')({
  loader: async ({ context }) => {
    if (!context.session?.user) throw redirect({ to: '/onboarding/account' })
    const state = await checkOnboardingState()
    const target = pickOnboardingStep({
      session: { userId: context.session.user.id },
      state,
    })
    if (target === '/onboarding/workspace' || state.setupOpenToClaim !== false) {
      throw redirect({ to: '/onboarding/workspace' })
    }
    const identity = await getCloudIdentityFn()
    if (!identity) throw redirect({ to: '/onboarding/workspace' })
    if (target !== '/onboarding/usecase' && state.setupState?.steps.startingPoint) {
      throw redirect({ to: target })
    }
    return { existingUseCase: state.setupState?.useCase }
  },
  component: CloudUseCaseStep,
})

export function CloudUseCaseStep() {
  const navigate = useNavigate()
  const { existingUseCase } = Route.useLoaderData()
  return (
    <CloudUseCaseForm
      existingUseCase={existingUseCase}
      onSave={async (useCase) => {
        const result = await saveCloudOnboardingGoalFn({ data: { useCase } })
        if (result.enabledModules.length === 1) {
          toast.success(`${result.enabledModules[0]} turned on`)
        } else if (result.enabledModules.length > 1) {
          toast.success(`Turned on ${result.enabledModules.join(', ')}`)
        }
        await navigate({ to: '/onboarding/complete' })
      }}
    />
  )
}

export function CloudUseCaseForm(props: {
  existingUseCase?: OnboardingOutcome
  onSave: (useCase: OnboardingOutcome) => Promise<void>
}) {
  const [useCase, setUseCase] = useState<OnboardingOutcome | undefined>(props.existingUseCase)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!useCase) return
    setIsSaving(true)
    setError('')
    try {
      await props.onSave(useCase)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your goal. Try again.')
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mx-auto flex w-full max-w-2xl flex-col gap-7 pb-24 sm:pb-0">
      <header className="text-center">
        <h1 className="text-2xl font-bold">What would you like to accomplish first?</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          We’ll personalize your launch plan around this outcome.
        </p>
      </header>

      <UseCaseSelector
        value={useCase}
        onChange={(value) => setUseCase(value as OnboardingOutcome)}
        disabled={isSaving}
      />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={isSaving || !useCase}
        className="mx-auto h-11 w-full max-w-sm"
      >
        {isSaving && <ArrowPathIcon className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
        Continue
      </Button>
    </form>
  )
}
