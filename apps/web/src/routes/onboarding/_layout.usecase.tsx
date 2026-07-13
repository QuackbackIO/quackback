import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/onboarding/_layout/usecase')({
  loader: () => {
    throw redirect({ to: '/onboarding/workspace' })
  },
  component: () => null,
})
