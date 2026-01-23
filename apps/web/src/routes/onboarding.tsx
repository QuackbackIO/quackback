import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * Parent route for onboarding - just renders children.
 * The index route handles redirection logic.
 */
export const Route = createFileRoute('/onboarding')({
  component: () => <Outlet />,
})
